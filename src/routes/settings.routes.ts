import { Router } from 'express';
import settingsController from '../controllers/settings.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

router.get('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), settingsController.getAll);
router.put('/', verifyToken, requireRole('ADMIN'), settingsController.update);

export default router;