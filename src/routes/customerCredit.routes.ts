import { Router } from 'express';
import { downloadCustomerStatementPdf, getCustomerDueBills, settleBillPayment } from '../controllers/customerCredit.controller.ts';

const router = Router();

router.get('/customers/:customerId/due-bills', getCustomerDueBills);
router.post('/settle-bill', settleBillPayment);
// Stream official customer account due statement PDF
router.get('/customers/:customerId/statement-pdf', downloadCustomerStatementPdf);

export default router;