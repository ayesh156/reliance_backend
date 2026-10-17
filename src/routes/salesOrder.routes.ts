import { Router } from 'express';
import * as salesOrderController from '../controllers/salesOrder.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * Presales Order Management Routes
 * Accessible to Sales Representatives (REP), Staff, Cashiers, and Admins
 */

// Stream/Download Order PDF (Requires token or public preview if accessed with token)
router.get('/:id/pdf', salesOrderController.downloadSalesOrderPdf);

// Create new sales order
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'),
  salesOrderController.createSalesOrder
);

// List paginated sales orders
router.get(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'),
  salesOrderController.getSalesOrders
);

// Get single sales order by ID
router.get(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'),
  salesOrderController.getSalesOrderById
);

// Update existing sales order
router.put(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'),
  salesOrderController.updateSalesOrder
);

// Update sales order status
router.patch(
  '/:id/status',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'),
  salesOrderController.updateSalesOrderStatus
);

// Convert Sales Order to Invoice placeholder action
router.post(
  '/:id/convert-to-invoice',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER', 'REP'),
  salesOrderController.convertSalesOrderToInvoice
);

// Safe atomic presales order deletion (ADMIN has global access; REP can delete own orders)
router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'REP'),
  salesOrderController.deleteSalesOrder
);

export default router;
