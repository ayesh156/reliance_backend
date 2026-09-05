import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import settingsRoutes from './settings.routes';
import attributeRoutes from './attribute.routes';
import customerRoutes from './customer.routes';
import orderRoutes from './order.routes';
import rawMaterialShopRoutes from './rawMaterialShop.routes';

const router = Router();

// Modular Route Aggregation
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);
router.use('/attributes', attributeRoutes);
router.use('/customers', customerRoutes);
router.use('/orders', orderRoutes);
router.use('/raw-material-shops', rawMaterialShopRoutes);

export default router;