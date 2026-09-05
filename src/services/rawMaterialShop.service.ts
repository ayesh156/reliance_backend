import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';
import { isValidSriLankanPhone } from '../utils/validators';

export interface CreateShopInput {
  name: string;
  phone?: string;
  address?: string;
  contactPerson?: string;
}

/**
 * Service class handling database operations for Raw Material Supplier Shops.
 */
export class RawMaterialShopService {
  /**
   * Fetch all raw material supplier shops with optional keyword search.
   * Matches against name, contactPerson, phone, and address.
   */
  async getAll(search?: string) {
    const where: any = {};
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q } },
        { contactPerson: { contains: q } },
        { phone: { contains: q } },
        { address: { contains: q } },
      ];
    }

    return prisma.rawMaterialShop.findMany({
      where,
      include: {
        _count: {
          select: { purchases: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fetch a single raw material supplier shop by ID with recent purchase history.
   */
  async getById(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid shop ID');

    const shop = await prisma.rawMaterialShop.findUnique({
      where: { id },
      include: {
        purchases: {
          orderBy: { purchaseDate: 'desc' },
          take: 50,
        },
        _count: {
          select: { purchases: true },
        },
      },
    });

    if (!shop) throw new HttpException(404, 'Raw material shop not found');
    return shop;
  }

  /**
   * Create a new raw material supplier shop record.
   */
  async create(data: CreateShopInput) {
    if (!data.name || !data.name.trim()) {
      throw new HttpException(400, 'Shop name is required');
    }

    // Validate Sri Lankan Phone Number if provided
    if (data.phone && data.phone.trim() && !isValidSriLankanPhone(data.phone.trim())) {
      throw new HttpException(400, 'Invalid Sri Lankan phone number format');
    }

    return prisma.rawMaterialShop.create({
      data: {
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
        contactPerson: data.contactPerson?.trim() || null,
      },
    });
  }

  /**
   * Update an existing raw material supplier shop record.
   */
  async update(id: number, data: Partial<CreateShopInput>) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid shop ID');

    const existing = await prisma.rawMaterialShop.findUnique({ where: { id } });
    if (!existing) throw new HttpException(404, 'Raw material shop not found');

    // Validate Sri Lankan Phone Number if provided in update payload
    if (data.phone && data.phone.trim() && !isValidSriLankanPhone(data.phone.trim())) {
      throw new HttpException(400, 'Invalid Sri Lankan phone number format');
    }

    return prisma.rawMaterialShop.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name.trim() : existing.name,
        phone: data.phone !== undefined ? (data.phone?.trim() || null) : existing.phone,
        address: data.address !== undefined ? (data.address?.trim() || null) : existing.address,
        contactPerson: data.contactPerson !== undefined ? (data.contactPerson?.trim() || null) : existing.contactPerson,
      },
    });
  }

  /**
   * Delete a raw material supplier shop record.
   * Ensures suppliers with associated purchase records cannot be accidentally deleted.
   */
  async delete(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid shop ID');

    const purchaseCount = await prisma.buyRawMaterial.count({
      where: { rawMaterialShopId: id },
    });

    if (purchaseCount > 0) {
      throw new HttpException(
        400,
        `Cannot delete shop. It is associated with ${purchaseCount} purchase order(s).`
      );
    }

    return prisma.rawMaterialShop.delete({ where: { id } });
  }
}

export default new RawMaterialShopService();