import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

/**
 * POS cashier & Invoices endpoints guarded for ADMIN, STAFF and CASHIER
 */
router.get('/catalog', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.getPosCatalog);
router.post('/pos', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.createPosOrder);

// Customer Debt Settlement & Reconciliation Routes
router.get('/customers/:customerId/pending-invoices', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.getCustomerPendingInvoices);
router.post('/customers/:customerId/settle-debt', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.settleCustomerDebt);

// Invoices CRUD Management Routes (Explicit Route Ordering)
router.get('/invoices', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.getInvoices);
router.get('/invoices/:id/pdf', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.downloadInvoicePdf);
router.get('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.getInvoiceById);

// Support both standard PUT and POST for edit invoice submissions
router.put('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.updateInvoiceOrder);
router.post('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.updateInvoiceOrder);

router.delete('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.deleteInvoiceOrder);

export default router;