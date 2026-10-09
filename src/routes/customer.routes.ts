import { Router } from 'express';
import * as customerController from '../controllers/customer.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * Routes guarded for ADMIN, STAFF, CASHIER, and REP members
 */
router.get('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomers);
router.get('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.getCustomerById);
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.createCustomer);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'), customerController.updateCustomer);
router.delete('/:id', verifyToken, requireRole('ADMIN'), customerController.deleteCustomer);

export default router;