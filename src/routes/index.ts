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
import customerCreditRoutes from './customerCredit.routes.ts';
import paymentRoutes from './payment.routes.ts';
import productionRoutes from './production.routes.ts';
import reportRoutes from './report.routes.ts';
import userRoutes from './user.routes.ts';

const router = Router();

// Modular Route Aggregation
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
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
router.use('/credit', customerCreditRoutes);
router.use('/payments', paymentRoutes);
router.use('/production', productionRoutes);
router.use('/reports', reportRoutes);

export default router;