import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { OrderStatus, PurchasePaymentStatus } from '@prisma/client';

export interface EditPaymentDTO {
  amount: number;
  paymentDate?: string | Date;
  reference?: string;
  method?: string;
  notes?: string; // Optional audit note / reason
  purchaseId?: number;
  type?: 'customer' | 'supplier';
}

export class PaymentService {
  /**
   * Void / Delete Payment with automated ledger and debt balance rollback
   */
  static async deletePayment(
    paymentId: number,
    options?: { type?: 'customer' | 'supplier'; purchaseId?: number }
  ) {
    if (!paymentId || isNaN(paymentId)) {
      throw new HttpException(400, 'A valid Payment ID is required.');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Check if explicitly marked as supplier payment or purchaseId provided
      if (options?.type === 'supplier' || options?.purchaseId) {
        return await this.deleteSupplierPaymentTx(tx, paymentId, options?.purchaseId);
      }

      // 2. Try Customer OrderPayment first
      const orderPayment = await tx.orderPayment.findUnique({
        where: { id: paymentId },
        include: {
          order: {
            include: { customer: true },
          },
        },
      });

      if (orderPayment) {
        const voidedAmount = Number(orderPayment.amount) || 0;
        const currentPaid = Number(orderPayment.order.paidAmount) || 0;
        const newPaidAmount = Math.max(0, Math.round((currentPaid - voidedAmount) * 100) / 100);
        const orderTotal = Number(orderPayment.order.totalAmount) || 0;
        const isFullyPaid = newPaidAmount >= orderTotal;

        // Revert Order paidAmount and status
        await tx.order.update({
          where: { id: orderPayment.orderId },
          data: {
            paidAmount: newPaidAmount,
            status: isFullyPaid ? OrderStatus.PAID : OrderStatus.PROCESSING,
            updatedAt: new Date(),
          },
        });

        // Revert Customer outstanding credit balance
        if (orderPayment.order.customerId) {
          await tx.customer.update({
            where: { id: orderPayment.order.customerId },
            data: {
              outstandingBalance: {
                increment: voidedAmount,
              },
            },
          });
        }

        // Delete payment ledger record
        await tx.orderPayment.delete({
          where: { id: paymentId },
        });

        return {
          success: true,
          type: 'customer',
          message: `Customer payment of Rs. ${voidedAmount.toFixed(2)} voided and balance reversed.`,
          voidedAmount,
          newPaidAmount,
          customerId: orderPayment.order.customerId,
          orderId: orderPayment.orderId,
        };
      }

      // 3. If not in OrderPayment, check if it's a supplier purchase payment
      return await this.deleteSupplierPaymentTx(tx, paymentId, options?.purchaseId);
    });
  }

  /**
   * Helper to void a Supplier Purchase payment within transaction
   */
  private static async deleteSupplierPaymentTx(tx: any, paymentId: number, purchaseId?: number) {
    let targetPurchase: any = null;

    if (purchaseId) {
      targetPurchase = await tx.buyRawMaterial.findUnique({
        where: { id: Number(purchaseId) },
      });
    } else {
      // Search across purchases that might contain this payment ID in notes JSON
      const purchasesWithNotes = await tx.buyRawMaterial.findMany({
        where: {
          notes: { contains: String(paymentId) },
        },
        take: 5,
      });

      if (purchasesWithNotes.length > 0) {
        targetPurchase = purchasesWithNotes[0];
      }
    }

    if (targetPurchase) {
      let paymentsList: any[] = [];
      let originalNotesText = '';

      try {
        if (targetPurchase.notes && targetPurchase.notes.startsWith('{') && targetPurchase.notes.includes('"payments"')) {
          const parsed = JSON.parse(targetPurchase.notes);
          paymentsList = Array.isArray(parsed.payments) ? parsed.payments : [];
          originalNotesText = parsed.userNotes || '';
        }
      } catch {
        paymentsList = [];
      }

      const paymentIdx = paymentsList.findIndex((p: any) => Number(p.id) === Number(paymentId));
      if (paymentIdx !== -1) {
        const targetPayment = paymentsList[paymentIdx];
        const voidedAmount = Number(targetPayment.amount) || 0;
        const currentPaid = Number(targetPurchase.paidAmount) || 0;
        const newPaid = Math.max(0, Math.round((currentPaid - voidedAmount) * 100) / 100);
        const total = Number(targetPurchase.totalAmount) || 0;

        let newStatus: PurchasePaymentStatus = PurchasePaymentStatus.DUE;
        if (newPaid >= total) {
          newStatus = PurchasePaymentStatus.PAID;
        } else if (newPaid > 0) {
          newStatus = PurchasePaymentStatus.PARTIAL;
        }

        // Remove payment item from JSON ledger
        paymentsList.splice(paymentIdx, 1);

        const updatedNotesPayload = JSON.stringify({
          userNotes: originalNotesText,
          payments: paymentsList,
        });

        // 1. Update purchase order
        await tx.buyRawMaterial.update({
          where: { id: targetPurchase.id },
          data: {
            paidAmount: newPaid,
            paymentStatus: newStatus,
            notes: updatedNotesPayload,
            updatedAt: new Date(),
          },
        });

        // 2. Increment supplier shop credit balance (debt increases by voided amount)
        await tx.rawMaterialShop.update({
          where: { id: targetPurchase.rawMaterialShopId },
          data: {
            creditBalance: {
              increment: voidedAmount,
            },
          },
        });

        // 3. Clean up any linked SupplierPayment table row if present
        try {
          await tx.supplierPayment.deleteMany({
            where: {
              buyRawMaterialId: targetPurchase.id,
              amount: voidedAmount,
            },
          });
        } catch {
          // ignore if none exists
        }

        return {
          success: true,
          type: 'supplier',
          message: `Supplier payment of Rs. ${voidedAmount.toFixed(2)} voided and debt balance restored.`,
          voidedAmount,
          newPaid,
          purchaseId: targetPurchase.id,
          shopId: targetPurchase.rawMaterialShopId,
        };
      }
    }

    // Check if directly in supplierPayment table
    const supplierPayment = await tx.supplierPayment.findUnique({
      where: { id: paymentId },
    });

    if (supplierPayment) {
      const voidedAmount = Number(supplierPayment.amount) || 0;

      if (supplierPayment.buyRawMaterialId) {
        const p = await tx.buyRawMaterial.findUnique({ where: { id: supplierPayment.buyRawMaterialId } });
        if (p) {
          const newPaid = Math.max(0, p.paidAmount - voidedAmount);
          const newStatus = newPaid >= p.totalAmount ? PurchasePaymentStatus.PAID : (newPaid > 0 ? PurchasePaymentStatus.PARTIAL : PurchasePaymentStatus.DUE);
          await tx.buyRawMaterial.update({
            where: { id: p.id },
            data: { paidAmount: newPaid, paymentStatus: newStatus },
          });
        }
      }

      await tx.rawMaterialShop.update({
        where: { id: supplierPayment.rawMaterialShopId },
        data: { creditBalance: { increment: voidedAmount } },
      });

      await tx.supplierPayment.delete({
        where: { id: paymentId },
      });

      return {
        success: true,
        type: 'supplier',
        message: `Supplier payment of Rs. ${voidedAmount.toFixed(2)} voided.`,
        voidedAmount,
      };
    }

    throw new HttpException(404, 'Payment record not found.');
  }

  /**
   * Edit Payment details (Amount, Date, Reference, Method) with optional audit note & delta calculation
   */
  static async editPayment(paymentId: number, data: EditPaymentDTO) {
    if (!paymentId || isNaN(paymentId)) {
      throw new HttpException(400, 'A valid Payment ID is required.');
    }

    const newAmount = Math.round(Number(data.amount) * 100) / 100;
    if (isNaN(newAmount) || newAmount <= 0) {
      throw new HttpException(400, 'Payment amount must be greater than Rs. 0.00.');
    }

    const auditNote = data.notes?.trim() || 'Payment details adjusted';

    return await prisma.$transaction(async (tx) => {
      // 1. Check Supplier Purchase Payment
      if (data.type === 'supplier' || data.purchaseId) {
        return await this.editSupplierPaymentTx(tx, paymentId, newAmount, data, auditNote);
      }

      // 2. Try Customer OrderPayment
      const orderPayment = await tx.orderPayment.findUnique({
        where: { id: paymentId },
        include: {
          order: {
            include: { customer: true },
          },
        },
      });

      if (orderPayment) {
        const oldAmount = Number(orderPayment.amount) || 0;
        const delta = Math.round((newAmount - oldAmount) * 100) / 100;
        const currentPaid = Number(orderPayment.order.paidAmount) || 0;
        const orderTotal = Number(orderPayment.order.totalAmount) || 0;
        const newPaidAmount = Math.round((currentPaid + delta) * 100) / 100;

        if (newPaidAmount < 0) {
          throw new HttpException(400, 'Edited amount results in negative paid total for this invoice.');
        }

        if (newPaidAmount > orderTotal) {
          throw new HttpException(
            400,
            `Total paid amount (Rs. ${newPaidAmount.toFixed(2)}) cannot exceed the invoice total of Rs. ${orderTotal.toFixed(2)}.`
          );
        }

        const isFullyPaid = newPaidAmount >= orderTotal;
        const resolvedDate = data.paymentDate && !isNaN(new Date(data.paymentDate).getTime())
          ? new Date(data.paymentDate)
          : orderPayment.createdAt;

        // 1. Update Order paidAmount and status
        await tx.order.update({
          where: { id: orderPayment.orderId },
          data: {
            paidAmount: newPaidAmount,
            status: isFullyPaid ? OrderStatus.PAID : OrderStatus.PROCESSING,
            updatedAt: new Date(),
          },
        });

        // 2. Adjust Customer outstanding credit balance with net difference (delta)
        if (orderPayment.order.customerId && delta !== 0) {
          await tx.customer.update({
            where: { id: orderPayment.order.customerId },
            data: {
              outstandingBalance: {
                decrement: delta, // If amount increased (delta > 0), debt decreases. If decreased (delta < 0), debt increases.
              },
            },
          });
        }

        // 3. Update OrderPayment record
        const formattedRef = data.reference !== undefined
          ? (data.reference.trim() ? `${data.reference.trim()} [Edit: ${auditNote}]` : `[Edit: ${auditNote}]`)
          : (orderPayment.reference ? `${orderPayment.reference} [Edit: ${auditNote}]` : `[Edit: ${auditNote}]`);

        const updatedPayment = await tx.orderPayment.update({
          where: { id: paymentId },
          data: {
            amount: newAmount,
            method: data.method || orderPayment.method,
            reference: formattedRef,
            createdAt: resolvedDate,
          },
        });

        return {
          success: true,
          type: 'customer',
          message: `Payment updated to Rs. ${newAmount.toFixed(2)} successfully.`,
          updatedPayment,
          delta,
          newPaidAmount,
          customerId: orderPayment.order.customerId,
          orderId: orderPayment.orderId,
        };
      }

      // 3. If not in OrderPayment, check Supplier Purchase Payment
      return await this.editSupplierPaymentTx(tx, paymentId, newAmount, data, auditNote);
    });
  }

  /**
   * Helper to edit a Supplier Purchase payment within transaction
   */
  private static async editSupplierPaymentTx(
    tx: any,
    paymentId: number,
    newAmount: number,
    data: EditPaymentDTO,
    auditNote: string
  ) {
    let targetPurchase: any = null;

    if (data.purchaseId) {
      targetPurchase = await tx.buyRawMaterial.findUnique({
        where: { id: Number(data.purchaseId) },
      });
    } else {
      const purchasesWithNotes = await tx.buyRawMaterial.findMany({
        where: { notes: { contains: String(paymentId) } },
        take: 5,
      });
      if (purchasesWithNotes.length > 0) {
        targetPurchase = purchasesWithNotes[0];
      }
    }

    if (targetPurchase) {
      let paymentsList: any[] = [];
      let originalNotesText = '';

      try {
        if (targetPurchase.notes && targetPurchase.notes.startsWith('{') && targetPurchase.notes.includes('"payments"')) {
          const parsed = JSON.parse(targetPurchase.notes);
          paymentsList = Array.isArray(parsed.payments) ? parsed.payments : [];
          originalNotesText = parsed.userNotes || '';
        }
      } catch {
        paymentsList = [];
      }

      const paymentIdx = paymentsList.findIndex((p: any) => Number(p.id) === Number(paymentId));
      if (paymentIdx !== -1) {
        const oldPayment = paymentsList[paymentIdx];
        const oldAmount = Number(oldPayment.amount) || 0;
        const delta = Math.round((newAmount - oldAmount) * 100) / 100;
        const currentPaid = Number(targetPurchase.paidAmount) || 0;
        const total = Number(targetPurchase.totalAmount) || 0;
        const newPaid = Math.round((currentPaid + delta) * 100) / 100;

        if (newPaid < 0) {
          throw new HttpException(400, 'Edited amount results in negative paid total for this purchase.');
        }

        if (newPaid > total) {
          throw new HttpException(
            400,
            `Total paid amount (Rs. ${newPaid.toFixed(2)}) cannot exceed the purchase bill total of Rs. ${total.toFixed(2)}.`
          );
        }

        let newStatus: PurchasePaymentStatus = PurchasePaymentStatus.DUE;
        if (newPaid >= total) {
          newStatus = PurchasePaymentStatus.PAID;
        } else if (newPaid > 0) {
          newStatus = PurchasePaymentStatus.PARTIAL;
        }

        const resolvedDate = data.paymentDate && !isNaN(new Date(data.paymentDate).getTime())
          ? new Date(data.paymentDate).toISOString()
          : oldPayment.createdAt;

        // Update payment item in JSON ledger
        paymentsList[paymentIdx] = {
          ...oldPayment,
          amount: newAmount,
          method: data.method || oldPayment.method,
          reference: data.reference !== undefined ? `${data.reference} [Edit: ${auditNote}]` : `${oldPayment.reference || ''} [Edit: ${auditNote}]`,
          createdAt: resolvedDate,
          editNote: auditNote,
        };

        const updatedNotesPayload = JSON.stringify({
          userNotes: originalNotesText,
          payments: paymentsList,
        });

        // 1. Update purchase order
        await tx.buyRawMaterial.update({
          where: { id: targetPurchase.id },
          data: {
            paidAmount: newPaid,
            paymentStatus: newStatus,
            notes: updatedNotesPayload,
            updatedAt: new Date(),
          },
        });

        // 2. Adjust supplier shop credit balance with net difference (delta)
        if (delta !== 0) {
          await tx.rawMaterialShop.update({
            where: { id: targetPurchase.rawMaterialShopId },
            data: {
              creditBalance: {
                decrement: delta,
              },
            },
          });
        }

        return {
          success: true,
          type: 'supplier',
          message: `Supplier payment updated to Rs. ${newAmount.toFixed(2)} successfully.`,
          delta,
          newPaid,
          purchaseId: targetPurchase.id,
          shopId: targetPurchase.rawMaterialShopId,
        };
      }
    }

    throw new HttpException(404, 'Payment record not found.');
  }
}
