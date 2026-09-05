import { Request, Response, NextFunction } from 'express';
import rawMaterialShopService from '../services/rawMaterialShop.service';
import { sendSuccess } from '../utils/response';

/**
 * Controller handling raw material supplier shop management endpoints.
 * Interacts with rawMaterialShopService and formats JSON responses.
 */
export class RawMaterialShopController {
  /**
   * Fetch all raw material supplier shops.
   * Supports optional query parameter: ?search=keyword
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const shops = await rawMaterialShopService.getAll(search);
      // HTTP 200 OK with list of suppliers
      return sendSuccess(res, shops);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Fetch single raw material shop detail along with purchase ledger.
   * Route parameter: :id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const shop = await rawMaterialShopService.getById(id);
      // HTTP 200 OK with supplier details
      return sendSuccess(res, shop);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Create a new raw material supplier shop record.
   * Expected body: { name: string, phone?: string, address?: string, contactPerson?: string }
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const shop = await rawMaterialShopService.create(req.body);
      // HTTP 201 Created with newly created shop record
      return sendSuccess(res, shop, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update an existing raw material supplier shop record.
   * Route parameter: :id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const shop = await rawMaterialShopService.update(id, req.body);
      // HTTP 200 OK with updated shop record
      return sendSuccess(res, shop);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete a raw material supplier shop record.
   * Protected against suppliers with existing purchase history orders.
   * Route parameter: :id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const result = await rawMaterialShopService.delete(id);
      // HTTP 200 OK with deleted shop record
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}

export default new RawMaterialShopController();