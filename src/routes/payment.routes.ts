import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// Generic routes
router.delete('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.deletePayment);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.editPayment);

// Explicit routes
router.delete('/customer/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.deleteCustomerPayment);
router.put('/customer/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.editCustomerPayment);

router.delete('/supplier/:purchaseId/:paymentId', verifyToken, requireRole('ADMIN', 'STAFF'), PaymentController.deleteSupplierPayment);
router.put('/supplier/:purchaseId/:paymentId', verifyToken, requireRole('ADMIN', 'STAFF'), PaymentController.editSupplierPayment);

export default router;
