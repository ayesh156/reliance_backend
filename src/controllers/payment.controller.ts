import type { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service.ts';
import { sendSuccess } from '../utils/response.ts';

export class PaymentController {
  /**
   * DELETE /payments/:id
   * Handles voiding of payment with full balance rollback
   */
  static async deletePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const paymentId = Number(rawId);
      const purchaseId = req.query.purchaseId ? Number(req.query.purchaseId) : undefined;
      const type = req.query.type as 'customer' | 'supplier' | undefined;

      const result = await PaymentService.deletePayment(paymentId, { type, purchaseId });
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /payments/:id
   * Handles editing amount, date, reference, or method with delta balance sync and mandatory audit note
   */
  static async editPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const paymentId = Number(rawId);
      const { amount, paymentDate, reference, method, notes, purchaseId, type } = req.body;

      const result = await PaymentService.editPayment(paymentId, {
        amount: Number(amount),
        paymentDate,
        reference,
        method,
        notes,
        purchaseId: purchaseId ? Number(purchaseId) : undefined,
        type,
      });

      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /payments/customer/:id
   */
  static async deleteCustomerPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const paymentId = Number(rawId);
      const result = await PaymentService.deletePayment(paymentId, { type: 'customer' });
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /payments/customer/:id
   */
  static async editCustomerPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const paymentId = Number(rawId);
      const { amount, paymentDate, reference, method, notes } = req.body;

      const result = await PaymentService.editPayment(paymentId, {
        amount: Number(amount),
        paymentDate,
        reference,
        method,
        notes,
        type: 'customer',
      });

      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /payments/supplier/:purchaseId/:paymentId
   */
  static async deleteSupplierPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const purchaseId = Number(Array.isArray(req.params.purchaseId) ? req.params.purchaseId[0] : req.params.purchaseId);
      const paymentId = Number(Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId);
      const result = await PaymentService.deletePayment(paymentId, { type: 'supplier', purchaseId });
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /payments/supplier/:purchaseId/:paymentId
   */
  static async editSupplierPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const purchaseId = Number(Array.isArray(req.params.purchaseId) ? req.params.purchaseId[0] : req.params.purchaseId);
      const paymentId = Number(Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId);
      const { amount, paymentDate, reference, method, notes } = req.body;

      const result = await PaymentService.editPayment(paymentId, {
        amount: Number(amount),
        paymentDate,
        reference,
        method,
        notes,
        purchaseId,
        type: 'supplier',
      });

      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}
