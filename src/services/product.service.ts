import type { Request } from 'express';
import { prisma } from '../lib/prisma.ts';
import { deleteLocalFile } from '../utils/fileHandler.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { sanitizeSafePrice, sanitizeSafeStock, validateProductPayload, sanitizeMultiValue } from '../utils/validators.ts';
import { normalizeImageUrl } from '../utils/imageUrl.ts';


const productInclude = {
  category: true,
  variants: {
    orderBy: { id: 'asc' as const },
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
    select: {
      id: true,
      imageUrl: true,
      order: true,
      variantId: true,
      isWebImage: true,
      tag: true,
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
          if (typeof u === 'string' && u.trim()) {
            const normalized = normalizeImageUrl(u.trim());
            if (!seen.has(normalized)) {
              seen.add(normalized);
              result.push({ imageUrl: normalized, order: result.length });
            }
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
    // ⭐ Only fetch active products (hide soft-deleted/archived ones)
    const where: any = {
      isActive: true,
    };

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

    // Enforce hard limit to prevent memory exhaustion and database pool saturation
    return prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
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

    // Strict Server-side Input Validation
    const validation = validateProductPayload(name, categoryId);
    if (!validation.isValid) {
      throw new HttpException(400, validation.message || 'Invalid product data');
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
          // Sanitize variant pricing, ensure non-negative numeric constraints
          create: parsedVariants.map((v) => {
            const cleanBarcode = v.barcode && typeof v.barcode === 'string' && v.barcode.trim() !== '' ? v.barcode.trim() : null;
            const retailPrice = Math.max(0, Number(v.retailPrice) || 0);
            const wholesalePrice = Math.max(0, Number(v.wholesalePrice) || 0);
            const costPrice = Math.max(0, Number(v.costPrice) || 0);
            const comparePrice = v.comparePrice ? Math.max(0, Number(v.comparePrice)) : null;
            const stock = sanitizeSafeStock(v.stock);

            return {
              size: sanitizeMultiValue(v.size),
              color: sanitizeMultiValue(v.color),
              sku: v.sku?.trim() ? String(v.sku).trim().slice(0, 100) : `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              barcode: cleanBarcode ? cleanBarcode.slice(0, 100) : null,
              costPrice,
              retailPrice,
              wholesalePrice,
              comparePrice,
              stock,
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
                isWebImage: true,
                tag: 'WEB',
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
        const normalized = normalizeImageUrl(url);
        const found = savedImages.find(img => img.imageUrl === url || img.imageUrl === normalized);
        if (found) targetImageIds.add(found.id);
      });

      // Update all matched images to belong to this variant
      if (targetImageIds.size > 0) {
        await prisma.productImage.updateMany({
          where: { id: { in: Array.from(targetImageIds) } },
          data: { variantId: createdVariant.id, isWebImage: false, tag: 'VARIANT' },
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

    // Strict Server-side Input Validation on Update
    if (name !== undefined || categoryId !== undefined) {
      const validation = validateProductPayload(
        name !== undefined ? name : existing.name,
        categoryId !== undefined ? categoryId : existing.categoryId
      );
      if (!validation.isValid) {
        throw new HttpException(400, validation.message || 'Invalid update data');
      }
    }

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
      // 1. Rebuild / Synchronize WEB catalog images (without wiping variant images)
      if (incomingImages) {
        const incomingWebUrls = incomingImages.map((i) => normalizeImageUrl(i.imageUrl));
        const incomingSet = new Set(incomingWebUrls);

        // Delete only unassigned/web images that are no longer in incomingImages
        // Crucial: do not touch variant images (where variantId !== null and isWebImage is false)
        const webImagesToDelete = await tx.productImage.findMany({
          where: {
            productId: id,
            OR: [
              { variantId: null },
              { isWebImage: true },
            ],
            imageUrl: { notIn: Array.from(incomingSet) },
          },
        });

        for (const img of webImagesToDelete) {
          if (img.imageUrl && !img.imageUrl.startsWith('http')) {
            const usageCount = await tx.productImage.count({
              where: { imageUrl: img.imageUrl, id: { not: img.id } },
            });
            if (usageCount === 0) {
              deleteLocalFile(img.imageUrl);
            }
          }
        }

        await tx.productImage.deleteMany({
          where: {
            id: { in: webImagesToDelete.map((img) => img.id) },
          },
        });

        // Upsert incoming WEB catalog images
        for (let i = 0; i < incomingImages.length; i++) {
          const img = incomingImages[i];
          const cleanUrl = normalizeImageUrl(img.imageUrl);

          const existingWeb = await tx.productImage.findFirst({
            where: {
              productId: id,
              variantId: null,
              imageUrl: cleanUrl,
            },
          });

          if (existingWeb) {
            await tx.productImage.update({
              where: { id: existingWeb.id },
              data: {
                order: i,
                isWebImage: true,
                tag: 'WEB',
              },
            });
          } else {
            await tx.productImage.create({
              data: {
                productId: id,
                imageUrl: cleanUrl,
                order: i,
                variantId: null,
                isWebImage: true,
                tag: 'WEB',
              },
            });
          }
        }
      }

      // 2. Safe Variant Synchronizer (Preserves Order History & Prevents Constraint Violations)
      if (variants !== undefined && parsedVariants.length > 0) {
        const retainedIds = new Set<number>();

        for (const v of parsedVariants) {
          const cleanBarcode =
            v.barcode && typeof v.barcode === 'string' && v.barcode.trim() !== '' ? v.barcode.trim() : null;

          const variantData = {
            size: sanitizeMultiValue(v.size),
            color: sanitizeMultiValue(v.color),
            sku: v.sku?.trim() || `SKU-${id}-${Date.now().toString().slice(-4)}`,
            barcode: cleanBarcode,
            costPrice: sanitizeSafePrice(v.costPrice),
            retailPrice: sanitizeSafePrice(v.retailPrice),
            wholesalePrice: sanitizeSafePrice(v.wholesalePrice),
            comparePrice: v.comparePrice ? sanitizeSafePrice(v.comparePrice) : null,
            stock: sanitizeSafeStock(v.stock),
          };

          let resolvedVariantId: number;
          if (v.id && !isNaN(Number(v.id))) {
            const updated = await tx.productVariant.update({
              where: { id: Number(v.id) },
              data: variantData,
            });
            resolvedVariantId = updated.id;
          } else {
            const created = await tx.productVariant.create({
              data: {
                ...variantData,
                productId: id,
              },
            });
            resolvedVariantId = created.id;
          }

          retainedIds.add(resolvedVariantId);

          // Synchronize variant images strictly for this variant ID without duplicating as WEB images
          const urlsToCheck = Array.isArray(v.imageUrls) 
            ? v.imageUrls 
            : v.imageUrl 
            ? [v.imageUrl] 
            : [];
          const normalizedVariantUrls = urlsToCheck
            .map((u) => (u ? normalizeImageUrl(String(u).trim()) : ''))
            .filter(Boolean);

          // Detach/delete obsolete images for this specific variant
          await tx.productImage.deleteMany({
            where: {
              productId: id,
              variantId: resolvedVariantId,
              imageUrl: { notIn: normalizedVariantUrls },
            },
          });

          // Ensure every variant image exists strictly for this variant
          for (let uIdx = 0; uIdx < normalizedVariantUrls.length; uIdx++) {
            const cleanTarget = normalizedVariantUrls[uIdx];

            const alreadyLinked = await tx.productImage.findFirst({
              where: {
                productId: id,
                variantId: resolvedVariantId,
                imageUrl: cleanTarget,
              },
            });

            if (!alreadyLinked) {
              await tx.productImage.create({
                data: {
                  productId: id,
                  imageUrl: cleanTarget,
                  variantId: resolvedVariantId,
                  isWebImage: false,
                  tag: 'VARIANT',
                  order: uIdx,
                },
              });
            }
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
  
  /**
   * Dedicated Product & Variant Image Upload
   * Handles WEB catalog images and variant-specific image uploads safely.
   * Guarantees a variant image upload ONLY creates a single database record associated strictly with that variant ID.
   * Prevents race conditions, unique constraint violations, and unhandled rejections that trigger 500 errors.
   */
  async uploadProductImage(params: {
    productId: number;
    variantId?: number | null;
    isWebImage?: boolean;
    tag?: string;
    req: Request;
  }) {
    const { productId, variantId, isWebImage, tag, req } = params;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new HttpException(404, `Product #${productId} not found`);
    }

    let verifiedVariantId: number | null = null;
    if (variantId && !isWebImage) {
      const variant = await prisma.productVariant.findFirst({
        where: { id: variantId, productId },
        select: { id: true },
      });
      if (!variant) {
        throw new HttpException(404, `Variant #${variantId} not found for product #${productId}`);
      }
      verifiedVariantId = variant.id;
    }

    const collected: { imageUrl: string; order: number }[] = [];
    const seen = new Set<string>();

    const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    if (Array.isArray(files)) {
      for (const f of files) {
        const url = '/uploads/products/' + f.filename;
        if (!seen.has(url)) {
          seen.add(url);
          collected.push({ imageUrl: url, order: collected.length });
        }
      }
    }

    if (req.body.imageUrl && typeof req.body.imageUrl === 'string' && req.body.imageUrl.trim()) {
      const normalized = normalizeImageUrl(req.body.imageUrl.trim());
      if (!seen.has(normalized)) {
        seen.add(normalized);
        collected.push({ imageUrl: normalized, order: collected.length });
      }
    }

    if (req.body.imageUrls) {
      try {
        const urls = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
        if (Array.isArray(urls)) {
          for (const u of urls) {
            if (typeof u === 'string' && u.trim()) {
              const normalized = normalizeImageUrl(u.trim());
              if (!seen.has(normalized)) {
                seen.add(normalized);
                collected.push({ imageUrl: normalized, order: collected.length });
              }
            }
          }
        }
      } catch { /* ignore malformed JSON */ }
    }

    if (collected.length === 0) {
      throw new HttpException(400, 'No image file or URL was provided');
    }

    const createdImages: any[] = [];
    try {
      const isWeb = verifiedVariantId === null || isWebImage === true;
      const finalVariantId = isWeb ? null : verifiedVariantId;
      const finalTag = isWeb ? 'WEB' : (tag || 'VARIANT');

      const maxOrderResult = await prisma.productImage.aggregate({
        where: { productId },
        _max: { order: true },
      });
      let nextOrder = (maxOrderResult._max.order ?? -1) + 1;

      for (const item of collected) {
        const cleanUrl = normalizeImageUrl(item.imageUrl);

        // Check if an identical record already exists for this scope to prevent duplicate constraint violation
        const existing = await prisma.productImage.findFirst({
          where: {
            productId,
            variantId: finalVariantId,
            imageUrl: cleanUrl,
          },
        });

        if (existing) {
          createdImages.push(existing);
          continue;
        }

        // CRITICAL: Variant image upload ONLY creates a single database record associated strictly with that specific variant ID.
        // No auto-duplication as a 'WEB' record!
        const record = await prisma.productImage.create({
          data: {
            productId,
            variantId: finalVariantId,
            imageUrl: cleanUrl,
            order: nextOrder++,
            isWebImage: isWeb,
            tag: finalTag,
          },
          select: {
            id: true,
            productId: true,
            variantId: true,
            imageUrl: true,
            order: true,
            isWebImage: true,
            tag: true,
            createdAt: true,
          },
        });
        createdImages.push(record);
      }
    } catch (err: any) {
      console.error('[ProductService] Error saving uploaded image records:', err);
      for (const item of collected) {
        if (item.imageUrl.startsWith('/uploads/')) {
          deleteLocalFile(item.imageUrl);
        }
      }
      throw new HttpException(500, err?.message || 'Failed to save uploaded image record');
    }

    return {
      success: true,
      scope: verifiedVariantId ? 'VARIANT' : 'WEB',
      variantId: verifiedVariantId,
      images: createdImages,
      image: createdImages[0] || null,
      imageUrl: createdImages[0]?.imageUrl || null,
    };
  }

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
   * Delete Product & local assets with integrity checks for order items
   */
  /**
   * ⭐ Enterprise Safe Product Delete:
   * If orders exist, archive product (isActive: false) to preserve sales records.
   * If unused, completely remove it and its local images.
   */
  async deleteProduct(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid product ID');

    const existing = await prisma.product.findUnique({
      where: { id },
      include: {
        images: true,
        variants: {
          select: { id: true },
        },
      },
    });
    if (!existing) throw new HttpException(404, 'Product not found');

    const variantIds = existing.variants.map((v) => v.id);
    let orderCount = 0;
    if (variantIds.length > 0) {
      orderCount = await prisma.orderItem.count({
        where: { variantId: { in: variantIds } },
      });
    }

    // Orders තිබේ නම් Error විසිකිරීම වෙනුවට Soft-Delete (Archive) කිරීම
    if (orderCount > 0) {
      await prisma.product.update({
        where: { id },
        data: { isActive: false },
      });
      return { success: true, message: 'Product archived and hidden from catalog successfully.' };
    }

    // Orders නැති අලුත් product එකක් නම් සම්පූර්ණයෙන්ම delete කිරීම
    for (const img of existing.images) {
      if (img.imageUrl && !img.imageUrl.startsWith('http')) deleteLocalFile(img.imageUrl);
    }

    await prisma.product.delete({ where: { id } });
    return { success: true, message: 'Product permanently deleted successfully.' };
  }
}

export default new ProductService();