import type { Request, Response } from 'express';
import { CustomerCreditService } from '../services/customerCredit.service.ts';

/**
 * Enterprise Customer Credit Controller
 * Acts as thin HTTP handler delegating all business & transaction logic to CustomerCreditService
 */

export const getCustomerDueBills = async (req: Request, res: Response) => {
  try {
    // Type-safe string parsing to prevent 'string | string[]' type error
    const rawCustomerId = Array.isArray(req.params.customerId) 
      ? req.params.customerId[0] 
      : req.params.customerId;
    const customerId = Number(rawCustomerId);

    if (!customerId || isNaN(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'වලංගු Customer ID එකක් අවශ්‍යයි.' });
    }

    const data = await CustomerCreditService.getCustomerDueBills(customerId);
    return res.status(200).json({ success: true, ...data });
  } catch (error: any) {
    console.error('Error in getCustomerDueBills:', error);
    return res.status(400).json({ success: false, message: error.message || 'දත්ත ලබාගැනීමට නොහැකි විය.' });
  }
};

export const settleBillPayment = async (req: Request, res: Response) => {
  try {
    const { orderId, amount, paymentMethod, reference, notes } = req.body;
    const result = await CustomerCreditService.settleBillPayment({
      orderId: parseInt(orderId, 10),
      amount: Number(amount),
      paymentMethod,
      reference,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: `රු. ${Number(amount).toFixed(2)} ක මුදලක් සාර්ථකව පියවන ලදී.`,
      data: result,
    });
  } catch (error: any) {
    console.error('Error in settleBillPayment:', error);
    return res.status(400).json({ success: false, message: error.message || 'ගෙවීම් ක්‍රියාවලිය අසාර්ථක විය.' });
  }
};