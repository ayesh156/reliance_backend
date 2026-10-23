import { Router } from 'express';
import productionController from '../controllers/production.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// ============================================================================
// 1. STATIC & COLLECTION ROUTES (MUST BE REGISTERED FIRST BEFORE ANY /:id)
// ============================================================================

// Summary metrics & analytics
router.get('/summary', verifyToken, productionController.getSummary);

// Next available sequential batch code
router.get('/next-batch-number', verifyToken, productionController.getNextBatchNumber);
router.get('/batches/next-number', verifyToken, productionController.getNextBatchNumber);

// Wash batches endpoint
router.get('/wash/batches', verifyToken, productionController.getWashBatches);

// Stage 1: Create new material cut batch (Starts WIP batch in CUTTING status)
router.post(
  '/cut-batch',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createCutBatch
);

// Alias route for creating production batch (POST /api/production/batches)
router.post(
  '/batches',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createCutBatch
);

// Direct Line-First Workflow: Create new production batch directly starting in LINE status
router.post(
  '/line-batch',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createLineBatch
);
router.post(
  '/batches/line-batch',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createLineBatch
);

// Finishing-First Workflow: Create new production batch directly from finished garments
router.post(
  '/finish-batch',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.createFinishBatch
);

// Standalone cut-logs update route
router.put(
  '/cut-logs/:cutLogId',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.updateCutLog
);

// Production orders list and legacy creation
router.get('/', verifyToken, productionController.getAll);
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.create
);

// ============================================================================
// 2. SPECIFIC SUB-RESOURCE ACTION ROUTES (BEFORE ANY CATCH-ALL /:id)
// ============================================================================

// Append raw materials/fabric to existing batch without log spam
router.post(
  '/:id/append-fabric',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.appendFabric
);
router.post(
  '/batches/:id/append-fabric',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.appendFabric
);

// Factory Workflow: Send batch to decoupled SEWING LINE stage
router.post(
  '/:id/send-to-line',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.sendToLine
);
router.post(
  '/batches/:id/send-to-line',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.sendToLine
);

// End-of-Day Workflow: Send batch to decoupled WASHING stage
router.post(
  '/:id/send-to-wash',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.sendToWash
);
router.post(
  '/batches/:id/send-to-wash',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.sendToWash
);

// Stage 4: Log Washed Items & Partial Sellable Stock Sync
router.post(
  '/:id/wash',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.logWashed
);
router.post(
  '/:id/log-washed',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.logWashed
);
router.post(
  '/batches/:id/wash',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.logWashed
);
router.post(
  '/batches/:id/log-washed',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.logWashed
);

// Stage 3: Confirm & Sync Finished Garments to Product Inventory
router.post(
  '/:id/sync-stock',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.syncStock
);
router.post(
  '/batches/:id/sync-stock',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.syncStock
);

// Return leftover materials (Increments raw material stock)
router.put(
  '/:id/return-materials',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnMaterials
);
router.put(
  '/batches/:id/return-materials',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnMaterials
);

// Return Scrap / Material Release Workflow
router.post(
  '/:id/return-scrap',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnScrap
);
router.post(
  '/batches/:id/return-scrap',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnScrap
);
router.put(
  '/:id/return-scrap',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnScrap
);
router.put(
  '/batches/:id/return-scrap',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.returnScrap
);

// Asynchronous Material Cutting Log
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
router.put(
  '/:id/cut-logs/:cutLogId',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.updateCutLog
);

// Asynchronous Garment Finishing Log
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

// Finalize Batch & push actual finished pieces to sellable stock
router.post(
  '/:id/finalize',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.finalize
);
router.put(
  '/:id/finalize',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.finalize
);
router.post(
  '/batches/:id/finalize',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.finalize
);
router.put(
  '/batches/:id/finalize',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.finalize
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
router.put(
  '/batches/:id/cancel',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.cancel
);
router.post(
  '/batches/:id/cancel',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.cancel
);

// ============================================================================
// 3. CATCH-ALL PARAMETRIC ROUTES (MUST BE REGISTERED LAST)
// ============================================================================

router.get('/batches/:id', verifyToken, productionController.getById);
router.get('/:id', verifyToken, productionController.getById);

router.put(
  '/batches/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.update
);
router.put(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productionController.update
);

router.delete(
  '/batches/:id',
  verifyToken,
  requireRole('ADMIN'),
  productionController.delete
);
router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN'),
  productionController.delete
);

export default router;
