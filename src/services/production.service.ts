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

export interface AddMaterialCutLogPayload {
  rawMaterialId: number;
  quantityCut: number;
  cutDate?: string | Date;
  loggedByRole?: string;
  deductInventory?: boolean;
}

export interface AddGarmentFinishLogPayload {
  quantityFinished: number;
  finishDate?: string | Date;
  loggedByRole?: string;
  incrementInventory?: boolean;
}

export interface ReturnMaterialsPayload {
  returns: Array<{
    usageId: number;
    returnedQty: number; // additional return or absolute returned quantity
    isAdditional?: boolean;
    returnReason?: string;
  }>;
}

export interface CreateCutBatchPayload {
  productionNo?: string;
  productId: number;
  variantId?: number | null;
  targetQuantity: number;
  cutDate?: string | Date;
  notes?: string;
  reason?: string;
  loggedByRole?: string;
  materials: Array<{
    rawMaterialId: number;
    issuedQty: number;
    unitCost?: number;
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
   * Stage 1: Create Material Cut Batch (POST /api/production/cut-batch)
   * Starts a new production batch (status: "CUTTING", completedQty: 0, isStockSynced: false).
   * Validates raw materials against currentStock, deducts stock, creates usages, initial cutLogs, and movements.
   */
  async createMaterialCutBatch(payload: CreateCutBatchPayload, userId?: number, userRole?: string) {
    const productId = Number(payload.productId);
    if (!productId || isNaN(productId)) {
      throw new HttpException(400, 'Valid product ID is required');
    }

    const targetQuantity = Math.max(1, Number(payload.targetQuantity) || 0);
    if (targetQuantity <= 0) {
      throw new HttpException(400, 'Target planned quantity must be greater than zero');
    }

    if (!payload.materials || !Array.isArray(payload.materials) || payload.materials.length === 0) {
      throw new HttpException(400, 'At least one raw material line is required to start a cut batch');
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

    // Sanitize materials
    const sanitizedMaterials = payload.materials.map((m) => {
      const rmId = Number(m.rawMaterialId);
      const issued = Number(m.issuedQty);

      if (!rmId || isNaN(rmId)) {
        throw new HttpException(400, 'Invalid raw material ID in material list');
      }
      if (isNaN(issued) || issued <= 0) {
        throw new HttpException(400, 'Issued cut quantity must be greater than zero');
      }

      return {
        rawMaterialId: rmId,
        issuedQty: issued,
        unitCost: m.unitCost !== undefined ? Number(m.unitCost) : undefined,
      };
    });

    const cutDate = payload.cutDate ? new Date(payload.cutDate) : new Date();
    const productionNo = payload.productionNo?.trim() || (await this.generateProductionNo());
    const loggedByRole = payload.loggedByRole?.trim() || userRole || 'Cutting Master';

    return prisma.$transaction(async (tx) => {
      const rawMaterialIds = sanitizedMaterials.map((m) => m.rawMaterialId);
      const rawMaterials = await tx.rawMaterialItem.findMany({
        where: { id: { in: rawMaterialIds } },
      });

      const rmMap = new Map(rawMaterials.map((r) => [r.id, r]));

      // Strict stock validation
      for (const mat of sanitizedMaterials) {
        const item = rmMap.get(mat.rawMaterialId);
        if (!item || !item.isActive) {
          throw new HttpException(404, `Raw material (ID: ${mat.rawMaterialId}) not found or inactive`);
        }

        if (item.currentStock < mat.issuedQty) {
          throw new HttpException(
            400,
            `Insufficient stock for "${item.name}". Available: ${item.currentStock} ${item.unit}, Required cut quantity: ${mat.issuedQty} ${item.unit}`
          );
        }
      }

      // Deduct raw material stock and record movement
      for (const mat of sanitizedMaterials) {
        const item = rmMap.get(mat.rawMaterialId)!;
        const newStock = Math.max(0, item.currentStock - mat.issuedQty);

        await tx.rawMaterialItem.update({
          where: { id: item.id },
          data: { currentStock: newStock },
        });

        await tx.rawMaterialMovement.create({
          data: {
            rawMaterialItemId: item.id,
            movementType: MaterialMovementType.PRODUCTION_USE,
            quantity: mat.issuedQty,
            previousStock: item.currentStock,
            newStock: newStock,
            reference: `Cutting log for Batch #${productionNo} (${product.name} - ${mat.issuedQty} ${item.unit})`,
            recordedBy: userId || null,
            createdAt: cutDate,
          },
        });

        if (mat.unitCost === undefined) {
          mat.unitCost = item.unitCostAverage;
        }
      }

      // Create ProductionOrder in CUTTING status with completedQty: 0, isStockSynced: false
      const productionOrder = await tx.productionOrder.create({
        data: {
          productionNo,
          productId,
          variantId: targetVariantId,
          targetQuantity,
          completedQty: 0,
          status: 'CUTTING',
          isStockSynced: false,
          reason: payload.reason?.trim() || 'Regular Bulk',
          notes: payload.notes?.trim() || null,
          productionDate: cutDate,
          materialUsages: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              issuedQty: m.issuedQty,
              returnedQty: 0,
              netConsumedQty: m.issuedQty,
              unitCost: m.unitCost || 0,
            })),
          },
        },
        include: {
          product: {
            select: { id: true, name: true, slug: true, images: true },
          },
          variant: true,
          materialUsages: {
            include: {
              rawMaterial: {
                select: { id: true, name: true, code: true, unit: true, currentStock: true },
              },
            },
          },
          cutLogs: {
            include: {
              rawMaterial: { select: { id: true, name: true, code: true, unit: true } },
            },
          },
          finishLogs: true,
        },
      });

      return productionOrder;
    });
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

      // 1. Rollback old finished goods stock on old variant ONLY if stock was already synced to inventory
      if (existingOrder.isStockSynced && existingOrder.variantId && existingOrder.completedQty > 0) {
        await tx.productVariant.update({
          where: { id: existingOrder.variantId },
          data: { stock: { decrement: existingOrder.completedQty } },
        });
      }

      // 2. Increment new finished goods stock on target variant ONLY if stock was already synced to inventory
      if (existingOrder.isStockSynced && targetVariantId && completedQty > 0) {
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
          completedQty: payload.completedQty !== undefined ? Math.max(0, Number(payload.completedQty)) : existingOrder.completedQty,
          status: payload.status || existingOrder.status || 'CUTTING',
          reason: payload.reason?.trim() || existingOrder.reason || 'Regular Bulk',
          notes: payload.notes !== undefined ? payload.notes?.trim() || null : existingOrder.notes,
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
   * Leftover Material Scrap Return (PUT /api/production/:id/return-materials):
   * Validate that returned scrap does not exceed netConsumedQty. Restore to RawMaterialItem.currentStock,
   * log in RawMaterialMovement (SCRAP_RETURN), and return timestamped events so the History Timeline
   * displays scrap returns as distinct chronological events.
   */
  async returnLeftoverMaterials(productionOrderId: number, payload: ReturnMaterialsPayload, userId?: number, userRole?: string) {
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
          cutLogs: true,
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

        // Strict calculation: Material that has already been cut cannot be returned as uncut scrap!
        const totalCutQty = (order.cutLogs || [])
          .filter((c) => c.rawMaterialId === usage.rawMaterialId)
          .reduce((sum, c) => sum + Number(c.quantityCut || 0), 0);

        const previouslyReturnedQty = usage.returnedQty;
        // Max Returnable = max(0, issuedQty - totalCutQty - previouslyReturnedQty)
        const maxReturnable = Math.max(0, usage.issuedQty - totalCutQty - previouslyReturnedQty);

        let diffToRestore: number;
        let newReturnedQty: number;

        if (ret.isAdditional) {
          diffToRestore = rawReturnVal;
          newReturnedQty = previouslyReturnedQty + rawReturnVal;
        } else {
          diffToRestore = rawReturnVal - previouslyReturnedQty;
          newReturnedQty = rawReturnVal;
        }

        if (diffToRestore > maxReturnable) {
          throw new HttpException(
            400,
            `Returned scrap quantity (${diffToRestore} ${usage.rawMaterial.unit}) exceeds maximum available leftover (${maxReturnable} ${usage.rawMaterial.unit}) for "${usage.rawMaterial.name}". (Issued: ${usage.issuedQty}, Cut Used: ${totalCutQty}, Previously Returned: ${previouslyReturnedQty})`
          );
        }

        if (diffToRestore <= 0) continue;

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
              reference: `Leftover scrap returned for Production #${order.productionNo}${
                ret.returnReason ? ` (${ret.returnReason})` : ''
              } - Role: ${userRole || 'Warehouse'}`,
              recordedBy: userId || null,
            },
          });
        }
      }

      // Return refreshed order with nested logs and scrap movements
      return this.getByIdWithLogs(orderId, tx);
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
          cutLogs: {
            orderBy: { cutDate: 'desc' },
            include: {
              rawMaterial: { select: { id: true, name: true, code: true, unit: true } },
            },
          },
          finishLogs: {
            orderBy: { finishDate: 'desc' },
          },
        },
      }),
    ]);

    // Attach scrap movements to items for timeline history
    const batchNos = items.map((o) => o.productionNo);
    const scrapMovements = batchNos.length > 0
      ? await prisma.rawMaterialMovement.findMany({
          where: {
            movementType: MaterialMovementType.SCRAP_RETURN,
            OR: batchNos.map((no) => ({ reference: { contains: no } })),
          },
          include: {
            rawMaterialItem: { select: { id: true, name: true, code: true, unit: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const itemsWithScrap = items.map((order) => {
      const matchingScrap = scrapMovements.filter((m) => m.reference && m.reference.includes(order.productionNo));
      if (matchingScrap.length > 0) {
        return { ...order, scrapReturns: matchingScrap };
      }
      const fallbackScrap = (order.materialUsages || [])
        .filter((u) => u.returnedQty > 0)
        .map((u) => ({
          id: u.id,
          quantity: u.returnedQty,
          createdAt: u.updatedAt || order.productionDate,
          reference: u.returnReason ? `Leftover scrap returned (${u.returnReason})` : 'Leftover scrap returned to warehouse',
          rawMaterialItem: u.rawMaterial,
          role: 'Warehouse / Cutting',
        }));
      return { ...order, scrapReturns: fallbackScrap };
    });

    return {
      items: itemsWithScrap,
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

    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    startOfWeek.setHours(0, 0, 0, 0);

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
      cutTodayAgg,
      cutWeekAgg,
      finishTodayAgg,
      finishWeekAgg,
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
      // Material Cutting Aggregates
      prisma.materialCutLog.aggregate({
        where: { cutDate: { gte: startOfToday, lte: endOfToday } },
        _sum: { quantityCut: true },
      }),
      prisma.materialCutLog.aggregate({
        where: { cutDate: { gte: startOfWeek, lte: endOfToday } },
        _sum: { quantityCut: true },
      }),
      // Garment Finishing Aggregates
      prisma.garmentFinishLog.aggregate({
        where: { finishDate: { gte: startOfToday, lte: endOfToday } },
        _sum: { quantityFinished: true },
      }),
      prisma.garmentFinishLog.aggregate({
        where: { finishDate: { gte: startOfWeek, lte: endOfToday } },
        _sum: { quantityFinished: true },
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
          cutLogs: {
            orderBy: { cutDate: 'desc' },
            include: {
              rawMaterial: { select: { id: true, name: true, code: true, unit: true } },
            },
          },
          finishLogs: {
            orderBy: { finishDate: 'desc' },
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

    // Compute WIP (Work In Progress): Units planned/cut but not yet finished
    let currentWip = 0;
    let activeWipBatches = 0;
    let totalMaterialsCut = 0;
    let totalScrapReturned = 0;
    let pendingStockSync = 0;
    let syncedToInventory = 0;

    filteredOrders.forEach((o) => {
      if (o.status !== 'CANCELLED') {
        if (o.isStockSynced) {
          syncedToInventory += o.completedQty || 0;
        } else if (o.completedQty > 0) {
          pendingStockSync += o.completedQty || 0;
        }

        if (o.status !== 'COMPLETED') {
          const remaining = Math.max(0, o.targetQuantity - (o.completedQty || 0));
          if (remaining > 0) {
            currentWip += remaining;
            activeWipBatches++;
          }
        }
      }

      if (o.cutLogs && o.cutLogs.length > 0) {
        totalMaterialsCut += o.cutLogs.reduce((acc, c) => acc + c.quantityCut, 0);
      } else if (o.materialUsages && o.materialUsages.length > 0) {
        totalMaterialsCut += o.materialUsages.reduce((acc, u) => acc + u.issuedQty, 0);
      }

      if (o.materialUsages && o.materialUsages.length > 0) {
        totalScrapReturned += o.materialUsages.reduce((acc, u) => acc + u.returnedQty, 0);
      }
    });

    // Attach scrap movements to filtered orders
    const batchNos = filteredOrders.map((o) => o.productionNo);
    const scrapMovements = batchNos.length > 0
      ? await prisma.rawMaterialMovement.findMany({
          where: {
            movementType: MaterialMovementType.SCRAP_RETURN,
            OR: batchNos.map((no) => ({ reference: { contains: no } })),
          },
          include: {
            rawMaterialItem: { select: { id: true, name: true, code: true, unit: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const filteredOrdersWithScrap = filteredOrders.map((order) => {
      const matchingScrap = scrapMovements.filter((m) => m.reference && m.reference.includes(order.productionNo));
      if (matchingScrap.length > 0) {
        return { ...order, scrapReturns: matchingScrap };
      }
      const fallbackScrap = (order.materialUsages || [])
        .filter((u) => u.returnedQty > 0)
        .map((u) => ({
          id: u.id,
          quantity: u.returnedQty,
          createdAt: u.updatedAt || order.productionDate,
          reference: u.returnReason ? `Leftover scrap returned (${u.returnReason})` : 'Leftover scrap returned to warehouse',
          rawMaterialItem: u.rawMaterial,
          role: 'Warehouse / Cutting',
        }));
      return { ...order, scrapReturns: fallbackScrap };
    });

    // Compute Date-wise cutting vs finishing output map for analytics
    const dateMap: Record<string, { date: string; cutQty: number; finishedQty: number; batchesCount: number }> = {};
    filteredOrders.forEach((o) => {
      const pDate = new Date(o.productionDate).toISOString().split('T')[0];
      if (!dateMap[pDate]) {
        dateMap[pDate] = { date: pDate, cutQty: 0, finishedQty: 0, batchesCount: 0 };
      }
      dateMap[pDate].batchesCount++;

      // Sum cutting logs
      if (o.cutLogs && o.cutLogs.length > 0) {
        o.cutLogs.forEach((cl) => {
          const cDate = new Date(cl.cutDate).toISOString().split('T')[0];
          if (!dateMap[cDate]) {
            dateMap[cDate] = { date: cDate, cutQty: 0, finishedQty: 0, batchesCount: 0 };
          }
          dateMap[cDate].cutQty += cl.quantityCut;
        });
      }

      // Sum finishing logs
      if (o.finishLogs && o.finishLogs.length > 0) {
        o.finishLogs.forEach((fl) => {
          const fDate = new Date(fl.finishDate).toISOString().split('T')[0];
          if (!dateMap[fDate]) {
            dateMap[fDate] = { date: fDate, cutQty: 0, finishedQty: 0, batchesCount: 0 };
          }
          dateMap[fDate].finishedQty += fl.quantityFinished;
        });
      } else {
        // Fallback for batches before log separation
        dateMap[pDate].finishedQty += o.completedQty;
      }
    });

    const dailyOutputTrends = Object.values(dateMap).sort((a, b) => b.date.localeCompare(a.date));

    return {
      metrics: {
        todayOutput: todayAggregates._sum.completedQty || 0,
        todayBatches: todayAggregates._count.id || 0,
        monthOutput: monthAggregates._sum.completedQty || 0,
        monthBatches: monthAggregates._count.id || 0,
        filteredBatches: totalFilterBatches,
        filteredGarments: totalFilterGarments,
        totalYardageConsumed: Number(totalYardageConsumed.toFixed(2)),
        // Multi-stage pipeline metrics
        totalMaterialsCut,
        totalScrapReturned,
        pendingStockSync,
        syncedToInventory,
        // Decoupled Cutting & Finishing WIP Metrics
        totalCutToday: cutTodayAgg._sum.quantityCut || 0,
        totalCutWeek: cutWeekAgg._sum.quantityCut || 0,
        totalFinishedToday: finishTodayAgg._sum.quantityFinished || todayAggregates._sum.completedQty || 0,
        totalFinishedWeek: finishWeekAgg._sum.quantityFinished || 0,
        currentWip,
        activeWipBatches,
      },
      materialBreakdown: Object.values(materialBreakdown),
      dailyOutputTrends,
      records: filteredOrdersWithScrap,
    };
  }

  /**
   * Helper to fetch full production order with nested history logs (cutLogs & finishLogs sorted desc)
   * and distinct scrap return movements.
   */
  async getByIdWithLogs(id: number, tx: any = prisma) {
    const order = await tx.productionOrder.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            variants: true,
            images: { select: { id: true, imageUrl: true, order: true, variantId: true } },
          },
        },
        variant: true,
        materialUsages: {
          include: {
            rawMaterial: true,
          },
        },
        cutLogs: {
          orderBy: { cutDate: 'desc' },
          include: {
            rawMaterial: { select: { id: true, name: true, code: true, unit: true } },
          },
        },
        finishLogs: {
          orderBy: { finishDate: 'desc' },
        },
      },
    });

    if (!order) {
      throw new HttpException(404, 'Production order not found');
    }

    // Fetch chronological scrap return movements for this batch
    const scrapMovements = await tx.rawMaterialMovement.findMany({
      where: {
        movementType: MaterialMovementType.SCRAP_RETURN,
        reference: { contains: order.productionNo },
      },
      include: {
        rawMaterialItem: {
          select: { id: true, name: true, code: true, unit: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let scrapReturns = scrapMovements;
    if (scrapReturns.length === 0) {
      scrapReturns = (order.materialUsages || [])
        .filter((u: any) => u.returnedQty > 0)
        .map((u: any) => ({
          id: u.id,
          quantity: u.returnedQty,
          createdAt: u.updatedAt || order.productionDate,
          reference: u.returnReason ? `Leftover scrap returned (${u.returnReason})` : 'Leftover scrap returned to warehouse',
          rawMaterialItem: u.rawMaterial,
          role: 'Warehouse / Cutting',
        }));
    }

    return {
      ...order,
      scrapReturns,
    };
  }

  /**
   * Get single production order by ID including nested history logs
   */
  async getById(id: number) {
    return this.getByIdWithLogs(id);
  }

  /**
   * Asynchronously log a material cutting event for an existing production batch.
   * Can happen on separate days from garment finishing, consuming from the already-issued batch allocation.
   * NOTE: Does NOT deduct again from warehouse RawMaterialItem stock.
   */
  async addMaterialCutLog(
    id: number,
    payload: AddMaterialCutLogPayload,
    userId?: number,
    userRole?: string
  ) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    const rawMaterialId = Number(payload.rawMaterialId);
    if (!rawMaterialId || isNaN(rawMaterialId)) {
      throw new HttpException(400, 'Valid raw material ID is required');
    }

    const quantityCut = Number(payload.quantityCut);
    if (!quantityCut || isNaN(quantityCut) || quantityCut <= 0) {
      throw new HttpException(400, 'Quantity cut must be greater than zero');
    }

    const cutDate = payload.cutDate ? new Date(payload.cutDate) : new Date();
    const loggedByRole = payload.loggedByRole?.trim() || userRole || 'Cutting Master';

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          materialUsages: {
            include: { rawMaterial: true },
          },
          cutLogs: true,
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production order not found');
      }

      const usage = order.materialUsages.find((u) => u.rawMaterialId === rawMaterialId);
      if (!usage) {
        throw new HttpException(
          400,
          `Raw material #${rawMaterialId} is not allocated to Batch #${order.productionNo}. Please edit the batch to allocate this material.`
        );
      }

      // Calculate total cut so far for this material in this batch
      const totalAlreadyCutQty = (order.cutLogs || [])
        .filter((c) => c.rawMaterialId === rawMaterialId)
        .reduce((sum, c) => sum + Number(c.quantityCut || 0), 0);

      // Remaining uncut allocation in batch = issuedQty - totalAlreadyCutQty - returnedQty
      const remainingUncut = Math.max(0, usage.issuedQty - totalAlreadyCutQty - usage.returnedQty);

      if (quantityCut > remainingUncut) {
        throw new HttpException(
          400,
          `Cannot cut ${quantityCut} ${usage.rawMaterial.unit}. Remaining uncut allocation in batch is only ${remainingUncut} ${usage.rawMaterial.unit} (Allocated: ${usage.issuedQty}, Already Cut: ${totalAlreadyCutQty}, Returned: ${usage.returnedQty}). To allocate additional fabric from warehouse inventory, please use Edit Batch.`
        );
      }

      // 1. Create the MaterialCutLog without deducting from warehouse inventory
      await tx.materialCutLog.create({
        data: {
          productionOrderId: orderId,
          rawMaterialId,
          quantityCut,
          cutDate,
          loggedByRole,
        },
      });

      // Advance status from PENDING to CUTTING if needed
      if (order.status === 'PENDING') {
        await tx.productionOrder.update({
          where: { id: orderId },
          data: { status: 'CUTTING' },
        });
      }

      return this.getByIdWithLogs(orderId, tx);
    });
  }

  /**
   * Stage 2: Log Finished Garments (POST /api/production/:id/finish-logs)
   * Records finished garment counts with date/time and role into GarmentFinishLog and increments ProductionOrder.completedQty.
   * Crucial Change: Do NOT automatically increment ProductVariant.stock here unless explicitly synced,
   * keeping isSyncedToStock: false until user triggers dedicated "Sync/Add to Product Stock".
   * Updates batch status to "FINISHED_PENDING_STOCK" (or "IN_PROGRESS" if partial).
   */
  async addGarmentFinishLog(
    id: number,
    payload: AddGarmentFinishLogPayload,
    userId?: number,
    userRole?: string
  ) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    const quantityFinished = Math.floor(Number(payload.quantityFinished));
    if (!quantityFinished || isNaN(quantityFinished) || quantityFinished <= 0) {
      throw new HttpException(400, 'Finished quantity must be greater than zero');
    }

    const finishDate = payload.finishDate ? new Date(payload.finishDate) : new Date();
    const loggedByRole = payload.loggedByRole?.trim() || userRole || 'Finishing Supervisor';
    // Automatically increment inventory unless explicitly set to false
    const shouldIncrementInventory = payload.incrementInventory !== false;

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: { variant: true, finishLogs: true },
      });

      if (!order) {
        throw new HttpException(404, 'Production order not found');
      }

      // 1. Calculate total already finished garments for the batch
      const logsFinishedSum = (order.finishLogs || []).reduce(
        (sum, log) => sum + Number(log.quantityFinished || 0),
        0
      );
      const currentCompletedQty = Math.max(order.completedQty, logsFinishedSum);
      const targetQty = Number(order.targetQuantity || 0);

      // 2. Enforce strict over-production validation against targetQuantity
      if (targetQty > 0 && currentCompletedQty + quantityFinished > targetQty) {
        const remainingAllowed = Math.max(0, targetQty - currentCompletedQty);
        throw new HttpException(
          400,
          `Cannot finish more garments than the target quantity (${targetQty}). Remaining allowed: ${remainingAllowed}`
        );
      }

      // 3. Create the GarmentFinishLog with isSyncedToStock
      await tx.garmentFinishLog.create({
        data: {
          productionOrderId: orderId,
          quantityFinished,
          finishDate,
          loggedByRole,
          isSyncedToStock: shouldIncrementInventory,
          syncedAt: shouldIncrementInventory ? new Date() : null,
        },
      });

      // 4. Increment completedQty on ProductionOrder
      const newCompletedQty = currentCompletedQty + quantityFinished;
      const isTargetMet = targetQty > 0 && newCompletedQty >= targetQty;

      let newStatus: string;
      let newStockSynced = order.isStockSynced;
      let newStockSyncedAt = order.stockSyncedAt;
      let newStockSyncedByRole = order.stockSyncedByRole;

      if (shouldIncrementInventory) {
        // Direct increment to ProductVariant stock
        if (order.variantId) {
          await tx.productVariant.update({
            where: { id: order.variantId },
            data: { stock: { increment: quantityFinished } },
          });
        } else {
          const firstVariant = await tx.productVariant.findFirst({
            where: { productId: order.productId },
          });
          if (firstVariant) {
            await tx.productVariant.update({
              where: { id: firstVariant.id },
              data: { stock: { increment: quantityFinished } },
            });
          }
        }
        newStockSynced = true;
        newStockSyncedAt = new Date();
        newStockSyncedByRole = loggedByRole;
        newStatus = isTargetMet ? 'COMPLETED' : 'IN_PROGRESS';
      } else {
        // Multi-stage pipeline: Keep in AWAITING STOCK SYNC state
        newStockSynced = false;
        newStatus = isTargetMet ? 'FINISHED_PENDING_STOCK' : 'IN_PROGRESS';
      }

      await tx.productionOrder.update({
        where: { id: orderId },
        data: {
          completedQty: newCompletedQty,
          status: newStatus,
          isStockSynced: newStockSynced,
          stockSyncedAt: newStockSyncedAt,
          stockSyncedByRole: newStockSyncedByRole,
        },
      });

      return this.getByIdWithLogs(orderId, tx);
    });
  }

  /**
   * Stage 3: Confirm & Sync Finished Garments to Product Inventory (POST /api/production/:id/sync-stock)
   * Dedicated endpoint triggered after user confirmation.
   * Finds unsynced finished quantities for the batch, increments ProductVariant.stock (or product stock),
   * marks isStockSynced = true and isSyncedToStock = true with current timestamp and user role,
   * and updates batch status to "COMPLETED".
   */
  async syncStockToInventory(id: number, userId?: number, userRole?: string) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          variant: true,
          finishLogs: true,
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production order not found');
      }

      if (order.isStockSynced) {
        throw new HttpException(400, `Production batch #${order.productionNo} stock has already been synced to active inventory`);
      }

      // Calculate unsynced finished garments
      const unsyncedLogs = order.finishLogs.filter((f) => !f.isSyncedToStock);
      let unsyncedQty = unsyncedLogs.reduce((acc, log) => acc + log.quantityFinished, 0);

      // Fallback for batches logged before separate log table or legacy entries
      if (unsyncedQty <= 0 && order.completedQty > 0) {
        unsyncedQty = order.completedQty;
      }

      if (unsyncedQty <= 0) {
        throw new HttpException(400, 'No finished garments available to sync to stock for this batch');
      }

      // 1. Increment variant stock accurately
      if (order.variantId) {
        await tx.productVariant.update({
          where: { id: order.variantId },
          data: {
            stock: { increment: unsyncedQty },
          },
        });
      } else {
        const firstVariant = await tx.productVariant.findFirst({
          where: { productId: order.productId },
        });
        if (firstVariant) {
          await tx.productVariant.update({
            where: { id: firstVariant.id },
            data: {
              stock: { increment: unsyncedQty },
            },
          });
        }
      }

      const syncTimestamp = new Date();
      const syncedRole = userRole || 'Inventory Admin';

      // 2. Update all GarmentFinishLog rows associated with the batch
      await tx.garmentFinishLog.updateMany({
        where: {
          productionOrderId: orderId,
        },
        data: {
          isSyncedToStock: true,
          syncedAt: syncTimestamp,
        },
      });

      // Legacy fallback: if there were no finish log records created earlier, create one
      if (order.finishLogs.length === 0 && unsyncedQty > 0) {
        await tx.garmentFinishLog.create({
          data: {
            productionOrderId: orderId,
            quantityFinished: unsyncedQty,
            isSyncedToStock: true,
            syncedAt: syncTimestamp,
            loggedByRole: syncedRole,
            finishDate: syncTimestamp,
          },
        });
      }

      const finalCompletedQty = Math.max(order.completedQty, unsyncedQty);

      // 3. Mark order as synced and COMPLETED
      await tx.productionOrder.update({
        where: { id: orderId },
        data: {
          completedQty: finalCompletedQty,
          isStockSynced: true,
          stockSyncedAt: syncTimestamp,
          stockSyncedByRole: syncedRole,
          status: 'COMPLETED',
        },
      });

      return this.getByIdWithLogs(orderId, tx);
    });
  }

  /**
   * Atomic Deletion / Rollback of a Production Order:
   * 1. Reverses material deductions (restores RawMaterial stock).
   * 2. Decrements finished goods stock from ProductVariant ONLY IF already synced to stock.
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

      // 2. Decrement completed garments from variant stock ONLY IF already synced
      if (order.variantId && order.completedQty > 0 && order.isStockSynced) {
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
