import { Router } from 'express';
import rawMaterialItemController from '../controllers/rawMaterialItem.controller.ts';
import {
  deductMaterialStock,
  returnScrapMaterialStock,
  getMaterialMovementHistory,
  updateMaterialMovement,
  deleteMaterialMovement,
} from '../controllers/rawMaterialMovement.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// ── Read Routes (Accessible to authenticated Staff & Admins) ──
router.get('/', verifyToken, rawMaterialItemController.getAll);
// Endpoint to retrieve real-time auto-generated sequential code from Database
router.get('/next-code', verifyToken, rawMaterialItemController.getNextCode);
router.get('/:id', verifyToken, rawMaterialItemController.getById);

// ── Stock Movement & Audit Logs (Accessible to authenticated Staff & Admins) ──
router.get('/:itemId/movements', verifyToken, getMaterialMovementHistory);

// Edit single movement audit record (Admin & Staff)
router.put(
  '/movements/:movementId',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  updateMaterialMovement
);

// Delete/Rollback single movement audit record (Admin Only)
router.delete(
  '/movements/:movementId',
  verifyToken,
  requireRole('ADMIN'),
  deleteMaterialMovement
);

// ── Mutation Routes (Gated to Admin & Staff) ──
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  rawMaterialItemController.create
);

// Production Material Deduction (Admin & Staff)
router.post(
  '/deduct',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  deductMaterialStock
);

// Leftover Scrap Return to Warehouse Stock (Admin & Staff)
router.post(
  '/scrap-return',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  returnScrapMaterialStock
);

router.put(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  rawMaterialItemController.update
);

// ── Deletion Route (Admin Only) ──
router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN'),
  rawMaterialItemController.delete
);

export default router;