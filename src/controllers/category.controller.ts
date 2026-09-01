import { Request, Response, NextFunction } from 'express';
import { categoryService } from '../services/category.service';
import { sendCreated, sendSuccess } from '../utils/response';

export class CategoryController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await categoryService.getAllCategories();
      sendSuccess(res, categories);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.createCategory(req.body);
      sendCreated(res, category);
    } catch (err) {
      next(err);
    }
  }
}

export const categoryController = new CategoryController();