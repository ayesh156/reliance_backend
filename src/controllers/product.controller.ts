import type { Request, Response } from 'express';
import productService from '../services/product.service.ts';
import { sendErrorFrom, sendNoContent } from '../utils/response.ts';
import { createProductSchema, categoryIdSchema } from '../schemas/product.schema.ts';

export class ProductController {
  /** GET /api/products — Fetch with sanitized search & category filter */
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : undefined;
      const rawCat = req.query.categoryId;
      const categoryId = rawCat && !isNaN(Number(rawCat)) && Number(rawCat) > 0 ? Number(rawCat) : undefined;
      const products = await productService.getAllProducts(search, categoryId);
      res.json(products);
    } catch (error) {
      console.error('[ProductController] Error fetching products:', error);
      sendErrorFrom(res, error, 'Failed to fetch products');
    }
  }

  /** GET /api/products/:id — Fetch single product by ID or Slug */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const idOrSlug = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const product = await productService.getProductById(idOrSlug);
      res.json(product);
    } catch (error) {
      console.error('[ProductController] Error fetching product:', error);
      sendErrorFrom(res, error, 'Failed to fetch product');
    }
  }

  /** POST /api/products — Create product with variants & images */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const userRole = String((req as any).user?.role || '').toUpperCase();
      if (userRole === 'REP') {
        res.status(403).json({ error: 'Forbidden: Representatives cannot create products.' });
        return;
      }
      // Ensure variant stock defaults to 0 if omitted or blank (Production-driven inventory)
      if (req.body.variants) {
        try {
          const raw = typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;
          if (Array.isArray(raw)) {
            const normalized = raw.map((v: any) => ({
              ...v,
              stock: v.stock !== undefined && v.stock !== null && String(v.stock).trim() !== ''
                ? Math.max(0, parseInt(String(v.stock), 10) || 0)
                : 0,
            }));
            req.body.variants = typeof req.body.variants === 'string' ? JSON.stringify(normalized) : normalized;
          }
        } catch { /* proceed to service parser */ }
      }
      const parsedPayload = createProductSchema.safeParse(req.body);
      if (!parsedPayload.success) {
        res.status(400).json({ error: parsedPayload.error.issues[0]?.message || 'Invalid product data' });
        return;
      }
      req.body.categoryId = parsedPayload.data.categoryId;
      const product = await productService.createProduct(req);
      res.status(201).json(product);
    } catch (error) {
      console.error('[ProductController] Create error:', error);
      sendErrorFrom(res, error, 'Failed to create product');
    }
  }

  /** PUT /api/products/:id — Update product with strict ID checks */
  async update(req: Request, res: Response): Promise<void> {
    try {
      const userRole = String((req as any).user?.role || '').toUpperCase();
      if (userRole === 'REP') {
        res.status(403).json({ error: 'Forbidden: Representatives cannot modify products.' });
        return;
      }
      const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Valid positive integer product ID is required' });
        return;
      }
      if (req.body.categoryId !== undefined) {
        const parsedCat = categoryIdSchema.safeParse(req.body.categoryId);
        if (!parsedCat.success) {
          res.status(400).json({ error: 'A valid positive integer categoryId is required' });
          return;
        }
        req.body.categoryId = parsedCat.data;
      }
      // Ensure variant stock defaults to 0 if omitted or blank, allowing stock of 0
      if (req.body.variants) {
        try {
          const raw = typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;
          if (Array.isArray(raw)) {
            const normalized = raw.map((v: any) => ({
              ...v,
              stock: v.stock !== undefined && v.stock !== null && String(v.stock).trim() !== ''
                ? Math.max(0, parseInt(String(v.stock), 10) || 0)
                : 0,
            }));
            req.body.variants = typeof req.body.variants === 'string' ? JSON.stringify(normalized) : normalized;
          }
        } catch { /* proceed to service parser */ }
      }
      const product = await productService.updateProduct(id, req);
      res.json(product);
    } catch (error) {
      console.error('[ProductController] Error updating product:', error);
      sendErrorFrom(res, error, 'Failed to update product');
    }
  }

  /** DELETE /api/products/:productId/images/:imageId — Delete image with param validation */
  async deleteImage(req: Request, res: Response): Promise<void> {
    try {
      const userRole = String((req as any).user?.role || '').toUpperCase();
      if (userRole === 'REP') {
        res.status(403).json({ error: 'Forbidden: Representatives cannot delete product images.' });
        return;
      }
      const productId = Number(Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId);
      const imageId = Number(Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId);
      if (!productId || isNaN(productId) || productId <= 0 || !imageId || isNaN(imageId) || imageId <= 0) {
        res.status(400).json({ error: 'Valid positive integer product ID and image ID are required' });
        return;
      }
      const result = await productService.deleteProductImage(productId, imageId);
      res.json(result);
    } catch (error) {
      console.error('[ProductController] Error deleting product image:', error);
      sendErrorFrom(res, error, 'Failed to delete image');
    }
  }

  /** DELETE /api/products/:id — Delete or archive product safely */
  async remove(req: Request, res: Response): Promise<void> {
    try {
      const userRole = String((req as any).user?.role || '').toUpperCase();
      if (userRole === 'REP') {
        res.status(403).json({ error: 'Forbidden: Representatives cannot delete products.' });
        return;
      }
      const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Valid positive integer product ID is required' });
        return;
      }
      const result = await productService.deleteProduct(id);
      res.json(result);
    } catch (error) {
      console.error('[ProductController] Error deleting product:', error);
      sendErrorFrom(res, error, 'Failed to delete product');
    }
  }
}

export default new ProductController();