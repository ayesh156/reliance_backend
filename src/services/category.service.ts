import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';

export class CategoryService {
  async getAllCategories() {
    return prisma.category.findMany({
      orderBy: { id: 'asc' },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
  }

  async createCategory(data: { name: string; description?: string; image?: string; status?: string }) {
    const cleanName = data.name.trim();
    if (!cleanName) {
      throw new HttpException(400, 'Category name is required');
    }

    // Generate SEO friendly unique slug
    const slug = cleanName
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const existing = await prisma.category.findFirst({
      where: {
        OR: [{ name: cleanName }, { slug }]
      }
    });

    if (existing) {
      throw new HttpException(409, 'A category with this name or slug already exists');
    }

    return prisma.category.create({
      data: {
        name: cleanName,
        slug,
        description: data.description?.trim() || null,
        image: data.image || null,
        status: data.status || 'active',
      }
    });
  }
}

export const categoryService = new CategoryService();