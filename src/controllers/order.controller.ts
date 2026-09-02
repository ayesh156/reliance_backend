import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service';
import { sendCreated, sendSuccess } from '../utils/response';

/**
 * Handle creation of new POS cashier invoice order
 */
export const createPosOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    const order = await orderService.createPosOrder({
      ...req.body,
      userId: Number(userId),
    });
    sendCreated(res, order);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle listing all product variants optimized for POS terminal grid
 */
export const getPosCatalog = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const catalog = await orderService.getPosCatalog();
    sendSuccess(res, catalog);
  } catch (err) {
    next(err);
  }
};