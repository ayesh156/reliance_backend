import type { Request, Response, NextFunction } from 'express';
import { RawMaterialMovementService } from '../services/rawMaterialMovement.service.ts';
import { sendSuccess, sendCreated } from '../utils/response.ts';

/**
 * Handle raw material stock deduction for garment production or damage write-off
 */
export const deductMaterialStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawUserId = (req as any).user?.userId;
    const userId = rawUserId ? parseInt(String(rawUserId), 10) : undefined;

    const { rawMaterialItemId, quantity, movementType, reference, customDate } = req.body;

    const itemId = parseInt(String(rawMaterialItemId), 10);
    const qty = parseFloat(String(quantity));

    if (!itemId || isNaN(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'Valid positive raw material item ID is required' });
    }

    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Deduction quantity must be a positive number' });
    }

    const validTypes = ['PRODUCTION_USE', 'DAMAGE_WASTE'];
    const resolvedType = validTypes.includes(movementType) ? movementType : 'PRODUCTION_USE';

    const result = await RawMaterialMovementService.deductMaterial({
      rawMaterialItemId: itemId,
      quantity: qty,
      movementType: resolvedType,
      reference: typeof reference === 'string' ? reference.trim().slice(0, 500) : undefined,
      customDate: customDate ? String(customDate) : undefined,
      userId,
    });

    sendCreated(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle returning leftover fabric pieces or scrap cut-pieces back into inventory stock
 */
export const returnScrapMaterialStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawUserId = (req as any).user?.userId;
    const userId = rawUserId ? parseInt(String(rawUserId), 10) : undefined;

    const { rawMaterialItemId, quantity, reference, customDate } = req.body;

    const itemId = parseInt(String(rawMaterialItemId), 10);
    const qty = parseFloat(String(quantity));

    if (!itemId || isNaN(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'Valid positive raw material item ID is required' });
    }

    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Return quantity must be a positive number' });
    }

    const result = await RawMaterialMovementService.returnLeftoverMaterial({
      rawMaterialItemId: itemId,
      quantity: qty,
      reference: typeof reference === 'string' ? reference.trim().slice(0, 500) : undefined,
      customDate: customDate ? String(customDate) : undefined,
      userId,
    });

    sendCreated(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle listing historical stock movements for a specific raw material item
 */
/**
 * Handle listing historical stock movements for a specific raw material item with filters & pagination
 */
/**
 * Handle listing historical stock movements for a specific raw material item
 */
export const getMaterialMovementHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
    const itemId = parseInt(String(rawId), 10);

    if (!itemId || isNaN(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'Valid raw material item ID is required' });
    }

    // Clean service call returning all movement records for frontend client-side processing
    const movements = await RawMaterialMovementService.getMaterialMovements(itemId);

    sendSuccess(res, movements);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle deleting a movement record and reverting its stock effect
 */
export const deleteMaterialMovement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const movementId = parseInt(String(req.params.movementId), 10);
    if (!movementId || isNaN(movementId)) {
      return res.status(400).json({ error: 'Valid movement ID is required' });
    }

    const result = await RawMaterialMovementService.deleteMovement(movementId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle editing an existing movement record
 */
export const updateMaterialMovement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const movementId = parseInt(String(req.params.movementId), 10);
    if (!movementId || isNaN(movementId)) {
      return res.status(400).json({ error: 'Valid movement ID is required' });
    }

    const { quantity, reference, customDate } = req.body;
    const result = await RawMaterialMovementService.updateMovement(movementId, {
      quantity: quantity !== undefined ? parseFloat(String(quantity)) : undefined,
      reference: typeof reference === 'string' ? reference : undefined,
      customDate: customDate ? String(customDate) : undefined,
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};