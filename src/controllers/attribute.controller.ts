import { Request, Response, NextFunction } from 'express';
import { attributeService } from '../services/attribute.service';
import { sendSuccess, sendCreated } from '../utils/response';

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