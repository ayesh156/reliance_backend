import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// Automated reconciliation route
router.post('/reconcile-matured', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.reconcileMaturedCheques);

// Generic routes
router.delete('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.deletePayment);
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.editPayment);
router.post('/:id/cancel-replace', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.cancelAndReplacePayment);

// Explicit routes
router.delete('/customer/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.deleteCustomerPayment);
router.put('/customer/:id', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.editCustomerPayment);
router.post('/customer/:id/cancel-replace', verifyToken, requireRole('ADMIN', 'STAFF', 'CASHIER'), PaymentController.cancelAndReplacePayment);

router.delete('/supplier/:purchaseId/:paymentId', verifyToken, requireRole('ADMIN', 'STAFF'), PaymentController.deleteSupplierPayment);
router.put('/supplier/:purchaseId/:paymentId', verifyToken, requireRole('ADMIN', 'STAFF'), PaymentController.editSupplierPayment);

export default router;
