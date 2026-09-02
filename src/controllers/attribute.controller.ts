import { Request, Response, NextFunction } from 'express';
import { attributeService } from '../services/attribute.service';
import { sendSuccess, sendCreated } from '../utils/response';

/**
 * Handle listing all categories
 */
export const getCategories = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await attributeService.getCategories();
    sendSuccess(res, categories);
  } catch (err) { next(err); }
};

/**
 * Handle creating a category
 */
export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await attributeService.createCategory(req.body);
    sendCreated(res, category);
  } catch (err) { next(err); }
};

/**
 * Handle category deletion with dependency validation
 */
export const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await attributeService.deleteCategory(Number(req.params.id));
    sendSuccess(res, { success: true, message: 'Category deleted' });
  } catch (err) { next(err); }
};

/**
 * Handle listing all sizes
 */
export const getSizes = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sizes = await attributeService.getSizes();
    sendSuccess(res, sizes);
  } catch (err) { next(err); }
};

export const createSize = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const size = await attributeService.createSize(req.body.name, req.body.order);
    sendCreated(res, size);
  } catch (err) { next(err); }
};

export const deleteSize = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await attributeService.deleteSize(Number(req.params.id));
    sendSuccess(res, { success: true, message: 'Size deleted' });
  } catch (err) { next(err); }
};

export const getColors = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const colors = await attributeService.getColors();
    sendSuccess(res, colors);
  } catch (err) { next(err); }
};

export const createColor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const color = await attributeService.createColor(req.body.name, req.body.hexCode);
    sendCreated(res, color);
  } catch (err) { next(err); }
};

export const deleteColor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await attributeService.deleteColor(Number(req.params.id));
    sendSuccess(res, { success: true, message: 'Color deleted' });
  } catch (err) { next(err); }
};