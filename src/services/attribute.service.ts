import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';

export class AttributeService {
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