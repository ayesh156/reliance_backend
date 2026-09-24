import type { Request, Response, NextFunction } from 'express';
import { attributeService } from '../services/attribute.service.ts';
import { sendSuccess, sendCreated } from '../utils/response.ts';

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
 * Handle category deletion with strict parameter validation and array guard
 */
export const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer category ID is required' });
    }
    await attributeService.deleteCategory(id);
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

/**
 * Handle standard garment size creation with payload sanitization
 */
export const createSize = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body.name || typeof req.body.name !== 'string') {
      return res.status(400).json({ error: 'Valid size name string is required' });
    }
    const size = await attributeService.createSize(req.body.name, req.body.order);
    sendCreated(res, size);
  } catch (err) { next(err); }
};

/**
 * Handle size deletion with parameter validation
 */
export const deleteSize = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid size ID is required' });
    }
    await attributeService.deleteSize(id);
    sendSuccess(res, { success: true, message: 'Size deleted' });
  } catch (err) { next(err); }
};

export const getColors = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const colors = await attributeService.getColors();
    sendSuccess(res, colors);
  } catch (err) { next(err); }
};

/**
 * Handle color attribute creation with input type checks
 */
export const createColor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body.name || typeof req.body.name !== 'string') {
      return res.status(400).json({ error: 'Valid color name string is required' });
    }
    const color = await attributeService.createColor(req.body.name, req.body.hexCode);
    sendCreated(res, color);
  } catch (err) { next(err); }
};

/**
 * Handle color deletion with parameter validation
 */
export const deleteColor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid color ID is required' });
    }
    await attributeService.deleteColor(id);
    sendSuccess(res, { success: true, message: 'Color deleted' });
  } catch (err) { next(err); }
};