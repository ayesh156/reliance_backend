import { Router } from 'express';
import userController from '../controllers/user.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * PUT /api/users/:id/admin-override
 * Protected by verifyToken and requireRole('ADMIN')
 * Allows an admin to directly update name, email, role, active, and set a new hashed password.
 */
router.put(
  '/:id/admin-override',
  verifyToken,
  requireRole('ADMIN'),
  userController.adminOverride.bind(userController)
);

export default router;
