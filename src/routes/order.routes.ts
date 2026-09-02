import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

/**
 * POS cashier endpoints guarded for ADMIN and STAFF members
 */
router.get('/catalog', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.getPosCatalog);
router.post('/pos', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.createPosOrder);

export default router;