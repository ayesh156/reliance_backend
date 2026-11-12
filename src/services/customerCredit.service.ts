import { prisma } from '../lib/prisma.ts';
import { ChequeStatus } from '@prisma/client';
import {
  extractCleanChequeNumber,
  extractCleanBankName,
  extractCleanMaturityDate,
} from './customer-statement-pdf.service.ts';

/**
 * Enterprise Secure Customer Credit & Bill Settlement Service
 * Enforces ACID transaction guarantees, concurrency control, and zero-overpayment rules
 */

export interface PaymentEntryInput {
  amount: number;
  method?: string;
  paymentMethod?: string;
  reference?: string | null;
  chequeNumber?: string | null;
  bankName?: string | null;
  chequeDate?: string | Date | null;
  paymentDate?: string | Date | null;
  notes?: string | null;
}

export interface SettleBillInput {
  orderId: number;
  amount?: number;
  paymentMethod?: string;
  reference?: string | null;
  notes?: string | null;
  paymentDate?: Date | string; // Custom audit payment date
  payments?: PaymentEntryInput[];
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

    // Extract all customer invoices (both settled and pending) with accurate due calculation
    const allBills = orders
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
      });

    const bills = allBills.filter((bill) => bill.dueAmount > 0.01);

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
        const chqNo = extractCleanChequeNumber((cp as any).chequeNumber, cp.reference);
        const bName = extractCleanBankName((cp as any).bankName, cp.reference);
        const dateSource = extractCleanMaturityDate(cp.chequeDate, cp.createdAt, cp.order?.createdAt);
        const formattedDate = dateSource !== '-' ? dateSource : new Date().toISOString().split('T')[0];

        pendingCheques.push({
          id: cp.id,
          orderId: cp.orderId,
          invoiceNumber: cp.order?.invoiceNumber || `INV${cp.orderId}`,
          chequeNumber: chqNo,
          bankName: bName,
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
                const cNo = extractCleanChequeNumber(c.chequeNumber, c.reference);
                const cBnk = extractCleanBankName(c.bankName, c.bank);
                const cAmt = Number(c.amount) || 0;
                // Avoid duplicating cheques already captured via OrderPayment
                const isDuplicate = pendingCheques.some(
                  (x) => x.orderId === o.id && (x.chequeNumber === cNo || Math.abs(x.amount - cAmt) < 0.01)
                );
                if (!isDuplicate && cAmt > 0) {
                  const rawChqDate = extractCleanMaturityDate(c.chequeDate, c.date, o.createdAt);
                  pendingCheques.push({
                    orderId: o.id,
                    invoiceNumber: o.invoiceNumber || `ORD-#${o.id}`,
                    chequeNumber: cNo,
                    bankName: cBnk,
                    chequeDate: rawChqDate !== '-' ? rawChqDate : new Date(o.createdAt).toISOString().split('T')[0],
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

    // ---------------------------------------------------------------------------------
    // Cheque Aggregation Logic:
    // When multiple bills/payments are settled by the exact same raw numeric cheque number,
    // consolidate them into a single row summing their amounts, with combined invoice numbers.
    // ---------------------------------------------------------------------------------
    const groupedChequesMap = new Map<string, {
      id?: number;
      orderId?: number;
      invoiceNumbers: string[];
      invoiceNumber: string;
      chequeNumber: string;
      bankName: string;
      chequeDate: string;
      amount: number;
      status: string;
    }>();

    for (const chq of pendingCheques) {
      const cleanChq = extractCleanChequeNumber(chq.chequeNumber);
      const cleanBank = extractCleanBankName(chq.bankName);

      let targetKey = (cleanChq && cleanChq !== '-')
        ? `CHQ_${cleanChq.toUpperCase()}`
        : `RAW_${chq.id || chq.orderId || Math.random()}`;

      if (cleanChq && cleanChq !== '-') {
        for (const [existingKey, existingVal] of groupedChequesMap.entries()) {
          if (existingVal.chequeNumber.toUpperCase() === cleanChq.toUpperCase()) {
            targetKey = existingKey;
            break;
          }
        }
      }

      const existing = groupedChequesMap.get(targetKey);
      if (existing) {
        existing.amount = Math.round((existing.amount + chq.amount) * 100) / 100;
        if (chq.invoiceNumber && !existing.invoiceNumbers.includes(chq.invoiceNumber)) {
          existing.invoiceNumbers.push(chq.invoiceNumber);
        }
        existing.invoiceNumber = existing.invoiceNumbers.join(', ');
        if ((!existing.bankName || existing.bankName === '-') && cleanBank !== '-') {
          existing.bankName = cleanBank;
        } else if (cleanBank !== '-' && cleanBank.length > existing.bankName.length) {
          existing.bankName = cleanBank;
        }
        if ((!existing.chequeDate || existing.chequeDate === '-') && chq.chequeDate && chq.chequeDate !== '-') {
          existing.chequeDate = chq.chequeDate;
        }
      } else {
        const invNumbers = chq.invoiceNumber ? [chq.invoiceNumber] : [];
        groupedChequesMap.set(targetKey, {
          ...chq,
          chequeNumber: cleanChq,
          bankName: cleanBank,
          invoiceNumbers: invNumbers,
          invoiceNumber: invNumbers.join(', '),
        });
      }
    }

    const aggregatedPendingCheques = Array.from(groupedChequesMap.values());

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
      allBills,
      pendingCheques: aggregatedPendingCheques,
      recentReceipts,
      latestReceipt: recentReceipts[0] || null,
      returnBills,
    };
  }

  /**
   * Settle invoice due payment atomically (Strict ACID Transaction & Zero Overpayment Rule)
   * Supports both single payment and multi-payment batch queues
   */
  static async settleBillPayment(input: SettleBillInput) {
    const { orderId, amount, paymentMethod, reference, notes, paymentDate, payments } = input;

    if (!orderId || isNaN(orderId)) {
      throw new Error('A valid Order ID is required.');
    }

    const paymentList: PaymentEntryInput[] = (payments && payments.length > 0)
      ? payments
      : [{
          amount: amount || 0,
          method: paymentMethod || 'CASH',
          reference,
          notes,
          paymentDate,
        }];

    const payAmount = Math.round(paymentList.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) * 100) / 100;

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

      // Master Receipt creation for the settlement payment
      const resolvedDate = paymentDate && !isNaN(new Date(paymentDate).getTime())
        ? new Date(paymentDate)
        : new Date();

      let customerReceiptId: number | undefined = undefined;
      let masterReceipt: any = null;

      if (order.customerId) {
        const receiptNumber = `REC-${Date.now().toString(36).toUpperCase()}`;
        const distinctMethods = Array.from(new Set(paymentList.map((p) => (p.method || 'CASH').toUpperCase())));
        const primaryMethod = distinctMethods.length === 1 ? distinctMethods[0] : 'SPLIT';

        masterReceipt = await tx.customerReceipt.create({
          data: {
            receiptNumber,
            customerId: order.customerId,
            totalAmount: payAmount,
            paymentMethod: primaryMethod,
            reference: reference?.trim() || notes?.trim() || `Invoice #${order.invoiceNumber || order.id} Due Settlement`,
            receiptDate: resolvedDate,
            notes: notes?.trim() || undefined,
          },
        });
        customerReceiptId = masterReceipt.id;
      }

      const paymentLogs = [];
      for (const p of paymentList) {
        const itemAmt = Math.round(Number(p.amount) * 100) / 100;
        if (itemAmt <= 0) continue;
        const pMethod = (p.method || 'CASH').toUpperCase();
        const itemDate = p.paymentDate && !isNaN(new Date(p.paymentDate).getTime())
          ? new Date(p.paymentDate)
          : resolvedDate;

        let ref = p.reference?.trim();
        let chqDate: Date | undefined = undefined;
        let chqStatus: ChequeStatus | undefined = undefined;

        if (pMethod === 'CHEQUE') {
          const chqNum = p.chequeNumber?.trim();
          const bName = p.bankName?.trim();
          if (!ref) {
            ref = chqNum ? `Cheque #${chqNum}${bName ? ` (${bName})` : ''}` : 'Cheque';
          }
          if (p.chequeDate) {
            const parsedChqDate = new Date(p.chequeDate);
            if (!isNaN(parsedChqDate.getTime())) {
              chqDate = parsedChqDate;
            }
          }
          chqStatus = ChequeStatus.PENDING;
        } else if (!ref) {
          ref = p.notes?.trim() || reference?.trim() || notes?.trim() || 'Invoice Due Settlement';
        }

        const pLog = await tx.orderPayment.create({
          data: {
            orderId,
            amount: itemAmt,
            method: pMethod,
            reference: ref,
            chequeDate: chqDate,
            chequeStatus: chqStatus,
            customerReceiptId,
            createdAt: itemDate,
          },
        });
        paymentLogs.push(pLog);
      }

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
        paymentLog: paymentLogs[0] || null,
        paymentLogs,
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
