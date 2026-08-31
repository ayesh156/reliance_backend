import { Request, Response } from 'express';
import productService from '../services/product.service';
import { sendErrorFrom, sendNoContent } from '../utils/response';

export class ProductController {
  /** GET /api/products — Fetch with search & Category filter */
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
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
      const product = await productService.createProduct(req);
      res.status(201).json(product);
    } catch (error) {
      console.error('[ProductController] Create error:', error);
      sendErrorFrom(res, error, 'Failed to create product');
    }
  }

  /** PUT /api/products/:id — Update product */
  async update(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const product = await productService.updateProduct(id, req);
      res.json(product);
    } catch (error) {
      console.error('[ProductController] Error updating product:', error);
      sendErrorFrom(res, error, 'Failed to update product');
    }
  }

  /** DELETE /api/products/:productId/images/:imageId — Delete image */
  async deleteImage(req: Request, res: Response): Promise<void> {
    try {
      const productId = Number(Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId);
      const imageId = Number(Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId);
      const result = await productService.deleteProductImage(productId, imageId);
      res.json(result);
    } catch (error) {
      console.error('[ProductController] Error deleting product image:', error);
      sendErrorFrom(res, error, 'Failed to delete image');
    }
  }

  /** DELETE /api/products/:id — Delete product */
  async remove(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      await productService.deleteProduct(id);
      sendNoContent(res);
    } catch (error) {
      console.error('[ProductController] Error deleting product:', error);
      sendErrorFrom(res, error, 'Failed to delete product');
    }
  }
}

export default new ProductController();