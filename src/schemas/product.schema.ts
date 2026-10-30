import { z } from 'zod';

/**
 * Product Variant Zod Schema
 */
export const productVariantSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  size: z.string().optional().default('FREE'),
  color: z.string().optional().default('Default'),
  sku: z.string().optional(),
  barcode: z.string().nullable().optional(),
  costPrice: z.coerce.number().min(0).default(0),
  retailPrice: z.coerce.number().min(0),
  wholesalePrice: z.coerce.number().min(0),
  comparePrice: z.coerce.number().min(0).nullable().optional(),
  stock: z.coerce.number().int().min(0).default(0),
  imageUrl: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  imageIndex: z.number().nullable().optional(),
  imageIndexes: z.array(z.number()).optional(),
});

/**
 * Zod Schema for Category ID Validation and Coercion
 * Using z.coerce.number().int().positive() ensures stringified numbers
 * from multipart/form-data requests are correctly parsed into valid positive integers.
 */
export const categoryIdSchema = z.coerce
  .number({
    message: 'A valid positive integer categoryId is required',
  })
  .int('A valid positive integer categoryId is required')
  .positive('A valid positive integer categoryId is required');

/**
 * Product Creation Zod Schema
 */
export const createProductSchema = z.object({
  name: z
    .string({ message: 'Product title is required and cannot be blank' })
    .trim()
    .min(2, 'Product title must be between 2 and 200 characters')
    .max(200, 'Product title must be between 2 and 200 characters'),
  categoryId: z.coerce
    .number({
      message: 'A valid positive integer categoryId is required',
    })
    .int('A valid positive integer categoryId is required')
    .positive('A valid positive integer categoryId is required'),
  description: z.string().optional().nullable(),
  searchKey: z.string().optional().nullable(),
  isFeatured: z.union([z.boolean(), z.string()]).optional(),
  variants: z.union([z.string(), z.array(productVariantSchema), z.array(z.any())]).optional(),
  reviews: z.union([z.string(), z.array(z.any())]).optional(),
});

/**
 * Product Update Zod Schema
 */
export const updateProductSchema = createProductSchema.partial().extend({
  categoryId: z.coerce
    .number({
      message: 'A valid positive integer categoryId is required',
    })
    .int('A valid positive integer categoryId is required')
    .positive('A valid positive integer categoryId is required')
    .optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductVariantInput = z.infer<typeof productVariantSchema>;

