import type { NextFunction, Request, Response } from 'express';
import { CustomerCreditService } from '../services/customerCredit.service.ts';
import { CustomerStatementPdfService } from '../services/customer-statement-pdf.service.ts';
import { prisma } from '../lib/prisma.ts';

/**
 * Stream generated Customer Due Statement PDF directly to browser/client
 */
export const downloadCustomerStatementPdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawCustomerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    const customerId = Number(rawCustomerId);

    if (!customerId || isNaN(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Valid customer ID is required' });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Retrieve active due bills list
    const dueBillsData = await CustomerCreditService.getCustomerDueBills(customerId);
    const doc = CustomerStatementPdfService.generate(customer, dueBillsData.bills || []);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Statement-${customer.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);

    doc.on('error', (streamErr) => {
      console.error('[PDF STREAM RUNTIME ERROR]:', streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: 'PDF statement stream failed' });
      }
    });

    doc.pipe(res);
    doc.end();
  } catch (err: any) {
    console.error('[CUSTOMER STATEMENT PDF ERROR]:', err);
    res.status(500).json({ error: err.message || 'Failed to generate customer statement PDF' });
  }
};

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
      return res.status(400).json({ success: false, message: 'A valid customer ID is required.' });
    }

    const data = await CustomerCreditService.getCustomerDueBills(customerId);
    return res.status(200).json({ success: true, ...data });
  } catch (error: any) {
    console.error('Error in getCustomerDueBills:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to retrieve due bills.' });
  }
};

export const settleBillPayment = async (req: Request, res: Response) => {
  try {
    // Read optional custom paymentDate sent from frontend datepicker
    const { orderId, amount, paymentMethod, reference, notes, paymentDate } = req.body;
    const result = await CustomerCreditService.settleBillPayment({
      orderId: parseInt(orderId, 10),
      amount: Number(amount),
      paymentMethod,
      reference,
      notes,
      paymentDate: paymentDate ? new Date(paymentDate) : undefined,
    });

    return res.status(200).json({
      success: true,
      message: `Payment of Rs. ${Number(amount).toFixed(2)} settled successfully.`,
      data: result,
    });
  } catch (error: any) {
    console.error('Error in settleBillPayment:', error);
    return res.status(400).json({ success: false, message: error.message || 'Payment settlement failed.' });
  }
};