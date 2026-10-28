import { prisma } from '../lib/prisma.ts';

/**
 * Enterprise Secure Customer Credit & Bill Settlement Service
 * Enforces ACID transaction guarantees, concurrency control, and zero-overpayment rules
 */

export interface SettleBillInput {
  orderId: number;
  amount: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  paymentDate?: Date; // Custom audit payment date
}

export class CustomerCreditService {
  /**
   * Retrieve all pending due bills for a specific customer with timestamps
   */
  static async getCustomerDueBills(customerId: number) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        outstandingBalance: true,
        creditLimit: true,
      },
    });

    if (!customer) {
      throw new Error('Customer not found in the system.');
    }

    // Retrieve all non-cancelled orders with pending dues
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'asc' }, // Oldest bills first (FIFO)
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { name: true },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // හිඟ මුදල (dueAmount) ගණනය කර filter කිරීම
    const bills = orders
      .map((order) => {
        const total = Number(order.totalAmount) || 0;
        const paid = Number(order.paidAmount) || 0;
        const due = Math.max(0, Math.round((total - paid) * 100) / 100);

        return {
          orderId: order.id,
          invoiceNumber: order.invoiceNumber || `ORD-#${order.id}`,
          source: order.source,
          createdAt: order.createdAt, // Invoice issue date and time
          dueDate: order.dueDate,
          totalAmount: total,
          paidAmount: paid,
          dueAmount: due,
          status: order.status,
          paymentMethod: order.paymentMethod,
          notes: order.notes,
          itemCount: order.items.reduce((sum, it) => sum + it.quantity, 0),
          items: order.items.map((it) => ({
            name: it.variant?.product?.name || 'Item',
            size: it.variant?.size,
            color: it.variant?.color,
            quantity: it.quantity,
            price: it.price,
          })),
          paymentHistory: order.payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            method: p.method,
            reference: p.reference,
            createdAt: p.createdAt,
          })),
          payments: order.payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            method: p.method,
            reference: p.reference,
            createdAt: p.createdAt,
          })),
        };
      })
      .filter((bill) => bill.dueAmount > 0.01);

    const computedBillsDue = bills.reduce((acc, b) => acc + b.dueAmount, 0);
    const effectiveTotalDue = Math.round(computedBillsDue * 100) / 100;

    const storedBal = Math.round((Number(customer.outstandingBalance) || 0) * 100) / 100;
    // Atomically synchronize customer.outstandingBalance with verified invoice debts if open bills exceed stored balance,
    // preserving any legacy / opening customer credit balance.
    if (storedBal < effectiveTotalDue) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { outstandingBalance: effectiveTotalDue },
      });
      customer.outstandingBalance = effectiveTotalDue;
    }

    const finalTotalDue = Math.max(storedBal, effectiveTotalDue);

    // ---------------------------------------------------------------------------------
    // Pending Cheques Ledger Inspection Logic:
    // Identifies all pending, unrealized, or uncleared cheques in hand associated with this
    // customer across both payment audit records (OrderPayment) and structured order notes.
    // Preserves visibility of in-hand tender even when outstanding balance is 0 or cleared.
    // ---------------------------------------------------------------------------------
    const rawChequePayments = await prisma.orderPayment.findMany({
      where: {
        method: 'CHEQUE',
        order: {
          customerId,
          status: { not: 'CANCELLED' },
        },
      },
      include: {
        order: {
          select: {
            id: true,
            invoiceNumber: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        chequeDate: 'asc',
      },
    });

    const pendingCheques: Array<{
      id?: number;
      orderId?: number;
      invoiceNumber?: string;
      chequeNumber: string;
      bankName: string;
      chequeDate: string;
      amount: number;
      status: string;
    }> = [];

    // 1. Extract from persistent OrderPayment records
    for (const cp of rawChequePayments) {
      const rawStatus = String(cp.chequeStatus || 'PENDING').toUpperCase();
      // Only include uncleared / unrealized in-hand cheques (exclude CLEARED and BOUNCED)
      if (rawStatus !== 'CLEARED' && rawStatus !== 'BOUNCED') {
        let chqNo = '-';
        let bName = '-';
        if (cp.reference) {
          const chqMatch = /Cheque\s*#?([^\s(]+)/i.exec(cp.reference);
          if (chqMatch) {
            chqNo = chqMatch[1];
          } else {
            chqNo = cp.reference.replace(/\s*\[Edit:.*?\]$/, '').slice(0, 30);
          }
          const bankMatch = /\(([^)]+)\)/.exec(cp.reference);
          if (bankMatch) {
            bName = bankMatch[1];
          }
        }

        const dateSource = cp.chequeDate || cp.createdAt || cp.order?.createdAt;
        const formattedDate = dateSource
          ? new Date(dateSource).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        pendingCheques.push({
          id: cp.id,
          orderId: cp.orderId,
          invoiceNumber: cp.order?.invoiceNumber || `INV${cp.orderId}`,
          chequeNumber: chqNo.replace(/^#/, '').trim() || '-',
          bankName: bName.trim() || '-',
          chequeDate: formattedDate,
          amount: Number(cp.amount) || 0,
          status: rawStatus,
        });
      }
    }

    // 2. Extract from structured Order.notes JSON for multi-cheque transactions
    for (const o of orders) {
      if (o.notes) {
        try {
          let current: any = o.notes;
          while (typeof current === 'string' && current.trim().startsWith('{')) {
            current = JSON.parse(current);
          }
          if (current && typeof current === 'object') {
            const chqs = Array.isArray(current.cheques) ? current.cheques : [];
            const splits = Array.isArray(current.splitPayments)
              ? current.splitPayments.filter((s: any) => String(s.method).toUpperCase() === 'CHEQUE')
              : [];
            const combined = [...chqs, ...splits];

            for (const c of combined) {
              const cStatus = String(c.status || c.chequeStatus || 'PENDING').toUpperCase();
              if (cStatus !== 'CLEARED' && cStatus !== 'REALIZED' && cStatus !== 'BOUNCED') {
                const cNo = String(c.chequeNumber || c.reference || '').replace(/^#/, '').trim() || '-';
                const cAmt = Number(c.amount) || 0;
                // Avoid duplicating cheques already captured via OrderPayment
                const isDuplicate = pendingCheques.some(
                  (x) => x.orderId === o.id && (x.chequeNumber === cNo || Math.abs(x.amount - cAmt) < 0.01)
                );
                if (!isDuplicate && cAmt > 0) {
                  const rawChqDate = c.chequeDate || c.date || o.createdAt;
                  pendingCheques.push({
                    orderId: o.id,
                    invoiceNumber: o.invoiceNumber || `ORD-#${o.id}`,
                    chequeNumber: cNo,
                    bankName: (c.bankName || c.bank || '-').trim(),
                    chequeDate: rawChqDate
                      ? new Date(rawChqDate).toISOString().split('T')[0]
                      : new Date(o.createdAt).toISOString().split('T')[0],
                    amount: cAmt,
                    status: cStatus,
                  });
                }
              }
            }
          }
        } catch {
          // Ignore invalid JSON notes without disrupting billing output
        }
      }
    }

    // Retrieve recent master receipts for settlement audit trails
    const recentReceipts = await prisma.customerReceipt.findMany({
      where: { customerId },
      orderBy: { receiptDate: 'desc' },
      take: 10,
      include: {
        payments: {
          include: {
            order: {
              select: {
                id: true,
                invoiceNumber: true,
                totalAmount: true,
                paidAmount: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    // Retrieve recent return bills & credit notes for this customer
    const rawReturnOrders = await prisma.order.findMany({
      where: {
        customerId,
        OR: [
          { totalAmount: { lt: 0 } },
          { isReturnBill: true },
        ],
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        totalAmount: true,
        paidAmount: true,
        returnCreditApplied: true,
        refundedCashAmount: true,
        status: true,
      },
    });

    const returnBills = rawReturnOrders.map((ro) => ({
      ...ro,
      trueReturnCreditApplied: ro.returnCreditApplied > 0
        ? ro.returnCreditApplied
        : (ro.totalAmount < 0 ? Math.abs(ro.totalAmount) - (ro.refundedCashAmount || 0) : 0),
    }));

    return {
      customer: {
        ...customer,
        outstandingBalance: finalTotalDue,
        computedTotalDue: finalTotalDue,
        totalOutstandingDue: finalTotalDue,
      },
      bills,
      pendingCheques,
      recentReceipts,
      latestReceipt: recentReceipts[0] || null,
      returnBills,
    };
  }

  /**
   * Settle invoice due payment atomically (Strict ACID Transaction & Zero Overpayment Rule)
   */
  static async settleBillPayment(input: SettleBillInput) {
    const { orderId, amount, paymentMethod, reference, notes, paymentDate } = input;
    const payAmount = Math.round(Number(amount) * 100) / 100;

    if (!orderId || isNaN(orderId)) {
      throw new Error('A valid Order ID is required.');
    }

    if (isNaN(payAmount) || payAmount <= 0) {
      throw new Error('Payment amount must be greater than Rs. 0.00.');
    }

    // Atomic Database Transaction: Record payment log and synchronize customer balance
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { customer: true },
      });

      if (!order) {
        throw new Error('Target invoice could not be found.');
      }

      if (order.status === 'CANCELLED') {
        throw new Error('This invoice has been cancelled and cannot accept payments.');
      }

      const total = Number(order.totalAmount);
      const currentlyPaid = Number(order.paidAmount);
      const remainingDue = Math.max(0, Math.round((total - currentlyPaid) * 100) / 100);

      if (remainingDue <= 0) {
        throw new Error('This invoice has already been fully settled.');
      }

      // Strict enforcement of Zero Overpayment rule
      if (payAmount > remainingDue) {
        throw new Error(`Maximum payable amount for this invoice is Rs. ${remainingDue.toFixed(2)}.`);
      }

      const newPaidAmount = Math.round((currentlyPaid + payAmount) * 100) / 100;
      const isFullySettled = newPaidAmount >= total;

      // 1. Create audit log entry with optional user-selected payment date
      const resolvedDate = paymentDate && !isNaN(new Date(paymentDate).getTime()) ? new Date(paymentDate) : new Date();

      // Master Receipt creation for the settlement payment
      let customerReceiptId: number | undefined = undefined;
      let masterReceipt: any = null;
      if (order.customerId) {
        const receiptNumber = `REC-${Date.now().toString(36).toUpperCase()}`;
        masterReceipt = await tx.customerReceipt.create({
          data: {
            receiptNumber,
            customerId: order.customerId,
            totalAmount: payAmount,
            paymentMethod: paymentMethod || 'CASH',
            reference: reference?.trim() || notes?.trim() || `Invoice #${order.invoiceNumber || order.id} Due Settlement`,
            receiptDate: resolvedDate,
            notes: notes?.trim() || undefined,
          },
        });
        customerReceiptId = masterReceipt.id;
      }

      const paymentLog = await tx.orderPayment.create({
        data: {
          orderId,
          amount: payAmount,
          method: paymentMethod || 'CASH',
          reference: reference?.trim() || notes?.trim() || 'Invoice Due Settlement',
          customerReceiptId,
          createdAt: resolvedDate, // Records selected custom payment date
        },
      });

      // 2. Update order paidAmount and status
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: newPaidAmount,
          status: isFullySettled ? 'PAID' : order.status,
          updatedAt: new Date(),
        },
      });

      // 3. Atomically decrement customer outstanding credit balance
      if (order.customerId) {
        const currentCustomer = await tx.customer.findUnique({
          where: { id: order.customerId },
          select: { outstandingBalance: true },
        });

        if (currentCustomer) {
          const currentBal = Number(currentCustomer.outstandingBalance) || 0;
          const updatedBal = Math.max(0, Math.round((currentBal - payAmount) * 100) / 100);

          await tx.customer.update({
            where: { id: order.customerId },
            data: {
              outstandingBalance: updatedBal,
            },
          });
        }
      }

      return {
        paymentLog,
        updatedOrder,
        remainingBalance: Math.max(0, Math.round((total - newPaidAmount) * 100) / 100),
        receipt: masterReceipt,
      };
    });
  }

  /**
   * Retrieve Master Receipts with optional historical date range filtering
   */
  static async getCustomerReceipts(
    customerId: number,
    filters?: { startDate?: string; endDate?: string; search?: string }
  ) {
    const where: any = { customerId };

    if (filters?.startDate || filters?.endDate) {
      where.receiptDate = {};
      if (filters.startDate) {
        where.receiptDate.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.receiptDate.lte = end;
      }
    }

    if (filters?.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { receiptNumber: { contains: q } },
        { reference: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    const receipts = await prisma.customerReceipt.findMany({
      where,
      orderBy: { receiptDate: 'desc' },
      include: {
        payments: {
          include: {
            order: {
              select: {
                id: true,
                invoiceNumber: true,
                totalAmount: true,
                paidAmount: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return receipts.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      customerId: r.customerId,
      totalAmount: r.totalAmount,
      paymentMethod: r.paymentMethod,
      reference: r.reference,
      receiptDate: r.receiptDate,
      notes: r.notes,
      createdAt: r.createdAt,
      payments: r.payments.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        createdAt: p.createdAt,
        invoiceNumber: p.order?.invoiceNumber || `INV${p.orderId}`,
        invoiceTotal: p.order?.totalAmount || 0,
        invoicePaid: p.order?.paidAmount || 0,
        invoiceStatus: p.order?.status || 'PAID',
        invoiceDate: p.order?.createdAt,
      })),
      clearedInvoicesCount: r.payments.length,
    }));
  }
}
