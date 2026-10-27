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
router.get('/orders/:id/pdf', orderController.downloadInvoicePdf);

/**
 * Invoices & Orders Ledger Retrieval Routes
 * Accessible to ADMIN, STAFF, CASHIER, and REP.
 * Note: Controller strictly enforces data scoping so REPs only receive invoices they authored,
 * while ADMIN, STAFF, and CASHIER retrieve the full global ledger.
 */
router.get('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoices);
router.get('/invoices', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoices);
router.get('/orders', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoices);
/**
 * Dedicated Return Inventory Pipeline Routes (strictly ABOVE /:id)
 * Accessible to ADMIN, STAFF, CASHIER, and REP.
 */
router.get('/return-inventory', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getReturnInventory);
router.get('/orders/return-inventory', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getReturnInventory);
router.get('/invoices/return-inventory', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getReturnInventory);
router.post('/return-inventory/:id/restock', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.restockReturnItem);
router.post('/orders/return-inventory/:id/restock', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.restockReturnItem);
router.post('/invoices/return-inventory/:id/restock', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.restockReturnItem);

router.get('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoiceById);
router.get('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoiceById);
router.get('/orders/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.getInvoiceById);

/**
 * Invoice Order Creation & Modification Routes
 * Accessible to ADMIN, STAFF, CASHIER, and REP.
 * Supports standard PUT and POST submissions for Quick Checkout creation and editing.
 */
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.createPosOrder);
router.put('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.updateInvoiceOrder);
router.post('/invoices/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.updateInvoiceOrder);
router.put('/orders/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.updateInvoiceOrder);
router.post('/orders/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.updateInvoiceOrder);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.updateInvoiceOrder);
router.post('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.updateInvoiceOrder);

/**
 * In-Store Invoice Item Return & Stock Restoration Endpoint
 * (POST /api/orders/:id/returns, /api/invoices/:id/returns, and /:id/returns)
 * Accessible to ADMIN, STAFF, CASHIER, and REP.
 */
router.post('/orders/:id/returns', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.processInvoiceReturn);
router.post('/invoices/:id/returns', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.processInvoiceReturn);
router.post('/:id/returns', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.processInvoiceReturn);

// Toggle Rep Dispatch Tracking status (Rep Sent / Dispatched)
router.patch('/invoices/:id/dispatch', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.toggleInvoiceDispatch);
router.patch('/orders/:id/dispatch', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.toggleInvoiceDispatch);
router.patch('/:id/dispatch', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), orderController.toggleInvoiceDispatch);

// Restrict destructive invoice deletion: ADMIN only (REP is forbidden)
router.delete('/invoices/:id', verifyToken, requireRole('ADMIN'), orderController.deleteInvoiceOrder);
router.delete('/orders/:id', verifyToken, requireRole('ADMIN'), orderController.deleteInvoiceOrder);
router.delete('/:id', verifyToken, requireRole('ADMIN'), orderController.deleteInvoiceOrder);

export default router;