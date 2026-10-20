import type { Request, Response, NextFunction } from 'express';
import productionService from '../services/production.service.ts';
import { sendSuccess } from '../utils/response.ts';

export class ProductionController {
  /**
   * POST /api/production/cut-batch
   * Stage 1: Create a new multi-material cut batch (status: CUTTING, stock synced: false).
   */
  async createCutBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.createMaterialCutBatch(req.body, userId, userRole);
      return sendSuccess(res, order, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production
   * Create a new production batch with raw material deductions & finished stock increments.
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const order = await productionService.createProduction(req.body, userId);
      return sendSuccess(res, order, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/production/:id
   * Update an existing production batch with inventory syncing.
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const order = await productionService.updateProduction(id, req.body, userId);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/production/summary
   * Fetch production KPIs, material breakdowns, and filtered records based on date queries.
   */
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const today = req.query.today === 'true';
      const month = req.query.month === 'true' ? true : (req.query.month as string | undefined);
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const productId = req.query.productId ? Number(req.query.productId) : undefined;

      const summary = await productionService.getProductionSummary({
        today,
        month,
        startDate,
        endDate,
        productId,
      });

      return sendSuccess(res, summary);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/production
   * Fetch all production orders with query filter support
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const productId = req.query.productId ? Number(req.query.productId) : undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const today = req.query.today === 'true';
      const month = req.query.month === 'true' ? true : (req.query.month as string | undefined);
      const status = req.query.status as string | undefined;
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const result = await productionService.getProductionOrders({
        search,
        productId,
        startDate,
        endDate,
        today,
        month,
        status,
        page,
        limit,
      });

      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/production/:id
   * Get single production order details
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const order = await productionService.getById(id);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/production/:id/return-materials
   * Return leftover raw materials from a production order
   */
  async returnMaterials(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.returnLeftoverMaterials(id, req.body, userId, userRole);
      return sendSuccess(res, updatedOrder);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/sync-stock
   * Stage 3: Confirm & Sync Finished Garments to Product Inventory.
   * Increments product variant stock, updates isStockSynced & isSyncedToStock, and marks COMPLETED.
   */
  async syncStock(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.syncStockToInventory(id, userId, userRole);
      return sendSuccess(res, updatedOrder);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/cut-logs
   * Asynchronously log a material cutting event for this production order
   */
  async addCutLog(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer production order ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.addMaterialCutLog(id, req.body, userId, userRole);
      return sendSuccess(res, updatedOrder, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/finish-logs
   * Asynchronously log a garment finishing event for this production order
   */
  async addFinishLog(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer production order ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.addGarmentFinishLog(id, req.body, userId, userRole);
      return sendSuccess(res, updatedOrder, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/finish-batch
   * Finishing-First Stage: Create a new production batch directly from finished garments
   * with zero initial raw materials required upfront.
   */
  async createFinishBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.createFinishingBatch(req.body, userId, userRole);
      return sendSuccess(res, order, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/production/:id/cancel
   * Cancel an active production order at any stage, safely reversing deducted raw materials
   * and synced product variant stock inside a Prisma transaction.
   */
  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const reason = req.body?.reason;
      const order = await productionService.cancelProductionOrder(id, userId, userRole, reason);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/production/:id
   * Roll back and delete a production order
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userRole = String((req as any).user?.role || '').toUpperCase();
      if (userRole === 'REP') {
        return res.status(403).json({ error: 'Forbidden: Representatives cannot delete production orders.' });
      }
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const result = await productionService.deleteProductionOrder(id, userId);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}

export default new ProductionController();
