import { Router } from 'express';
import * as customerController from '../controllers/customer.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

/**
 * Routes guarded for ADMIN and STAFF members
 */
router.get('/', verifyToken, requireRole('ADMIN', 'STAFF'), customerController.getCustomers);
router.get('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), customerController.getCustomerById);
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF'), customerController.createCustomer);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), customerController.updateCustomer);
router.delete('/:id', verifyToken, requireRole('ADMIN'), customerController.deleteCustomer);

export default router;