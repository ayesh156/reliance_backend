import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { SalesOrderStatus } from '@prisma/client';
import { SalesOrderPdfService } from './sales-order-pdf.service.ts';
import { broadcastLiveEvent, sseGateway } from '../gateways/sse.gateway.ts';

export interface CreateSalesOrderItemInput {
  variantId?: number;
  productName?: string;
  variantName?: string;
  sku?: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  totalPrice?: number;
  notes?: string;
}

export interface CreateSalesOrderInput {
  userId?: number;
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  subtotal?: number;
  discount?: number;
  totalAmount?: number;
  notes?: string;
  items: CreateSalesOrderItemInput[];
}

export interface GetSalesOrdersParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  repId?: number;
  customerId?: string;
  sortBy?: string;
}

export class SalesOrderService {
  /**
   * Create a new Presales Order taken by a Field Sales Representative.
   * Supports registered customers or guest / one-time customers on the fly.
   */
  async createSalesOrder(data: CreateSalesOrderInput) {
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new HttpException(400, 'Order must contain at least one line item');
    }

    const salesOrder = await prisma.$transaction(async (tx) => {
      // 1. Resolve customer details (if registered customer was selected)
      let resolvedCustomerName = data.customerName?.trim() || '';
      let resolvedCustomerPhone = data.customerPhone?.trim() || '';
      let resolvedCustomerAddress = data.customerAddress?.trim() || '';
      let resolvedCustomerCity = data.customerCity?.trim() || '';

      if (data.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: Number(data.customerId) },
        });
        if (customer) {
          resolvedCustomerName = resolvedCustomerName || customer.name;
          resolvedCustomerPhone = resolvedCustomerPhone || customer.phone;
          resolvedCustomerAddress = resolvedCustomerAddress || customer.address || '';
          resolvedCustomerCity = resolvedCustomerCity || customer.city || '';
        }
      }

      if (!resolvedCustomerName) {
        resolvedCustomerName = 'Guest Customer';
      }

      // 2. Calculate sequential order number (e.g. ORD-1001)
      const lastOrder = await tx.salesOrder.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true, orderNumber: true },
      });

      let nextIndex = 1001;
      if (lastOrder) {
        if (lastOrder.orderNumber && lastOrder.orderNumber.startsWith('ORD-')) {
          const parsed = parseInt(lastOrder.orderNumber.replace('ORD-', ''), 10);
          if (!isNaN(parsed)) {
            nextIndex = parsed + 1;
          } else {
            nextIndex = lastOrder.id + 1001;
          }
        } else {
          nextIndex = lastOrder.id + 1001;
        }
      }

      const generatedOrderNumber = `ORD-${nextIndex}`;

      // 3. Process line items with reliable variant data & calculations
      let calculatedSubtotal = 0;

      const processedItems = await Promise.all(
        data.items.map(async (item) => {
          const qty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
          let unitPrice = Math.max(0, Number(item.unitPrice) || 0);
          let productName = item.productName || '';
          let variantName = item.variantName || '';
          let sku = item.sku || '';
          let imageUrl = item.imageUrl || '';

          // If variantId is linked, enrich metadata and fallback prices if missing
          if (item.variantId) {
            const variant = await tx.productVariant.findUnique({
              where: { id: Number(item.variantId) },
              include: {
                product: {
                  include: {
                    images: { orderBy: { order: 'asc' } },
                  },
                },
                images: true,
              },
            });

            if (variant) {
              productName = productName || variant.product.name;
              const sizeLabel = variant.size || '';
              const colorLabel = variant.color || '';
              variantName = variantName || (sizeLabel || colorLabel ? `${sizeLabel} / ${colorLabel}` : '');
              sku = sku || variant.sku || '';
              if (!unitPrice) {
                unitPrice = variant.wholesalePrice || variant.retailPrice || 0;
              }
              if (!imageUrl) {
                const varImg = variant.images?.[0]?.imageUrl;
                const prodImg = variant.product.images?.[0]?.imageUrl;
                imageUrl = varImg || prodImg || '';
              }
            }
          }

          const isReturn = Boolean((item as any).isReturn || item.quantity < 0);
          const lineDiscount = Math.max(0, Number(item.discount) || 0);
          const lineTotal = Math.max(0, Math.round((qty * unitPrice - lineDiscount) * 100) / 100);
          calculatedSubtotal += isReturn ? -lineTotal : lineTotal;

          return {
            variantId: item.variantId ? Number(item.variantId) : null,
            productName: productName || 'Garment Item',
            variantName: variantName || null,
            sku: sku || null,
            imageUrl: imageUrl || null,
            quantity: qty,
            unitPrice,
            discount: lineDiscount,
            totalPrice: isReturn ? -lineTotal : lineTotal,
            isReturn,
            notes: item.notes || null,
          };
        })
      );

      const hasReturns = data.items.some((i: any) => Boolean(i.isReturn || i.quantity < 0));
      const isReturnOrder = Boolean((data as any).isReturnOrder || hasReturns);
      const subtotal = data.subtotal !== undefined ? Number(data.subtotal) : calculatedSubtotal;
      const orderDiscount = Math.max(0, Number(data.discount) || 0);
      const totalAmount = data.totalAmount !== undefined ? Number(data.totalAmount) : (subtotal - orderDiscount);

      // 4. Create SalesOrder in database
      const salesOrder = await tx.salesOrder.create({
        data: {
          orderNumber: generatedOrderNumber,
          userId: data.userId ? Number(data.userId) : null,
          customerId: data.customerId ? Number(data.customerId) : null,
          customerName: resolvedCustomerName,
          customerPhone: resolvedCustomerPhone || null,
          customerAddress: resolvedCustomerAddress || null,
          customerCity: resolvedCustomerCity || null,
          subtotal,
          discount: orderDiscount,
          totalAmount,
          isReturnOrder,
          notes: data.notes?.trim() || null,
          status: SalesOrderStatus.PENDING,
          items: {
            create: processedItems,
          },
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: {
                    select: { id: true, name: true },
                  },
                },
              },
            },
          },
          customer: true,
          user: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      return salesOrder;
    });

    /**
     * ========================================================================
     * SSE REAL-TIME CROSS-DEVICE BROADCAST HOOK
     * ========================================================================
     * Executed strictly AFTER prisma.$transaction has committed successfully.
     * Event name: 'order_created' (strictly matches frontend EventSource listener).
     * Transmits the newly created presales order payload across all connected terminals.
     */
    try {
      broadcastLiveEvent('order_created', salesOrder);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast order_created after transaction commit:', sseErr);
    }

    return salesOrder;
  }

  /**
   * List presales orders with multi-tenant filtering, search query, date range, and pagination
   */
  async getSalesOrders(params: GetSalesOrdersParams) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Rep filter (Sales Rep can view only their orders if repId specified)
    if (params.repId) {
      where.userId = Number(params.repId);
    }

    // Status filter
    if (params.status && params.status !== 'ALL') {
      where.status = params.status as SalesOrderStatus;
    }

    // Date range filter
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = new Date(`${params.startDate}T00:00:00.000Z`);
      }
      if (params.endDate) {
        where.createdAt.lte = new Date(`${params.endDate}T23:59:59.999Z`);
      }
    }

    // Search filter across Order Number, Customer Name, and Customer Phone
    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { orderNumber: { contains: q } },
        { customerName: { contains: q } },
        { customerPhone: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    // Customer filter (registered customer or guest / walk-in)
    if (params.customerId && params.customerId !== 'all') {
      if (params.customerId === 'guest' || params.customerId === 'walkin') {
        where.customerId = null;
      } else {
        const parsedCustId = parseInt(params.customerId, 10);
        if (!isNaN(parsedCustId)) {
          where.customerId = parsedCustId;
        }
      }
    }

    // Dynamic sorting order
    let orderBy: any = { createdAt: 'desc' };
    if (params.sortBy === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (params.sortBy === 'highest_amount') {
      orderBy = { totalAmount: 'desc' };
    } else if (params.sortBy === 'lowest_amount') {
      orderBy = { totalAmount: 'asc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    const [total, orders] = await Promise.all([
      prisma.salesOrder.count({ where }),
      prisma.salesOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: {
            select: { id: true, name: true, phone: true, outstandingBalance: true },
          },
          user: {
            select: { id: true, name: true, role: true },
          },
          items: {
            include: {
              variant: {
                select: {
                  id: true,
                  size: true,
                  color: true,
                  sku: true,
                  stock: true,
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
          invoice: {
            select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
          },
        },
      }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single presales order by ID with complete relations
   */
  async getSalesOrderById(id: number) {
    const order = await prisma.salesOrder.findUnique({
      where: { id: Number(id) },
      include: {
        customer: true,
        user: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        invoice: {
          select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
        },
      },
    });

    if (!order) {
      throw new HttpException(404, `Sales Order #${id} not found`);
    }

    return order;
  }

  /**
   * Update an existing Presales Order with modified line items, discounts, or customer information.
   * Disallows editing already converted orders.
   */
  async updateSalesOrder(id: number, data: CreateSalesOrderInput) {
    const existing = await prisma.salesOrder.findUnique({
      where: { id: Number(id) },
      include: { invoice: true },
    });

    if (!existing) {
      throw new HttpException(404, `Sales Order #${id} not found`);
    }

    if (existing.status === 'CONVERTED' || existing.invoiceId) {
      throw new HttpException(400, `Sales Order #${id} has already been converted to an invoice and cannot be edited.`);
    }

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new HttpException(400, 'Order must contain at least one line item');
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // 1. Resolve customer details
      let resolvedCustomerName = data.customerName?.trim() || existing.customerName || '';
      let resolvedCustomerPhone = data.customerPhone?.trim() || existing.customerPhone || '';
      let resolvedCustomerAddress = data.customerAddress?.trim() || existing.customerAddress || '';
      let resolvedCustomerCity = data.customerCity?.trim() || existing.customerCity || '';

      if (data.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: Number(data.customerId) },
        });
        if (customer) {
          resolvedCustomerName = data.customerName?.trim() || customer.name;
          resolvedCustomerPhone = data.customerPhone?.trim() || customer.phone;
          resolvedCustomerAddress = data.customerAddress?.trim() || customer.address || '';
          resolvedCustomerCity = data.customerCity?.trim() || customer.city || '';
        }
      }

      // 2. Process updated line items
      let calculatedSubtotal = 0;
      const processedItems = await Promise.all(
        data.items.map(async (item) => {
          const qty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
          let unitPrice = Math.max(0, Number(item.unitPrice) || 0);
          let productName = item.productName || '';
          let variantName = item.variantName || '';
          let sku = item.sku || '';
          let imageUrl = item.imageUrl || '';

          if (item.variantId) {
            const variant = await tx.productVariant.findUnique({
              where: { id: Number(item.variantId) },
              include: {
                product: {
                  include: {
                    images: { orderBy: { order: 'asc' } },
                  },
                },
                images: true,
              },
            });

            if (variant) {
              productName = productName || variant.product.name;
              const sizeLabel = variant.size || '';
              const colorLabel = variant.color || '';
              variantName = variantName || (sizeLabel || colorLabel ? `${sizeLabel} / ${colorLabel}` : '');
              sku = sku || variant.sku || '';
              if (!unitPrice) {
                unitPrice = variant.wholesalePrice || variant.retailPrice || 0;
              }
              if (!imageUrl) {
                const varImg = variant.images?.[0]?.imageUrl;
                const prodImg = variant.product.images?.[0]?.imageUrl;
                imageUrl = varImg || prodImg || '';
              }
            }
          }

          const isReturn = Boolean((item as any).isReturn || item.quantity < 0);
          const lineDiscount = Math.max(0, Number(item.discount) || 0);
          const lineTotal = Math.max(0, Math.round((qty * unitPrice - lineDiscount) * 100) / 100);
          calculatedSubtotal += isReturn ? -lineTotal : lineTotal;

          return {
            variantId: item.variantId ? Number(item.variantId) : null,
            productName: productName || 'Garment Item',
            variantName: variantName || null,
            sku: sku || null,
            imageUrl: imageUrl || null,
            quantity: qty,
            unitPrice,
            discount: lineDiscount,
            totalPrice: isReturn ? -lineTotal : lineTotal,
            isReturn,
            notes: item.notes || null,
          };
        })
      );

      const subtotal = data.subtotal !== undefined ? Number(data.subtotal) : calculatedSubtotal;
      const discount = Math.max(0, Number(data.discount) || 0);
      const totalAmount = data.totalAmount !== undefined ? Number(data.totalAmount) : Math.max(0, subtotal - discount);

      // 3. Delete existing line items
      await tx.salesOrderItem.deleteMany({
        where: { salesOrderId: Number(id) },
      });

      // 4. Update order record and recreate line items
      const updatedOrder = await tx.salesOrder.update({
        where: { id: Number(id) },
        data: {
          customerId: data.customerId ? Number(data.customerId) : null,
          customerName: resolvedCustomerName,
          customerPhone: resolvedCustomerPhone || null,
          customerAddress: resolvedCustomerAddress || null,
          customerCity: resolvedCustomerCity || null,
          subtotal,
          discount,
          totalAmount,
          notes: data.notes?.trim() || null,
          items: {
            create: processedItems,
          },
        },
        include: {
          customer: true,
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                },
              },
            },
          },
          user: {
            select: { id: true, name: true, email: true, phone: true, role: true },
          },
        },
      });

      return updatedOrder;
    });

    /**
     * ========================================================================
     * SSE REAL-TIME CROSS-DEVICE BROADCAST HOOK
     * ========================================================================
     * Executed strictly AFTER prisma.$transaction has committed successfully.
     * Event name: 'order_updated' (strictly matches frontend EventSource listener).
     */
    try {
      broadcastLiveEvent('order_updated', updatedOrder);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast order_updated after transaction commit:', sseErr);
    }

    return updatedOrder;
  }

  /**
   * Update the status of a sales order (e.g. PENDING -> CONFIRMED / CANCELLED)
   */
  async updateSalesOrderStatus(id: number, status: SalesOrderStatus) {
    const existing = await prisma.salesOrder.findUnique({ where: { id: Number(id) } });
    if (!existing) {
      throw new HttpException(404, `Sales Order #${id} not found`);
    }

    const updated = await prisma.salesOrder.update({
      where: { id: Number(id) },
      data: { status },
      include: {
        customer: true,
        items: true,
      },
    });

    /**
     * SSE Real-time Cross-Device Broadcast Hook for status change
     */
    try {
      broadcastLiveEvent('order_updated', updated);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast order_updated on status change:', sseErr);
    }

    return updated;
  }

  /**
   * Placeholder / Skeleton for Future "Convert to Invoice" feature.
   *
   * Future Roadmap & Architectural Plan:
   * 1. Validates that the SalesOrder is not already converted to an invoice (`order.invoiceId == null`).
   * 2. Checks live inventory stock for each `variantId` in `SalesOrderItem`.
   * 3. Creates an `Order` (POS wholesale invoice) inside an atomic `prisma.$transaction`.
   * 4. Deducts variant stock quantities atomically.
   * 5. Links `SalesOrder.invoiceId` to the newly generated `Order.id` and sets `status = CONVERTED`.
   * 6. Updates customer ledger / credit balance.
   */
  async convertSalesOrderToInvoice(orderId: number, executingUserId: number) {
    const order = await prisma.salesOrder.findUnique({
      where: { id: Number(orderId) },
      include: { items: true, invoice: true },
    });

    if (!order) {
      throw new HttpException(404, `Sales Order #${orderId} not found`);
    }

    if (order.invoiceId || order.invoice) {
      throw new HttpException(400, `Sales Order #${orderId} is already converted to Invoice #${order.invoice?.invoiceNumber || order.invoiceId}`);
    }

    // ── Placeholder Implementation ──
    // In Phase 3, this will invoke `orderService.createPosOrder` to convert this presales order into a full invoice.
    return {
      message: 'Convert to Invoice placeholder executed successfully.',
      salesOrderId: order.id,
      orderNumber: order.orderNumber,
      executingUserId,
      status: 'READY_FOR_INVOICE_CONVERSION',
      nextSteps: 'Pending live stock reservation and invoice settlement assignment in subsequent phase.',
    };
  }

  /**
   * Safe Atomic Deletion of a Presales / Sales Order.
   * Completely removes the order and associated line items within an atomic transaction.
   * If the order was converted into or linked to an Invoice (Order), rolls back:
   * 1. Any variant stock decremented for that invoice's line items.
   * 2. Any customer ledger/balance adjustments (credit due & settled due).
   * 3. Deletes associated invoice payments and items, unlinking/removing the invoice.
   *
   * Permission Rules:
   * - ADMIN: Global unrestricted deletion.
   * - REP: Scoped strictly to their own orders (`order.userId === currentUser.userId`).
   */
  async deleteSalesOrder(
    orderId: number,
    currentUser?: { id?: number | string; userId?: number | string; role?: string }
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id: Number(orderId) },
        include: {
          items: true,
          invoice: {
            include: {
              items: true,
              payments: true,
            },
          },
        },
      });

      if (!order) {
        throw new HttpException(404, `Sales Order #${orderId} not found`);
      }

      // Enforce Role-Based Access Control on deletion
      if (currentUser) {
        const userRole = String(currentUser.role || '').toUpperCase();
        const requestingUserId = Number(currentUser.id ?? currentUser.userId);
        const isOwner = Number(order.userId) === requestingUserId;

        if (userRole === 'ADMIN') {
          // ADMIN has global deletion authorization
        } else if (userRole === 'REP') {
          if (!isOwner) {
            throw new HttpException(
              403,
              'Unauthorized: Sales Representatives can only delete their own orders'
            );
          }
        } else {
          throw new HttpException(
            403,
            'Unauthorized: Insufficient permissions to delete orders'
          );
        }
      }

      // Rollback any stock or financial records if linked to an Invoice (Order)
      if (order.invoice) {
        const linkedInvoice = order.invoice;

        // 1. Rollback stock for all variant items in the linked invoice
        for (const item of linkedInvoice.items) {
          if (item.variantId && item.quantity > 0) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }

        // 2. Rollback financial impact on customer ledger
        const creditDue = Math.max(0, linkedInvoice.totalAmount - linkedInvoice.paidAmount);
        const settledDue = Number((linkedInvoice as any).settledDueAmount || 0);
        const adjustment = -creditDue + settledDue;
        if (linkedInvoice.customerId && adjustment !== 0) {
          await tx.customer.update({
            where: { id: linkedInvoice.customerId },
            data: { outstandingBalance: { increment: adjustment } },
          });
        }

        // 3. Delete payments and items of the linked invoice
        await tx.orderPayment.deleteMany({ where: { orderId: linkedInvoice.id } });
        await tx.orderItem.deleteMany({ where: { orderId: linkedInvoice.id } });

        // Unlink invoice from salesOrder before deleting invoice
        await tx.salesOrder.update({
          where: { id: order.id },
          data: { invoiceId: null },
        });

        await tx.order.delete({ where: { id: linkedInvoice.id } });
      }

      // 4. Atomically delete sales order line items
      await tx.salesOrderItem.deleteMany({
        where: { salesOrderId: Number(orderId) },
      });

      // 5. Delete the sales order itself
      await tx.salesOrder.delete({
        where: { id: Number(orderId) },
      });

      return {
        success: true,
        message: `Order #${order.orderNumber || orderId} deleted successfully and any reserved stock/financial records rolled back`,
      };
    });

    /**
     * ========================================================================
     * SSE REAL-TIME CROSS-DEVICE BROADCAST HOOK
     * ========================================================================
     * Executed strictly AFTER prisma.$transaction has committed successfully.
     * Event name: 'order_deleted' (strictly matches frontend EventSource listener).
     */
    try {
      broadcastLiveEvent('order_deleted', { id: Number(orderId), orderId: Number(orderId) });
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast order_deleted after transaction commit:', sseErr);
    }

    return result;
  }

  /**
   * Generate streaming A4 PDF for Presales Order with product image in first column
   */
  async generateSalesOrderPdf(id: number) {
    const order = await this.getSalesOrderById(id);
    return SalesOrderPdfService.generate(order);
  }
}

export const salesOrderService = new SalesOrderService();
