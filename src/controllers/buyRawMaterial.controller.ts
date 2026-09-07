import { Request, Response, NextFunction } from 'express';
import buyRawMaterialService from '../services/buyRawMaterial.service';
import { sendSuccess } from '../utils/response';

export class BuyRawMaterialController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const purchases = await buyRawMaterialService.getAll(search);
      return sendSuccess(res, purchases);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const purchase = await buyRawMaterialService.getById(id);
      return sendSuccess(res, purchase);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const purchase = await buyRawMaterialService.create(req.body);
      return sendSuccess(res, purchase, 201);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const result = await buyRawMaterialService.delete(id);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/buy-raw-materials/next-invoice
   */
  async getNextInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const nextInvoice = await buyRawMaterialService.getNextInvoiceNumber();
      return sendSuccess(res, { invoiceNumber: nextInvoice });
    } catch (err) {
      next(err);
    }
  }
}

export default new BuyRawMaterialController();