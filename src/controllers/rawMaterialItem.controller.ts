import type { Request, Response, NextFunction } from "express";
import rawMaterialItemService from "../services/rawMaterialItem.service.ts";
import { sendSuccess } from "../utils/response.ts";

/**
 * Controller handling raw material inventory items endpoints.
 */
export class RawMaterialItemController {
  /**
   * Fetch all raw material items with sanitized query filters and bounds
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : undefined;
      const rawUnit = typeof req.query.unit === 'string' ? req.query.unit.trim().toUpperCase() : undefined;
      const lowStockOnly = req.query.lowStockOnly === 'true';

      // Pass sanitized dimensions to service layer
      const items = await rawMaterialItemService.getAll({ search: rawSearch, unit: rawUnit as any, lowStockOnly });
      return sendSuccess(res, items);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Fetch single raw material item by validated integer ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Valid positive integer item ID is required' });
      }
      const item = await rawMaterialItemService.getById(id);
      return sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Create a new raw material item with payload validation
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Valid payload object is required' });
      }
      const item = await rawMaterialItemService.create(req.body);
      return sendSuccess(res, item, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update an existing raw material item with strict ID validation
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Valid positive integer item ID is required' });
      }
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Valid update payload is required' });
      }
      const item = await rawMaterialItemService.update(id, req.body);
      return sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete a raw material item with ID guard
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Valid positive integer item ID is required' });
      }
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
