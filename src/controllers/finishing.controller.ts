import type { Request, Response, NextFunction } from 'express';
import finishingService from '../services/finishing.service.ts';
import { sendSuccess, sendCreated } from '../utils/response.ts';

export class FinishingController {
  /**
   * GET /api/finishing
   * Supports filtering by date (startDate/endDate or from/to) and actionType ('IRON' | 'PACK' | 'ALL')
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, from, to, actionType, productId } = req.query;
      const logs = await finishingService.getAll({
        startDate: startDate as string,
        endDate: endDate as string,
        from: from as string,
        to: to as string,
        actionType: actionType as string,
        productId: productId ? Number(productId) : undefined,
      });
      return sendSuccess(res, logs);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/finishing/summary
   * KPI aggregates: today/week/total for IRON and PACK
   */
  async getSummary(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await finishingService.getSummary();
      return sendSuccess(res, summary);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/finishing/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const log = await finishingService.getById(id);
      return sendSuccess(res, log);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/finishing
   * Body: { productId: number, actionType: 'IRON' | 'PACK', quantity: number, date?: string }
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const log = await finishingService.create(req.body);
      return sendCreated(res, log);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/finishing/:id
   * PATCH /api/finishing/:id
   * Body: { productId?: number, actionType?: 'IRON' | 'PACK', quantity?: number, date?: string }
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const log = await finishingService.update(id, req.body);
      return sendSuccess(res, log);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/finishing/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const result = await finishingService.delete(id);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}

export default new FinishingController();

