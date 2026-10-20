import { Router } from 'express';
import productionController from '../controllers/production.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// Summary metrics & analytics
router.get('/summary', verifyToken, productionController.getSummary);

// Production orders list and details
router.get('/', verifyToken, productionController.getAll);
router.get('/:id', verifyToken, productionController.getById);

// Stage 1: Create new material cut batch (Starts WIP batch in CUTTING status)
router.post(
  '/cut-batch',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createCutBatch
);

// Finishing-First Workflow: Create new production batch directly from finished garments
router.post(
  '/finish-batch',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createFinishBatch
);

// Create new production batch (Legacy / direct all-in-one run)
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.create
);

// Stage 3: Confirm & Sync Finished Garments to Product Inventory
router.post(
  '/:id/sync-stock',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.syncStock
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

// Asynchronous Material Cutting Log (Separate date/time logging)
router.post(
  '/:id/cut-logs',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.addCutLog
);
router.post(
  '/:id/cuts',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.addCutLog
);

// Asynchronous Garment Finishing Log (Separate date/time logging)
router.post(
  '/:id/finish-logs',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.addFinishLog
);
router.post(
  '/:id/finish',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.addFinishLog
);

// Cancel an active production order at any stage (Reverses materials and product stock)
router.put(
  '/:id/cancel',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.cancel
);
router.post(
  '/:id/cancel',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.cancel
);

// Rollback and delete a production order
router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN'),
  productionController.delete
);

export default router;
