import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';
import { OrderSource, OrderStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { InvoicePdfService } from './invoice-pdf.service';

export class OrderService {
  /**
   * Create POS Order with transactional atomic stock deduction
   */
  async createPosOrder(data: {
    userId: number;
    source: OrderSource; // POS_RETAIL or POS_WHOLESALE
    customerId?: number;
    customerName?: string;
    customerPhone?: string;
    items: {
      variantId: number;
      quantity: number;
      unitPrice: number;
      discount?: number;
      price: number;
    }[];
    subtotal: number;
    discount?: number;
    totalAmount: number;
    paidAmount?: number;
    paymentMethod: string; // CASH, CARD, CREDIT, CHEQUE
    notes?: string;
  }) {
    if (!data.items || data.items.length === 0) {
      throw new HttpException(400, 'Order must contain at least one item');
    }

    return prisma.$transaction(async (tx) => {
      // 1. Verify and reduce variant inventory stock
      for (const item of data.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          throw new HttpException(404, `Product variant #${item.variantId} not found`);
        }

        if (variant.stock < item.quantity) {
          throw new HttpException(
            400,
            `Insufficient stock for "${variant.product.name}" (${variant.size}/${variant.color}). Available: ${variant.stock}`
          );
        }

        // Deduct inventory stock
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const paid = Number(data.paidAmount) || 0;
      const total = Number(data.totalAmount) || 0;
      const isFullPaid = paid >= total;

      // 2. Create parent order entry
      const order = await tx.order.create({
        data: {
          source: data.source || OrderSource.POS_RETAIL,
          userId: data.userId,
          customerId: data.customerId ? Number(data.customerId) : null,
          customerName: data.customerName || 'Walk-in Customer',
          customerPhone: data.customerPhone || null,
          subtotal: Number(data.subtotal) || total,
          discount: Number(data.discount) || 0,
          totalAmount: total,
          paidAmount: paid,
          status: isFullPaid ? OrderStatus.PAID : OrderStatus.PROCESSING,
          paymentMethod: data.paymentMethod || 'CASH',
          notes: data.notes || null,
          items: {
            create: data.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              discount: i.discount || 0,
              price: i.price,
            })),
          },
          payments:
            paid > 0
              ? {
                  create: [
                    {
                      amount: paid,
                      method: data.paymentMethod || 'CASH',
                    },
                  ],
                }
              : undefined,
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { name: true } },
                },
              },
            },
          },
          customer: true,
          user: { select: { id: true, name: true } },
        },
      });

      // 3. Update customer outstanding balance if credit was used
      if (data.customerId && total > paid) {
        const creditDue = total - paid;
        await tx.customer.update({
          where: { id: Number(data.customerId) },
          data: { outstandingBalance: { increment: creditDue } },
        });
      }

      return order;
    });
  }

  /**
   * Retrieve active catalog variants formatted for POS searching and scanning
   */
  /**
   * Retrieve active catalog variants with complete image assets for color matching
   */
  async getPosCatalog() {
    return prisma.productVariant.findMany({
      include: {
        images: { select: { imageUrl: true }, take: 1 },
        product: {
          select: {
            id: true,
            name: true,
            searchKey: true,
            category: { select: { name: true } },
            images: { orderBy: { order: 'asc' }, select: { id: true, imageUrl: true } },
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });
  }

  /**
   * Get paginated & filtered Invoices list with search & customer filter
   */
  async getInvoices(params: {
    search?: string;
    customerId?: number;
    paymentMethod?: string;
    source?: OrderSource;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 15);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.source) {
      where.source = params.source;
    }

    if (params.customerId) {
      where.customerId = Number(params.customerId);
    }

    if (params.paymentMethod && params.paymentMethod !== 'ALL') {
      where.paymentMethod = params.paymentMethod;
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      const numQuery = Number(q);
      where.OR = [
        ...(!isNaN(numQuery) ? [{ id: numQuery }] : []),
        { customerName: { contains: q } },
        { customerPhone: { contains: q } },
        { paymentMethod: { contains: q } },
      ];
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true, outstandingBalance: true } },
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
          user: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      data: orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get single invoice order details for editing in POS modal
   */
  async getInvoiceById(id: number) {
    const order = await prisma.order.findUnique({
      where: { id: Number(id) },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            city: true,
            outstandingBalance: true,
          },
        },
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    images: { orderBy: { order: 'asc' }, select: { imageUrl: true } },
                  },
                },
                images: { select: { imageUrl: true }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new HttpException(404, `Invoice #${id} not found`);
    }

    // Attach resolved customer address into shippingAddress fallback for frontend print parities
    if (order.customer?.address && !order.shippingAddress) {
      (order as any).shippingAddress = order.customer.address;
    }

    return order;
  }

  /**
   * Update existing invoice:
   * 1. Reverts previous item inventory stock and deducts updated item inventory stock.
   * 2. Recalculates credit due delta and increments/decrements customer outstandingBalance atomically.
   */
  async updateInvoiceOrder(
    orderId: number,
    data: {
      customerId?: number;
      customerName?: string;
      customerPhone?: string;
      items: {
        variantId: number;
        quantity: number;
        unitPrice: number;
        price: number;
      }[];
      subtotal: number;
      discount?: number;
      totalAmount: number;
      paidAmount: number;
      paymentMethod: string;
    }
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!existing) {
        throw new HttpException(404, `Invoice #${orderId} not found`);
      }

      // 1. Revert previous stock
      for (const oldItem of existing.items) {
        await tx.productVariant.update({
          where: { id: oldItem.variantId },
          data: { stock: { increment: oldItem.quantity } },
        });
      }

      // 2. Validate and deduct new stock
      for (const newItem of data.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: newItem.variantId },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          throw new HttpException(404, `Product variant #${newItem.variantId} not found`);
        }

        if (variant.stock < newItem.quantity) {
          throw new HttpException(
            400,
            `Insufficient stock for "${variant.product.name}" (${variant.size}/${variant.color}). Available: ${variant.stock}`
          );
        }

        await tx.productVariant.update({
          where: { id: newItem.variantId },
          data: { stock: { decrement: newItem.quantity } },
        });
      }

      // 3. Bulletproof Financial and Customer Credit Delta Sync
      const oldTotal = Number(existing.totalAmount || 0);
      const oldPaid = Number(existing.paidAmount || 0);
      const oldCreditDue = Math.max(0, oldTotal - oldPaid);

      const newTotal = Number(data.totalAmount || 0);
      const newPaid = Math.min(newTotal, Math.max(0, Number(data.paidAmount || 0)));
      const newCreditDue = Math.max(0, newTotal - newPaid);

      const targetCustomerId = data.customerId ? Number(data.customerId) : existing.customerId;

      if (existing.customerId && targetCustomerId && existing.customerId === targetCustomerId) {
        // Same customer: adjust only the net difference (newCreditDue - oldCreditDue)
        const creditDelta = newCreditDue - oldCreditDue;
        if (creditDelta !== 0) {
          await tx.customer.update({
            where: { id: targetCustomerId },
            data: { outstandingBalance: { increment: creditDelta } },
          });
        }
      } else {
        // Customer was switched: rollback old credit and apply new credit to new customer
        if (existing.customerId && oldCreditDue > 0) {
          await tx.customer.update({
            where: { id: existing.customerId },
            data: { outstandingBalance: { decrement: oldCreditDue } },
          });
        }
        if (targetCustomerId && newCreditDue > 0) {
          await tx.customer.update({
            where: { id: targetCustomerId },
            data: { outstandingBalance: { increment: newCreditDue } },
          });
        }
      }

      // 4. Update order items and sync payments ledger
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.orderPayment.deleteMany({ where: { orderId } });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          customerId: targetCustomerId || null,
          customerName: data.customerName || 'Walk-in Customer',
          customerPhone: data.customerPhone || null,
          subtotal: Number(data.subtotal),
          discount: Number(data.discount) || 0,
          totalAmount: newTotal,
          paidAmount: newPaid,
          paymentMethod: newCreditDue > 0 ? 'CREDIT' : data.paymentMethod || 'CASH',
          status: newPaid >= newTotal ? OrderStatus.PAID : OrderStatus.PROCESSING,
          items: {
            create: data.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              price: i.price,
            })),
          },
          payments: newPaid > 0 ? {
            create: [
              {
                amount: newPaid,
                method: data.paymentMethod === 'CREDIT' ? 'CASH' : (data.paymentMethod || 'CASH'),
              }
            ]
          } : undefined,
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { name: true } },
                },
              },
            },
          },
          customer: true,
        },
      });

      return updatedOrder;
    });
  }

  /**
   * Delete invoice with automatic inventory stock roll-back and credit cancellation
   */
  async deleteInvoiceOrder(orderId: number) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new HttpException(404, `Invoice #${orderId} not found`);
      }

      // Rollback stock
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }

      // Cancel remaining credit from customer outstanding balance
      const creditDue = Math.max(0, order.totalAmount - order.paidAmount);
      if (order.customerId && creditDue > 0) {
        await tx.customer.update({
          where: { id: order.customerId },
          data: { outstandingBalance: { decrement: creditDue } },
        });
      }

      await tx.order.delete({ where: { id: orderId } });
      return { success: true, message: `Invoice #${orderId} deleted successfully` };
    });
  }

  /**
   * Delegates PDF rendering to dedicated InvoicePdfService ensuring Clean Architecture
   */
  async generateInvoicePdf(orderId: number) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: {
          include: {
            variant: {
              include: { product: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!order) {
      throw new HttpException(404, `Invoice #${orderId} not found`);
    }

    return InvoicePdfService.generate(order);
  }


  /**
   * Settle customer outstanding balance with flexible invoice allocation strategies:
   * - FULL: Marks all unpaid customer credit invoices as fully paid.
   * - PARTIAL (FIFO): Settles oldest invoices first.
   * - PARTIAL (LIFO): Settles newest invoices first.
   * - PARTIAL (CUSTOM): Allocates payment strictly across selected invoice IDs.
   */
  async settleCustomerDebt(data: {
    customerId: number;
    amount: number;
    strategy: 'FULL' | 'FIFO' | 'LIFO' | 'CUSTOM';
    selectedInvoiceIds?: number[];
    paymentMethod?: string;
    notes?: string;
  }) {
    const { customerId, amount, strategy, selectedInvoiceIds = [], paymentMethod = 'CASH' } = data;

    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new HttpException(404, `Customer #${customerId} not found`);
      }

      if (customer.outstandingBalance <= 0) {
        throw new HttpException(400, 'Customer does not have any outstanding debt');
      }

      const paymentToApply = strategy === 'FULL' 
        ? customer.outstandingBalance 
        : Math.min(amount, customer.outstandingBalance);

      if (paymentToApply <= 0) {
        throw new HttpException(400, 'Invalid settlement amount');
      }

      // Query unpaid/partially paid credit invoices for this customer (Excludes CANCELLED & PAID)
      const whereCondition: any = {
        customerId,
        paymentMethod: 'CREDIT',
        status: { in: [OrderStatus.PROCESSING, OrderStatus.PENDING, OrderStatus.DELIVERED] },
      };

      if (strategy === 'CUSTOM' && selectedInvoiceIds.length > 0) {
        whereCondition.id = { in: selectedInvoiceIds };
      }

      const unpaidOrders = await tx.order.findMany({
        where: whereCondition,
        orderBy: { createdAt: strategy === 'LIFO' ? 'desc' : 'asc' },
      });

      let remainingCash = paymentToApply;
      const settledInvoiceDetails: { invoiceId: number; amountSettled: number }[] = [];

      for (const order of unpaidOrders) {
        if (remainingCash <= 0) break;

        const currentDebt = Math.max(0, order.totalAmount - order.paidAmount);
        if (currentDebt <= 0) continue;

        const amountForThisOrder = strategy === 'FULL' 
          ? currentDebt 
          : Math.min(remainingCash, currentDebt);

        const newPaid = order.paidAmount + amountForThisOrder;
        const isNowFullyPaid = newPaid >= order.totalAmount;

        // Update Order balance & status
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidAmount: newPaid,
            status: isNowFullyPaid ? OrderStatus.PAID : order.status,
            paymentMethod: isNowFullyPaid ? 'CASH' : 'CREDIT',
          },
        });

        // Add payment ledger transaction
        await tx.orderPayment.create({
          data: {
            orderId: order.id,
            amount: amountForThisOrder,
            method: paymentMethod,
          },
        });

        remainingCash -= amountForThisOrder;
        settledInvoiceDetails.push({ invoiceId: order.id, amountSettled: amountForThisOrder });
      }

      // Deduct settled amount atomically from Customer outstanding balance
      const updatedCustomer = await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalance: { decrement: paymentToApply },
        },
      });

      return {
        success: true,
        settledAmount: paymentToApply,
        remainingBalance: updatedCustomer.outstandingBalance,
        settledInvoices: settledInvoiceDetails,
      };
    });
  }

  /**
   * Get unpaid credit invoices for a specific customer to populate multi-select tags
   */
  async getCustomerPendingInvoices(customerId: number) {
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        totalAmount: { gt: prisma.order.fields.paidAmount },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        createdAt: true,
      },
    });

    return orders.map((o) => ({
      id: o.id,
      invoiceNo: `INV${o.id}`,
      total: o.totalAmount,
      paid: o.paidAmount,
      due: Math.max(0, o.totalAmount - o.paidAmount),
      date: new Date(o.createdAt).toISOString().split('T')[0],
    }));
  }

  
}



export const orderService = new OrderService();