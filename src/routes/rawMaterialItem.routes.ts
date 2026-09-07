import { Router } from 'express';
import rawMaterialItemController from '../controllers/rawMaterialItem.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// ── Read Routes (Accessible to authenticated Staff & Admins) ──
router.get('/', verifyToken, rawMaterialItemController.getAll);
// Endpoint to retrieve real-time auto-generated sequential code from Database
router.get('/next-code', verifyToken, rawMaterialItemController.getNextCode);
router.get('/:id', verifyToken, rawMaterialItemController.getById);

// ── Mutation Routes (Gated to Admin & Staff) ──
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  rawMaterialItemController.create
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