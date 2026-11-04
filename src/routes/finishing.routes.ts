import { Router } from 'express';
import finishingController from '../controllers/finishing.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// Static & Summary endpoints (MUST precede /:id)
router.get('/summary', verifyToken, finishingController.getSummary);

// Collection endpoints
router.get('/', verifyToken, finishingController.getAll);
router.get('/:id', verifyToken, finishingController.getById);

// Mutations (Restricted to Admin and Staff)
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF'), finishingController.create);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), finishingController.update);
router.patch('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), finishingController.update);
router.delete('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), finishingController.delete);

export default router;

