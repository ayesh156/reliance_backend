import { Router } from 'express';
import * as attributeController from '../controllers/attribute.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Categories endpoints unified under attributes
router.get('/categories', attributeController.getCategories);
router.post('/categories', verifyToken, requireRole('ADMIN', 'STAFF'), attributeController.createCategory);
router.delete('/categories/:id', verifyToken, requireRole('ADMIN'), attributeController.deleteCategory);

// Sizes endpoints
router.get('/sizes', attributeController.getSizes);
router.post('/sizes', verifyToken, requireRole('ADMIN', 'STAFF'), attributeController.createSize);
router.delete('/sizes/:id', verifyToken, requireRole('ADMIN'), attributeController.deleteSize);

// Colors endpoints
router.get('/colors', attributeController.getColors);
router.post('/colors', verifyToken, requireRole('ADMIN', 'STAFF'), attributeController.createColor);
router.delete('/colors/:id', verifyToken, requireRole('ADMIN'), attributeController.deleteColor);

export default router;