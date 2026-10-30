import { z } from 'zod';

/**
 * Raw Material Supplier Shop Creation Schema
 */
export const createSupplierShopSchema = z.object({
  name: z.string().trim().min(2, 'Supplier shop name must be at least 2 characters'),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateSupplierShopSchema = createSupplierShopSchema.partial();

/**
 * Raw Material Purchase Item Schema
 */
export const buyRawMaterialItemSchema = z.object({
  rawMaterialItemId: z.coerce.number().int().positive({ message: 'Valid rawMaterialItemId is required' }),
  quantity: z.coerce.number().positive({ message: 'Quantity must be > 0' }),
  unitPrice: z.coerce.number().min(0, { message: 'Unit price must be >= 0' }),
  subtotal: z.coerce.number().min(0).optional(),
});

/**
 * Raw Material Purchase (GRN / Bill) Creation Schema
 */
export const createBuyRawMaterialSchema = z.object({
  rawMaterialShopId: z.coerce.number().int().positive({ message: 'Valid supplier shop ID is required' }),
  shopId: z.coerce.number().int().positive().optional(),
  invoiceNumber: z.string().optional(),
  purchaseDate: z.union([z.string(), z.date()]).optional(),
  items: z.array(buyRawMaterialItemSchema).min(1, { message: 'Purchase must have at least one raw material line item' }),
  totalAmount: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0).optional().default(0),
  dueAmount: z.coerce.number().min(0).optional().default(0),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'DUE']).optional(),
  paymentMethod: z.string().optional().default('CASH'),
  notes: z.string().optional().nullable(),
});

/**
 * Settle Supplier Invoice Due Schema
 */
export const settleSupplierBillSchema = z.object({
  shopId: z.coerce.number().int().positive({ message: 'Valid supplier shop ID is required' }),
  purchaseId: z.coerce.number().int().positive().optional().nullable(),
  amount: z.coerce.number().positive({ message: 'Payment amount must be greater than zero' }),
  paymentMethod: z.string().optional().default('CASH'),
  reference: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  notes: z.string().optional().nullable(),
});

export type CreateSupplierShopInput = z.infer<typeof createSupplierShopSchema>;
export type UpdateSupplierShopInput = z.infer<typeof updateSupplierShopSchema>;
export type BuyRawMaterialItemInput = z.infer<typeof buyRawMaterialItemSchema>;
export type CreateBuyRawMaterialInput = z.infer<typeof createBuyRawMaterialSchema>;
export type SettleSupplierBillInput = z.infer<typeof settleSupplierBillSchema>;

