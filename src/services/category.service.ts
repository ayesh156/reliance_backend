import { prisma } from '../lib/prisma';

export class CategoryService {
  /**
   * Fetch all categories with product counts.
   */
  async getAllCategories() {
    return prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { id: 'asc' },
    });
  }
}

export default new CategoryService();