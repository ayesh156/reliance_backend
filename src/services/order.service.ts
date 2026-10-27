import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { OrderSource, OrderStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service.ts';
import { PaymentService } from './payment.service.ts';
import { broadcastLiveEvent } from '../gateways/sse.gateway.ts';

export interface ReturnedItemRecord {
  variantId: number;
  productId?: number;
  productName?: string;
  variantName?: string;
  sku?: string;
  returnQty: number;
  unitPrice: number;
  amount: number;
}

export interface ReturnRecord {
  returnId: string;
  returnDate: string; // ISO timestamp
  returnedItems: ReturnedItemRecord[];
  totalReturnRefund: number;
  reason: string;
  recordedBy: string;
  creditDueAdjustment?: number;
  cashRefundAmount?: number;
}

export interface ProcessReturnInput {
  returnedItems: {
    variantId: number;
    productId?: number;
    returnQty: number;
    unitPrice?: number;
    amount?: number;
  }[];
  reason?: string;
  recordedBy?: string;
}

/**
 * Universal helper to parse structured metadata stored within `Order.notes` JSON.
 * Preserves user text notes while extracting return logs, split payments, and cheques.
 */
export function parseOrderStructuredNotes(notes: any) {
  let userNotes = '';
  let splitPayments: any[] = [];
  let cheques: any[] = [];
  let itemVariants: any[] = [];
  let returns: ReturnRecord[] = [];
  let originalTotalAmount: number | undefined = undefined;
  let discountType: string | undefined = undefined;
  let discountInput: number | undefined = undefined;
  let discountRate: number | undefined = undefined;
  let itemDiscounts: any[] | undefined = undefined;
  let rawParsed: any = {};

  if (notes) {
    try {
      let current: any = notes;
      while (typeof current === 'string' && current.trim().startsWith('{')) {
        current = JSON.parse(current);
      }
      if (typeof current === 'object' && current !== null) {
        rawParsed = current;
        if (Array.isArray(current.splitPayments)) splitPayments = current.splitPayments;
        if (Array.isArray(current.cheques)) cheques = current.cheques;
        if (Array.isArray(current.itemVariants)) itemVariants = current.itemVariants;
        if (Array.isArray(current.returns)) returns = current.returns;
        if (typeof current.originalTotalAmount === 'number') originalTotalAmount = current.originalTotalAmount;
        if (typeof current.discountType === 'string') discountType = current.discountType;
        if (typeof current.discountInput === 'number' || (typeof current.discountInput === 'string' && current.discountInput !== '')) {
          discountInput = Number(current.discountInput);
        }
        if (typeof current.discountRate === 'number') discountRate = current.discountRate;
        if (Array.isArray(current.itemDiscounts)) itemDiscounts = current.itemDiscounts;
        userNotes = current.userNotes || '';
      } else {
        userNotes = String(current || '');
      }
    } catch {
      userNotes = typeof notes === 'string' && notes.trim().startsWith('{') ? '' : String(notes || '');
    }
  }

  return {
    rawParsed,
    userNotes,
    splitPayments,
    cheques,
    itemVariants,
    returns,
    originalTotalAmount,
    discountType,
    discountInput,
    discountRate,
    itemDiscounts,
  };
}

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
      isReturn?: boolean;
    }[];
    subtotal: number;
    discount?: number;
    totalAmount: number;
    paidAmount?: number;
    settledDueAmount?: number;
    excessMode?: string;
    paymentMethod: string; // CASH, CARD, CREDIT, CHEQUE, BANK_TRANSFER
    notes?: string;
    isReturnBill?: boolean;
    returnCreditApplied?: number;
    refundedCashAmount?: number;
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

    const createdOrder = await prisma.$transaction(async (tx) => {
      // 1. Verify and adjust variant inventory stock with strict input sanitization
      for (const item of data.items) {
        const rawQty = parseInt(String(item.quantity), 10);
        const qty = Math.abs(rawQty);
        const isReturnItem = Boolean(item.isReturn || rawQty < 0);

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

        if (isReturnItem) {
          // ⭐ Return item: Staged into dedicated Return Inventory (ReturnInventoryItem)
          // Do NOT immediately increment main sellable stock.
        } else {
          // Normal sale item: Check availability and decrement inventory
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
      }

      // 2. Financial Calculations & Return Analysis
      const returnItems = data.items.filter((i) => Boolean(i.isReturn || Number(i.quantity) < 0));
      const saleItems = data.items.filter((i) => !i.isReturn && Number(i.quantity) > 0);
      const isReturnOnlyBill = returnItems.length > 0 && saleItems.length === 0;

      const totalReturnValue = returnItems.reduce((sum, i) => {
        const lineNet = Math.abs(Number(i.unitPrice)) * Math.abs(Number(i.quantity)) - (Number(i.discount) || 0);
        return sum + Math.max(0, lineNet);
      }, 0);

      const totalSaleValue = saleItems.reduce((sum, i) => {
        const lineNet = Math.abs(Number(i.unitPrice)) * Math.abs(Number(i.quantity)) - (Number(i.discount) || 0);
        return sum + Math.max(0, lineNet);
      }, 0);

      const sanitizedDiscount = Math.max(0, Number(data.discount) || 0);
      const computedNet = totalSaleValue - totalReturnValue - sanitizedDiscount;
      const isReturnBill = Boolean(data.isReturnBill || isReturnOnlyBill || data.totalAmount < 0 || computedNet < 0);

      // Financials
      const rawTotal = Number(data.totalAmount);
      const total = isReturnBill ? (rawTotal < 0 ? rawTotal : -Math.abs(rawTotal || totalReturnValue)) : Math.max(0, rawTotal || computedNet);
      const paid = isReturnBill ? 0 : Math.min(Math.max(0, total), Math.max(0, Number(data.paidAmount) || 0));
      const sanitizedSettledDue = Math.max(0, Number(data.settledDueAmount) || 0);
      const isFullPaid = isReturnBill ? true : (paid >= total);

      // Prepare Multi-Split, Multi-Cheque or standard payments
      let paymentCreateEntries: any[] = [];
      if (!isReturnBill) {
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
      }

      // Structure notes if split payments, multi-cheques, or discounts are included
      let cleanUserNote = data.notes || '';
      while (typeof cleanUserNote === 'string' && cleanUserNote.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanUserNote);
          cleanUserNote = parsed.userNotes || '';
        } catch {
          break;
        }
      }

      const itemVariants = (data.items || []).map((i: any) => ({
        variantId: Number(i.variantId),
        size: i.size || i.selectedSize || '',
        color: i.color || i.selectedColor || '',
      }));

      const itemDiscounts = (data.items || []).map((i: any) => ({
        discountType: (i as any).discountType || 'FIXED',
        discountInput: (i as any).discountInput !== undefined && (i as any).discountInput !== '' ? Number((i as any).discountInput) : 0,
        discount: Number(i.discount) || 0,
      }));

      const hasItemVariants = itemVariants.some((iv: any) => iv.size || iv.color);
      const hasItemDiscounts = itemDiscounts.some((id: any) => id.discount > 0 || id.discountInput > 0);
      const hasOrderDiscount = (data as any).discountType || (data as any).discountInput !== undefined;

      let finalOrderNotes: string | null = cleanUserNote || null;
      if (
        (data.splitPayments && data.splitPayments.length > 0) ||
        (data.cheques && data.cheques.length > 0) ||
        hasItemVariants ||
        hasItemDiscounts ||
        hasOrderDiscount ||
        isReturnBill
      ) {
        try {
          finalOrderNotes = JSON.stringify({
            userNotes: cleanUserNote,
            splitPayments: data.splitPayments || [],
            cheques: data.cheques || (data.splitPayments ? data.splitPayments.filter((s) => s.method === 'CHEQUE') : []),
            itemVariants: hasItemVariants ? itemVariants : undefined,
            discountType: (data as any).discountType,
            discountInput: (data as any).discountInput,
            discountRate: (data as any).discountRate,
            itemDiscounts: hasItemDiscounts ? itemDiscounts : undefined,
            isReturnBill,
            totalReturnValue: totalReturnValue > 0 ? totalReturnValue : undefined,
          });
        } catch {
          finalOrderNotes = cleanUserNote || null;
        }
      }

      // Automatic customer lookup & address backfill if customerId is missing or shippingAddress is empty
      let targetCustomerId = data.customerId ? Number(data.customerId) : null;
      let targetCustomer: any = null;

      if (targetCustomerId) {
        targetCustomer = await tx.customer.findUnique({
          where: { id: targetCustomerId },
          select: { id: true, name: true, phone: true, address: true, city: true, type: true, outstandingBalance: true, creditLimit: true },
        });
      } else if (data.customerPhone || data.customerName) {
        const cleanPhone = data.customerPhone ? String(data.customerPhone).replace(/[^0-9]/g, '').slice(-9) : '';
        const rawName = data.customerName ? String(data.customerName).trim() : '';

        targetCustomer = await tx.customer.findFirst({
          where: {
            OR: [
              ...(data.customerPhone ? [{ phone: data.customerPhone }] : []),
              ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : []),
              ...(rawName && rawName.toLowerCase() !== 'walk-in customer' ? [{ name: rawName }] : []),
            ],
          },
          select: { id: true, name: true, phone: true, address: true, city: true, type: true, outstandingBalance: true, creditLimit: true },
        });

        if (targetCustomer) {
          targetCustomerId = targetCustomer.id;
        }
      }

      const resolvedShippingAddress = (data as any).shippingAddress || (data as any).customerAddress || targetCustomer?.address || null;
      const resolvedCity = (data as any).city || (data as any).customerCity || targetCustomer?.city || null;

      // 3. Create parent order entry
      const order = await tx.order.create({
        data: {
          source: data.source || OrderSource.POS_RETAIL,
          userId: data.userId,
          customerId: targetCustomerId,
          customerName: data.customerName || targetCustomer?.name || 'Walk-in Customer',
          customerPhone: data.customerPhone || targetCustomer?.phone || null,
          shippingAddress: resolvedShippingAddress,
          city: resolvedCity,
          subtotal: Number(data.subtotal) || total,
          discount: sanitizedDiscount,
          discountType: (data as any).discountType === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
          discountValue: Number((data as any).discountValue ?? (data as any).discountInput) || 0,
          totalAmount: total,
          paidAmount: isReturnBill ? 0 : paid,
          settledDueAmount: sanitizedSettledDue,
          status: isReturnBill ? OrderStatus.PAID : (isFullPaid ? OrderStatus.PAID : OrderStatus.PROCESSING),
          paymentMethod: isReturnBill ? 'RETURN_CREDIT' : (data.paymentMethod || 'CASH'),
          notes: finalOrderNotes,
          isReturnBill: isReturnBill,
          returnCreditApplied: 0,
          refundedCashAmount: Math.max(0, Number(data.refundedCashAmount) || 0),
          items: {
            create: data.items.map((i) => {
              const isRet = Boolean(i.isReturn || Number(i.quantity) < 0 || Number(i.price) < 0);
              const absQty = Math.abs(Number(i.quantity));
              const absPrice = i.price !== undefined && !isNaN(Number(i.price))
                ? Math.abs(Number(i.price))
                : Math.max(0, absQty * (Number(i.unitPrice) || 0) - (Number(i.discount) || 0));
              return {
                variantId: i.variantId,
                quantity: absQty,
                unitPrice: Number(i.unitPrice) || 0,
                discount: Number(i.discount) || 0,
                discountType: (i as any).discountType === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
                discountValue: Number((i as any).discountValue ?? (i as any).discountInput) || 0,
                price: isRet ? -absPrice : absPrice,
                isReturn: isRet,
                returnReason: (i as any).returnReason || 'UNSOLD',
                restockedToMain: false,
              };
            }),
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
          user: { select: { id: true, name: true, role: true } },
        },
      });

      // 3.5. Stage returned items into dedicated Return Inventory ledger
      for (const createdItem of createdOrder.items) {
        if (createdItem.isReturn) {
          await tx.returnInventoryItem.create({
            data: {
              orderId: createdOrder.id,
              orderItemId: createdItem.id,
              productId: createdItem.variant.productId,
              variantId: createdItem.variantId,
              quantity: createdItem.quantity,
              restockedQty: 0,
              reason: createdItem.returnReason || 'UNSOLD',
              status: 'IN_RETURN_STOCK',
            },
          });
        }
      }

      // 4. Return Credit Auto-Deduction & Customer Outstanding Debt Synchronization
      if (targetCustomerId) {
        const custId = Number(targetCustomerId);
        const customerRecord = targetCustomer || (await tx.customer.findUnique({
          where: { id: custId },
        }));

        if (!customerRecord) {
          throw new HttpException(404, `Linked customer #${targetCustomerId} not found`);
        }

        // ⭐ DEDICATED RETURN BILL & CUSTOMER CREDIT AUTO-DEDUCTION
        // When submitting a Return Bill (or net invoice total is negative/return):
        // Automatically apply the return credit against existing unpaid/partially-paid invoices (oldest first - FIFO)
        if (isReturnBill || totalReturnValue > 0) {
          const rawReturnCredit = isReturnBill ? (rawTotal < 0 ? Math.abs(rawTotal) : totalReturnValue) : (computedNet < 0 ? Math.abs(computedNet) : 0);

          if (rawReturnCredit > 0) {
            let remainingCredit = rawReturnCredit;
            let appliedCreditTotal = 0;

            // Fetch previous unpaid or partially paid credit invoices for this customer (oldest first)
            const unpaidOrders = await tx.order.findMany({
              where: {
                customerId: custId,
                id: { not: order.id },
                status: { not: OrderStatus.CANCELLED },
              },
              orderBy: { createdAt: 'asc' },
            });

            for (const prevOrder of unpaidOrders) {
              if (remainingCredit <= 0) break;
              const prevDue = Math.max(0, Math.round((Number(prevOrder.totalAmount) - Number(prevOrder.paidAmount)) * 100) / 100);
              if (prevDue <= 0) continue;

              const creditForThisOrder = Math.min(prevDue, remainingCredit);
              const newPrevPaid = Math.round((Number(prevOrder.paidAmount) + creditForThisOrder) * 100) / 100;
              const isPrevFullyPaid = newPrevPaid >= Number(prevOrder.totalAmount);

              await tx.order.update({
                where: { id: prevOrder.id },
                data: {
                  paidAmount: newPrevPaid,
                  status: isPrevFullyPaid ? OrderStatus.PAID : prevOrder.status,
                  updatedAt: new Date(),
                },
              });

              await tx.orderPayment.create({
                data: {
                  orderId: prevOrder.id,
                  amount: creditForThisOrder,
                  method: 'RETURN_CREDIT',
                  reference: `Return credit applied from Invoice #${order.invoiceNumber || order.id}`,
                  createdAt: new Date(),
                },
              });

              remainingCredit = Math.round((remainingCredit - creditForThisOrder) * 100) / 100;
              appliedCreditTotal = Math.round((appliedCreditTotal + creditForThisOrder) * 100) / 100;
            }

            // Decrement customer's overall credit/due balance accurately
            await tx.customer.update({
              where: { id: custId },
              data: {
                outstandingBalance: { decrement: rawReturnCredit },
              },
            });

            // Update returnCreditApplied on this order
            await tx.order.update({
              where: { id: order.id },
              data: {
                returnCreditApplied: appliedCreditTotal,
              },
            });
            order.returnCreditApplied = appliedCreditTotal;
          }
        }

        // Standard Sale Debt Settlement & Outstanding Balance Propagation (for non-return purchases)
        if (!isReturnBill && computedNet > 0) {
          const unpaidBalance = Math.max(0, Math.round((total - paid) * 100) / 100);
          const custCreditLimit = Number(targetCustomer?.creditLimit || 0);
          const currentOutstanding = Number(targetCustomer?.outstandingBalance || 0);

          // Check if customer exceeds allowable credit limit
          if (unpaidBalance > 0 && custCreditLimit > 0 && (currentOutstanding + unpaidBalance) > custCreditLimit) {
            throw new HttpException(
              400,
              `Transaction exceeds allowed credit limit of Rs. ${custCreditLimit}. Current outstanding: Rs. ${currentOutstanding}`
            );
          }

          // Directly decrement customer outstanding if settledDueAmount > 0
          if (sanitizedSettledDue > 0) {
            await tx.customer.update({
              where: { id: custId },
              data: { outstandingBalance: { decrement: sanitizedSettledDue } },
            });

            // FIFO Settlement on previous unpaid/partially paid credit invoices
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

          // Atomic Customer Debt Synchronization:
          // Increments Customer.outstandingBalance whenever unpaid balance remains on ANY payment method
          if (unpaidBalance > 0) {
            await tx.customer.update({
              where: { id: custId },
              data: { outstandingBalance: { increment: unpaidBalance } },
            });
          }
        }

        const freshCustomer = await tx.customer.findUnique({
          where: { id: custId },
        });

        (order as any).customer = freshCustomer;
      }

      return order;
    });

    /**
     * ========================================================================
     * SSE REAL-TIME CROSS-DEVICE BROADCAST HOOK
     * ========================================================================
     * Executed strictly AFTER prisma.$transaction has committed successfully.
     * Event name: 'invoice_created' (strictly matches frontend EventSource listener).
     * Transmits the newly generated invoice across all terminals (POS, Mobile, Desktop).
     */
    try {
      broadcastLiveEvent('invoice_created', createdOrder);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast invoice_created after transaction commit:', sseErr);
    }

    return createdOrder;
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
   * Get paginated & filtered Invoices list with multi-word search, customer filter & Sri Lanka timezone date boundaries.
   * Supports RBAC data-scoping: strictly constrains where clause when `userId` is passed for Sales Representatives (REP).
   */
  async getInvoices(params: {
    search?: string;
    customerId?: number;
    paymentMethod?: string;
    source?: OrderSource;
    startDate?: string;
    endDate?: string;
    sortBy?: string;
    page?: number;
    limit?: number;
    userId?: number;
  }) {
    // Automatically reconcile matured post-dated cheques before returning invoice query results
    try {
      await PaymentService.reconcileMaturedCheques(params.customerId ? { customerId: Number(params.customerId) } : undefined);
    } catch (reconcileErr) {
      console.error('[OrderService.getInvoices] Warning: Failed to reconcile matured cheques:', reconcileErr);
    }

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 15);
    const skip = (page - 1) * limit;

    const where: any = {};

    // Role-Based Access Control (RBAC): Enforce strict scoping to the authoring user (REP role)
    if (params.userId !== undefined && !isNaN(Number(params.userId)) && Number(params.userId) > 0) {
      where.userId = Number(params.userId);
    }

    if (params.source) {
      where.source = params.source;
    }

    if (params.customerId) {
      where.customerId = Number(params.customerId);
    }

    if (params.paymentMethod && params.paymentMethod !== 'ALL') {
      where.paymentMethod = params.paymentMethod;
    }

    // Date range boundaries normalized in Sri Lanka timezone (UTC+05:30)
    if (params.startDate || params.endDate) {
      const parseBoundary = (raw: string | undefined, isEnd: boolean): Date | null => {
        if (!raw || !raw.trim()) return null;
        const str = raw.trim();
        const ymdMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str);
        if (ymdMatch) {
          const yr = ymdMatch[1];
          const mo = ymdMatch[2].padStart(2, '0');
          const dy = ymdMatch[3].padStart(2, '0');
          const time = isEnd ? '23:59:59.999' : '00:00:00.000';
          const d = new Date(`${yr}-${mo}-${dy}T${time}+05:30`);
          return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
      };

      let startBound = parseBoundary(params.startDate, false);
      let endBound = parseBoundary(params.endDate, true);

      if (startBound && endBound && startBound > endBound) {
        const temp = startBound;
        startBound = endBound;
        endBound = temp;
      }

      if (startBound || endBound) {
        where.createdAt = {};
        if (startBound) where.createdAt.gte = startBound;
        if (endBound) where.createdAt.lte = endBound;
      }
    }

    /**
     * Helper to sanitize and parse numerical invoice IDs from search queries.
     * Matches patterns: #INV123, INV123, INV-123, #123, raw digits 123, or space-separated #INV 123.
     */
    const parseInvoiceId = (term: string): number | null => {
      const cleaned = term.trim();
      const match = cleaned.match(/^(?:#\s*)?(?:INV[-_\s]*|ORD[-_\s]*)?(\d+)$/i);
      if (match) {
        const parsed = parseInt(match[1], 10);
        return !isNaN(parsed) && parsed > 0 ? parsed : null;
      }
      return null;
    };

    /**
     * Builds comprehensive Prisma OR conditions for an individual search term.
     */
    const buildSearchConditions = (term: string) => {
      const parsedInvoiceId = parseInvoiceId(term);
      const cleanTerm = term.replace(/^#\s*/, '');

      const orConditions: any[] = [];

      // Include numerical invoice ID match if valid
      if (parsedInvoiceId) {
        orConditions.push({ id: parsedInvoiceId });
      }

      // Exact and sanitized invoice number contains matches
      orConditions.push({ invoiceNumber: { contains: term } });
      if (cleanTerm && cleanTerm !== term) {
        orConditions.push({ invoiceNumber: { contains: cleanTerm } });
      }

      // Customer name, phone, and payment method matches
      orConditions.push(
        { customerName: { contains: term } },
        { customerPhone: { contains: term } },
        { paymentMethod: { contains: term } },
        { customer: { is: { name: { contains: term } } } },
        { customer: { is: { phone: { contains: term } } } }
      );

      return orConditions;
    };

    // Instant Multi-word, Invoice Number, and Phone Number Matching across all order fields
    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      const entireInvoiceId = parseInvoiceId(q);
      const terms = q.split(/\s+/).filter(Boolean);

      if (entireInvoiceId) {
        // Direct numerical ID priority condition
        const cleanQuery = q.replace(/^#\s*/, '');
        where.OR = [
          { id: entireInvoiceId },
          { invoiceNumber: { contains: q } },
          ...(cleanQuery !== q ? [{ invoiceNumber: { contains: cleanQuery } }] : []),
          { customerName: { contains: q } },
          { customerPhone: { contains: q } },
          { customer: { is: { name: { contains: q } } } },
          { customer: { is: { phone: { contains: q } } } },
        ];
      } else if (terms.length === 1) {
        where.OR = buildSearchConditions(terms[0]);
      } else if (terms.length > 1) {
        where.AND = terms.map((term) => ({
          OR: buildSearchConditions(term),
        }));
      }
    }

    let orderBy: any = { createdAt: 'desc' };
    const isOverdueOldest = params.sortBy === 'most_overdue' || params.sortBy === 'overdue_oldest';
    const isOverdueRecent = params.sortBy === 'least_overdue' || params.sortBy === 'overdue_newest';

    /**
     * Dual Overdue Sorting Options:
     * - 'most_overdue' / 'overdue_oldest': Filters unpaid/due invoices (creditDue > 0) and orders by oldest issue date first (createdAt ASC).
     * - 'least_overdue' / 'overdue_newest': Filters unpaid/due invoices (creditDue > 0) and orders by newest issue date first (createdAt DESC).
     */
    if (isOverdueOldest || isOverdueRecent) {
      where.status = { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] };
      orderBy = isOverdueOldest ? { createdAt: 'asc' } : { createdAt: 'desc' };
    } else if (params.sortBy === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (params.sortBy === 'highest_amount') {
      orderBy = { totalAmount: 'desc' };
    } else if (params.sortBy === 'lowest_amount') {
      orderBy = { totalAmount: 'asc' };
    } else if (params.sortBy === 'highest_due') {
      orderBy = [{ totalAmount: 'desc' }, { paidAmount: 'asc' }];
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: { select: { id: true, name: true, phone: true, address: true, city: true, type: true, outstandingBalance: true } },
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
          },
          user: { select: { id: true, name: true, role: true } },
        },
      }),
    ]);

    // Backfill customer relation or missing shippingAddress/city by looking up matching customers
    const ordersNeedingCustomer = orders.filter(
      (o) => (!o.customer || !o.shippingAddress) && (o.customerPhone || o.customerName)
    );

    const customerLookupMap = new Map<string, any>();
    if (ordersNeedingCustomer.length > 0) {
      const phones = Array.from(
        new Set(
          ordersNeedingCustomer
            .map((o) => o.customerPhone?.trim())
            .filter((p): p is string => Boolean(p))
        )
      );
      const names = Array.from(
        new Set(
          ordersNeedingCustomer
            .map((o) => o.customerName?.trim())
            .filter((n): n is string => Boolean(n && n.toLowerCase() !== 'walk-in customer'))
        )
      );

      if (phones.length > 0 || names.length > 0) {
        const foundCustomers = await prisma.customer.findMany({
          where: {
            OR: [
              ...(phones.length > 0 ? [{ phone: { in: phones } }] : []),
              ...(names.length > 0 ? [{ name: { in: names } }] : []),
            ],
          },
          select: { id: true, name: true, phone: true, address: true, city: true, type: true, outstandingBalance: true },
        });

        for (const c of foundCustomers) {
          if (c.phone) customerLookupMap.set(`phone:${c.phone}`, c);
          if (c.name) customerLookupMap.set(`name:${c.name.toLowerCase()}`, c);
        }
      }
    }

    const mappedOrders = orders.map((order) => {
      (order.items || []).forEach((it: any) => {
        it.isReturn = Boolean(it.isReturn || (typeof it.price === 'number' && it.price < 0));
      });
      const parsed = parseOrderStructuredNotes(order.notes);
      const originalTotalAmount = parsed.originalTotalAmount ?? (
        parsed.returns.length > 0
          ? order.totalAmount + parsed.returns.reduce((sum, r) => sum + (Number(r.totalReturnRefund) || 0), 0)
          : order.totalAmount
      );

      let resolvedCustomer = order.customer;
      if (!resolvedCustomer) {
        if (order.customerPhone && customerLookupMap.has(`phone:${order.customerPhone.trim()}`)) {
          resolvedCustomer = customerLookupMap.get(`phone:${order.customerPhone.trim()}`);
        } else if (order.customerName && customerLookupMap.has(`name:${order.customerName.trim().toLowerCase()}`)) {
          resolvedCustomer = customerLookupMap.get(`name:${order.customerName.trim().toLowerCase()}`);
        }
      }

      const resolvedShippingAddress =
        order.shippingAddress || resolvedCustomer?.address || null;
      const resolvedCity = order.city || resolvedCustomer?.city || null;

      return {
        ...order,
        customer: resolvedCustomer,
        shippingAddress: resolvedShippingAddress,
        city: resolvedCity,
        returns: parsed.returns,
        originalTotalAmount,
        splitPayments: parsed.splitPayments.length > 0 ? parsed.splitPayments : undefined,
        cheques: parsed.cheques.length > 0 ? parsed.cheques : undefined,
        userNotes: parsed.userNotes,
      };
    });

    let resultOrders = mappedOrders;
    if (isOverdueOldest || isOverdueRecent) {
      resultOrders = mappedOrders.filter(
        (order) => Math.max(0, (Number(order.totalAmount) || 0) - (Number(order.paidAmount) || 0)) > 0
      );
    }

    return {
      data: resultOrders,
      pagination: {
        total: isOverdueOldest || isOverdueRecent ? resultOrders.length : total,
        page,
        limit,
        totalPages: isOverdueOldest || isOverdueRecent ? Math.ceil(resultOrders.length / limit) || 1 : Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get single invoice order details for editing in POS modal
   */
  async getInvoiceById(id: number) {
    // Automatically reconcile matured cheques for this order before returning details
    try {
      await PaymentService.reconcileMaturedCheques({ orderId: Number(id) });
    } catch (reconcileErr) {
      console.error('[OrderService.getInvoiceById] Warning: Failed to reconcile matured cheques:', reconcileErr);
    }

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
            type: true,
            outstandingBalance: true,
            repId: true,
            rep: { select: { id: true, name: true } },
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
        user: { select: { id: true, name: true, role: true } },
      },
    });

    if (!order) {
      throw new HttpException(404, `Invoice #${id} not found`);
    }

    // If order has no linked customer, automatically look up customer by phone or name
    if (!order.customer && (order.customerPhone || order.customerName)) {
      const cleanPhone = order.customerPhone ? String(order.customerPhone).replace(/[^0-9]/g, '').slice(-9) : '';
      const rawName = order.customerName ? String(order.customerName).trim() : '';

      const matchedCustomer = await prisma.customer.findFirst({
        where: {
          OR: [
            ...(order.customerPhone ? [{ phone: order.customerPhone }] : []),
            ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : []),
            ...(rawName && rawName.toLowerCase() !== 'walk-in customer' ? [{ name: rawName }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          city: true,
          type: true,
          outstandingBalance: true,
          repId: true,
          rep: { select: { id: true, name: true } },
        },
      });

      if (matchedCustomer) {
        (order as any).customer = matchedCustomer;
        if (!order.customerId) (order as any).customerId = matchedCustomer.id;
      }
    }

    // Attach resolved customer address into shippingAddress fallback for frontend print parities
    if (order.customer?.address && !order.shippingAddress) {
      (order as any).shippingAddress = order.customer.address;
    }
    if (order.customer?.city && !order.city) {
      (order as any).city = order.customer.city;
    }

    // Parse structured notes and return history if present
    const parsed = parseOrderStructuredNotes(order.notes);
    (order.items || []).forEach((it: any, idx: number) => {
      it.isReturn = Boolean(it.isReturn || (typeof it.price === 'number' && it.price < 0));
      if (parsed.itemVariants.length > 0 && parsed.itemVariants[idx]) {
        it.size = parsed.itemVariants[idx].size;
        it.color = parsed.itemVariants[idx].color;
        it.selectedSize = parsed.itemVariants[idx].size;
        it.selectedColor = parsed.itemVariants[idx].color;
      }
    });

    const originalTotalAmount = parsed.originalTotalAmount ?? (
      parsed.returns.length > 0
        ? order.totalAmount + parsed.returns.reduce((sum, r) => sum + (Number(r.totalReturnRefund) || 0), 0)
        : order.totalAmount
    );

    // Attach line-level discount properties if itemDiscounts array exists
    if (parsed.itemDiscounts && parsed.itemDiscounts.length > 0) {
      (order.items || []).forEach((it: any, idx: number) => {
        if (parsed.itemDiscounts && parsed.itemDiscounts[idx]) {
          it.discountType = parsed.itemDiscounts[idx].discountType;
          it.discountInput = parsed.itemDiscounts[idx].discountInput;
        }
      });
    }

    return {
      ...order,
      splitPayments: parsed.splitPayments.length > 0 ? parsed.splitPayments : undefined,
      cheques: parsed.cheques.length > 0 ? parsed.cheques : undefined,
      returns: parsed.returns,
      originalTotalAmount,
      userNotes: parsed.userNotes,
      discountType: parsed.discountType || (parsed.rawParsed?.discountType),
      discountInput: parsed.discountInput !== undefined ? parsed.discountInput : parsed.rawParsed?.discountInput,
      discountRate: parsed.discountRate !== undefined ? parsed.discountRate : parsed.rawParsed?.discountRate,
      itemDiscounts: parsed.itemDiscounts || parsed.rawParsed?.itemDiscounts,
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
        discount?: number;
        price: number;
      }[];
      subtotal: number;
      discount?: number;
      discountType?: string;
      discountInput?: number;
      discountRate?: number;
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
    },
    currentUser?: { id?: number | string; userId?: number | string; role?: string; name?: string; email?: string }
  ) {
    const updatedOrder = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!existing) {
        throw new HttpException(404, `Invoice #${orderId} not found`);
      }

      // Role & Ownership Validation: REPs can only edit invoices they authored
      if (currentUser) {
        const userRole = String(currentUser.role || '').toUpperCase();
        const requestingUserId = Number(currentUser.id ?? currentUser.userId);

        if (userRole === 'REP') {
          const isOwner = Number(existing.userId) === requestingUserId;
          if (!isOwner) {
            throw new HttpException(
              403,
              'Unauthorized: Representatives can only edit invoices they authored'
            );
          }
        }
      }

      // 1. Revert previous stock (decrement returns if restocked, increment standard items)
      for (const oldItem of existing.items) {
        if (oldItem.isReturn) {
          if (oldItem.restockedToMain) {
            await tx.productVariant.update({
              where: { id: oldItem.variantId },
              data: { stock: { decrement: oldItem.quantity } },
            });
          }
          await tx.returnInventoryItem.deleteMany({
            where: { orderItemId: oldItem.id },
          });
        } else {
          await tx.productVariant.update({
            where: { id: oldItem.variantId },
            data: { stock: { increment: oldItem.quantity } },
          });
        }
      }

      // 2. Validate and adjust new stock (deduct standard items, stage returns in return inventory)
      for (const newItem of data.items) {
        const isRet = Boolean((newItem as any).isReturn || newItem.quantity < 0);
        const absQty = Math.abs(newItem.quantity);
        const variant = await tx.productVariant.findUnique({
          where: { id: newItem.variantId },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          throw new HttpException(404, `Product variant #${newItem.variantId} not found`);
        }

        if (isRet) {
          // Staged into Return Inventory; do not directly increment variant stock
        } else {
          if (variant.stock < absQty) {
            throw new HttpException(
              400,
              `Insufficient stock for "${variant.product.name}" (${variant.size}/${variant.color}). Available: ${variant.stock}`
            );
          }

          await tx.productVariant.update({
            where: { id: newItem.variantId },
            data: { stock: { decrement: absQty } },
          });
        }
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

      let targetCustomerId = data.customerId ? Number(data.customerId) : existing.customerId;
      let targetCustomer: any = null;

      if (targetCustomerId) {
        targetCustomer = await tx.customer.findUnique({
          where: { id: targetCustomerId },
          select: { id: true, name: true, phone: true, address: true, city: true, type: true, outstandingBalance: true, creditLimit: true },
        });
      } else if (data.customerPhone || data.customerName) {
        const cleanPhone = data.customerPhone ? String(data.customerPhone).replace(/[^0-9]/g, '').slice(-9) : '';
        const rawName = data.customerName ? String(data.customerName).trim() : '';

        targetCustomer = await tx.customer.findFirst({
          where: {
            OR: [
              ...(data.customerPhone ? [{ phone: data.customerPhone }] : []),
              ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : []),
              ...(rawName && rawName.toLowerCase() !== 'walk-in customer' ? [{ name: rawName }] : []),
            ],
          },
          select: { id: true, name: true, phone: true, address: true, city: true, type: true, outstandingBalance: true, creditLimit: true },
        });

        if (targetCustomer) {
          targetCustomerId = targetCustomer.id;
        }
      }

      const resolvedShippingAddress = (data as any).shippingAddress || (data as any).customerAddress || targetCustomer?.address || existing.shippingAddress || null;
      const resolvedCity = (data as any).city || (data as any).customerCity || targetCustomer?.city || existing.city || null;

      if (targetCustomerId) {
        const custId = Number(targetCustomerId);
        const isCustomerChanged = Boolean(existing.customerId && existing.customerId !== targetCustomerId);

        // 1. If settledDueAmount increased (or customer changed), apply incremental FIFO Settlement on previous unpaid invoices
        const settledDueToApply = isCustomerChanged
          ? newSettledDue
          : Math.max(0, Math.round((newSettledDue - oldSettledDue) * 100) / 100);

        if (settledDueToApply > 0) {
          let remainingToSettle = settledDueToApply;
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
            const unpaidAmount = Math.max(0, Math.round((Number(prevOrder.totalAmount) - Number(prevOrder.paidAmount)) * 100) / 100);
            if (unpaidAmount > 0) {
              const settleForThis = Math.min(unpaidAmount, remainingToSettle);
              const newPrevPaid = Math.round((Number(prevOrder.paidAmount) + settleForThis) * 100) / 100;
              const isPrevPaid = newPrevPaid >= Number(prevOrder.totalAmount);

              await tx.order.update({
                where: { id: prevOrder.id },
                data: {
                  paidAmount: newPrevPaid,
                  status: isPrevPaid ? OrderStatus.PAID : prevOrder.status,
                  updatedAt: new Date(),
                },
              });

              await tx.orderPayment.create({
                data: {
                  orderId: prevOrder.id,
                  amount: settleForThis,
                  method: data.paymentMethod || 'CASH',
                  reference: `Settled from POS Invoice #${orderId}`,
                  createdAt: new Date(),
                },
              });

              remainingToSettle = Math.round((remainingToSettle - settleForThis) * 100) / 100;
            }
          }
        }

        // 2. Rollback previous customer's debt if customer was changed
        if (isCustomerChanged && existing.customerId) {
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

        // 3. Atomically synchronize live outstanding balance for active customer from all active orders
        const allActiveCustomerOrders = await tx.order.findMany({
          where: { customerId: custId, status: { not: OrderStatus.CANCELLED } },
          select: { id: true, totalAmount: true, paidAmount: true },
        });
        const trueLiveDebt = allActiveCustomerOrders.reduce((sum, o) => {
          const ordTotal = o.id === orderId ? newTotal : Number(o.totalAmount || 0);
          const ordPaid = o.id === orderId ? newPaid : Number(o.paidAmount || 0);
          return sum + Math.max(0, ordTotal - ordPaid);
        }, 0);
        await tx.customer.update({
          where: { id: custId },
          data: { outstandingBalance: Math.round(trueLiveDebt * 100) / 100 },
        });
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

      const itemVariants = (data.items || []).map((i: any) => ({
        variantId: Number(i.variantId),
        size: i.size || i.selectedSize || '',
        color: i.color || i.selectedColor || '',
      }));
      const hasItemVariants = itemVariants.some((iv: any) => iv.size || iv.color);

      const itemDiscounts = (data.items || []).map((i: any) => ({
        discountType: (i as any).discountType || 'FIXED',
        discountInput: (i as any).discountInput !== undefined && (i as any).discountInput !== '' ? Number((i as any).discountInput) : 0,
        discount: Number(i.discount) || 0,
      }));
      const hasItemDiscounts = itemDiscounts.some((id: any) => id.discount > 0 || id.discountInput > 0);
      const hasOrderDiscount = (data as any).discountType || (data as any).discountInput !== undefined;

      const existingParsed = parseOrderStructuredNotes(existing.notes);

      let finalOrderNotes: string | null = cleanUserNote || null;
      if (
        (data.splitPayments && data.splitPayments.length > 0) ||
        (data.cheques && data.cheques.length > 0) ||
        hasItemVariants ||
        hasItemDiscounts ||
        hasOrderDiscount ||
        existingParsed.returns.length > 0
      ) {
        try {
          finalOrderNotes = JSON.stringify({
            ...existingParsed.rawParsed,
            userNotes: cleanUserNote,
            splitPayments: data.splitPayments || existingParsed.splitPayments || [],
            cheques: data.cheques || (data.splitPayments ? data.splitPayments.filter((s) => s.method === 'CHEQUE') : existingParsed.cheques || []),
            itemVariants: hasItemVariants ? itemVariants : existingParsed.itemVariants,
            discountType: (data as any).discountType || existingParsed.discountType,
            discountInput: (data as any).discountInput !== undefined ? (data as any).discountInput : existingParsed.discountInput,
            discountRate: (data as any).discountRate !== undefined ? (data as any).discountRate : existingParsed.discountRate,
            itemDiscounts: hasItemDiscounts ? itemDiscounts : existingParsed.itemDiscounts,
            returns: existingParsed.returns,
            originalTotalAmount: existingParsed.originalTotalAmount,
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
          customerName: data.customerName || targetCustomer?.name || existing.customerName || 'Walk-in Customer',
          customerPhone: data.customerPhone || targetCustomer?.phone || existing.customerPhone || null,
          shippingAddress: resolvedShippingAddress,
          city: resolvedCity,
          subtotal: Number(data.subtotal),
          discount: Number(data.discount) || 0,
          discountType: (data as any).discountType === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
          discountValue: Number((data as any).discountValue ?? (data as any).discountInput) || 0,
          totalAmount: newTotal,
          paidAmount: newPaid,
          settledDueAmount: newSettledDue,
          paymentMethod: newCreditDue > 0 ? 'CREDIT' : data.paymentMethod || 'CASH',
          notes: finalOrderNotes,
          refundedCashAmount: (data as any).refundedCashAmount !== undefined ? Math.max(0, Number((data as any).refundedCashAmount) || 0) : Number(existing.refundedCashAmount || 0),
          status: newPaid >= newTotal ? OrderStatus.PAID : OrderStatus.PROCESSING,
          items: {
            create: data.items.map((i) => {
              const isRet = Boolean((i as any).isReturn || Number(i.quantity) < 0 || Number(i.price) < 0);
              const absQty = Math.abs(Number(i.quantity));
              const absPrice = i.price !== undefined && !isNaN(Number(i.price))
                ? Math.abs(Number(i.price))
                : Math.max(0, absQty * (Number(i.unitPrice) || 0) - (Number(i.discount) || 0));
              return {
                variantId: i.variantId,
                quantity: absQty,
                unitPrice: Number(i.unitPrice) || 0,
                discount: Number(i.discount) || 0,
                discountType: (i as any).discountType === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
                discountValue: Number((i as any).discountValue ?? (i as any).discountInput) || 0,
                price: isRet ? -absPrice : absPrice,
                isReturn: isRet,
                returnReason: (i as any).returnReason || 'UNSOLD',
                restockedToMain: false,
              };
            }),
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
          user: { select: { id: true, name: true, role: true } },
        },
      });

      // Stage new returned items into dedicated Return Inventory ledger
      for (const it of updatedOrder.items) {
        if (it.isReturn) {
          await tx.returnInventoryItem.create({
            data: {
              orderId: updatedOrder.id,
              orderItemId: it.id,
              productId: it.variant.productId,
              variantId: it.variantId,
              quantity: it.quantity,
              restockedQty: 0,
              reason: it.returnReason || 'UNSOLD',
              status: 'IN_RETURN_STOCK',
            },
          });
        }
      }

      return updatedOrder;
    });

    /**
     * ========================================================================
     * SSE REAL-TIME CROSS-DEVICE BROADCAST HOOK
     * ========================================================================
     * Executed strictly AFTER prisma.$transaction has committed successfully.
     * Event names: 'invoice_updated' and 'order_updated' (strictly match frontend listeners).
     */
    try {
      broadcastLiveEvent('invoice_updated', updatedOrder);
      broadcastLiveEvent('order_updated', updatedOrder);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast invoice_updated / order_updated after transaction commit:', sseErr);
    }

    return updatedOrder;
  }

  /**
   * Delete invoice with scoped authorization, automatic inventory stock roll-back, and customer credit adjustment
   * 
   * Authorization Invariant:
   * - ADMIN: Global unrestricted deletion authority across all order types and creators.
   * - REP: Scoped strictly to wholesale invoices created by the requesting sales representative (ownership validation).
   * - OTHER: 403 Forbidden.
   * 
   * Atomic Transaction Integrity:
   * 1. Validates invoice existence and ownership constraints.
   * 2. Automatically restores / rolls back inventory stock quantities for all line item variants.
   * 3. Decrements any unpaid credit balance from linked customer's outstanding balance ledger.
   * 4. Permanently cascades/deletes order items, payment records, and the parent order atomically.
   * 
   * @param orderId ID of the invoice order to delete
   * @param currentUser Optional authenticated user context containing id / userId and role
   */
  async deleteInvoiceOrder(
    orderId: number,
    currentUser?: { id?: number | string; userId?: number | string; role?: string; name?: string; email?: string }
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new HttpException(404, `Invoice #${orderId} not found`);
      }

      // Role & Ownership Validation: REPs are strictly not permitted to delete invoices
      if (currentUser) {
        const userRole = String(currentUser.role || '').toUpperCase();
        if (userRole === 'REP') {
          throw new HttpException(
            403,
            'Sales Representatives are not permitted to delete invoices'
          );
        }
        if (userRole !== 'ADMIN') {
          throw new HttpException(
            403,
            'Unauthorized: Insufficient permissions to delete invoices'
          );
        }
      }

      // 1. Rollback stock & clean up return items
      const returnInventoryItems = await tx.returnInventoryItem.findMany({
        where: { orderId },
      });

      for (const item of order.items) {
        if (!item.isReturn) {
          // Standard sold item: increment stock back into inventory
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        } else {
          // Return item: decrement stock if it had been restocked into warehouse inventory
          const linkedReturn = returnInventoryItems.find(
            (r) => r.orderItemId === item.id || (r.variantId === item.variantId && r.orderId === orderId)
          );
          const restockedQty =
            linkedReturn?.restockedQty ||
            (linkedReturn?.status === 'RESTOCKED' || (linkedReturn as any)?.restockDecision === 'RESTOCKED'
              ? item.quantity
              : 0);

          if (restockedQty > 0) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { decrement: restockedQty } },
            });
          }
        }
      }

      // Clean up linked ReturnInventoryItem records
      await tx.returnInventoryItem.deleteMany({
        where: { orderId },
      });

      // 2. Accurately synchronize customer outstanding balance from remaining active orders
      if (order.customerId) {
        const remainingCustomerOrders = await tx.order.findMany({
          where: {
            customerId: order.customerId,
            id: { not: orderId },
            status: { not: OrderStatus.CANCELLED },
          },
          select: { totalAmount: true, paidAmount: true },
        });
        const trueRemainingDue = remainingCustomerOrders.reduce(
          (sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0)),
          0
        );
        await tx.customer.update({
          where: { id: order.customerId },
          data: { outstandingBalance: Math.round(trueRemainingDue * 100) / 100 },
        });
      }

      // 3. Atomically delete items, payments, and order
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.orderPayment.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });

      return {
        success: true,
        message: `Invoice #${orderId} deleted successfully and inventory stock restored`,
      };
    });

    /**
     * ========================================================================
     * SSE REAL-TIME CROSS-DEVICE BROADCAST HOOK
     * ========================================================================
     * Executed strictly AFTER prisma.$transaction has committed successfully.
     * Event names: 'invoice_deleted' and 'order_deleted' (strictly match frontend listeners).
     */
    try {
      broadcastLiveEvent('invoice_deleted', { id: Number(orderId), invoiceId: Number(orderId) });
      broadcastLiveEvent('order_deleted', { id: Number(orderId), orderId: Number(orderId) });
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast invoice_deleted / order_deleted after transaction commit:', sseErr);
    }

    return result;
  }

  /**
   * Safely toggle or update Rep Dispatch Tracking status on an invoice.
   * Records whether the order/invoice was dispatched with a sales representative
   * and captures the operator's role (e.g. ADMIN, STAFF, CASHIER, REP).
   */
  async toggleInvoiceDispatch(
    orderId: number,
    options?: { isDispatched?: boolean },
    user?: { role?: string; userId?: number; name?: string }
  ) {
    const existing = await prisma.order.findUnique({
      where: { id: Number(orderId) },
      select: { id: true, isDispatched: true, dispatchedByRole: true, invoiceNumber: true },
    });

    if (!existing) {
      throw new Error(`Target invoice #${orderId} could not be found.`);
    }

    const nextIsDispatched = typeof options?.isDispatched === 'boolean'
      ? options.isDispatched
      : !existing.isDispatched;

    const operatorRole = user?.role ? String(user.role).toUpperCase() : 'ADMIN';
    const nextDispatchedByRole = nextIsDispatched ? operatorRole : null;

    const updatedOrder = await prisma.order.update({
      where: { id: Number(orderId) },
      data: {
        isDispatched: nextIsDispatched,
        dispatchedByRole: nextDispatchedByRole,
      },
      select: {
        id: true,
        invoiceNumber: true,
        isDispatched: true,
        dispatchedByRole: true,
        updatedAt: true,
      },
    });

    /**
     * SSE Real-time Cross-Device Broadcast Hook for dispatch tracking toggle
     */
    try {
      broadcastLiveEvent('invoice_updated', updatedOrder);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast invoice_updated on dispatch toggle:', sseErr);
    }

    return updatedOrder;
  }

  /**
   * Delegates PDF rendering to dedicated InvoicePdfService with fully hydrated variant & customer models
   */
  async generateInvoicePdf(orderId: number) {
    const order = await prisma.order.findUnique({
      where: { id: Number(orderId) },
      include: {
        customer: true,
        payments: {
          orderBy: { createdAt: 'asc' },
        },
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
    if (!order.customer && (order.customerPhone || order.customerName)) {
      const cleanPhone = order.customerPhone ? String(order.customerPhone).replace(/[^0-9]/g, '').slice(-9) : '';
      const rawName = order.customerName ? String(order.customerName).trim() : '';

      const matchedCustomer = await prisma.customer.findFirst({
        where: {
          OR: [
            ...(order.customerPhone ? [{ phone: order.customerPhone }] : []),
            ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : []),
            ...(rawName && rawName.toLowerCase() !== 'walk-in customer' ? [{ name: rawName }] : []),
          ],
        },
      });

      if (matchedCustomer) {
        (order as any).customer = matchedCustomer;
      }
    }

    if (order.customer?.address && !order.shippingAddress) {
      (order as any).shippingAddress = order.customer.address;
    }
    if (order.customer?.city && !order.city) {
      (order as any).city = order.customer.city;
    }

    // Hydrate item custom size and color from notes
    if (order.notes) {
      try {
        let current: any = order.notes;
        while (typeof current === 'string' && current.trim().startsWith('{')) {
          current = JSON.parse(current);
        }
        if (typeof current === 'object' && current !== null && Array.isArray(current.itemVariants)) {
          (order.items || []).forEach((it: any, idx: number) => {
            if (current.itemVariants[idx]) {
              it.size = current.itemVariants[idx].size;
              it.color = current.itemVariants[idx].color;
              it.selectedSize = current.itemVariants[idx].size;
              it.selectedColor = current.itemVariants[idx].color;
            }
          });
        }
      } catch {}
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
      const newBal = Math.max(0, Math.round((customer.outstandingBalance - paymentToApply) * 100) / 100);
      const updatedCustomer = await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalance: newBal,
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
        status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        source: true,
        totalAmount: true,
        paidAmount: true,
        paymentMethod: true,
        createdAt: true,
        payments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            amount: true,
            method: true,
            reference: true,
            createdAt: true,
          },
        },
      },
      take: 100,
    });

    return orders
      .filter((o) => (Number(o.totalAmount) - Number(o.paidAmount)) > 0.01)
      .map((o) => {
        const due = Math.max(0, Math.round((Number(o.totalAmount) - Number(o.paidAmount)) * 100) / 100);
        return {
          id: o.id,
          orderId: o.id,
          invoiceNo: o.invoiceNumber || `INV${o.id}`,
          invoiceNumber: o.invoiceNumber || `INV${o.id}`,
          source: o.source,
          totalAmount: o.totalAmount,
          total: o.totalAmount,
          paidAmount: o.paidAmount,
          paid: o.paidAmount,
          dueAmount: due,
          due,
          createdAt: o.createdAt,
          date: new Date(o.createdAt).toISOString().split('T')[0],
          payments: o.payments,
          paymentHistory: o.payments,
        };
      });
  }

  /**
   * Process in-store invoice item return & atomic stock restoration.
   *
   * Architecture, Rollback Arithmetic & Concurrency Safeguards:
   * 1. Schema Preservation Strategy:
   *    - Operates with ZERO alterations to `schema.prisma` and without database migrations.
   *    - Maintains an immutable return audit log in `Order.notes` JSON metadata.
   * 2. Strict Concurrency Guard:
   *    - Wrapped entirely inside an isolated `prisma.$transaction`.
   *    - Reads live invoice rows, validates cumulative past returns, updates stock,
   *      and commits all financial ledger balances atomically.
   * 3. Cumulative Quantity Validation:
   *    - Sums historical returns across all previous return events for this invoice:
   *      `returnableQty = orderItem.quantity - sum(pastReturns.returnQty)`.
   *    - Throws `HttpException(400)` if requested `returnQty > returnableQty` or if total returnQty is 0.
   * 4. Atomic Inventory Restoration:
   *    - For every returned item, executes `tx.productVariant.update` with `{ stock: { increment: returnQty } }`.
   * 5. Financial Ledger Reconciliation & Due Rollback Arithmetic:
   *    - Line item amount: `amount = round(returnQty * unitPrice, 2)`.
   *    - Total refund value: `totalReturnRefund = sum(item.amount)`.
   *    - New invoice net total: `newBillTotal = max(0, order.totalAmount - totalReturnRefund)`.
   *    - Previous credit due: `oldCreditDue = max(0, order.totalAmount - order.paidAmount)`.
   *    - Due offset logic:
   *      a) If the bill had unpaid credit due (`oldCreditDue > 0`), the return refund FIRST offsets
   *         that credit due: `creditDueAdjustment = min(oldCreditDue, totalReturnRefund)`.
   *         This amount is decremented from `Customer.outstandingBalance`.
   *      b) Any refund value exceeding the credit due represents cash/tender paid by customer:
   *         `cashRefundAmount = min(order.paidAmount, totalReturnRefund - creditDueAdjustment)`.
   *         `order.paidAmount` is decremented by `cashRefundAmount`, and a negative audit entry
   *         is recorded in `OrderPayment` (`amount: -cashRefundAmount`).
   * 6. Audit Trail Recording:
   *    - Generates a globally unique `returnId` (e.g., `RET-<orderId>-<timestamp>`).
   *    - Appends the return event to `Order.notes` including items breakdown, reason, and cashier identity.
   */
  async processInvoiceReturn(
    orderId: number,
    data: ProcessReturnInput,
    user?: { userId?: number; name?: string; role?: string }
  ) {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch order with items, variants, linked customer, and payments
      const order = await tx.order.findUnique({
        where: { id: Number(orderId) },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
          customer: true,
          payments: true,
        },
      });

      if (!order) {
        throw new HttpException(404, `Invoice #${orderId} not found`);
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new HttpException(400, `Cannot process return for cancelled invoice #${orderId}`);
      }

      // 2. Parse existing structured metadata from order.notes
      const parsedNotes = parseOrderStructuredNotes(order.notes);
      const existingReturns = parsedNotes.returns || [];

      // Calculate cumulative returned quantities per variantId
      const cumulativeReturnedQty: Record<number, number> = {};
      for (const pastRet of existingReturns) {
        for (const item of pastRet.returnedItems) {
          cumulativeReturnedQty[item.variantId] = (cumulativeReturnedQty[item.variantId] || 0) + Number(item.returnQty);
        }
      }

      // 3. Validate returned items payload
      if (!Array.isArray(data.returnedItems) || data.returnedItems.length === 0) {
        throw new HttpException(400, 'At least one item must be submitted for return');
      }

      const activeReturnsToProcess: ReturnedItemRecord[] = [];
      let totalReturnRefund = 0;

      for (const retItem of data.returnedItems) {
        const variantId = Number(retItem.variantId);
        const returnQty = Number(retItem.returnQty);

        if (!returnQty || returnQty <= 0) {
          continue; // Skip items with 0 return quantity
        }

        // Locate original order item
        const originalOrderItem = order.items.find((it) => it.variantId === variantId);
        if (!originalOrderItem) {
          throw new HttpException(400, `Item variant #${variantId} was not part of invoice #${orderId}`);
        }

        const originalPurchasedQty = originalOrderItem.quantity;
        const alreadyReturned = cumulativeReturnedQty[variantId] || 0;
        const returnableQty = originalPurchasedQty - alreadyReturned;

        if (returnQty > returnableQty) {
          const prodName = originalOrderItem.variant?.product?.name || `Variant #${variantId}`;
          throw new HttpException(
            400,
            `Return quantity (${returnQty}) for "${prodName}" exceeds remaining returnable quantity (${returnableQty}). Original purchased: ${originalPurchasedQty}, already returned: ${alreadyReturned}.`
          );
        }

        // Calculate unit price and line amount
        const unitPrice = retItem.unitPrice !== undefined && Number(retItem.unitPrice) >= 0
          ? Number(retItem.unitPrice)
          : (originalOrderItem.unitPrice || (originalOrderItem.price / originalOrderItem.quantity));
        const amount = Math.round(returnQty * unitPrice * 100) / 100;
        totalReturnRefund += amount;

        // Extract variant descriptor
        const size = (originalOrderItem as any).size || originalOrderItem.variant?.size || '';
        const color = (originalOrderItem as any).color || originalOrderItem.variant?.color || '';
        const variantName = [size, color].filter(Boolean).join('/') || undefined;

        activeReturnsToProcess.push({
          variantId,
          productId: retItem.productId || originalOrderItem.variant?.productId,
          productName: originalOrderItem.variant?.product?.name || 'Garment Item',
          variantName,
          sku: originalOrderItem.variant?.sku,
          returnQty,
          unitPrice,
          amount,
        });
      }

      if (activeReturnsToProcess.length === 0 || totalReturnRefund <= 0) {
        throw new HttpException(400, 'Return must contain at least one item with a quantity greater than zero');
      }

      totalReturnRefund = Math.round(totalReturnRefund * 100) / 100;
      const returnTimestamp = new Date();
      const returnId = `RET-${order.id}-${Date.now().toString(36).toUpperCase()}`;
      const recordedBy = data.recordedBy || user?.name || (user?.userId ? `User #${user.userId}` : 'Cashier');
      const returnReason = (data.reason || 'Customer Request').trim();

      // 4. Atomic Inventory Restoration: increment ProductVariant.stock and log in Return Inventory
      for (const item of activeReturnsToProcess) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            stock: { increment: item.returnQty },
          },
        });

        const originalOrderItem = order.items.find((it) => it.variantId === item.variantId);
        await tx.returnInventoryItem.create({
          data: {
            orderId: order.id,
            orderItemId: originalOrderItem?.id || null,
            productId: item.productId || originalOrderItem?.variant?.productId || null,
            variantId: item.variantId,
            quantity: item.returnQty,
            restockedQty: item.returnQty,
            reason: returnReason,
            status: 'RESTOCKED',
            notes: `In-store return processed (${returnId})`,
          },
        });
      }

      // 5. Financial Ledger Reconciliation & Due Rollback Arithmetic
      const oldBillTotal = order.totalAmount;
      const oldPaidAmount = order.paidAmount;
      const oldCreditDue = Math.max(0, Math.round((oldBillTotal - oldPaidAmount) * 100) / 100);

      const newBillTotal = Math.max(0, Math.round((oldBillTotal - totalReturnRefund) * 100) / 100);

      let creditDueAdjustment = 0;
      let cashRefundAmount = 0;

      if (oldCreditDue > 0) {
        creditDueAdjustment = Math.min(oldCreditDue, totalReturnRefund);
        const excessRefund = totalReturnRefund - creditDueAdjustment;
        if (excessRefund > 0) {
          cashRefundAmount = Math.min(oldPaidAmount, excessRefund);
        }
      } else {
        // Bill was fully paid: entire return value is refunded to customer
        cashRefundAmount = Math.min(oldPaidAmount, totalReturnRefund);
      }

      const newPaidAmount = Math.max(0, Math.round((oldPaidAmount - cashRefundAmount) * 100) / 100);
      const newCreditDue = Math.max(0, Math.round((newBillTotal - newPaidAmount) * 100) / 100);

      // Decrement customer outstanding debt by the credit offset amount
      if (order.customerId && creditDueAdjustment > 0) {
        await tx.customer.update({
          where: { id: order.customerId },
          data: {
            outstandingBalance: { decrement: creditDueAdjustment },
          },
        });
      }

      // Record negative order payment entry if cash/paid was refunded
      if (cashRefundAmount > 0) {
        await tx.orderPayment.create({
          data: {
            orderId: order.id,
            amount: -cashRefundAmount,
            method: order.paymentMethod || 'CASH',
            reference: `Cash Refund: Item Return (${data.reason || 'Customer Return'})`,
          },
        });
      }

      // 6. Build Return Record & Update Order
      const returnRecord: ReturnRecord = {
        returnId,
        returnDate: returnTimestamp.toISOString(),
        returnedItems: activeReturnsToProcess,
        totalReturnRefund,
        reason: returnReason,
        recordedBy,
        creditDueAdjustment,
        cashRefundAmount,
      };

      const updatedReturnsList = [...existingReturns, returnRecord];
      const originalTotalAmount = parsedNotes.originalTotalAmount ?? oldBillTotal;

      const updatedNotesPayload = JSON.stringify({
        ...parsedNotes.rawParsed,
        userNotes: parsedNotes.userNotes,
        originalTotalAmount,
        returns: updatedReturnsList,
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          totalAmount: newBillTotal,
          paidAmount: newPaidAmount,
          notes: updatedNotesPayload,
          updatedAt: returnTimestamp,
        },
        include: {
          customer: {
            select: { id: true, name: true, phone: true, outstandingBalance: true },
          },
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
          },
          user: { select: { id: true, name: true, role: true } },
        },
      });

      return {
        success: true,
        returnRecord,
        order: {
          ...updatedOrder,
          returns: updatedReturnsList,
          originalTotalAmount,
          newBillTotal,
          newPaidAmount,
          newCreditDue,
          creditDueAdjustment,
          cashRefundAmount,
        },
      };
    });

    /**
     * SSE Real-time Cross-Device Broadcast Hook for returns processing
     */
    try {
      broadcastLiveEvent('invoice_updated', result.order);
    } catch (sseErr) {
      console.error('[SSE Broadcast] Failed to broadcast invoice_updated on item return:', sseErr);
    }

    return result;
  }

  /**
   * ----------------------------------------------------
   * RETURN INVENTORY MANAGEMENT PIPELINE
   * ----------------------------------------------------
   */

  /**
   * Retrieve all items currently logged in the return inventory ledger
   */
  async getReturnInventory() {
    const items = await prisma.returnInventoryItem.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            invoiceNumber: true,
            customerName: true,
            customerPhone: true,
            createdAt: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            images: { select: { imageUrl: true }, take: 1 },
          },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            stock: true,
            wholesalePrice: true,
            retailPrice: true,
          },
        },
      },
    });

    return items.map((item) => ({
      ...item,
      order: item.order
        ? {
            ...item.order,
            orderNumber: item.order.invoiceNumber || `INV-${item.order.id}`,
          }
        : null,
    }));
  }

  /**
   * Move eligible items from Return Inventory back into sellable ProductVariant.stock
   * Safely handles missing payload properties and executes in a transactional block.
   */
  async restockReturnItem(returnItemId: number, restockQty?: number) {
    return prisma.$transaction(async (tx) => {
      const returnItem = await tx.returnInventoryItem.findUnique({
        where: { id: returnItemId },
        include: { variant: true, orderItem: true },
      });

      if (!returnItem) {
        throw new HttpException(404, 'Return inventory item not found');
      }

      const availableToRestock = Math.max(0, (returnItem.quantity || 0) - (returnItem.restockedQty || 0));
      if (availableToRestock <= 0) {
        throw new HttpException(400, 'This return item has already been fully restocked to main inventory');
      }

      const qtyToApply = restockQty && restockQty > 0
        ? Math.min(availableToRestock, restockQty)
        : availableToRestock;

      // 1. Increment product variant main sellable stock if variant exists in DB
      if (returnItem.variantId) {
        const variantExists = await tx.productVariant.findUnique({
          where: { id: returnItem.variantId },
          select: { id: true },
        });
        if (variantExists) {
          await tx.productVariant.update({
            where: { id: returnItem.variantId },
            data: { stock: { increment: qtyToApply } },
          });
        }
      }

      const newRestockedQty = (returnItem.restockedQty || 0) + qtyToApply;
      const isFullyRestocked = newRestockedQty >= returnItem.quantity;

      // 2. Update return inventory ledger record with valid schema select fields
      const updated = await tx.returnInventoryItem.update({
        where: { id: returnItemId },
        data: {
          restockedQty: newRestockedQty,
          status: isFullyRestocked ? 'RESTOCKED' : 'PARTIALLY_RESTOCKED',
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              images: { select: { imageUrl: true }, take: 1 },
            },
          },
          variant: true,
          order: {
            select: {
              id: true,
              invoiceNumber: true,
              customerName: true,
              customerPhone: true,
            },
          },
        },
      });

      // 3. If linked to an order item and fully restocked, mark restockedToMain: true
      if (returnItem.orderItemId && isFullyRestocked) {
        await tx.orderItem.update({
          where: { id: returnItem.orderItemId },
          data: { restockedToMain: true },
        });
      }

      return {
        ...updated,
        order: updated.order
          ? {
              ...updated.order,
              orderNumber: updated.order.invoiceNumber || `INV-${updated.order.id}`,
            }
          : null,
      };
    });
  }
}



export const orderService = new OrderService();