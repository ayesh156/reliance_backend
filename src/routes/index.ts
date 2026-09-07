import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import settingsRoutes from './settings.routes';
import attributeRoutes from './attribute.routes';
import customerRoutes from './customer.routes';
import orderRoutes from './order.routes';
import rawMaterialShopRoutes from './rawMaterialShop.routes';
import rawMaterialItemRoutes from './rawMaterialItem.routes';
import buyRawMaterialRoutes from './buyRawMaterial.routes';

const router = Router();

// Modular Route Aggregation
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);
router.use('/attributes', attributeRoutes);
router.use('/customers', customerRoutes);
router.use('/orders', orderRoutes);
router.use('/buy-raw-materials', buyRawMaterialRoutes);
router.use('/raw-material-shops', rawMaterialShopRoutes);
router.use('/raw-material-items', rawMaterialItemRoutes);

export default router;