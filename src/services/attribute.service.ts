import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';

export class AttributeService {
  /**
   * Fetch all categories with linked product count
   */
  async getCategories() {
    return prisma.category.findMany({
      orderBy: { id: 'asc' },
      include: {
        _count: {
          select: { products: true }
        }
      }
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
   * Retrieve all standardized garment sizes
   */
  async getSizes() {
    return prisma.size.findMany({ orderBy: { order: 'asc' } });
  }

  async createSize(name: string, order = 0) {
    const clean = name.trim().toUpperCase();
    if (!clean) throw new HttpException(400, 'Size name is required');
    return prisma.size.create({ data: { name: clean, order: Number(order) || 0 } });
  }

  async deleteSize(id: number) {
    return prisma.size.delete({ where: { id: Number(id) } });
  }

  async getColors() {
    return prisma.color.findMany({ orderBy: { name: 'asc' } });
  }

  async createColor(name: string, hexCode?: string) {
    const clean = name.trim();
    if (!clean) throw new HttpException(400, 'Color name is required');
    return prisma.color.create({ data: { name: clean, hexCode: hexCode?.trim() || null } });
  }

  async deleteColor(id: number) {
    return prisma.color.delete({ where: { id: Number(id) } });
  }
}

export const attributeService = new AttributeService();