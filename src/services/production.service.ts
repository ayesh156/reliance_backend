import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { MaterialMovementType } from '@prisma/client';

export interface ProductionMaterialInput {
  id?: number;
  rawMaterialId: number;
  issuedQty: number;
  returnedQty?: number;
  unitCost?: number;
  returnReason?: string;
}

export interface CreateProductionPayload {
  productionNo?: string;
  productId: number;
  variantId?: number | null;
  targetQuantity?: number;
  completedQty: number;
  status?: string;
  reason?: string;
  notes?: string;
  productionDate?: string | Date;
  materials: ProductionMaterialInput[];
}

export interface ReturnMaterialsPayload {
  returns: Array<{
    usageId: number;
    returnedQty: number; // additional return or absolute returned quantity
    isAdditional?: boolean;
    returnReason?: string;
  }>;
}

export class ProductionService {
  /**
   * Helper to generate a unique Production Order Number (e.g. PRD-261005001)
   */
  private async generateProductionNo(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(-2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `PRD-${yy}${mm}${dd}`;

    const latest = await prisma.productionOrder.findFirst({
      where: {
        productionNo: { startsWith: prefix },
      },
      orderBy: { id: 'desc' },
      select: { productionNo: true },
    });

    if (latest && latest.productionNo) {
      const lastSeq = parseInt(latest.productionNo.slice(-3), 10);
      if (!isNaN(lastSeq)) {
        const nextSeq = String(lastSeq + 1).padStart(3, '0');
        return `${prefix}${nextSeq}`;
      }
    }

    return `${prefix}001`;
  }

  /**
   * Atomically create a garment production record:
   * 1. Validates material stock availability.
   * 2. Decrements raw material stock by net consumed (issued - returned).
   * 3. Creates raw material movement ledger entries.
   * 4. Increments target product / variant stock.
   * 5. Saves the ProductionOrder & ProductionMaterialUsage lines.
   */
  async createProduction(payload: CreateProductionPayload, userId?: number) {
    const productId = Number(payload.productId);
    if (!productId || isNaN(productId)) {
      throw new HttpException(400, 'Valid product ID is required');
    }

    const completedQty = Math.max(0, Number(payload.completedQty) || 0);
    const targetQuantity = Math.max(completedQty, Number(payload.targetQuantity) || completedQty);

    if (!payload.materials || !Array.isArray(payload.materials) || payload.materials.length === 0) {
      throw new HttpException(400, 'At least one raw material line is required for production');
    }

    // Verify product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new HttpException(404, 'Product not found');
    }

    // Resolve variant
    let targetVariantId: number | null = payload.variantId ? Number(payload.variantId) : null;
    if (targetVariantId) {
      const found = product.variants.find((v) => v.id === targetVariantId);
      if (!found) {
        throw new HttpException(400, 'Selected variant does not belong to this product');
      }
    } else if (product.variants.length > 0) {
      targetVariantId = product.variants[0].id;
    }

    // Validate raw materials and check stock
    const sanitizedMaterials = payload.materials.map((m) => {
      const rmId = Number(m.rawMaterialId);
      const issued = Math.max(0, Number(m.issuedQty) || 0);
      const returned = Math.max(0, Number(m.returnedQty) || 0);
      const net = Math.max(0, issued - returned);

      if (!rmId || isNaN(rmId)) {
        throw new HttpException(400, 'Invalid raw material ID in material list');
      }
      if (issued <= 0) {
        throw new HttpException(400, 'Issued quantity must be greater than zero');
      }
      if (returned > issued) {
        throw new HttpException(400, 'Returned quantity cannot exceed issued quantity');
      }

      return {
        rawMaterialId: rmId,
        issuedQty: issued,
        returnedQty: returned,
        netConsumedQty: net,
        unitCost: m.unitCost !== undefined ? Number(m.unitCost) : undefined,
        returnReason: m.returnReason?.trim() || null,
      };
    });

    const productionNo = payload.productionNo?.trim() || (await this.generateProductionNo());

    return prisma.$transaction(async (tx) => {
      // 1. Fetch and lock raw material items to verify stock
      const rawMaterialIds = sanitizedMaterials.map((m) => m.rawMaterialId);
      const rawMaterials = await tx.rawMaterialItem.findMany({
        where: { id: { in: rawMaterialIds } },
      });

      const rmMap = new Map(rawMaterials.map((r) => [r.id, r]));

      for (const mat of sanitizedMaterials) {
        const item = rmMap.get(mat.rawMaterialId);
        if (!item || !item.isActive) {
          throw new HttpException(404, `Raw material (ID: ${mat.rawMaterialId}) not found or inactive`);
        }

        if (item.currentStock < mat.netConsumedQty) {
          throw new HttpException(
            400,
            `Insufficient stock for "${item.name}". Available: ${item.currentStock} ${item.unit}, Net consumed required: ${mat.netConsumedQty} ${item.unit}`
          );
        }
      }

      const prodDate = payload.productionDate ? new Date(payload.productionDate) : new Date();

      // 2. Decrement raw materials & record movements
      for (const mat of sanitizedMaterials) {
        const item = rmMap.get(mat.rawMaterialId)!;
        const newStock = Math.max(0, item.currentStock - mat.netConsumedQty);

        await tx.rawMaterialItem.update({
          where: { id: item.id },
          data: { currentStock: newStock },
        });

        // Movement audit record
        if (mat.netConsumedQty > 0) {
          await tx.rawMaterialMovement.create({
            data: {
              rawMaterialItemId: item.id,
              movementType: MaterialMovementType.PRODUCTION_USE,
              quantity: mat.netConsumedQty,
              previousStock: item.currentStock,
              newStock: newStock,
              reference: `Production batch #${productionNo} for ${product.name} (Issued: ${mat.issuedQty}, Returned: ${mat.returnedQty})`,
              recordedBy: userId || null,
              createdAt: prodDate,
            },
          });
        }

        // Set unitCost from item if not supplied
        if (mat.unitCost === undefined) {
          mat.unitCost = item.unitCostAverage;
        }
      }

      // 3. Increment finished garment stock
      if (targetVariantId && completedQty > 0) {
        await tx.productVariant.update({
          where: { id: targetVariantId },
          data: {
            stock: { increment: completedQty },
          },
        });
      }

      // 4. Create Production Order with nested Usages
      const productionOrder = await tx.productionOrder.create({
        data: {
          productionNo,
          productId,
          variantId: targetVariantId,
          targetQuantity,
          completedQty,
          status: payload.status || 'COMPLETED',
          reason: payload.reason?.trim() || 'Regular Bulk',
          notes: payload.notes?.trim() || null,
          productionDate: prodDate,
          materialUsages: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              issuedQty: m.issuedQty,
              returnedQty: m.returnedQty,
              netConsumedQty: m.netConsumedQty,
              unitCost: m.unitCost || 0,
              returnReason: m.returnReason,
            })),
          },
        },
        include: {
          product: {
            select: { id: true, name: true, slug: true },
          },
          variant: {
            select: { id: true, size: true, color: true, sku: true, stock: true },
          },
          materialUsages: {
            include: {
              rawMaterial: {
                select: { id: true, name: true, code: true, unit: true, currentStock: true },
              },
            },
          },
        },
      });

      return productionOrder;
    });
  }

  /**
   * Atomically update an existing production order:
   * 1. Rolls back previous stock adjustments (restores old raw materials, deducts old product stock).
   * 2. Validates new stock availability.
   * 3. Applies new stock adjustments and logs movements.
   * 4. Updates ProductionOrder & material usages.
   */
  async updateProduction(id: number, payload: CreateProductionPayload, userId?: number) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    const productId = Number(payload.productId);
    if (!productId || isNaN(productId)) {
      throw new HttpException(400, 'Valid product ID is required');
    }

    const completedQty = Math.max(0, Number(payload.completedQty) || 0);
    const targetQuantity = Math.max(completedQty, Number(payload.targetQuantity) || completedQty);

    if (!payload.materials || !Array.isArray(payload.materials) || payload.materials.length === 0) {
      throw new HttpException(400, 'At least one raw material line is required for production');
    }

    // Verify product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new HttpException(404, 'Product not found');
    }

    // Resolve variant
    let targetVariantId: number | null = payload.variantId ? Number(payload.variantId) : null;
    if (targetVariantId) {
      const found = product.variants.find((v) => v.id === targetVariantId);
      if (!found) {
        throw new HttpException(400, 'Selected variant does not belong to this product');
      }
    } else if (product.variants.length > 0) {
      targetVariantId = product.variants[0].id;
    }

    const sanitizedMaterials = payload.materials.map((m) => {
      const rmId = Number(m.rawMaterialId);
      const issued = Math.max(0, Number(m.issuedQty) || 0);
      const returned = Math.max(0, Number(m.returnedQty) || 0);
      const net = Math.max(0, issued - returned);

      if (!rmId || isNaN(rmId)) {
        throw new HttpException(400, 'Invalid raw material ID in material list');
      }
      if (issued <= 0) {
        throw new HttpException(400, 'Issued quantity must be greater than zero');
      }
      if (returned > issued) {
        throw new HttpException(400, 'Returned quantity cannot exceed issued quantity');
      }

      return {
        rawMaterialId: rmId,
        issuedQty: issued,
        returnedQty: returned,
        netConsumedQty: net,
        unitCost: m.unitCost !== undefined ? Number(m.unitCost) : undefined,
        returnReason: m.returnReason?.trim() || null,
      };
    });

    return prisma.$transaction(async (tx) => {
      const existingOrder = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: { materialUsages: true },
      });

      if (!existingOrder) {
        throw new HttpException(404, 'Production order not found');
      }

      // 1. Rollback old finished goods stock on old variant
      if (existingOrder.variantId && existingOrder.completedQty > 0) {
        await tx.productVariant.update({
          where: { id: existingOrder.variantId },
          data: { stock: { decrement: existingOrder.completedQty } },
        });
      }

      // 2. Increment new finished goods stock on target variant
      if (targetVariantId && completedQty > 0) {
        await tx.productVariant.update({
          where: { id: targetVariantId },
          data: { stock: { increment: completedQty } },
        });
      }

      // 3. Rollback old raw material usages stock
      for (const oldUsage of existingOrder.materialUsages) {
        if (oldUsage.netConsumedQty > 0) {
          await tx.rawMaterialItem.update({
            where: { id: oldUsage.rawMaterialId },
            data: { currentStock: { increment: oldUsage.netConsumedQty } },
          });
        }
      }

      // 4. Validate and apply new raw material stock deductions
      const rawMaterialIds = sanitizedMaterials.map((m) => m.rawMaterialId);
      const rawMaterials = await tx.rawMaterialItem.findMany({
        where: { id: { in: rawMaterialIds } },
      });
      const rmMap = new Map(rawMaterials.map((r) => [r.id, r]));

      const prodDate = payload.productionDate ? new Date(payload.productionDate) : new Date();

      for (const mat of sanitizedMaterials) {
        const item = rmMap.get(mat.rawMaterialId);
        if (!item || !item.isActive) {
          throw new HttpException(404, `Raw material (ID: ${mat.rawMaterialId}) not found or inactive`);
        }

        if (item.currentStock < mat.netConsumedQty) {
          throw new HttpException(
            400,
            `Insufficient stock for "${item.name}". Available: ${item.currentStock} ${item.unit}, Net required: ${mat.netConsumedQty} ${item.unit}`
          );
        }

        const newStock = Math.max(0, item.currentStock - mat.netConsumedQty);
        await tx.rawMaterialItem.update({
          where: { id: item.id },
          data: { currentStock: newStock },
        });

        if (mat.netConsumedQty > 0) {
          await tx.rawMaterialMovement.create({
            data: {
              rawMaterialItemId: item.id,
              movementType: MaterialMovementType.PRODUCTION_USE,
              quantity: mat.netConsumedQty,
              previousStock: item.currentStock,
              newStock: newStock,
              reference: `Updated Production batch #${existingOrder.productionNo} for ${product.name} (Issued: ${mat.issuedQty}, Returned: ${mat.returnedQty})`,
              recordedBy: userId || null,
              createdAt: prodDate,
            },
          });
        }

        if (mat.unitCost === undefined) {
          mat.unitCost = item.unitCostAverage;
        }
      }

      // 5. Delete old material usage lines & insert updated lines
      await tx.productionMaterialUsage.deleteMany({
        where: { productionOrderId: orderId },
      });

      // 6. Update production order
      const updatedOrder = await tx.productionOrder.update({
        where: { id: orderId },
        data: {
          productId,
          variantId: targetVariantId,
          targetQuantity,
          completedQty,
          status: payload.status || existingOrder.status || 'COMPLETED',
          reason: payload.reason?.trim() || 'Regular Bulk',
          notes: payload.notes?.trim() || null,
          productionDate: prodDate,
          materialUsages: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              issuedQty: m.issuedQty,
              returnedQty: m.returnedQty,
              netConsumedQty: m.netConsumedQty,
              unitCost: m.unitCost || 0,
              returnReason: m.returnReason,
            })),
          },
        },
        include: {
          product: { select: { id: true, name: true, slug: true } },
          variant: { select: { id: true, size: true, color: true, sku: true, stock: true } },
          materialUsages: {
            include: {
              rawMaterial: { select: { id: true, name: true, code: true, unit: true, currentStock: true } },
            },
          },
        },
      });

      return updatedOrder;
    });
  }

  /**
   * Return leftover raw materials after production (Rollback / Scrap recovery):
   * Increments RawMaterial stock and updates usage returnedQty.
   */
  async returnLeftoverMaterials(productionOrderId: number, payload: ReturnMaterialsPayload, userId?: number) {
    const orderId = Number(productionOrderId);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    if (!payload.returns || !Array.isArray(payload.returns) || payload.returns.length === 0) {
      throw new HttpException(400, 'At least one material return specification is required');
    }

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          product: true,
          materialUsages: {
            include: { rawMaterial: true },
          },
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production order not found');
      }

      for (const ret of payload.returns) {
        const usage = order.materialUsages.find((u) => u.id === Number(ret.usageId));
        if (!usage) {
          throw new HttpException(404, `Material usage record #${ret.usageId} not found in this order`);
        }

        const rawReturnVal = Math.max(0, Number(ret.returnedQty) || 0);
        let newReturnedQty: number;
        let diffToRestore: number;

        if (ret.isAdditional) {
          diffToRestore = rawReturnVal;
          newReturnedQty = usage.returnedQty + rawReturnVal;
        } else {
          diffToRestore = rawReturnVal - usage.returnedQty;
          newReturnedQty = rawReturnVal;
        }

        if (newReturnedQty > usage.issuedQty) {
          throw new HttpException(
            400,
            `Total returned quantity (${newReturnedQty}) cannot exceed issued quantity (${usage.issuedQty}) for ${usage.rawMaterial.name}`
          );
        }

        if (diffToRestore === 0) continue;

        const newNetConsumed = Math.max(0, usage.issuedQty - newReturnedQty);

        // Update Usage
        await tx.productionMaterialUsage.update({
          where: { id: usage.id },
          data: {
            returnedQty: newReturnedQty,
            netConsumedQty: newNetConsumed,
            returnReason: ret.returnReason?.trim() || usage.returnReason,
          },
        });

        // Restore raw material stock
        const currentItem = await tx.rawMaterialItem.findUnique({
          where: { id: usage.rawMaterialId },
        });

        if (currentItem) {
          const updatedStock = currentItem.currentStock + diffToRestore;
          await tx.rawMaterialItem.update({
            where: { id: currentItem.id },
            data: { currentStock: updatedStock },
          });

          // Log movement
          await tx.rawMaterialMovement.create({
            data: {
              rawMaterialItemId: currentItem.id,
              movementType: MaterialMovementType.SCRAP_RETURN,
              quantity: Math.abs(diffToRestore),
              previousStock: currentItem.currentStock,
              newStock: updatedStock,
              reference: `Leftover material return for Production #${order.productionNo}${
                ret.returnReason ? ` (${ret.returnReason})` : ''
              }`,
              recordedBy: userId || null,
            },
          });
        }
      }

      // Return refreshed order
      return tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          product: { select: { id: true, name: true, slug: true } },
          variant: { select: { id: true, size: true, color: true, sku: true, stock: true } },
          materialUsages: {
            include: {
              rawMaterial: { select: { id: true, name: true, code: true, unit: true, currentStock: true } },
            },
          },
        },
      });
    });
  }

  /**
   * Fetch all production orders with query filtering
   */
  async getProductionOrders(filters: {
    search?: string;
    productId?: number;
    startDate?: string;
    endDate?: string;
    today?: boolean;
    month?: boolean | string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const where: any = {};

    if (filters.productId) {
      where.productId = Number(filters.productId);
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where.OR = [
        { productionNo: { contains: filters.search } },
        { reason: { contains: filters.search } },
        { product: { name: { contains: filters.search } } },
      ];
    }

    // Date range processing
    const now = new Date();
    if (filters.today) {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      where.productionDate = { gte: startOfDay, lte: endOfDay };
    } else if (filters.month) {
      let year = now.getFullYear();
      let month = now.getMonth();
      if (typeof filters.month === 'string' && filters.month.includes('-')) {
        const parts = filters.month.split('-');
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
      }
      const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
      where.productionDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (filters.startDate || filters.endDate) {
      where.productionDate = {};
      if (filters.startDate) {
        where.productionDate.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.productionDate.lte = end;
      }
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      prisma.productionOrder.count({ where }),
      prisma.productionOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { productionDate: 'desc' },
        include: {
          product: {
            select: { id: true, name: true, slug: true, images: { take: 1 } },
          },
          variant: {
            select: { id: true, size: true, color: true, sku: true, stock: true },
          },
          materialUsages: {
            include: {
              rawMaterial: {
                select: { id: true, name: true, code: true, unit: true, currentStock: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Fetch aggregate summary metrics & filtered records
   */
  async getProductionSummary(filters: {
    startDate?: string;
    endDate?: string;
    today?: boolean;
    month?: boolean | string;
    productId?: number;
  }) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Filter criteria for filtered breakdown
    const filteredWhere: any = {};
    if (filters.productId) {
      filteredWhere.productId = Number(filters.productId);
    }
    if (filters.today) {
      filteredWhere.productionDate = { gte: startOfToday, lte: endOfToday };
    } else if (filters.month) {
      filteredWhere.productionDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (filters.startDate || filters.endDate) {
      filteredWhere.productionDate = {};
      if (filters.startDate) {
        filteredWhere.productionDate.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        filteredWhere.productionDate.lte = end;
      }
    }

    // Run parallel aggregates
    const [
      todayAggregates,
      monthAggregates,
      filteredOrders,
      allUsagesInFilter,
    ] = await Promise.all([
      // Today Output
      prisma.productionOrder.aggregate({
        where: { productionDate: { gte: startOfToday, lte: endOfToday } },
        _sum: { completedQty: true },
        _count: { id: true },
      }),
      // Month Output
      prisma.productionOrder.aggregate({
        where: { productionDate: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { completedQty: true },
        _count: { id: true },
      }),
      // Filtered records
      prisma.productionOrder.findMany({
        where: filteredWhere,
        orderBy: { productionDate: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              images: { select: { id: true, imageUrl: true, order: true, variantId: true } },
            },
          },
          variant: {
            select: { id: true, size: true, color: true, sku: true, stock: true },
          },
          materialUsages: {
            include: {
              rawMaterial: {
                select: { id: true, name: true, code: true, unit: true },
              },
            },
          },
        },
      }),
      // Filtered material usages
      prisma.productionMaterialUsage.findMany({
        where: {
          productionOrder: filteredWhere,
        },
        include: {
          rawMaterial: { select: { id: true, name: true, unit: true } },
        },
      }),
    ]);

    // Material consumption totals grouped by unit & material
    let totalYardageConsumed = 0;
    const materialBreakdown: Record<number, { name: string; unit: string; totalIssued: number; totalReturned: number; netConsumed: number; totalCost: number }> = {};

    allUsagesInFilter.forEach((u) => {
      totalYardageConsumed += u.netConsumedQty;
      if (!materialBreakdown[u.rawMaterialId]) {
        materialBreakdown[u.rawMaterialId] = {
          name: u.rawMaterial.name,
          unit: u.rawMaterial.unit,
          totalIssued: 0,
          totalReturned: 0,
          netConsumed: 0,
          totalCost: 0,
        };
      }
      materialBreakdown[u.rawMaterialId].totalIssued += u.issuedQty;
      materialBreakdown[u.rawMaterialId].totalReturned += u.returnedQty;
      materialBreakdown[u.rawMaterialId].netConsumed += u.netConsumedQty;
      materialBreakdown[u.rawMaterialId].totalCost += u.netConsumedQty * u.unitCost;
    });

    const totalFilterBatches = filteredOrders.length;
    const totalFilterGarments = filteredOrders.reduce((acc, o) => acc + (o.completedQty || 0), 0);

    return {
      metrics: {
        todayOutput: todayAggregates._sum.completedQty || 0,
        todayBatches: todayAggregates._count.id || 0,
        monthOutput: monthAggregates._sum.completedQty || 0,
        monthBatches: monthAggregates._count.id || 0,
        filteredBatches: totalFilterBatches,
        filteredGarments: totalFilterGarments,
        totalYardageConsumed: Number(totalYardageConsumed.toFixed(2)),
      },
      materialBreakdown: Object.values(materialBreakdown),
      records: filteredOrders,
    };
  }

  /**
   * Get single production order by ID
   */
  async getById(id: number) {
    const order = await prisma.productionOrder.findUnique({
      where: { id },
      include: {
        product: {
          select: { id: true, name: true, slug: true, variants: true },
        },
        variant: true,
        materialUsages: {
          include: {
            rawMaterial: true,
          },
        },
      },
    });

    if (!order) {
      throw new HttpException(404, 'Production order not found');
    }

    return order;
  }

  /**
   * Atomic Deletion / Rollback of a Production Order:
   * 1. Reverses material deductions (restores RawMaterial stock).
   * 2. Decrements finished goods stock from ProductVariant.
   * 3. Removes ProductionOrder & usages.
   */
  async deleteProductionOrder(id: number, userId?: number) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          materialUsages: true,
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production order not found');
      }

      // 1. Rollback raw materials stock
      for (const usage of order.materialUsages) {
        if (usage.netConsumedQty > 0) {
          const item = await tx.rawMaterialItem.findUnique({ where: { id: usage.rawMaterialId } });
          if (item) {
            const restoredStock = item.currentStock + usage.netConsumedQty;
            await tx.rawMaterialItem.update({
              where: { id: item.id },
              data: { currentStock: restoredStock },
            });

            await tx.rawMaterialMovement.create({
              data: {
                rawMaterialItemId: item.id,
                movementType: MaterialMovementType.AUDIT_ADJUST,
                quantity: usage.netConsumedQty,
                previousStock: item.currentStock,
                newStock: restoredStock,
                reference: `Rollback deleted Production #${order.productionNo}`,
                recordedBy: userId || null,
              },
            });
          }
        }
      }

      // 2. Decrement completed garments from variant stock
      if (order.variantId && order.completedQty > 0) {
        const variant = await tx.productVariant.findUnique({ where: { id: order.variantId } });
        if (variant) {
          const updatedStock = Math.max(0, variant.stock - order.completedQty);
          await tx.productVariant.update({
            where: { id: variant.id },
            data: { stock: updatedStock },
          });
        }
      }

      // 3. Delete production order (materialUsages will cascade)
      await tx.productionOrder.delete({
        where: { id: orderId },
      });

      return { success: true, message: `Production batch #${order.productionNo} deleted and inventory rolled back.` };
    });
  }
}

export default new ProductionService();
