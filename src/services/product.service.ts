import { Request } from 'express';
import { prisma } from '../lib/prisma';
import { deleteLocalFile } from '../utils/fileHandler';
import { HttpException } from '../middleware/error.middleware';

const productInclude = {
  category: true,
  variants: {
    include: {
      images: { select: { id: true, imageUrl: true }, take: 1 },
    },
  },
  reviews: {
    include: {
      images: true,
    },
  },
  images: {
    orderBy: {
      order: 'asc' as const,
    },
  },
} as const;

/**
 * Express Payload Inputs for Variant and Review Processing
 */
interface VariantInput {
  id?: number;
  size?: string;
  color?: string;
  sku: string;
  barcode?: string;
  costPrice?: number;
  retailPrice: number;
  wholesalePrice: number;
  comparePrice?: number;
  stock?: number;
  imageUrl?: string;
  imageUrls?: string[];
  imageIndex?: number | null;
  imageIndexes?: number[];
}

interface ReviewInput {
  reviewerName: string;
  reviewerPhoto?: string;
  description?: string;
  rating?: number;
}

function collectImages(req: Request): { imageUrl: string; order: number }[] {
  const result: { imageUrl: string; order: number }[] = [];
  const seen = new Set<string>();

  // 1. Existing image URLs
  if (req.body.imageUrls) {
    try {
      const urls: unknown = typeof req.body.imageUrls === 'string'
        ? JSON.parse(req.body.imageUrls)
        : req.body.imageUrls;
      if (Array.isArray(urls)) {
        for (const u of urls) {
          if (typeof u === 'string' && u.trim() && !seen.has(u)) {
            seen.add(u);
            result.push({ imageUrl: u, order: result.length });
          }
        }
      }
    } catch { /* malformed JSON */ }
  }

  // 2. Uploaded files
  const files = req.files as Express.Multer.File[] | undefined;
  if (files && Array.isArray(files)) {
    for (const f of files) {
      const url = '/uploads/products/' + f.filename;
      if (!seen.has(url)) {
        seen.add(url);
        result.push({ imageUrl: url, order: result.length });
      }
    }
  }

  result.forEach((r, i) => { r.order = i; });
  return result;
}

