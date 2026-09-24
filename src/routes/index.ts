import { Router } from 'express';
import authRoutes from './auth.routes.ts';
import productRoutes from './product.routes.ts';
import settingsRoutes from './settings.routes.ts';
import attributeRoutes from './attribute.routes.ts';
import customerRoutes from './customer.routes.ts';
import orderRoutes from './order.routes.ts';
import rawMaterialShopRoutes from './rawMaterialShop.routes.ts';
import rawMaterialItemRoutes from './rawMaterialItem.routes.ts';
import buyRawMaterialRoutes from './buyRawMaterial.routes.ts';

const router = Router();

// Modular Route Aggregation
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);
router.use('/attributes', attributeRoutes);
router.use('/customers', customerRoutes);
router.use('/orders', orderRoutes);
// Alias route for Frontend Invoice PDF and ledger endpoints
router.use('/invoices', orderRoutes);
router.use('/buy-raw-materials', buyRawMaterialRoutes);
router.use('/raw-material-shops', rawMaterialShopRoutes);
router.use('/raw-material-items', rawMaterialItemRoutes);

export default router;