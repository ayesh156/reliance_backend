import { z } from 'zod';

/**
 * Order Line Item Zod Schema
 */
export const orderItemSchema = z.object({
  variantId: z.coerce.number().int().positive({ message: 'Valid integer variantId is required' }),
  quantity: z.coerce.number().int({ message: 'Quantity must be an integer' }),
  unitPrice: z.coerce.number().min(0, { message: 'Unit price must be >= 0' }),
  discount: z.coerce.number().min(0).optional().default(0),
  costPrice: z.coerce.number().min(0).optional(),
  isReturn: z.coerce.boolean().optional().default(false),
});

/**
 * Split Payment Zod Schema
 */
export const splitPaymentItemSchema = z.object({
  method: z.string().default('CASH'),
  amount: z.coerce.number().min(0, { message: 'Payment amount must be >= 0' }),
  reference: z.string().optional().nullable(),
});

/**
 * Cheque Item Zod Schema
 */
export const chequeItemSchema = z.object({
  chequeNumber: z.string().min(1),
  bank: z.string().optional().nullable(),
  branch: z.string().optional().nullable(),
  chequeDate: z.string().optional().nullable(),
  amount: z.coerce.number().min(0, { message: 'Cheque amount must be >= 0' }),
  notes: z.string().optional().nullable(),
});

/**
 * POS Cashier Order Creation Schema
 */
export const createPosOrderSchema = z.object({
  customerId: z.coerce.number().int().positive().nullable().optional(),
  userId: z.coerce.number().int().positive().optional(),
  items: z.array(orderItemSchema).min(1, { message: 'Order must contain at least one line item' }),
  paymentMethod: z.string().optional().default('CASH'),
  paidAmount: z.coerce.number().min(0).optional().default(0),
  totalAmount: z.coerce.number().min(0).optional(),
  creditDue: z.coerce.number().min(0).optional().default(0),
  tenderedAmount: z.coerce.number().optional(),
  changeAmount: z.coerce.number().optional(),
  discount: z.coerce.number().min(0).optional().default(0),
  discountType: z.string().optional(),
  discountValue: z.coerce.number().min(0).optional().default(0),
  discountInput: z.coerce.number().min(0).optional(),
  originalTotalAmount: z.coerce.number().optional(),
  previousDue: z.coerce.number().optional(),
  source: z.string().optional(),
  notes: z.union([z.string(), z.record(z.string(), z.any())]).optional().nullable(),
  splitPayments: z.array(splitPaymentItemSchema).optional(),
  cheques: z.array(chequeItemSchema).optional(),
});

/**
 * Customer Due Settlement Schema
 */
export const settleCustomerDebtSchema = z.object({
  customerId: z.coerce.number().int().positive({ message: 'Valid customerId is required' }),
  amount: z.coerce.number().positive({ message: 'Settlement amount must be > 0' }),
  paymentMethod: z.string().optional().default('CASH'),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
});

/**
 * Single Bill Payment Settlement Schema
 */
export const settleBillPaymentSchema = z.object({
  orderId: z.coerce.number().int().positive({ message: 'Valid orderId is required' }),
  amount: z.coerce.number().positive({ message: 'Settlement amount must be > 0' }),
  paymentMethod: z.string().optional().default('CASH'),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paymentDate: z.union([z.string(), z.date()]).optional(),
});

/**
 * Invoices Query Parameters Schema
 */
export const invoicesQuerySchema = z.object({
  search: z.string().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  paymentMethod: z.string().optional(),
  source: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(15),
});

export type CreatePosOrderInput = z.infer<typeof createPosOrderSchema>;
export type SettleCustomerDebtInput = z.infer<typeof settleCustomerDebtSchema>;
export type SettleBillPaymentInput = z.infer<typeof settleBillPaymentSchema>;
export type InvoicesQueryInput = z.infer<typeof invoicesQuerySchema>;
