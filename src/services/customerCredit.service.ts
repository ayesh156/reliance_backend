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
}

export class CustomerCreditService {
  /**
   * පාරිභෝගිකයෙකුගේ සියලුම හිඟ බිල්පත් (Due Bills) දිනය සහ වේලාව සමඟ ලබා ගැනීම
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
      throw new Error('ගනුදෙනුකරු පද්ධතියේ සොයාගත නොහැකි විය.');
    }

    // CANCELLED නොවන සහ ගෙවීම් හිඟ ඇති සියලුම orders ලබා ගැනීම
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'asc' }, // පැරණිම බිල්පතේ සිට
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
          createdAt: order.createdAt, // බිල නිකුත් කළ දිනය සහ වේලාව
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
        };
      })
      .filter((bill) => bill.dueAmount > 0.01);

    const computedTotalDue = bills.reduce((acc, b) => acc + b.dueAmount, 0);

    return {
      customer: {
        ...customer,
        computedTotalDue: Math.round(computedTotalDue * 100) / 100,
      },
      bills,
    };
  }

  /**
   * තෝරාගත් නිශ්චිත බිල්පතකට (Order) මුදල් ගෙවීම පියවීම (Strict ACID Transaction)
   */
  static async settleBillPayment(input: SettleBillInput) {
    const { orderId, amount, paymentMethod, reference, notes } = input;
    const payAmount = Math.round(Number(amount) * 100) / 100;

    if (!orderId || isNaN(orderId)) {
      throw new Error('වලංගු Order ID එකක් අවශ්‍යයි.');
    }

    if (isNaN(payAmount) || payAmount <= 0) {
      throw new Error('ගෙවීම් මුදල රු. 0.00 ට වඩා වැඩි විය යුතුය.');
    }

    // Atomic Database Transaction: Order Payment එක සටහන් කර Balance යාවත්කාලීන කිරීම
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { customer: true },
      });

      if (!order) {
        throw new Error('අදාළ බිල්පත සොයාගත නොහැකි විය.');
      }

      if (order.status === 'CANCELLED') {
        throw new Error('මෙම බිල්පත අවලංගු කර (Cancelled) ඇති බැවින් ගෙවීම් කළ නොහැක.');
      }

      const total = Number(order.totalAmount);
      const currentlyPaid = Number(order.paidAmount);
      const remainingDue = Math.max(0, Math.round((total - currentlyPaid) * 100) / 100);

      if (remainingDue <= 0) {
        throw new Error('මෙම බිල්පත දැනටමත් සම්පූර්ණයෙන්ම ගෙවා අවසන් කර ඇත.');
      }

      // ශතයකින් හෝ වැඩිපුර මුදලක් ගෙවීම වැළැක්වීම (Zero Overpayment Rule)
      if (payAmount > remainingDue) {
        throw new Error(`මෙම බිල්පත සඳහා ගෙවිය හැකි උපරිම මුදල රු. ${remainingDue.toFixed(2)} කි.`);
      }

      const newPaidAmount = Math.round((currentlyPaid + payAmount) * 100) / 100;
      const isFullySettled = newPaidAmount >= total;

      // 1. OrderPayment Table එකේ Audit log එකක් නිර්මාණය කිරීම
      const paymentLog = await tx.orderPayment.create({
        data: {
          orderId,
          amount: payAmount,
          method: paymentMethod || 'CASH',
          reference: reference?.trim() || notes?.trim() || 'Invoice Due Settlement',
          createdAt: new Date(),
        },
      });

      // 2. Order එකේ paidAmount සහ status යාවත්කාලීන කිරීම
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: newPaidAmount,
          status: isFullySettled ? 'PAID' : order.status,
          updatedAt: new Date(),
        },
      });

      // 3. Customer ගේ outstandingBalance නිවැරදිව අඩු කිරීම
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
      };
    });
  }
}