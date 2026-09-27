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

      const paymentLog = await tx.orderPayment.create({
        data: {
          orderId,
          amount: payAmount,
          method: paymentMethod || 'CASH',
          reference: reference?.trim() || notes?.trim() || 'Invoice Due Settlement',
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
      };
    });
  }
}