import { Router } from 'express';
import { getCustomerDueBills, settleBillPayment } from '../controllers/customerCredit.controller.ts';

const router = Router();

// Customer ගේ සියලුම හිඟ බිල්පත් ලැයිස්තුව
router.get('/customers/:customerId/due-bills', getCustomerDueBills);

// තෝරාගත් බිලකට ගෙවීමක් සිදු කිරීම
router.post('/settle-bill', settleBillPayment);

export default router;