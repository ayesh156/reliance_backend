import { Prisma, RawMaterialUnit } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';

export interface CreateRawMaterialItemDTO {
  name: string;
  code?: string | null;
  description?: string | null;
  unit?: RawMaterialUnit;
  currentStock?: number;
  alertThreshold?: number;
  unitCostAverage?: number;
}

export interface UpdateRawMaterialItemDTO {
  name?: string;
  code?: string | null;
  description?: string | null;
  unit?: RawMaterialUnit;
  currentStock?: number;
  alertThreshold?: number;
  unitCostAverage?: number;
}

export interface GetRawMaterialItemsFilter {
  search?: string;
  unit?: RawMaterialUnit;
  lowStockOnly?: boolean;
}

export class RawMaterialItemService {
  /**
   * Retrieve all raw material items with optional search and unit filters.
   */
  async getAll(filters: GetRawMaterialItemsFilter = {}) {
    const { search, unit, lowStockOnly } = filters;
    const where: Prisma.RawMaterialItemWhereInput = {};

    // Keyword search across Name, Code, and Description
    if (search && search.trim().length > 0) {
      const query = search.trim();
      where.OR = [
        { name: { contains: query } },
        { code: { contains: query } },
        { description: { contains: query } },
      ];
    }

    // Filter by measurement unit
    if (unit && Object.values(RawMaterialUnit).includes(unit)) {
      where.unit = unit;
    }

    const items = await prisma.rawMaterialItem.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { purchaseItems: true },
        },
      },
    });

    // In-memory filter for low stock threshold if requested
    if (lowStockOnly) {
      return items.filter((item) => item.currentStock <= item.alertThreshold);
    }

    return items;
  }

  /**
   * Retrieve single raw material item by ID with purchase history breakdown.
   */
  async getById(id: number) {
    const item = await prisma.rawMaterialItem.findUnique({
      where: { id },
      include: {
        purchaseItems: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            buyRawMaterial: {
              select: {
                id: true,
                invoiceNumber: true,
                purchaseDate: true,
                paymentStatus: true,
                paymentMethod: true,
                shop: {
                  select: {
                    id: true,
                    name: true,
                    contactPerson: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: { purchaseItems: true },
        },
      },
    });

    if (!item) {
      const error: any = new Error(`Raw material item with ID ${id} was not found.`);
      error.statusCode = 404;
      throw error;
    }

    return item;
  }

  /**
   * Create a new raw material item with uniqueness validation on code.
   */
  async create(data: CreateRawMaterialItemDTO) {
    const trimmedName = data.name?.trim();
    if (!trimmedName) {
      const error: any = new Error('Raw material item name is required.');
      error.statusCode = 400;
      throw error;
    }

    // Format custom code or prepare for auto-generation if blank
    let finalCode = data.code && data.code.trim().length > 0 ? data.code.trim().toUpperCase() : null;

    // If code is empty, auto-generate sequential code: RM-0001, RM-0002...
    if (!finalCode) {
      finalCode = await this.getNextCode();
    }

    // Pre-check code uniqueness if custom or auto code is provided
    if (finalCode) {
      const existing = await prisma.rawMaterialItem.findUnique({
        where: { code: finalCode },
      });

      if (existing) {
        throw new HttpException(409, `Item code "${finalCode}" is already in use. Please enter a different code.`);
      }
    }

    try {
      return await prisma.rawMaterialItem.create({
        data: {
          name: trimmedName,
          code: finalCode,
          description: data.description?.trim() || null,
          unit: data.unit ?? RawMaterialUnit.METERS,
          currentStock: Number(data.currentStock) || 0,
          alertThreshold: data.alertThreshold !== undefined ? Number(data.alertThreshold) : 10,
          unitCostAverage: Number(data.unitCostAverage) || 0,
        },
      });
    } catch (err: any) {
      // Catch Prisma unique constraint collision (P2002) as a clean 409 conflict
      if (err.code === 'P2002') {
        throw new HttpException(409, `Item code "${finalCode}" is already registered in the system.`);
      }
      throw err;
    }
  }

  /**
   * Update existing raw material item details with duplicate check.
   */
  async update(id: number, data: UpdateRawMaterialItemDTO) {
    const existing = await prisma.rawMaterialItem.findUnique({
      where: { id },
    });

    if (!existing) {
      const error: any = new Error(`Raw material item with ID ${id} was not found.`);
      error.statusCode = 404;
      throw error;
    }

    const updatePayload: Prisma.RawMaterialItemUpdateInput = {};

    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (!trimmedName) {
        const error: any = new Error('Raw material item name cannot be empty.');
        error.statusCode = 400;
        throw error;
      }
      updatePayload.name = trimmedName;
    }

    if (data.code !== undefined) {
      const trimmedCode = data.code && data.code.trim().length > 0 ? data.code.trim() : null;

      if (trimmedCode && trimmedCode !== existing.code) {
        const duplicate = await prisma.rawMaterialItem.findUnique({
          where: { code: trimmedCode },
        });

        if (duplicate && duplicate.id !== id) {
          throw new HttpException(409, `Item code "${trimmedCode}" is already in use by another item.`);
        }
      }
      updatePayload.code = trimmedCode;
    }

    if (data.description !== undefined) {
      updatePayload.description = data.description ? data.description.trim() : null;
    }

    if (data.unit !== undefined && Object.values(RawMaterialUnit).includes(data.unit)) {
      updatePayload.unit = data.unit;
    }

    if (data.currentStock !== undefined) {
      updatePayload.currentStock = Math.max(0, Number(data.currentStock) || 0);
    }

    if (data.alertThreshold !== undefined) {
      updatePayload.alertThreshold = Math.max(0, Number(data.alertThreshold) || 0);
    }

    if (data.unitCostAverage !== undefined) {
      updatePayload.unitCostAverage = Math.max(0, Number(data.unitCostAverage) || 0);
    }

    return await prisma.rawMaterialItem.update({
      where: { id },
      data: updatePayload,
    });
  }

  /**
   * Delete an item safeguarding against existing purchase receipts.
   */
  async delete(id: number) {
    const existing = await prisma.rawMaterialItem.findUnique({
      where: { id },
      include: {
        _count: {
          select: { purchaseItems: true },
        },
      },
    });

    if (!existing) {
      const error: any = new Error(`Raw material item with ID ${id} was not found.`);
      error.statusCode = 404;
      throw error;
    }

    if (existing._count.purchaseItems > 0) {
      const error: any = new Error(
        `Cannot delete raw material item '${existing.name}'. It is associated with ${existing._count.purchaseItems} purchase line item(s).`
      );
      error.statusCode = 400;
      throw error;
    }

    return await prisma.rawMaterialItem.delete({
      where: { id },
    });
  }

  /**
   * Inspect database and generate the next unique sequential Item Code (e.g. RM-0001, RM-0002)
   */
  async getNextCode(): Promise<string> {
    const lastItem = await prisma.rawMaterialItem.findFirst({
      where: {
        code: {
          startsWith: 'RM-',
        },
      },
      orderBy: { id: 'desc' },
      select: { code: true, id: true },
    });

    if (!lastItem || !lastItem.code) {
      // Fallback check total count if no RM- prefixed item exists
      const count = await prisma.rawMaterialItem.count();
      return `RM-${String(count + 1).padStart(4, '0')}`;
    }

    const match = lastItem.code.match(/RM-(\d+)/i);
    const lastNumber = match ? parseInt(match[1], 10) : lastItem.id;
    const nextNumber = isNaN(lastNumber) ? lastItem.id + 1 : lastNumber + 1;

    return `RM-${String(nextNumber).padStart(4, '0')}`;
  }
}

export default new RawMaterialItemService();