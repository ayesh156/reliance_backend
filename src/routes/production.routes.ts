import { Router } from 'express';
import productionController from '../controllers/production.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// Summary metrics & analytics
router.get('/summary', verifyToken, productionController.getSummary);

// Production orders list and details
router.get('/', verifyToken, productionController.getAll);
router.get('/:id', verifyToken, productionController.getById);

// Create new production batch (Deducts raw materials, increases product stock)
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.create
);

// Update existing production batch (Syncs raw materials & finished product stock)
router.put(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.update
);

// Return leftover materials (Increments raw material stock)
router.put(
  '/:id/return-materials',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnMaterials
);

// Rollback and delete a production order
router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN'),
  productionController.delete
);

export default router;
