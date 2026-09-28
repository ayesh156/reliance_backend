import { Router } from 'express';
import buyRawMaterialController from '../controllers/buyRawMaterial.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

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

router.put(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  buyRawMaterialController.update
);

// Add these routes below existing endpoints
router.get('/:id/pdf', verifyToken, buyRawMaterialController.downloadGrnPdf);
router.post('/settle-payment', verifyToken, requireRole('ADMIN', 'STAFF'), buyRawMaterialController.settlePayment);

export default router;