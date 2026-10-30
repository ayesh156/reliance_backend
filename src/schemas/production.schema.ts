import { z } from 'zod';

/**
 * Production Target Product Specification
 */
export const targetProductItemSchema = z.object({
  productId: z.coerce.number().int().positive({ message: 'Valid productId is required' }),
  variantId: z.coerce.number().int().positive().optional().nullable(),
  productName: z.string().optional(),
  variantName: z.string().optional(),
  cutQty: z.coerce.number().int().min(0).optional().default(0),
  targetQuantity: z.coerce.number().int().min(0).optional().default(0),
  completedQty: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * Production Material Allocation Item
 */
export const materialUsageItemSchema = z.object({
  rawMaterialId: z.coerce.number().int().positive({ message: 'Valid rawMaterialId is required' }),
  issuedQty: z.coerce.number().min(0, { message: 'Issued quantity must be >= 0' }),
  returnedQty: z.coerce.number().min(0).optional().default(0),
  returnedScrap: z.coerce.number().min(0).optional().default(0),
});

/**
 * Production Cut Batch Creation Schema (Stage 1)
 */
export const createCutBatchSchema = z.object({
  productionNo: z.string().optional(),
  productId: z.coerce.number().int().positive().optional().nullable(),
  variantId: z.coerce.number().int().positive().optional().nullable(),
  targetQuantity: z.coerce.number().int().min(0).optional().default(0),
  completedQty: z.coerce.number().int().min(0).optional().default(0),
  cutQty: z.coerce.number().int().min(0).optional().default(0),
  sewnQty: z.coerce.number().int().min(0).optional().default(0),
  sentToWashQty: z.coerce.number().int().min(0).optional().default(0),
  washedQty: z.coerce.number().int().min(0).optional().default(0),
  lineSentQty: z.coerce.number().int().min(0).optional().default(0),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  productionDate: z.union([z.string(), z.date()]).optional(),
  materials: z.array(materialUsageItemSchema).optional().default([]),
  targetProducts: z.union([z.string(), z.array(targetProductItemSchema)]).optional(),
});

/**
 * Log Sewing Event Schema
 */
export const logSewnSchema = z.object({
  sewnQty: z.coerce.number().int().min(0, { message: 'Sewn quantity must be >= 0' }),
  logDate: z.string().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Dispatch Batch to Line Schema
 */
export const sendToLineSchema = z.object({
  lineSentQty: z.coerce.number().int().min(0).optional(),
  cutQty: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Dispatch Batch to Wash Schema
 */
export const sendToWashSchema = z.object({
  sentToWashQty: z.coerce.number().int().min(0, { message: 'Wash dispatch quantity must be >= 0' }),
  notes: z.string().optional().nullable(),
});

/**
 * Cut Log Event Schema
 */
export const cutLogSchema = z.object({
  quantity: z.coerce.number().int().min(0, { message: 'Cut quantity must be >= 0' }),
  cutDate: z.string().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Garment Finishing Log Event Schema
 */
export const finishLogSchema = z.object({
  quantity: z.coerce.number().int().min(0, { message: 'Finished quantity must be >= 0' }),
  finishDate: z.string().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Return Scrap Schema
 */
export const returnScrapItemSchema = z.object({
  rawMaterialId: z.coerce.number().int().positive().optional(),
  returnedScrap: z.coerce.number().min(0, { message: 'Returned scrap must be >= 0' }),
});

export const returnScrapSchema = z.object({
  scrapItems: z.array(returnScrapItemSchema).min(1, { message: 'At least one scrap item is required' }),
});

export type TargetProductItemInput = z.infer<typeof targetProductItemSchema>;
export type MaterialUsageItemInput = z.infer<typeof materialUsageItemSchema>;
export type CreateCutBatchInput = z.infer<typeof createCutBatchSchema>;
export type LogSewnInput = z.infer<typeof logSewnSchema>;
export type SendToLineInput = z.infer<typeof sendToLineSchema>;
export type SendToWashInput = z.infer<typeof sendToWashSchema>;
export type CutLogInput = z.infer<typeof cutLogSchema>;
export type FinishLogInput = z.infer<typeof finishLogSchema>;
export type ReturnScrapInput = z.infer<typeof returnScrapSchema>;

