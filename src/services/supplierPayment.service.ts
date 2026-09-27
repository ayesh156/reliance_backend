import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';

export class SupplierPaymentService {
  /**
   * සැපයුම්කරුගේ Due Balance හෝ අදාළ බිල්පතට මුදල් ගෙවීම සටහන් කිරීම
   */
  static async settleSupplierBill(data: {
    shopId: number;
    purchaseId?: number;
    amount: number;
    paymentMethod: string;
    reference?: string;
    paymentDate?: string;
  }) {
    const payAmount = Math.max(0, Number(data.amount) || 0);
    if (payAmount <= 0) {
      throw new HttpException(400, 'Valid positive payment amount is required');
    }

    return prisma.$transaction(async (tx) => {
      const shop = await tx.rawMaterialShop.findUnique({
        where: { id: Number(data.shopId) },
      });

      if (!shop) {
        throw new HttpException(404, 'Supplier shop partner not found');
      }

      // විශේෂිත Purchase Invoice එකකට ගෙවීමක් සිදු කරන්නේ නම්
      if (data.purchaseId) {
        const purchase = await tx.buyRawMaterial.findUnique({
          where: { id: Number(data.purchaseId) },
        });

        if (!purchase) {
          throw new HttpException(404, 'Purchase record not found');
        }

        const remainingBillDue = Math.max(0, purchase.totalAmount - purchase.paidAmount);
        if (payAmount > remainingBillDue) {
          throw new HttpException(400, `Amount exceeds remaining bill due balance of Rs. ${remainingBillDue.toFixed(2)}`);
        }

        const newPaid = purchase.paidAmount + payAmount;
        const isSettled = newPaid >= purchase.totalAmount;

        await tx.buyRawMaterial.update({
          where: { id: purchase.id },
          data: {
            paidAmount: newPaid,
            paymentStatus: isSettled ? 'PAID' : 'PARTIAL',
          },
        });
      }

      // කඩයට ගෙවීමට ඇති මුළු Credit Balance එක අඩු කිරීම
      await tx.rawMaterialShop.update({
        where: { id: shop.id },
        data: {
          creditBalance: { decrement: payAmount },
        },
      });

      // Supplier Payment එක Audit Ledger එකට එක් කිරීම
      const paymentRecord = await tx.supplierPayment.create({
        data: {
          rawMaterialShopId: shop.id,
          buyRawMaterialId: data.purchaseId ? Number(data.purchaseId) : null,
          amount: payAmount,
          paymentMethod: data.paymentMethod || 'CASH',
          reference: data.reference || null,
          paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
        },
      });

      return { success: true, paymentRecord };
    });
  }
}