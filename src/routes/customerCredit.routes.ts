import { Router } from 'express';
import {
  downloadCustomerStatementPdf,
  getCustomerDueBills,
  getCustomerReceipts,
  settleBillPayment,
} from '../controllers/customerCredit.controller.ts';

const router = Router();

router.get('/customers/:customerId/due-bills', getCustomerDueBills);
router.get('/customers/:customerId/receipts', getCustomerReceipts);
router.post('/settle-bill', settleBillPayment);
// Stream official customer account due statement PDF
router.get('/customers/:customerId/statement-pdf', downloadCustomerStatementPdf);

export default router;