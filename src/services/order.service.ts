import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { OrderSource, OrderStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { InvoicePdfService } from './invoice-pdf.service.ts';

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
    settledDueAmount?: number;
    excessMode?: string;
    paymentMethod: string; // CASH, CARD, CREDIT, CHEQUE, BANK_TRANSFER
    notes?: string;
    splitPayments?: Array<{
      id?: string;
      method: string;
      amount: number | string;
      date?: string | Date;
      chequeNumber?: string;
      bankName?: string;
      reference?: string;
    }>;
    cheques?: Array<{
      chequeNumber?: string;
      bankName?: string;
      chequeDate?: string | Date;
      amount: number | string;
    }>;
  }) {
    if (!data.items || data.items.length === 0) {
      throw new HttpException(400, 'Order must contain at least one item');
    }

    return prisma.$transaction(async (tx) => {
      // 1. Verify and reduce variant inventory stock with strict input sanitization
      for (const item of data.items) {
        const qty = parseInt(String(item.quantity), 10);
        const unitPrice = Math.max(0, Number(item.unitPrice) || 0);

        if (!qty || isNaN(qty) || qty <= 0) {
          throw new HttpException(400, `Invalid line quantity specified for variant #${item.variantId}`);
        }

        const variant = await tx.productVariant.findUnique({
          where: { id: Number(item.variantId) },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          throw new HttpException(404, `Product variant #${item.variantId} not found`);
        }

        if (variant.stock < qty) {
          throw new HttpException(
            400,
            `Insufficient stock for "${variant.product.name}" (${variant.size || 'N/A'}/${variant.color || 'N/A'}). Available: ${variant.stock}`
          );
        }

        // Deduct inventory stock atomically
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: qty } },
        });
      }

      // Hardened Financial Calculations (Prevents negative payments and price manipulation)
      const sanitizedDiscount = Math.max(0, Number(data.discount) || 0);
      const total = Math.max(0, Number(data.totalAmount) || 0);
      const paid = Math.min(total, Math.max(0, Number(data.paidAmount) || 0));
      const sanitizedSettledDue = Math.max(0, Number(data.settledDueAmount) || 0);
      const isFullPaid = paid >= total;

      // Prepare Multi-Split, Multi-Cheque or standard payments
      let paymentCreateEntries: any[] = [];
      if (data.splitPayments && Array.isArray(data.splitPayments) && data.splitPayments.length > 0) {
        paymentCreateEntries = data.splitPayments
          .filter((s) => Number(s.amount) > 0)
          .map((s) => {
            let ref = s.reference || '';
            if (s.method === 'CHEQUE') {
              ref = `Cheque #${s.chequeNumber || ''}${s.bankName ? ` (${s.bankName})` : ''}`.trim() || ref || 'Cheque Payment';
            } else if (s.method === 'BANK_TRANSFER' && s.bankName) {
              ref = `Bank Transfer (${s.bankName})${ref ? `: ${ref}` : ''}`;
            }
            return {
              amount: Number(s.amount),
              method: s.method || 'CASH',
              reference: ref || `${s.method} Payment`,
              chequeDate: (s.method === 'CHEQUE' && s.date) ? new Date(s.date) : (s.date ? new Date(s.date) : undefined),
            };
          });
      } else if (data.cheques && Array.isArray(data.cheques) && data.cheques.length > 0) {
        paymentCreateEntries = data.cheques
          .filter((c) => Number(c.amount) > 0)
          .map((c) => ({
            amount: Number(c.amount),
            method: 'CHEQUE',
            reference: `Cheque #${c.chequeNumber || ''}${c.bankName ? ` (${c.bankName})` : ''}`.trim() || 'Cheque Payment',
            chequeDate: c.chequeDate ? new Date(c.chequeDate) : undefined,
          }));
      } else if (paid > 0) {
        paymentCreateEntries = [
          {
            amount: paid,
            method: data.paymentMethod || 'CASH',
          },
        ];
      }

      // Structure notes if split payments or multi-cheques are included
      let cleanUserNote = data.notes || '';
      while (typeof cleanUserNote === 'string' && cleanUserNote.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanUserNote);
          cleanUserNote = parsed.userNotes || '';
        } catch {
          break;
        }
      }

      let finalOrderNotes: string | null = cleanUserNote || null;
      if ((data.splitPayments && data.splitPayments.length > 0) || (data.cheques && data.cheques.length > 0)) {
        try {
          finalOrderNotes = JSON.stringify({
            userNotes: cleanUserNote,
            splitPayments: data.splitPayments || [],
            cheques: data.cheques || (data.splitPayments ? data.splitPayments.filter((s) => s.method === 'CHEQUE') : []),
          });
        } catch {
          finalOrderNotes = cleanUserNote || null;
        }
      }

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
          settledDueAmount: sanitizedSettledDue,
          status: isFullPaid ? OrderStatus.PAID : OrderStatus.PROCESSING,
          paymentMethod: data.paymentMethod || 'CASH',
          notes: finalOrderNotes,
          items: {
            create: data.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              discount: i.discount || 0,
              price: i.price,
            })),
          },
          payments: paymentCreateEntries.length > 0 ? { create: paymentCreateEntries } : undefined,
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

      // 3. Secure Customer Credit Verification & Outstanding Sync
      if (data.customerId) {
        const custId = Number(data.customerId);
        const creditDue = Math.max(0, total - paid);
        const targetCustomer = await tx.customer.findUnique({
          where: { id: custId },
        });

        if (!targetCustomer) {
          throw new HttpException(404, `Linked customer #${data.customerId} not found`);
        }

        // Check if customer exceeds allowable credit limit
        if (creditDue > 0 && targetCustomer.creditLimit > 0 && (targetCustomer.outstandingBalance + creditDue) > targetCustomer.creditLimit) {
          throw new HttpException(
            400,
            `Transaction exceeds allowed credit limit of Rs. ${targetCustomer.creditLimit}. Current outstanding: Rs. ${targetCustomer.outstandingBalance}`
          );
        }

        // 1. Directly decrement customer outstanding if settledDueAmount > 0
        if (sanitizedSettledDue > 0) {
          await tx.customer.update({
            where: { id: custId },
            data: { outstandingBalance: { decrement: sanitizedSettledDue } },
          });

          // 2. FIFO Settlement on previous unpaid/partially paid credit invoices
          let remainingToSettle = sanitizedSettledDue;
          const unpaidOrders = await tx.order.findMany({
            where: {
              customerId: custId,
              id: { not: order.id },
              status: { not: OrderStatus.CANCELLED },
            },
            orderBy: { createdAt: 'asc' },
          });

          for (const prevOrder of unpaidOrders) {
            if (remainingToSettle <= 0) break;
            const unpaidAmount = Math.max(0, prevOrder.totalAmount - prevOrder.paidAmount);
            if (unpaidAmount > 0 && remainingToSettle > 0) {
              const settleForThis = Math.min(unpaidAmount, remainingToSettle);
              const newPrevPaid = prevOrder.paidAmount + settleForThis;
              const isPrevPaid = newPrevPaid >= prevOrder.totalAmount;

              await tx.order.update({
                where: { id: prevOrder.id },
                data: {
                  paidAmount: { increment: settleForThis },
                  status: isPrevPaid ? OrderStatus.PAID : prevOrder.status,
                },
              });

              await tx.orderPayment.create({
                data: {
                  orderId: prevOrder.id,
                  amount: settleForThis,
                  method: data.paymentMethod || 'CASH',
                  reference: `Settled from POS Invoice #${order.id}`,
                },
              });

              remainingToSettle -= settleForThis;
            }
          }
        }

        if (creditDue > 0) {
          await tx.customer.update({
            where: { id: custId },
            data: { outstandingBalance: { increment: creditDue } },
          });
        }

        const freshCustomer = await tx.customer.findUnique({
          where: { id: custId },
        });

        (order as any).customer = freshCustomer;
      }

      return order;
    });
  }

  /**
   * Retrieve active catalog variants optimized for POS terminal:
   * 1. Resolves exact variant-tagged image priority (fallback to color match, then product image)
   * 2. Excludes depleted/unconfigured stock to keep cashier terminal responsive
   */
  /**
   * ⭐ POS Grid Catalog:
   * Only fetches product variants belonging to active, non-deleted products.
   * Soft-deleted/archived products are automatically hidden from the cashier.
   */
  async getPosCatalog() {
    const variants = await prisma.productVariant.findMany({
      where: {
        stock: { gt: 0 }, // Filter out items with zero stock from active POS checkout
        product: {
          isActive: true, // ⭐ Delete කළ හෝ inactive කළ භාණ්ඩ POS grid එකෙන් සඟවයි
        },
      },
      select: {
        id: true,
        size: true,
        color: true,
        sku: true,
        barcode: true,
        costPrice: true,
        retailPrice: true,
        wholesalePrice: true,
        stock: true,
        product: {
          select: {
            id: true,
            name: true,
            searchKey: true,
            category: { select: { name: true } },
            images: { 
              orderBy: { order: 'asc' }, 
              select: { id: true, imageUrl: true, variantId: true } 
            },
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
      take: 300, // Safeguard against unbounded memory consumption
    });

    // World-class asset resolution: accurately link tagged variant image to variant entity
    return variants.map((v) => {
      const allProductImages = v.product?.images || [];
      
      // 1. First priority: Image specifically tagged with this variant's foreign key
      const directVariantImg = allProductImages.find(
        (img) => img.variantId && Number(img.variantId) === Number(v.id)
      )?.imageUrl;

      // 2. Second priority: Match by variant color keyword if present
      const colorKey = (v.color || '').toLowerCase().trim();
      const colorMatchedImg = colorKey && colorKey !== 'default'
        ? allProductImages.find((img) => img.imageUrl.toLowerCase().includes(colorKey))?.imageUrl
        : null;

      // 3. Third priority: Primary product catalog photo
      const resolvedImg = directVariantImg || colorMatchedImg || allProductImages[0]?.imageUrl || null;

      return {
        id: v.id,
        size: v.size,
        color: v.color,
        sku: v.sku,
        barcode: v.barcode,
        costPrice: v.costPrice,
        retailPrice: v.retailPrice,
        wholesalePrice: v.wholesalePrice,
        stock: v.stock,
        imageUrl: resolvedImg,
        images: resolvedImg ? [{ imageUrl: resolvedImg }] : [],
        product: {
          id: v.product.id,
          name: v.product.name,
          searchKey: v.product.searchKey,
          category: v.product.category,
          images: allProductImages.map((img) => ({ imageUrl: img.imageUrl })),
        },
      };
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
        payments: {
          orderBy: { createdAt: 'asc' },
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

    // Parse structured notes if present
    let splitPayments: any[] = [];
    let parsedCheques: any[] = [];
    let userNotes = '';
    if (order.notes) {
      try {
        let current: any = order.notes;
        while (typeof current === 'string' && current.trim().startsWith('{')) {
          current = JSON.parse(current);
        }
        if (typeof current === 'object' && current !== null) {
          if (Array.isArray(current.splitPayments)) splitPayments = current.splitPayments;
          if (Array.isArray(current.cheques)) parsedCheques = current.cheques;
          userNotes = current.userNotes || '';
        } else {
          userNotes = String(current || '');
        }
      } catch {
        userNotes = typeof order.notes === 'string' && order.notes.trim().startsWith('{') ? '' : String(order.notes || '');
      }
    }

    return {
      ...order,
      splitPayments: splitPayments.length > 0 ? splitPayments : undefined,
      cheques: parsedCheques.length > 0 ? parsedCheques : undefined,
      userNotes,
    };
  }

  /**
   * Update existing invoice:
   * 1. Reverts previous item inventory stock and deducts updated item inventory stock.
   * 2. Recalculates credit due delta and increments/decrements customer outstandingBalance atomically.
   * 3. Performs FIFO allocation of settledDueAmount across older unpaid customer orders.
   */
  async updateInvoiceOrder(
    orderId: number,
    data: {
      source?: OrderSource; // Allows switching between POS_RETAIL and POS_WHOLESALE
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
      settledDueAmount?: number;
      excessMode?: string;
      paymentMethod: string;
      notes?: string;
      splitPayments?: Array<{
        id?: string;
        method: string;
        amount: number | string;
        date?: string | Date;
        chequeNumber?: string;
        bankName?: string;
        reference?: string;
      }>;
      cheques?: Array<{
        chequeNumber?: string;
        bankName?: string;
        chequeDate?: string | Date;
        amount: number | string;
      }>;
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
      const oldSettledDue = Number((existing as any).settledDueAmount || 0);

      const newTotal = Number(data.totalAmount || 0);
      const newPaid = Math.min(newTotal, Math.max(0, Number(data.paidAmount || 0)));
      const newCreditDue = Math.max(0, newTotal - newPaid);
      const newSettledDue = data.settledDueAmount !== undefined ? Math.max(0, Number(data.settledDueAmount) || 0) : oldSettledDue;

      const targetCustomerId = data.customerId ? Number(data.customerId) : existing.customerId;

      if (targetCustomerId) {
        const custId = Number(targetCustomerId);

        // 1. If settledDueAmount > 0, apply FIFO Settlement on previous unpaid/partially paid credit invoices
        if (newSettledDue > 0) {
          let remainingToSettle = newSettledDue;
          const unpaidOrders = await tx.order.findMany({
            where: {
              customerId: custId,
              id: { not: orderId },
              status: { not: OrderStatus.CANCELLED },
            },
            orderBy: { createdAt: 'asc' },
          });

          for (const prevOrder of unpaidOrders) {
            if (remainingToSettle <= 0) break;
            const unpaidAmount = Math.max(0, prevOrder.totalAmount - prevOrder.paidAmount);
            if (unpaidAmount > 0 && remainingToSettle > 0) {
              const settleForThis = Math.min(unpaidAmount, remainingToSettle);
              const newPrevPaid = prevOrder.paidAmount + settleForThis;
              const isPrevPaid = newPrevPaid >= prevOrder.totalAmount;

              await tx.order.update({
                where: { id: prevOrder.id },
                data: {
                  paidAmount: { increment: settleForThis },
                  status: isPrevPaid ? OrderStatus.PAID : prevOrder.status,
                },
              });

              await tx.orderPayment.create({
                data: {
                  orderId: prevOrder.id,
                  amount: settleForThis,
                  method: data.paymentMethod || 'CASH',
                  reference: `Settled from POS Invoice #${orderId}`,
                },
              });

              remainingToSettle -= settleForThis;
            }
          }
        }

        // 2. Rollback previous customer's debt if customer was changed
        if (existing.customerId && existing.customerId !== targetCustomerId) {
          const oldCustOrders = await tx.order.findMany({
            where: {
              customerId: existing.customerId,
              id: { not: orderId },
              status: { not: OrderStatus.CANCELLED },
            },
            select: { totalAmount: true, paidAmount: true },
          });
          const oldCustDue = oldCustOrders.reduce((sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0)), 0);
          await tx.customer.update({
            where: { id: existing.customerId },
            data: { outstandingBalance: Math.round(oldCustDue * 100) / 100 },
          });
        }

        // 3. Increment or decrement customer outstandingBalance based on net credit & settlement delta
        if (existing.customerId && existing.customerId !== targetCustomerId) {
          // New customer selected: apply new credit due to new customer
          if (newCreditDue > 0) {
            await tx.customer.update({
              where: { id: custId },
              data: { outstandingBalance: { increment: newCreditDue } },
            });
          }
        } else {
          // Same customer: apply net difference
          const balanceAdjustment = (newCreditDue - oldCreditDue) - (newSettledDue - oldSettledDue);
          if (balanceAdjustment !== 0) {
            await tx.customer.update({
              where: { id: custId },
              data: { outstandingBalance: { increment: balanceAdjustment } },
            });
          }
        }
      }

      // 4. Update order items and sync payments ledger
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.orderPayment.deleteMany({ where: { orderId } });

      let paymentCreateEntries: any[] = [];
      if (data.splitPayments && Array.isArray(data.splitPayments) && data.splitPayments.length > 0) {
        paymentCreateEntries = data.splitPayments
          .filter((s) => Number(s.amount) > 0)
          .map((s) => {
            let ref = s.reference || '';
            if (s.method === 'CHEQUE') {
              ref = `Cheque #${s.chequeNumber || ''}${s.bankName ? ` (${s.bankName})` : ''}`.trim() || ref || 'Cheque Payment';
            } else if (s.method === 'BANK_TRANSFER' && s.bankName) {
              ref = `Bank Transfer (${s.bankName})${ref ? `: ${ref}` : ''}`;
            }
            return {
              amount: Number(s.amount),
              method: s.method || 'CASH',
              reference: ref || `${s.method} Payment`,
              chequeDate: (s.method === 'CHEQUE' && s.date) ? new Date(s.date) : (s.date ? new Date(s.date) : undefined),
            };
          });
      } else if (data.cheques && Array.isArray(data.cheques) && data.cheques.length > 0) {
        paymentCreateEntries = data.cheques
          .filter((c) => Number(c.amount) > 0)
          .map((c) => ({
            amount: Number(c.amount),
            method: 'CHEQUE',
            reference: `Cheque #${c.chequeNumber || ''}${c.bankName ? ` (${c.bankName})` : ''}`.trim() || 'Cheque Payment',
            chequeDate: c.chequeDate ? new Date(c.chequeDate) : undefined,
          }));
      } else if (newPaid > 0) {
        paymentCreateEntries = [
          {
            amount: newPaid,
            method: data.paymentMethod === 'CREDIT' ? 'CASH' : (data.paymentMethod || 'CASH'),
          },
        ];
      }

      let rawNoteCandidate = data.notes !== undefined ? data.notes : existing.notes;
      let cleanUserNote = rawNoteCandidate || '';
      while (typeof cleanUserNote === 'string' && cleanUserNote.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanUserNote);
          cleanUserNote = parsed.userNotes || '';
        } catch {
          break;
        }
      }

      let finalOrderNotes: string | null = cleanUserNote || null;
      if ((data.splitPayments && data.splitPayments.length > 0) || (data.cheques && data.cheques.length > 0)) {
        try {
          finalOrderNotes = JSON.stringify({
            userNotes: cleanUserNote,
            splitPayments: data.splitPayments || [],
            cheques: data.cheques || (data.splitPayments ? data.splitPayments.filter((s) => s.method === 'CHEQUE') : []),
          });
        } catch {
          finalOrderNotes = cleanUserNote || null;
        }
      }

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          source: data.source || existing.source || OrderSource.POS_RETAIL, // Accurately updates Wholesale vs Retail mode
          customerId: targetCustomerId || null,
          customerName: data.customerName || 'Walk-in Customer',
          customerPhone: data.customerPhone || null,
          subtotal: Number(data.subtotal),
          discount: Number(data.discount) || 0,
          totalAmount: newTotal,
          paidAmount: newPaid,
          settledDueAmount: newSettledDue,
          paymentMethod: newCreditDue > 0 ? 'CREDIT' : data.paymentMethod || 'CASH',
          notes: finalOrderNotes,
          status: newPaid >= newTotal ? OrderStatus.PAID : OrderStatus.PROCESSING,
          items: {
            create: data.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              price: i.price,
            })),
          },
          payments: paymentCreateEntries.length > 0 ? { create: paymentCreateEntries } : undefined,
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

      // Cancel remaining credit and reverse any settled due from customer outstanding balance
      const creditDue = Math.max(0, order.totalAmount - order.paidAmount);
      const settledDue = Number((order as any).settledDueAmount || 0);
      const adjustment = -creditDue + settledDue;
      if (order.customerId && adjustment !== 0) {
        await tx.customer.update({
          where: { id: order.customerId },
          data: { outstandingBalance: { increment: adjustment } },
        });
      }

      await tx.order.delete({ where: { id: orderId } });
      return { success: true, message: `Invoice #${orderId} deleted successfully` };
    });
  }

  /**
   * Delegates PDF rendering to dedicated InvoicePdfService with fully hydrated variant & customer models
   */
  async generateInvoicePdf(orderId: number) {
    const order = await prisma.order.findUnique({
      where: { id: Number(orderId) },
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
      },
    });

    if (!order) {
      throw new HttpException(404, `Invoice #${orderId} not found`);
    }

    // Attach resolved customer address into shippingAddress fallback for identical receipt alignment
    if (order.customer?.address && !order.shippingAddress) {
      (order as any).shippingAddress = order.customer.address;
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
    paymentDate?: string | Date;
  }) {
    const { customerId, amount, strategy, selectedInvoiceIds = [], paymentMethod = 'CASH', notes, paymentDate } = data;

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

      // Resolve custom audit payment timestamp
      const resolvedDate = paymentDate && !isNaN(new Date(paymentDate).getTime())
        ? new Date(paymentDate)
        : new Date();

      // Query unpaid/partially paid credit invoices for this customer (Excludes CANCELLED)
      const whereCondition: any = {
        customerId,
        status: { not: OrderStatus.CANCELLED },
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

        const currentDebt = Math.max(0, Math.round((Number(order.totalAmount) - Number(order.paidAmount)) * 100) / 100);
        if (currentDebt <= 0) continue;

        const amountForThisOrder = strategy === 'FULL' 
          ? currentDebt 
          : Math.min(remainingCash, currentDebt);

        const newPaid = Math.round((Number(order.paidAmount) + amountForThisOrder) * 100) / 100;
        const isNowFullyPaid = newPaid >= Number(order.totalAmount);

        // Update Order balance & status
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidAmount: newPaid,
            status: isNowFullyPaid ? OrderStatus.PAID : order.status,
            paymentMethod: isNowFullyPaid ? (paymentMethod || 'CASH') : order.paymentMethod,
            updatedAt: new Date(),
          },
        });

        // Add explicit payment ledger transaction for this specific invoice
        await tx.orderPayment.create({
          data: {
            orderId: order.id,
            amount: amountForThisOrder,
            method: paymentMethod || 'CASH',
            reference: notes?.trim() || 'Full Balance Settlement',
            createdAt: resolvedDate,
          },
        });

        remainingCash = Math.round((remainingCash - amountForThisOrder) * 100) / 100;
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
  /**
   * Get pending debt invoices leveraging indexed status values for minimal query latency
   */
  async getCustomerPendingInvoices(customerId: number) {
    const orders = await prisma.order.findMany({
      where: {
        customerId: Number(customerId),
        status: { in: [OrderStatus.PROCESSING, OrderStatus.PENDING, OrderStatus.DELIVERED] },
        paymentMethod: 'CREDIT',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        createdAt: true,
      },
      take: 100,
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