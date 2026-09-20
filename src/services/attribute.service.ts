import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';

export class AttributeService {
/**
   * Fetch all categories with explicit projection and connection pool limit
   */
  async getCategories() {
    return prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: {
          select: { products: true }
        }
      },
      orderBy: { id: 'asc' },
      take: 200,
    });
  }

  /**
   * Create a new category with auto-generated slug
   */
  async createCategory(data: { name: string; description?: string }) {
    const cleanName = data.name.trim();
    if (!cleanName) throw new HttpException(400, 'Category name is required');

    const slug = cleanName
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const existing = await prisma.category.findFirst({
      where: { OR: [{ name: cleanName }, { slug }] }
    });
    if (existing) throw new HttpException(409, 'A category with this name or slug already exists');

    return prisma.category.create({
      data: {
        name: cleanName,
        slug,
        description: data.description?.trim() || null,
      }
    });
  }

  /**
   * Safely delete a category if not linked to active catalog products
   */
  async deleteCategory(id: number) {
    const category = await prisma.category.findUnique({
      where: { id: Number(id) },
      include: { products: { select: { id: true }, take: 1 } }
    });

    if (!category) throw new HttpException(404, 'Category not found');
    if (category.products.length > 0) {
      throw new HttpException(400, 'Cannot delete category assigned to existing products');
    }

    return prisma.category.delete({ where: { id: Number(id) } });
  }

  /**
   * Fetch all standardized sizes with lightweight projection
   */
  async getSizes() {
    return prisma.size.findMany({
      select: { id: true, name: true, order: true },
      orderBy: { order: 'asc' },
      take: 200,
    });
  }

  /**
   * Create standard size preventing duplicate values and length overflow
   */
  async createSize(name: string, order = 0) {
    const clean = name.trim().toUpperCase();
    if (!clean) throw new HttpException(400, 'Size name is required');
    if (clean.length > 20) throw new HttpException(400, 'Size name cannot exceed 20 characters');

    const existing = await prisma.size.findFirst({ where: { name: clean } });
    if (existing) throw new HttpException(409, 'Size with this name already exists');

    return prisma.size.create({ data: { name: clean, order: Number(order) || 0 } });
  }

  /**
   * Safely delete size preventing foreign key constraint violations
   */
  /**
   * Safely delete size ensuring no active product catalog variants are referencing it
   */
  async deleteSize(id: number) {
    const existing = await prisma.size.findUnique({
      where: { id: Number(id) },
      select: { id: true, name: true }
    });
    if (!existing) throw new HttpException(404, 'Size not found');

    // Prevent foreign key constraint failure by checking variant associations
    const variantUsage = await prisma.productVariant.findFirst({
      where: { size: existing.name },
      select: { id: true }
    });
    if (variantUsage) {
      throw new HttpException(400, 'Cannot delete size that is currently assigned to product variants');
    }

    return prisma.size.delete({ where: { id: Number(id) } });
  }

  /**
   * Fetch all color options with lightweight projection
   */
  async getColors() {
    return prisma.color.findMany({
      select: { id: true, name: true, hexCode: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  /**
   * Create color verifying hex color format, length overflow, and duplicates
   */
  async createColor(name: string, hexCode?: string) {
    const clean = name.trim();
    if (!clean) throw new HttpException(400, 'Color name is required');
    if (clean.length > 50) throw new HttpException(400, 'Color name cannot exceed 50 characters');

    let cleanHex: string | null = null;
    if (hexCode && hexCode.trim()) {
      cleanHex = hexCode.trim();
      const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexRegex.test(cleanHex)) {
        throw new HttpException(400, 'Invalid HEX color code format (e.g., #FFFFFF or #FFF)');
      }
    }

    const existing = await prisma.color.findFirst({ where: { name: clean } });
    if (existing) throw new HttpException(409, 'Color with this name already exists');

    return prisma.color.create({ data: { name: clean, hexCode: cleanHex } });
  }

  /**
   * Safely delete color preventing foreign key constraint violations
   */
  async deleteColor(id: number) {
    const existing = await prisma.color.findUnique({
      where: { id: Number(id) },
      select: { id: true, name: true }
    });
    if (!existing) throw new HttpException(404, 'Color not found');

    // Prevent foreign key constraint failure by checking variant associations
    const variantUsage = await prisma.productVariant.findFirst({
      where: { color: existing.name },
      select: { id: true }
    });
    if (variantUsage) {
      throw new HttpException(400, 'Cannot delete color that is currently assigned to product variants');
    }

    return prisma.color.delete({ where: { id: Number(id) } });
  }
}

export const attributeService = new AttributeService();