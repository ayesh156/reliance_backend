import { Router } from 'express';
import * as customerController from '../controllers/customer.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * Routes guarded for ADMIN, STAFF, CASHIER, and REP members
 */
router.get('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomers);
router.post('/reconcile', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), customerController.reconcileCustomerBalances);

// Single receipt fetch endpoint for 80mm consolidated thermal POS reprint
router.get('/receipts/:receiptId', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomerReceiptById);

// Customer 80mm statement endpoint: profile + all orders + payment methods breakdown
router.get('/:id/statement', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomerStatement);

// Customer receipts list endpoint
router.get('/:id/receipts', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomerReceipts);

router.get('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomerById);
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.createCustomer);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.updateCustomer);
router.delete('/:id', verifyToken, requireRole('ADMIN'), customerController.deleteCustomer);

export default router;
