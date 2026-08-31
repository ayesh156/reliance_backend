import { Request, Response } from 'express';
import categoryService from '../services/category.service';
import { sendError } from '../utils/response';

export class CategoryController {
  /** GET /api/categories — Fetch all categories */
  async getAll(_req: Request, res: Response): Promise<void> {
    try {
      const categories = await categoryService.getAllCategories();
      res.json(categories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      sendError(res, 'Failed to fetch categories', 500);
    }
  }
}

export default new CategoryController();