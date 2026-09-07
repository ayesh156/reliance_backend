import { Router } from 'express';
import buyRawMaterialController from '../controllers/buyRawMaterial.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Read routes
router.get('/', verifyToken, buyRawMaterialController.getAll);
// Real-time auto invoice generator endpoint from database
router.get('/next-invoice', verifyToken, buyRawMaterialController.getNextInvoice);
router.get('/:id', verifyToken, buyRawMaterialController.getById);

// Create and delete routes
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  buyRawMaterialController.create
);

router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN'),
  buyRawMaterialController.delete
);

export default router;