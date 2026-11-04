import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';

export interface CreateFinishingLogInput {
  productId: number;
  actionType: string; // 'IRON' | 'PACK'
  quantity: number;
  date?: string | Date;
}

export interface UpdateFinishingLogInput {
  productId?: number;
  actionType?: string; // 'IRON' | 'PACK'
  quantity?: number;
  date?: string | Date;
}

export interface FinishingLogFilters {
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  actionType?: string;
  productId?: number;
}

export class FinishingService {
  /**
   * Fetch finishing logs with optional date range and action type filtering.
   */
  async getAll(filters: FinishingLogFilters = {}) {
    const where: any = {};

    // 1. Action Type Filter ('IRON' | 'PACK')
    if (filters.actionType && filters.actionType !== 'ALL') {
      where.actionType = filters.actionType.toUpperCase().trim();
    }

    // 2. Product Filter
    if (filters.productId && !isNaN(Number(filters.productId))) {
      where.productId = Number(filters.productId);
    }

    // 3. Date Range Filter
    const fromStr = filters.startDate || filters.from;
    const toStr = filters.endDate || filters.to;

    if (fromStr || toStr) {
      where.date = {};
      if (fromStr) {
        const fromDate = new Date(fromStr);
        if (!isNaN(fromDate.getTime())) {
          if (typeof fromStr === 'string' && fromStr.length === 10) {
            fromDate.setHours(0, 0, 0, 0);
          }
          where.date.gte = fromDate;
        }
      }
      if (toStr) {
        const toDate = new Date(toStr);
        if (!isNaN(toDate.getTime())) {
          if (typeof toStr === 'string' && toStr.length === 10) {
            toDate.setHours(23, 59, 59, 999);
          }
          where.date.lte = toDate;
        }
      }
    }

    return prisma.finishingLog.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: {
              take: 1,
              select: {
                imageUrl: true,
              },
            },
            variants: {
              select: {
                id: true,
                sku: true,
                size: true,
                color: true,
              },
            },
          },
        },
      },
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  /**
   * Fetch a single finishing log by ID.
   */
  async getById(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid finishing log ID');

    const log = await prisma.finishingLog.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: {
              take: 1,
              select: { imageUrl: true },
            },
          },
        },
      },
    });

    if (!log) throw new HttpException(404, 'Finishing log entry not found');
    return log;
  }

  /**
   * Record a new Ironed or Packed batch log.
   */
  async create(data: CreateFinishingLogInput) {
    const productId = Number(data.productId);
    if (!productId || isNaN(productId)) {
      throw new HttpException(400, 'A valid finished product is required');
    }

    const action = String(data.actionType || 'PACK').toUpperCase().trim();
    if (action !== 'IRON' && action !== 'PACK') {
      throw new HttpException(400, "Invalid actionType. Allowed values: 'IRON' or 'PACK'");
    }

    const quantity = parseInt(String(data.quantity), 10);
    if (isNaN(quantity) || quantity <= 0) {
      throw new HttpException(400, 'Quantity must be a positive integer greater than 0');
    }

    // Verify product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true },
    });
    if (!product) {
      throw new HttpException(404, `Product with ID ${productId} does not exist`);
    }

    let parsedDate = new Date();
    if (data.date) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) {
        parsedDate = d;
      }
    }

    const finishingLog = await prisma.finishingLog.create({
      data: {
        productId,
        actionType: action,
        quantity,
        date: parsedDate,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: {
              take: 1,
              select: { imageUrl: true },
            },
          },
        },
      },
    });

    return finishingLog;
  }

  /**
   * Update an existing finishing log entry.
   */
  async update(id: number, data: UpdateFinishingLogInput) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid finishing log ID');

    const existing = await prisma.finishingLog.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new HttpException(404, 'Finishing log entry not found');
    }

    const updateData: any = {};

    if (data.productId !== undefined) {
      const productId = Number(data.productId);
      if (!productId || isNaN(productId)) {
        throw new HttpException(400, 'A valid finished product is required');
      }
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) {
        throw new HttpException(404, `Product with ID ${productId} does not exist`);
      }
      updateData.productId = productId;
    }

    if (data.actionType !== undefined) {
      const action = String(data.actionType).toUpperCase().trim();
      if (action !== 'IRON' && action !== 'PACK') {
        throw new HttpException(400, "Invalid actionType. Allowed values: 'IRON' or 'PACK'");
      }
      updateData.actionType = action;
    }

    if (data.quantity !== undefined) {
      const qty = parseInt(String(data.quantity), 10);
      if (isNaN(qty) || qty <= 0) {
        throw new HttpException(400, 'Quantity must be a positive integer greater than 0');
      }
      updateData.quantity = qty;
    }

    if (data.date !== undefined) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) {
        updateData.date = d;
      }
    }

    const updatedLog = await prisma.finishingLog.update({
      where: { id },
      data: updateData,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: {
              take: 1,
              select: { imageUrl: true },
            },
            variants: {
              select: {
                id: true,
                sku: true,
                size: true,
                color: true,
              },
            },
          },
        },
      },
    });

    return updatedLog;
  }

  /**
   * Delete a finishing log entry.
   */
  async delete(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid finishing log ID');

    const existing = await prisma.finishingLog.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new HttpException(404, 'Finishing log entry not found');
    }

    await prisma.finishingLog.delete({
      where: { id },
    });

    return { message: 'Finishing log deleted successfully', id };
  }

  /**
   * Aggregate KPI summary for quick dashboard reporting.
   */
  async getSummary() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0, 0);

    const [
      allLogs,
      todayIronedAgg,
      todayPackedAgg,
      weekIronedAgg,
      weekPackedAgg,
      totalIronedAgg,
      totalPackedAgg,
    ] = await Promise.all([
      prisma.finishingLog.count(),
      prisma.finishingLog.aggregate({
        _sum: { quantity: true },
        where: {
          actionType: 'IRON',
          date: { gte: startOfToday, lte: endOfToday },
        },
      }),
      prisma.finishingLog.aggregate({
        _sum: { quantity: true },
        where: {
          actionType: 'PACK',
          date: { gte: startOfToday, lte: endOfToday },
        },
      }),
      prisma.finishingLog.aggregate({
        _sum: { quantity: true },
        where: {
          actionType: 'IRON',
          date: { gte: startOfWeek },
        },
      }),
      prisma.finishingLog.aggregate({
        _sum: { quantity: true },
        where: {
          actionType: 'PACK',
          date: { gte: startOfWeek },
        },
      }),
      prisma.finishingLog.aggregate({
        _sum: { quantity: true },
        where: { actionType: 'IRON' },
      }),
      prisma.finishingLog.aggregate({
        _sum: { quantity: true },
        where: { actionType: 'PACK' },
      }),
    ]);

    return {
      totalRecords: allLogs,
      todayIroned: todayIronedAgg._sum.quantity || 0,
      todayPacked: todayPackedAgg._sum.quantity || 0,
      weekIroned: weekIronedAgg._sum.quantity || 0,
      weekPacked: weekPackedAgg._sum.quantity || 0,
      totalIroned: totalIronedAgg._sum.quantity || 0,
      totalPacked: totalPackedAgg._sum.quantity || 0,
    };
  }
}

export default new FinishingService();

