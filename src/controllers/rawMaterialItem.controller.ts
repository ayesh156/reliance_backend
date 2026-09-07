import { Request, Response, NextFunction } from "express";
import rawMaterialItemService from "../services/rawMaterialItem.service";
import { sendSuccess } from "../utils/response";

/**
 * Controller handling raw material inventory items endpoints.
 */
export class RawMaterialItemController {
  /**
   * Fetch all raw material items with search, unit, and low-stock filters.
   * Query params: ?search=&unit=&lowStockOnly=true
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const unit = req.query.unit as any;
      const lowStockOnly = req.query.lowStockOnly === 'true';

      // Pass all filter dimensions to the service layer
      const items = await rawMaterialItemService.getAll({ search, unit, lowStockOnly });
      return sendSuccess(res, items);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Fetch single raw material item by ID.
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const item = await rawMaterialItemService.getById(id);
      return sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Create a new raw material item.
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await rawMaterialItemService.create(req.body);
      return sendSuccess(res, item, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update an existing raw material item.
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const item = await rawMaterialItemService.update(id, req.body);
      return sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete a raw material item.
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const result = await rawMaterialItemService.delete(id);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/raw-material-items/next-code
   * Retrieve auto-calculated sequential item code from database
   */
  async getNextCode(req: Request, res: Response, next: NextFunction) {
    try {
      const nextCode = await rawMaterialItemService.getNextCode();
      return sendSuccess(res, { code: nextCode });
    } catch (err) {
      next(err);
    }
  }
}

export default new RawMaterialItemController();
