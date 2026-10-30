import {
  categoryIdSchema,
  createProductSchema,
  updateProductSchema,
  productVariantSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type ProductVariantInput,
} from '../schemas/product.schema.ts';

export {
  categoryIdSchema,
  createProductSchema,
  updateProductSchema,
  productVariantSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type ProductVariantInput,
};

/**
 * Product & Variant Request Validation Schemas
 *
 * Product inventory is strictly driven by the internal Production workflow
 * (Cutting -> Line -> Wash -> Stock). Manual stock entry during Product Creation
 * or Editing is optional and defaults to 0.
 */

export interface VariantValidationResult {
  isValid: boolean;
  error?: string;
  sanitized?: {
    id?: number;
    size?: string;
    color?: string;
    sku?: string;
    barcode?: string | null;
    costPrice: number;
    retailPrice: number;
    wholesalePrice: number;
    comparePrice?: number | null;
    stock: number;
    imageUrl?: string;
    imageUrls?: string[];
    imageIndex?: number | null;
    imageIndexes?: number[];
  };
}

/**
 * Validates an individual product variant input payload.
 * - stock: Optional, defaults to 0 if omitted, blank, null, or undefined. Minimum allowed value is 0.
 * - retailPrice: Non-negative number.
 * - wholesalePrice: Non-negative number.
 */
export const validateVariantPayload = (v: any): VariantValidationResult => {
  if (!v || typeof v !== 'object') {
    return { isValid: false, error: 'Variant payload must be a valid object' };
  }

  // Stock: optional, allows 0 or positive, defaults to 0
  let stock = 0;
  if (v.stock !== undefined && v.stock !== null && String(v.stock).trim() !== '') {
    const parsedStock = parseInt(String(v.stock), 10);
    if (isNaN(parsedStock) || parsedStock < 0) {
      return { isValid: false, error: 'Stock must be an integer greater than or equal to 0' };
    }
    stock = parsedStock;
  }

  const retailPrice = Number(v.retailPrice);
  if (isNaN(retailPrice) || retailPrice < 0) {
    return { isValid: false, error: 'Valid retail price (>= 0) is required' };
  }

  const wholesalePrice = Number(v.wholesalePrice);
  if (isNaN(wholesalePrice) || wholesalePrice < 0) {
    return { isValid: false, error: 'Valid wholesale price (>= 0) is required' };
  }

  const costPrice = v.costPrice !== undefined ? Math.max(0, Number(v.costPrice) || 0) : 0;
  const comparePrice = v.comparePrice ? Math.max(0, Number(v.comparePrice) || 0) : null;
  const cleanBarcode = v.barcode && typeof v.barcode === 'string' && v.barcode.trim() !== '' ? v.barcode.trim() : null;

  return {
    isValid: true,
    sanitized: {
      id: v.id ? Number(v.id) : undefined,
      size: typeof v.size === 'string' ? v.size.trim() : 'FREE',
      color: typeof v.color === 'string' ? v.color.trim() : 'Default',
      sku: v.sku?.trim() || undefined,
      barcode: cleanBarcode,
      costPrice,
      retailPrice,
      wholesalePrice,
      comparePrice,
      stock,
      imageUrl: v.imageUrl,
      imageUrls: Array.isArray(v.imageUrls) ? v.imageUrls : undefined,
      imageIndex: v.imageIndex,
      imageIndexes: Array.isArray(v.imageIndexes) ? v.imageIndexes : undefined,
    },
  };
};

/**
 * Validates product creation & update payload
 */
export const validateProductRequest = (
  name: any,
  categoryId: any,
  variants?: any[]
): { isValid: boolean; message?: string } => {
  if (typeof name !== 'string' || !name.trim()) {
    return { isValid: false, message: 'Product title is required and cannot be blank' };
  }
  if (name.trim().length < 2 || name.trim().length > 200) {
    return { isValid: false, message: 'Product title must be between 2 and 200 characters' };
  }
  const parsedCat = categoryIdSchema.safeParse(categoryId);
  if (!parsedCat.success) {
    return { isValid: false, message: 'A valid positive integer categoryId is required' };
  }
  if (variants !== undefined) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return { isValid: false, message: 'At least one product variant is required' };
    }
    for (let i = 0; i < variants.length; i++) {
      const check = validateVariantPayload(variants[i]);
      if (!check.isValid) {
        return { isValid: false, message: `Variant #${i + 1} validation failed: ${check.error}` };
      }
    }
  }
  return { isValid: true };
};
