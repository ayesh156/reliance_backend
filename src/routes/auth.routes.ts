import { Router } from 'express';
import authController from '../controllers/auth.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Public authentication endpoint
router.post('/login', authController.login.bind(authController));

// Authenticated current user profile
router.get('/me', verifyToken, authController.getMe.bind(authController));

// Admin-only user management endpoints
router.get('/users', verifyToken, requireRole('ADMIN'), authController.listUsers.bind(authController));
router.post('/users', verifyToken, requireRole('ADMIN'), authController.createUser.bind(authController));
router.patch('/users/:id', verifyToken, requireRole('ADMIN'), authController.updateUser.bind(authController));

export default router;