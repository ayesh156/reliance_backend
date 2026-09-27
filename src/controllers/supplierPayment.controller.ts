import type { Request, Response, NextFunction } from 'express';
import { SupplierPaymentService } from '../services/supplierPayment.service.ts';
import { prisma } from '../lib/prisma.ts';
import { sendSuccess, sendCreated } from '../utils/response.ts';

/**
 * Settle supplier outstanding bill dues individually with custom payment timestamp
 */
export const settleSupplierInvoiceDue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { shopId, purchaseId, amount, paymentMethod, reference, paymentDate } = req.body;

    const parsedShopId = parseInt(String(shopId), 10);
    const parsedPurchaseId = purchaseId ? parseInt(String(purchaseId), 10) : undefined;
    const parsedAmount = parseFloat(String(amount));

    if (!parsedShopId || isNaN(parsedShopId) || parsedShopId <= 0) {
      return res.status(400).json({ error: 'Valid supplier shop ID is required' });
    }

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Payment amount must be greater than zero' });
    }

    const result = await SupplierPaymentService.settleSupplierBill({
      shopId: parsedShopId,
      purchaseId: parsedPurchaseId,
      amount: parsedAmount,
      paymentMethod: typeof paymentMethod === 'string' ? paymentMethod.trim().slice(0, 30) : 'CASH',
      reference: typeof reference === 'string' ? reference.trim().slice(0, 100) : undefined,
      paymentDate: paymentDate ? String(paymentDate) : undefined,
    });

    sendCreated(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Fetch unpaid purchase bills for a specific supplier shop
 */
export const getSupplierPendingInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawShopId = Array.isArray(req.params.shopId) ? req.params.shopId[0] : req.params.shopId;
    const shopId = parseInt(String(rawShopId), 10);

    if (!shopId || isNaN(shopId) || shopId <= 0) {
      return res.status(400).json({ error: 'Valid supplier shop ID is required' });
    }

    const unpaidPurchases = await prisma.buyRawMaterial.findMany({
      where: {
        rawMaterialShopId: shopId,
        paymentStatus: { in: ['PARTIAL', 'DUE'] },
      },
      include: {
        items: {
          include: {
            rawMaterialItem: true,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { purchaseDate: 'asc' },
    });

    sendSuccess(res, unpaidPurchases);
  } catch (err) {
    next(err);
  }
};