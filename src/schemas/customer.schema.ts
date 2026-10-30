import { z } from 'zod';

/**
 * Customer Creation Zod Schema
 */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Customer name must be at least 2 characters'),
  phone: z.string().trim().min(7, 'Valid contact number is required'),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  nic: z.string().optional().nullable(),
  type: z.enum(['RETAIL', 'WHOLESALE']).optional().default('RETAIL'),
  creditLimit: z.coerce.number().min(0, 'Credit limit must be >= 0').optional().default(0),
  outstandingBalance: z.coerce.number().optional().default(0),
  repId: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Customer Update Zod Schema
 */
export const updateCustomerSchema = createCustomerSchema.partial().extend({
  id: z.coerce.number().int().positive().optional(),
});

/**
 * Customer Query Parameters Schema
 */
export const customerQuerySchema = z.object({
  query: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerQueryInput = z.infer<typeof customerQuerySchema>;

