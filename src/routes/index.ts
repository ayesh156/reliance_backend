import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes'
import categoryRoutes from './category.routes';
import settingsRoutes from './settings.routes';

const router = Router();

/**
 * Centralized API router.
 * Each module is mounted at its standard `/api/<resource>` prefix.
 */
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/settings', settingsRoutes);

export default router;