import { Router } from 'express';
import rawMaterialShopController from '../controllers/rawMaterialShop.controller.ts';
import {
  settleSupplierInvoiceDue,
  getSupplierPendingInvoices,
} from '../controllers/supplierPayment.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

router.get('/', verifyToken, rawMaterialShopController.getAll);
router.get('/:id', verifyToken, rawMaterialShopController.getById);

// ── Supplier Outstanding Dues & Pending Invoices (Authenticated Users) ──
router.get('/:shopId/pending-invoices', verifyToken, getSupplierPendingInvoices);

router.post('/', verifyToken, requireRole('ADMIN', 'STAFF'), rawMaterialShopController.create);

// ── Supplier Debt Settlement Mutation (Admin & Staff) ──
router.post('/settle-due', verifyToken, requireRole('ADMIN', 'STAFF'), settleSupplierInvoiceDue);

router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), rawMaterialShopController.update);
router.delete('/:id', verifyToken, requireRole('ADMIN'), rawMaterialShopController.delete);

export default router;