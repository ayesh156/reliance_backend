import { Router } from 'express';
import authRoutes from './auth.routes';
import categoryRoutes from './category.routes';
import productRoutes from './product.routes';
import settingsRoutes from './settings.routes';
import attributeRoutes from './attribute.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);
router.use('/attributes', attributeRoutes);

export default router;