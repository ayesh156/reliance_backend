import { Router } from 'express';
import { categoryController } from '../controllers/category.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/', (req, res, next) => categoryController.getAll(req, res, next));
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  (req, res, next) => categoryController.create(req, res, next)
);

export default router;