import { Router } from 'express';
import rawMaterialShopController from '../controllers/rawMaterialShop.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/', verifyToken, rawMaterialShopController.getAll);
router.get('/:id', verifyToken, rawMaterialShopController.getById);
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF'), rawMaterialShopController.create);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), rawMaterialShopController.update);
router.delete('/:id', verifyToken, requireRole('ADMIN'), rawMaterialShopController.delete);

export default router;