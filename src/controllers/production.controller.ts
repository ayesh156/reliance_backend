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
      const user = (req as any).user;
      const userId = user?.userId || user?.id;
      const userRole = user?.role;
      const userName = user?.name;
      const order = await productionService.createMaterialCutBatch(req.body, userId, userRole, userName);
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
      const user = (req as any).user;
      const userId = user?.userId || user?.id;
      const userRole = user?.role;
      const userName = user?.name;
      const order = await productionService.createProduction(req.body, userId, userRole, userName);
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
      const user = (req as any).user;
      const userId = user?.userId || user?.id;
      const userRole = user?.role;
      const userName = user?.name;
      const order = await productionService.updateProduction(id, req.body, userId, userRole, userName);
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
   * POST /api/production/batches/:id/return-scrap
   * Return scrap quantities, update material usage & returnedScrap, and atomically increment raw material stock
   */
  async returnScrap(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.returnScrap(id, req.body, userId, userRole);
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
   * PUT /api/production/:id/cut-logs/:cutLogId
   * Update an existing material cut log (adjust date, time, quantity cut)
   */
  async updateCutLog(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const cutLogId = Number(req.params.cutLogId);
      if (!id || isNaN(id) || !cutLogId || isNaN(cutLogId)) {
        return res.status(400).json({ error: 'Valid integer order ID and cutLogId are required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.updateMaterialCutLog(id, cutLogId, req.body, userId, userRole);
      return sendSuccess(res, updatedOrder);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/finalize
   * Finalize batch and push actual finished garments to sellable inventory
   */
  async finalize(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const updatedOrder = await productionService.finalizeBatch(id, req.body, userId, userRole);
      return sendSuccess(res, updatedOrder);
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
   * Roll back and delete a production order, or roll back a specific stage if ?stage=LINE or ?stage=WASH
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
      const stage = String(req.query.stage || '').toUpperCase();

      if (stage === 'LINE') {
        const result = await productionService.rollbackLineStage(id, userId, userRole);
        return sendSuccess(res, result);
      } else if (stage === 'WASH') {
        const result = await productionService.rollbackWashStage(id, userId, userRole);
        return sendSuccess(res, result);
      }

      const result = await productionService.deleteProductionOrder(id, userId);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/append-fabric
   * Append fabric / raw materials and target products directly to an existing batch without log spam
   */
  async appendFabric(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.appendFabricToBatch(id, req.body, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/production/next-batch-number
   * Returns next available sequential batch code
   */
  async getNextBatchNumber(req: Request, res: Response, next: NextFunction) {
    try {
      const nextNo = await productionService.getNextBatchNumber();
      return sendSuccess(res, { productionNo: nextNo });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/send-to-line
   * Transition batch to 'LINE' status recording sewing line intake
   */
  async sendToLine(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.sendToLine(id, req.body, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/line-batch
   * Create a new production batch starting directly in status 'LINE'
   */
  async createLineBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;
      const userId = user?.userId || user?.id;
      const userRole = user?.role;
      const userName = user?.name;
      const order = await productionService.createLineBatch(req.body, userId, userRole, userName);
      return sendSuccess(res, order, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/send-to-wash
   * Transition batch to 'WASHING' status recording sewn garments output
   */
  async sendToWash(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.sendToWash(id, req.body, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/wash (or /log-washed)
   * Log washed ready-to-sell products with immediate stock increment & partial sync
   */
  async logWashed(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.logWashedItems(id, req.body, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/production/wash/batches
   * Fetch all batches currently in 'WASHING' status
   */
  async getWashBatches(req: Request, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const result = await productionService.getWashBatches({ search, page, limit });
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
  /**
   * POST /api/production/:id/log-sewn
   * Log daily pieces sewn on the Sewing Line
   */
  async logDailySewn(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.logDailySewn(id, req.body, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/production/:id/line
   * Reset/rollback Sewing Line stage progress back to Cutting
   */
  async rollbackLine(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.rollbackLineStage(id, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/production/:id/wash
   * Reset/rollback Washing stage progress back to Sewing Line
   */
  async rollbackWash(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid integer ID is required' });
      }
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const order = await productionService.rollbackWashStage(id, userId, userRole);
      return sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/production/:id/revert-log/:logId
   * Revert a specific stage transition step and permanently delete its activity log
   */
  async revertActivityLog(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(String(req.params.id), 10);
      const logId = parseInt(String(req.params.logId), 10);
      if (isNaN(id) || isNaN(logId)) {
        return res.status(400).json({ success: false, message: 'Valid production order ID and log ID are required' });
      }
      const userId = (req as any).user?.userId || (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const result = await productionService.revertActivityLog(id, logId, userId, userRole);
      return res.status(200).json({
        success: true,
        message: 'Step reverted to previous state successfully and history entry removed',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ProductionController();
