import { Router } from 'express';
import * as orderController from '../controllers/order.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * POS cashier & Invoices endpoints guarded for ADMIN, STAFF, CASHIER, and REP (Sales Representative)
 */
router.get('/catalog', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getPosCatalog);
router.post('/pos', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.createPosOrder);

// Customer Debt Settlement & Reconciliation Routes
router.get('/customers/:customerId/pending-invoices', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getCustomerPendingInvoices);
router.post('/customers/:customerId/settle-debt', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.settleCustomerDebt);

// Dedicated Public/Direct Invoice PDF Preview & Download Routes (Must precede /invoices/:id)
router.get('/invoices/:id/pdf', orderController.downloadInvoicePdf);
router.get('/:id/pdf', orderController.downloadInvoicePdf);

// Invoices CRUD Management Routes (Explicit Route Ordering)
router.get('/invoices', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoices);
router.get('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoiceById);

// Support both standard PUT and POST for edit invoice submissions
router.put('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.updateInvoiceOrder);
router.post('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.updateInvoiceOrder);

// In-Store Invoice Item Return & Stock Restoration Endpoint (POST /api/orders/:id/returns & /api/invoices/:id/returns)
router.post('/orders/:id/returns', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.processInvoiceReturn);
router.post('/invoices/:id/returns', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.processInvoiceReturn);
router.post('/:id/returns', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), orderController.processInvoiceReturn);


// Restrict destructive invoice deletion: ADMIN has global access; REP is scoped to their own wholesale invoices
router.delete('/invoices/:id', verifyToken, requireRole('ADMIN', 'REP'), orderController.deleteInvoiceOrder);
router.delete('/orders/:id', verifyToken, requireRole('ADMIN', 'REP'), orderController.deleteInvoiceOrder);
router.delete('/:id', verifyToken, requireRole('ADMIN', 'REP'), orderController.deleteInvoiceOrder);

export default router;