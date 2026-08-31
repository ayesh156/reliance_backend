import { Router } from 'express';
import authController from '../controllers/auth.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// ── Public ──────────────────────────────────────────────────────────────────
router.post('/login', authController.login);

// ── Authenticated ───────────────────────────────────────────────────────────
router.get('/me', verifyToken, authController.getMe);

// ── Admin only ──────────────────────────────────────────────────────────────
router.get('/users', verifyToken, requireRole('ADMIN'), authController.listUsers);
router.post('/users', verifyToken, requireRole('ADMIN'), authController.createUser);
router.patch('/users/:id', verifyToken, requireRole('ADMIN'), authController.updateUser);

export default router;