export class ProductService {
  /**
   * Fetch all products with Fast POS search (ID, Name, SearchKey, SKU, Barcode) & Category filter
   */
  async getAllProducts(searchTerm?: string, categoryId?: number) {
    const where: any = {};

    if (categoryId && !isNaN(categoryId)) {
      where.categoryId = categoryId;
    }

    if (searchTerm && searchTerm.trim()) {
      const query = searchTerm.trim();
      const isNumeric = /^\d+$/.test(query);

      where.OR = [
        ...(isNumeric ? [{ id: parseInt(query, 10) }] : []),
        { name: { contains: query } },
        { searchKey: { contains: query } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: query } },
                { barcode: { contains: query } },
              ],
            },
          },
        },
      ];
    }

    return prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fetch single product by ID or Slug
   */
  async getProductById(idOrSlug: string | number) {
    const isId = typeof idOrSlug === 'number' || /^\d+$/.test(idOrSlug.toString());

    const product = isId
      ? await prisma.product.findUnique({
          where: { id: Number(idOrSlug) },
          include: productInclude,
        })
      : await prisma.product.findUnique({
          where: { slug: idOrSlug.toString() },
          include: productInclude,
        });

    if (!product) throw new HttpException(404, 'Product not found');
    return product;
  }

  /**
   * Create Product with Multi-price Variants, Images and SEO Slug
   */
  async createProduct(req: Request) {
    const { name, description, categoryId, searchKey, isFeatured, variants, reviews } = req.body;

    if (!name || !categoryId) {
      throw new HttpException(400, 'Product name and categoryId are required');
    }

    let parsedVariants: VariantInput[] = [];
    try {
      parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : (variants ?? []);
    } catch {
      parsedVariants = [];
    }

    if (!parsedVariants.length) {
      throw new HttpException(400, 'At least one product variant with retail & wholesale pricing is required');
    }

    let parsedReviews: ReviewInput[] = [];
    try {
      parsedReviews = typeof reviews === 'string' ? JSON.parse(reviews) : (reviews ?? []);
    } catch {
      parsedReviews = [];
    }

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
    const incomingImages = collectImages(req);

    /**
     * Create product record and associate uploaded gallery images to corresponding variants
     */
    const createdProduct = await prisma.product.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        searchKey: searchKey?.trim() || null,
        isFeatured: isFeatured === 'true' || isFeatured === true,
        categoryId: Number(categoryId),
        variants: {
          create: parsedVariants.map((v) => {
            const cleanBarcode = v.barcode && typeof v.barcode === 'string' && v.barcode.trim() !== '' ? v.barcode.trim() : null;
            return {
              size: v.size?.trim() || null,
              color: v.color?.trim() || null,
              sku: v.sku?.trim() || `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              barcode: cleanBarcode,
              costPrice: Number(v.costPrice) || 0,
              retailPrice: Number(v.retailPrice) || 0,
              wholesalePrice: Number(v.wholesalePrice) || 0,
              comparePrice: v.comparePrice ? Number(v.comparePrice) : null,
              stock: Number(v.stock) || 0,
            };
          }),
        },
        reviews: parsedReviews.length > 0
          ? {
              create: parsedReviews.map((r) => ({
                reviewerName: r.reviewerName || 'Anonymous',
                reviewerPhoto: r.reviewerPhoto || null,
                description: r.description || null,
                rating: Number(r.rating) || 5,
              })),
            }
          : undefined,
        images: incomingImages.length > 0
          ? {
              create: incomingImages.map((img) => ({
                imageUrl: img.imageUrl,
                order: img.order,
              })),
            }
          : undefined,
      },
      include: productInclude,
    });

    /**
     * Accurately link newly uploaded product images to specific variant entities via index or URL
     */
    /**
     * Accurately link uploaded product images to specific variant entities
     * Supports multiple images per variant via indexes and URLs
     */
    const savedImages = await prisma.productImage.findMany({
      where: { productId: createdProduct.id },
      orderBy: { order: 'asc' },
    });

    for (let i = 0; i < parsedVariants.length; i++) {
      const v = parsedVariants[i];
      const createdVariant = createdProduct.variants[i];
      if (!createdVariant) continue;

      const targetImageIds = new Set<number>();

      // 1. Check array of imageIndexes
      if (Array.isArray(v.imageIndexes)) {
        v.imageIndexes.forEach(idx => {
          if (savedImages[idx]) targetImageIds.add(savedImages[idx].id);
        });
      }

      // 2. Check legacy single imageIndex
      if (v.imageIndex !== undefined && v.imageIndex !== null && savedImages[v.imageIndex]) {
        targetImageIds.add(savedImages[v.imageIndex].id);
      }

      // 3. Check array of imageUrls or single imageUrl
      const urlsToCheck = Array.isArray(v.imageUrls) ? v.imageUrls : v.imageUrl ? [v.imageUrl] : [];
      urlsToCheck.forEach(url => {
        const found = savedImages.find(img => img.imageUrl === url);
        if (found) targetImageIds.add(found.id);
      });

      // Update all matched images to belong to this variant
      if (targetImageIds.size > 0) {
        await prisma.productImage.updateMany({
          where: { id: { in: Array.from(targetImageIds) } },
          data: { variantId: createdVariant.id },
        });
      }
    }

    return createdProduct;
  }

  /**
   * Atomic Update for Product, Multi-price Variants, Reviews & Images
   */
  async updateProduct(id: number, req: Request) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid product ID');

    const existing = await prisma.product.findUnique({
      where: { id },
      include: { images: true, variants: true },
    });
    if (!existing) throw new HttpException(404, 'Product not found');

    const { name, description, categoryId, searchKey, isFeatured, variants, reviews } = req.body;

    let parsedVariants: VariantInput[] = [];
    if (variants !== undefined) {
      try {
        parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
      } catch {
        parsedVariants = [];
      }
    }

    let parsedReviews: ReviewInput[] = [];
    if (reviews !== undefined) {
      try {
        parsedReviews = typeof reviews === 'string' ? JSON.parse(reviews) : reviews;
      } catch {
        parsedReviews = [];
      }
    }

    const hasImageUpdate = req.body.imageUrls !== undefined || (req.files && (req.files as Express.Multer.File[]).length > 0);
    const incomingImages = hasImageUpdate ? collectImages(req) : null;

    if (incomingImages) {
      const incomingSet = new Set(incomingImages.map((i) => i.imageUrl));
      for (const img of existing.images) {
        if (img.imageUrl && !incomingSet.has(img.imageUrl) && !img.imageUrl.startsWith('http')) {
          deleteLocalFile(img.imageUrl);
        }
      }
    }

    return prisma.$transaction(async (tx) => {
      // 1. Rebuild Images if provided
      if (incomingImages) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (incomingImages.length > 0) {
          await tx.productImage.createMany({
            data: incomingImages.map((img) => ({ productId: id, imageUrl: img.imageUrl, order: img.order })),
          });
        }
      }

      // 2. Safe Variant Synchronizer (Preserves Order History & Prevents Constraint Violations)
      if (variants !== undefined && parsedVariants.length > 0) {
        const retainedIds = new Set<number>();

        // Query active images for this product inside transaction after image step
        const currentImages = await tx.productImage.findMany({
          where: { productId: id },
          orderBy: { order: 'asc' },
        });

        // Reset stale variant mappings to allow fresh assignment
        await tx.productImage.updateMany({
          where: { productId: id },
          data: { variantId: null },
        });

        for (const v of parsedVariants) {
          const cleanBarcode =
            v.barcode && typeof v.barcode === 'string' && v.barcode.trim() !== '' ? v.barcode.trim() : null;

          const variantData = {
            size: v.size?.trim() || null,
            color: v.color?.trim() || null,
            sku: v.sku?.trim() || `SKU-${id}-${Date.now().toString().slice(-4)}`,
            barcode: cleanBarcode,
            costPrice: Number(v.costPrice) || 0,
            retailPrice: Number(v.retailPrice) || 0,
            wholesalePrice: Number(v.wholesalePrice) || 0,
            comparePrice: v.comparePrice ? Number(v.comparePrice) : null,
            stock: Number(v.stock) || 0,
          };

          let resolvedVariantId: number;
          if (v.id && !isNaN(Number(v.id))) {
            // Update existing variant (preserves sales history)
            const updated = await tx.productVariant.update({
              where: { id: Number(v.id) },
              data: variantData,
            });
            resolvedVariantId = updated.id;
          } else {
            // Insert newly appended variant row
            const created = await tx.productVariant.create({
              data: {
                ...variantData,
                productId: id,
              },
            });
            resolvedVariantId = created.id;
          }

          retainedIds.add(resolvedVariantId);

          // Map all matched catalog images to this variant via index or URL match
          const matchedImageIds = new Set<number>();

          if (Array.isArray(v.imageIndexes)) {
            v.imageIndexes.forEach(idx => {
              if (currentImages[idx]) matchedImageIds.add(currentImages[idx].id);
            });
          }
          if (v.imageIndex !== undefined && v.imageIndex !== null && currentImages[v.imageIndex]) {
            matchedImageIds.add(currentImages[v.imageIndex].id);
          }

          const urlsToCheck = Array.isArray(v.imageUrls) ? v.imageUrls : v.imageUrl ? [v.imageUrl] : [];
          urlsToCheck.forEach(url => {
            const found = currentImages.find(img => img.imageUrl === url);
            if (found) matchedImageIds.add(found.id);
          });

          if (matchedImageIds.size > 0) {
            await tx.productImage.updateMany({
              where: { id: { in: Array.from(matchedImageIds) } },
              data: { variantId: resolvedVariantId },
            });
          }
        }

        // Safely prune removed variants ONLY if they have never been sold in POS orders
        const variantsToDelete = existing.variants.filter(ev => !retainedIds.has(ev.id));
        for (const vt of variantsToDelete) {
          const soldCount = await tx.orderItem.count({
            where: { variantId: vt.id },
          });

          if (soldCount === 0) {
            await tx.productVariant.delete({ where: { id: vt.id } });
          } else {
            // If historical orders exist, keep the record intact and set stock to 0 to prevent orphaned order items
            await tx.productVariant.update({
              where: { id: vt.id },
              data: { stock: 0 },
            });
          }
        }
      }

      // 3. Rebuild Reviews if provided
      if (reviews !== undefined) {
        await tx.review.deleteMany({ where: { productId: id } });
        if (parsedReviews.length > 0) {
          await tx.review.createMany({
            data: parsedReviews.map((r) => ({
              productId: id,
              reviewerName: r.reviewerName || 'Anonymous',
              reviewerPhoto: r.reviewerPhoto || null,
              description: r.description || null,
              rating: Number(r.rating) || 5,
            })),
          });
        }
      }

      // 4. Update Product base fields
      return tx.product.update({
        where: { id },
        data: {
          name: name !== undefined ? name.trim() : existing.name,
          description: description !== undefined ? description?.trim() || null : existing.description,
          searchKey: searchKey !== undefined ? searchKey?.trim() || null : existing.searchKey,
          isFeatured: isFeatured !== undefined ? (isFeatured === 'true' || isFeatured === true) : existing.isFeatured,
          categoryId: categoryId !== undefined ? Number(categoryId) : existing.categoryId,
        },
        include: productInclude,
      });
    });
  }

  /**
   * Delete image asset
   */
  async deleteProductImage(productId: number, imageId: number) {
    if (isNaN(productId) || isNaN(imageId)) throw new HttpException(400, 'Invalid IDs');

    const image = await prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== productId) throw new HttpException(404, 'Image not found');

    if (image.imageUrl && !image.imageUrl.startsWith('http')) deleteLocalFile(image.imageUrl);
    await prisma.productImage.delete({ where: { id: imageId } });

    const remaining = await prisma.productImage.findMany({ where: { productId }, orderBy: { order: 'asc' } });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i) {
        await prisma.productImage.update({ where: { id: remaining[i].id }, data: { order: i } });
      }
    }

    return { success: true };
  }

  /**
   * Delete Product & local assets
   */
  async deleteProduct(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid product ID');

    const existing = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!existing) throw new HttpException(404, 'Product not found');

    for (const img of existing.images) {
      if (img.imageUrl && !img.imageUrl.startsWith('http')) deleteLocalFile(img.imageUrl);
    }

    await prisma.product.delete({ where: { id } });
  }
}

export default new ProductService();