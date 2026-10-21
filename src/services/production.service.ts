import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { MaterialMovementType } from '@prisma/client';

export interface TargetProductMapping {
  productId: number;
  variantId?: number | null;
  productName?: string;
  sku?: string;
  barcode?: string;
  plannedQty: number;
}

export interface ProductionMaterialInput {
  id?: number;
  rawMaterialId?: number;
  materialId?: number;
  issuedQty?: number;
  cuttingQty?: number;
  piecesCount?: number;
  pieces?: number;
  returnedQty?: number;
  unitCost?: number;
  returnReason?: string;
  targetProducts?: TargetProductMapping[];
}

export interface CreateProductionPayload {
  productionNo?: string;
  productId?: number;
  variantId?: number | null;
  targetQuantity?: number;
  completedQty?: number;
  status?: string;
  reason?: string;
  notes?: string;
  productionDate?: string | Date;
  cutDate?: string | Date;
  cuttingDate?: string | Date;
  materials?: ProductionMaterialInput[];
  targetProducts?: TargetProductMapping[];
}

export interface CreateFinishBatchPayload {
  productionNo?: string;
  productId: number;
  variantId?: number | null;
  targetQuantity?: number;
  completedQty: number;
  finishDate?: string | Date;
  notes?: string;
  reason?: string;
  loggedByRole?: string;
  syncToStock?: boolean;
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
  productId?: number;
  variantId?: number | null;
  targetQuantity?: number;
  productionDate?: string | Date;
  cutDate?: string | Date;
  cuttingDate?: string | Date;
  notes?: string;
  reason?: string;
  loggedByRole?: string;
  materials: ProductionMaterialInput[];
  targetProducts?: TargetProductMapping[];
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
  async createMaterialCutBatch(payload: CreateCutBatchPayload, userId?: number, userRole?: string, userName?: string) {
    if (!payload.materials || !Array.isArray(payload.materials) || payload.materials.length === 0) {
      throw new HttpException(400, 'At least one raw material line is required to start a cut batch');
    }

    // Decoupled payload: Extract target products directly from payload.targetProducts first
    const rawTargetProducts: TargetProductMapping[] = [];
    if (Array.isArray(payload.targetProducts) && payload.targetProducts.length > 0) {
      payload.targetProducts.forEach((tp) => {
        const prodId = Number(tp.productId || (tp as any).id);
        const pQty = Number(tp.plannedQty);
        if (prodId > 0 && pQty > 0) {
          rawTargetProducts.push({
            productId: prodId,
            variantId: tp.variantId ? Number(tp.variantId) : null,
            productName: tp.productName,
            sku: tp.sku,
            barcode: tp.barcode,
            plannedQty: pQty,
          });
        }
      });
    }

    // Backward compatibility: If empty, extract mapped products across material rows
    if (rawTargetProducts.length === 0 && Array.isArray(payload.materials)) {
      payload.materials.forEach((m) => {
        if (Array.isArray(m.targetProducts)) {
          m.targetProducts.forEach((tp) => {
            const prodId = Number(tp.productId || (tp as any).id);
            const pQty = Number(tp.plannedQty);
            if (prodId > 0 && pQty > 0) {
              rawTargetProducts.push({
                productId: prodId,
                variantId: tp.variantId ? Number(tp.variantId) : null,
                productName: tp.productName,
                sku: tp.sku,
                barcode: tp.barcode,
                plannedQty: pQty,
              });
            }
          });
        }
      });
    }

    // Enrich target products from DB if names or SKUs are missing
    const targetProductIds = Array.from(new Set(rawTargetProducts.map((p) => p.productId)));
    const enrichedProducts = targetProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: targetProductIds } },
          include: { variants: true },
        })
      : [];
    const prodMap = new Map(enrichedProducts.map((p) => [p.id, p]));

    const allMappedProducts: TargetProductMapping[] = rawTargetProducts.map((tp) => {
      const prod = prodMap.get(tp.productId);
      const matchedVariant = tp.variantId
        ? prod?.variants.find((v) => v.id === tp.variantId)
        : prod?.variants?.[0];
      return {
        productId: tp.productId,
        variantId: matchedVariant?.id || tp.variantId || null,
        productName: prod?.name || tp.productName || `Product #${tp.productId}`,
        sku: matchedVariant?.sku || tp.sku || '',
        barcode: matchedVariant?.barcode || tp.barcode || '',
        plannedQty: tp.plannedQty,
      };
    });

    // Primary product ID: either explicitly supplied or from first mapped target product
    let productId = payload.productId ? Number(payload.productId) : (allMappedProducts.length > 0 ? Number(allMappedProducts[0].productId) : null);
    if (!productId || isNaN(productId)) {
      const fallbackProd = await prisma.product.findFirst({ select: { id: true } });
      if (!fallbackProd) {
        throw new HttpException(400, 'Please create at least one product before starting a production batch');
      }
      productId = fallbackProd.id;
    }

    // Compute targetQuantity: sum of planned output across mapped products or explicit targetQuantity
    const mappedTotalQty = allMappedProducts.reduce((sum, p) => sum + (Number(p.plannedQty) || 0), 0);
    const targetQuantity = payload.targetQuantity && Number(payload.targetQuantity) > 0
      ? Number(payload.targetQuantity)
      : Math.max(1, mappedTotalQty);

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
        targetVariantId = null;
      }
    } else if (product.variants.length > 0) {
      targetVariantId = product.variants[0].id;
    }

    // Sanitize materials
    const sanitizedMaterials = payload.materials.map((m) => {
      const rmId = Number(m.rawMaterialId || m.materialId);
      const issued = Number(m.issuedQty !== undefined ? m.issuedQty : m.cuttingQty);
      const pieces = m.piecesCount !== undefined && m.piecesCount !== null
        ? Math.max(1, Number(m.piecesCount) || 1)
        : (m.pieces !== undefined && m.pieces !== null ? Math.max(1, Number(m.pieces) || 1) : 1);

      if (!rmId || isNaN(rmId)) {
        throw new HttpException(400, 'Invalid raw material ID in material list');
      }
      if (isNaN(issued) || issued <= 0) {
        throw new HttpException(400, 'Issued cut quantity must be greater than zero');
      }

      return {
        rawMaterialId: rmId,
        issuedQty: issued,
        piecesCount: pieces,
        unitCost: m.unitCost !== undefined ? Number(m.unitCost) : undefined,
        targetProducts: Array.isArray(m.targetProducts) ? m.targetProducts : [],
      };
    });

    const cutDate = payload.cuttingDate ? new Date(payload.cuttingDate) : (payload.cutDate ? new Date(payload.cutDate) : (payload.productionDate ? new Date(payload.productionDate) : new Date()));
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
            reference: `Cutting log for Batch #${productionNo} (${product.name} - ${mat.issuedQty} ${item.unit}, ${mat.piecesCount} Rolls/Pcs)`,
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
          reason: payload.reason?.trim() || 'Multi-Product Batch',
          notes: payload.notes?.trim() || null,
          productionDate: cutDate,
          targetProducts: allMappedProducts.length > 0 ? (allMappedProducts as any) : null,
          materialUsages: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              piecesCount: m.piecesCount,
              issuedQty: m.issuedQty,
              returnedQty: 0,
              netConsumedQty: m.issuedQty,
              unitCost: m.unitCost || 0,
              targetProducts: m.targetProducts.length > 0 ? (m.targetProducts as any) : null,
            })),
          },
          cutLogs: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              quantityCut: m.issuedQty,
              cutDate: cutDate,
              loggedByRole: loggedByRole,
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

      // Immediately record the initial Cutting stage activity log with unified summary
      let resolvedUserName = userName;
      if (!resolvedUserName && userId) {
        const creator = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
        if (creator?.name) resolvedUserName = creator.name;
      }
      if (!resolvedUserName) resolvedUserName = loggedByRole || 'Cutting Master';

      const initialPiecesQty = allMappedProducts.reduce((sum, p) => sum + (Number(p.plannedQty) || 0), 0) || targetQuantity;

      // Build summary of materials cut and target products planned
      const matSummary = sanitizedMaterials
        .map((m) => {
          const item = rmMap.get(m.rawMaterialId);
          return `${m.issuedQty} ${item?.unit || 'units'} of ${item?.name || 'Material'} (${m.piecesCount} Roll${m.piecesCount > 1 ? 's' : ''})`;
        })
        .join(', ');

      const prodSummary = allMappedProducts.length > 0
        ? allMappedProducts.map((p) => `${p.plannedQty} Pcs ${p.productName}`).join(', ')
        : `${targetQuantity} Pcs ${product.name}`;

      const notesSummary = `Cut ${matSummary} for target output: ${prodSummary}${payload.notes?.trim() ? ` — Notes: ${payload.notes.trim()}` : ''}`;

      await tx.batchActivityLog.create({
        data: {
          productionOrderId: productionOrder.id,
          stage: 'CUTTING',
          action: 'INITIAL_CUT',
          notes: notesSummary,
          timestamp: cutDate,
          userId: userId || null,
          userName: resolvedUserName,
          quantity: initialPiecesQty,
        },
      });

      return this.getByIdWithLogs(productionOrder.id, tx);
    });
  }

  /**
   * Finishing-First Stage: Create a brand-new production batch directly from finished garments
   * (POST /api/production/finish-batch)
   *
   * Enables a flexible, bi-directional production lifecycle where operators record finished pieces upfront
   * without requiring raw material cuts at initiation. Raw materials can be allocated and cut later at any time.
   *
   * @param payload - Batch setup details (productId, optional variantId, targetQuantity, completedQty, finishDate, notes, syncToStock)
   * @param userId - ID of the creating operator
   * @param userRole - Role of the creating operator
   * @returns Created ProductionOrder with initial GarmentFinishLog
   */
  async createFinishingBatch(payload: CreateFinishBatchPayload, userId?: number, userRole?: string) {
    const productId = Number(payload.productId);
    if (!productId || isNaN(productId)) {
      throw new HttpException(400, 'Valid product ID is required');
    }

    const completedQty = Math.max(1, Number(payload.completedQty) || 0);
    const targetQuantity = Math.max(completedQty, Number(payload.targetQuantity) || completedQty);

    // Verify product exists
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

    const finishDate = payload.finishDate ? new Date(payload.finishDate) : new Date();
    const productionNo = payload.productionNo?.trim() || (await this.generateProductionNo());
    const loggedByRole = payload.loggedByRole?.trim() || userRole || 'Finishing Supervisor';
    const syncToStock = Boolean(payload.syncToStock);

    const isTargetMet = targetQuantity > 0 && completedQty >= targetQuantity;
    let initialStatus: string;
    if (syncToStock) {
      initialStatus = isTargetMet ? 'COMPLETED' : 'IN_PROGRESS';
    } else {
      initialStatus = isTargetMet ? 'FINISHED_PENDING_STOCK' : 'IN_PROGRESS';
    }

    return prisma.$transaction(async (tx) => {
      // If immediate stock sync was chosen, increment product variant stock
      if (syncToStock) {
        if (targetVariantId) {
          await tx.productVariant.update({
            where: { id: targetVariantId },
            data: { stock: { increment: completedQty } },
          });
        } else {
          const firstVariant = await tx.productVariant.findFirst({
            where: { productId },
          });
          if (firstVariant) {
            await tx.productVariant.update({
              where: { id: firstVariant.id },
              data: { stock: { increment: completedQty } },
            });
          }
        }
      }

      // Create the production order with initial finished output and 0 raw material usages
      const order = await tx.productionOrder.create({
        data: {
          productionNo,
          productId,
          variantId: targetVariantId,
          targetQuantity,
          completedQty,
          status: initialStatus,
          isStockSynced: syncToStock,
          stockSyncedAt: syncToStock ? finishDate : null,
          stockSyncedByRole: syncToStock ? loggedByRole : null,
          reason: payload.reason?.trim() || 'Regular Bulk',
          notes: payload.notes?.trim() || null,
          productionDate: finishDate,
          finishLogs: {
            create: [
              {
                quantityFinished: completedQty,
                finishDate,
                loggedByRole,
                isSyncedToStock: syncToStock,
                syncedAt: syncToStock ? finishDate : null,
              },
            ],
          },
        },
      });

      return this.getByIdWithLogs(order.id, tx);
    });
  }

  /**
   * Atomically create a garment production record:
   * Supports both material-first and finishing-first bi-directional workflows.
   * If materials are provided:
   * 1. Validates material stock availability.
   * 2. Decrements raw material stock by net consumed (issued - returned).
   * 3. Creates raw material movement ledger entries.
   * 4. Increments target product / variant stock.
   * 5. Saves the ProductionOrder & ProductionMaterialUsage lines.
   */
  async createProduction(payload: CreateProductionPayload, userId?: number, userRole?: string, userName?: string) {
    const productId = Number(payload.productId);
    if (!productId || isNaN(productId)) {
      throw new HttpException(400, 'Valid product ID is required');
    }

    const completedQty = Math.max(0, Number(payload.completedQty) || 0);
    const targetQuantity = Math.max(completedQty, Number(payload.targetQuantity) || completedQty);

    const materialsList = Array.isArray(payload.materials) ? payload.materials : [];

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

    // Validate raw materials if provided
    const sanitizedMaterials = materialsList.map((m) => {
      const rmId = Number(m.rawMaterialId || m.materialId);
      const issued = Math.max(0, Number(m.issuedQty !== undefined ? m.issuedQty : m.cuttingQty) || 0);
      const pieces = m.piecesCount !== undefined && m.piecesCount !== null
        ? Math.max(1, Number(m.piecesCount) || 1)
        : (m.pieces !== undefined && m.pieces !== null ? Math.max(1, Number(m.pieces) || 1) : 1);
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
        piecesCount: pieces,
        returnedQty: returned,
        netConsumedQty: net,
        unitCost: m.unitCost !== undefined ? Number(m.unitCost) : undefined,
        returnReason: m.returnReason?.trim() || null,
        targetProducts: Array.isArray(m.targetProducts) ? m.targetProducts : [],
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
          status: payload.status || 'CUTTING',
          reason: payload.reason?.trim() || 'Regular Bulk',
          notes: payload.notes?.trim() || null,
          productionDate: prodDate,
          targetProducts: (Array.isArray(payload.targetProducts) && payload.targetProducts.length > 0) ? (payload.targetProducts as any) : null,
          materialUsages: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              piecesCount: m.piecesCount,
              issuedQty: m.issuedQty,
              returnedQty: m.returnedQty,
              netConsumedQty: m.netConsumedQty,
              unitCost: m.unitCost || 0,
              returnReason: m.returnReason,
              targetProducts: m.targetProducts.length > 0 ? (m.targetProducts as any) : null,
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

      // Immediately record the initial Cutting stage activity log
      let resolvedUserName = userName;
      if (!resolvedUserName && userId) {
        const creator = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
        if (creator?.name) resolvedUserName = creator.name;
      }
      if (!resolvedUserName) resolvedUserName = userRole || 'Cutting Master';

      const initialPiecesQty = (Array.isArray(payload.targetProducts) && payload.targetProducts.length > 0)
        ? payload.targetProducts.reduce((sum: number, p: any) => sum + (Number(p.plannedQty) || 0), 0)
        : targetQuantity;

      await tx.batchActivityLog.create({
        data: {
          productionOrderId: productionOrder.id,
          stage: 'CUTTING',
          action: 'INITIAL_CUT',
          notes: payload.notes?.trim() || 'Initial raw fabric cutting batch initiated',
          timestamp: prodDate,
          userId: userId || null,
          userName: resolvedUserName,
          quantity: initialPiecesQty,
        },
      });

      if (sanitizedMaterials.length > 0) {
        await tx.materialCutLog.createMany({
          data: sanitizedMaterials.map((m) => ({
            productionOrderId: productionOrder.id,
            rawMaterialId: m.rawMaterialId,
            quantityCut: m.issuedQty,
            cutDate: prodDate,
            loggedByRole: resolvedUserName,
          })),
        });
      }

      return this.getByIdWithLogs(productionOrder.id, tx);
    });
  }

  /**
   * Atomically update an existing production order:
   * 1. Rolls back previous stock adjustments (restores old raw materials, deducts old product stock).
   * 2. Validates new stock availability.
   * 3. Applies new stock adjustments and logs movements.
   * 4. Updates ProductionOrder & material usages.
   */
  async updateProduction(id: number, payload: CreateProductionPayload, userId?: number, userRole?: string, userName?: string) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    const materialsList = Array.isArray(payload.materials) ? payload.materials : [];

    // Decoupled payload: Extract target products directly from payload.targetProducts first
    const rawTargetProducts: TargetProductMapping[] = [];
    if (Array.isArray(payload.targetProducts) && payload.targetProducts.length > 0) {
      payload.targetProducts.forEach((tp) => {
        const prodId = Number(tp.productId || (tp as any).id);
        const pQty = Number(tp.plannedQty);
        if (prodId > 0 && pQty > 0) {
          rawTargetProducts.push({
            productId: prodId,
            variantId: tp.variantId ? Number(tp.variantId) : null,
            productName: tp.productName,
            sku: tp.sku,
            barcode: tp.barcode,
            plannedQty: pQty,
          });
        }
      });
    }

    // Backward compatibility: If empty, extract mapped products across material rows
    if (rawTargetProducts.length === 0) {
      materialsList.forEach((m) => {
        if (Array.isArray(m.targetProducts)) {
          m.targetProducts.forEach((tp) => {
            const prodId = Number(tp.productId || (tp as any).id);
            const pQty = Number(tp.plannedQty);
            if (prodId > 0 && pQty > 0) {
              rawTargetProducts.push({
                productId: prodId,
                variantId: tp.variantId ? Number(tp.variantId) : null,
                productName: tp.productName,
                sku: tp.sku,
                barcode: tp.barcode,
                plannedQty: pQty,
              });
            }
          });
        }
      });
    }

    // Enrich target products from DB
    const targetProductIds = Array.from(new Set(rawTargetProducts.map((p) => p.productId)));
    const enrichedProducts = targetProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: targetProductIds } },
          include: { variants: true },
        })
      : [];
    const prodMap = new Map(enrichedProducts.map((p) => [p.id, p]));

    const allMappedProducts: TargetProductMapping[] = rawTargetProducts.map((tp) => {
      const prod = prodMap.get(tp.productId);
      const matchedVariant = tp.variantId
        ? prod?.variants.find((v) => v.id === tp.variantId)
        : prod?.variants?.[0];
      return {
        productId: tp.productId,
        variantId: matchedVariant?.id || tp.variantId || null,
        productName: prod?.name || tp.productName || `Product #${tp.productId}`,
        sku: matchedVariant?.sku || tp.sku || '',
        barcode: matchedVariant?.barcode || tp.barcode || '',
        plannedQty: tp.plannedQty,
      };
    });

    const completedQty = Math.max(0, Number(payload.completedQty) || 0);
    const mappedTotalQty = allMappedProducts.reduce((sum, p) => sum + (Number(p.plannedQty) || 0), 0);
    const targetQuantity = payload.targetQuantity && Number(payload.targetQuantity) > 0
      ? Number(payload.targetQuantity)
      : (mappedTotalQty > 0 ? mappedTotalQty : (completedQty > 0 ? completedQty : 1));

    // Filter valid material rows and sanitize
    const sanitizedMaterials = materialsList
      .filter((m) => m && (m.rawMaterialId || m.materialId))
      .map((m) => {
        const rmId = Number(m.rawMaterialId || m.materialId);
        const issued = Math.max(0, Number(m.issuedQty !== undefined ? m.issuedQty : m.cuttingQty) || 0);
        const pieces = m.piecesCount !== undefined && m.piecesCount !== null
          ? Math.max(1, Number(m.piecesCount) || 1)
          : (m.pieces !== undefined && m.pieces !== null ? Math.max(1, Number(m.pieces) || 1) : 1);
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
          piecesCount: pieces,
          returnedQty: returned,
          netConsumedQty: net,
          unitCost: m.unitCost !== undefined ? Number(m.unitCost) : undefined,
          returnReason: m.returnReason?.trim() || null,
          targetProducts: Array.isArray(m.targetProducts) ? m.targetProducts : [],
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

      // Resolve product ID: explicit, or from mapped products, or existing
      const resolvedProductId = payload.productId && Number(payload.productId) > 0
        ? Number(payload.productId)
        : (allMappedProducts.length > 0 ? allMappedProducts[0].productId : existingOrder.productId);

      const product = await tx.product.findUnique({
        where: { id: resolvedProductId },
        include: { variants: true },
      });

      if (!product) {
        throw new HttpException(404, 'Product not found');
      }

      // Resolve variant
      let targetVariantId: number | null = payload.variantId !== undefined ? (payload.variantId ? Number(payload.variantId) : null) : existingOrder.variantId;
      if (targetVariantId) {
        const found = product.variants.find((v) => v.id === targetVariantId);
        if (!found) {
          targetVariantId = null;
        }
      } else if (product.variants.length > 0 && !targetVariantId) {
        targetVariantId = product.variants[0].id;
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

      const prodDate = payload.cuttingDate
        ? new Date(payload.cuttingDate)
        : (payload.cutDate
          ? new Date(payload.cutDate)
          : (payload.productionDate ? new Date(payload.productionDate) : existingOrder.productionDate));

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

        // Update in-memory stock for subsequent rows with same material
        item.currentStock = newStock;

        if (mat.netConsumedQty > 0) {
          await tx.rawMaterialMovement.create({
            data: {
              rawMaterialItemId: item.id,
              movementType: MaterialMovementType.PRODUCTION_USE,
              quantity: mat.netConsumedQty,
              previousStock: item.currentStock + mat.netConsumedQty,
              newStock: newStock,
              reference: `Updated Production batch #${existingOrder.productionNo} for ${product.name} (Issued: ${mat.issuedQty}, Returned: ${mat.returnedQty}, ${mat.piecesCount} Rolls/Pcs)`,
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

      // Synchronize material cut logs to match the updated materials and cut date
      await tx.materialCutLog.deleteMany({
        where: { productionOrderId: orderId },
      });

      if (sanitizedMaterials.length > 0) {
        await tx.materialCutLog.createMany({
          data: sanitizedMaterials.map((m) => ({
            productionOrderId: orderId,
            rawMaterialId: m.rawMaterialId,
            quantityCut: m.issuedQty,
            cutDate: prodDate,
            loggedByRole: userRole || 'Cutting Master',
          })),
        });
      }

      // 6. Update production order
      const updatedOrder = await tx.productionOrder.update({
        where: { id: orderId },
        data: {
          productId: resolvedProductId,
          variantId: targetVariantId,
          targetQuantity,
          completedQty: payload.completedQty !== undefined ? Math.max(0, Number(payload.completedQty)) : existingOrder.completedQty,
          status: payload.status || existingOrder.status || 'CUTTING',
          reason: payload.reason?.trim() || existingOrder.reason || 'Multi-Product Batch',
          notes: payload.notes !== undefined ? payload.notes?.trim() || null : existingOrder.notes,
          productionDate: prodDate,
          targetProducts: allMappedProducts.length > 0 ? (allMappedProducts as any) : (payload.targetProducts as any || existingOrder.targetProducts),
          materialUsages: {
            create: sanitizedMaterials.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              piecesCount: m.piecesCount,
              issuedQty: m.issuedQty,
              returnedQty: m.returnedQty,
              netConsumedQty: m.netConsumedQty,
              unitCost: m.unitCost || 0,
              returnReason: m.returnReason,
              targetProducts: m.targetProducts.length > 0 ? (m.targetProducts as any) : null,
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

      // Synchronize timeline activity log
      const initialCutLog = await tx.batchActivityLog.findFirst({
        where: { productionOrderId: orderId, stage: 'CUTTING', action: 'INITIAL_CUT' },
      });

      const matSummary = sanitizedMaterials
        .map((m) => {
          const item = rmMap.get(m.rawMaterialId);
          return `${m.issuedQty} ${item?.unit || 'units'} of ${item?.name || 'Material'} (${m.piecesCount} Roll${m.piecesCount > 1 ? 's' : ''})`;
        })
        .join(', ');

      const prodSummary = allMappedProducts.length > 0
        ? allMappedProducts.map((p) => `${p.plannedQty} Pcs ${p.productName}`).join(', ')
        : `${targetQuantity} Pcs ${product.name}`;

      const notesSummary = `Cut ${matSummary} for target output: ${prodSummary}${payload.notes?.trim() ? ` — Notes: ${payload.notes.trim()}` : ''}`;

      if (initialCutLog) {
        await tx.batchActivityLog.update({
          where: { id: initialCutLog.id },
          data: {
            timestamp: prodDate,
            quantity: targetQuantity,
            notes: notesSummary,
          },
        });
      }

      // Automatically insert a new BatchActivityLog for CUTTING using the specified Date & Time
      await tx.batchActivityLog.create({
        data: {
          productionOrderId: orderId,
          stage: 'CUTTING',
          action: 'CUTTING',
          notes: notesSummary,
          timestamp: prodDate,
          userId: userId || null,
          userName: userName || userRole || 'Cutting Master',
          quantity: targetQuantity,
        },
      });

      return this.getByIdWithLogs(updatedOrder.id, tx);
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

          // Record RETURNED activity log in batch timeline
          await tx.batchActivityLog.create({
            data: {
              productionOrderId: orderId,
              stage: 'SCRAP_RETURN',
              action: 'RETURNED',
              notes: ret.returnReason?.trim() || `Returned ${diffToRestore} ${usage.rawMaterial.unit} of ${usage.rawMaterial.name} to warehouse inventory`,
              timestamp: new Date(),
              userId: userId || null,
              userName: userRole || 'Warehouse',
              quantity: diffToRestore,
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
          activityLogs: {
            orderBy: { timestamp: 'desc' },
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
          activityLogs: {
            orderBy: { timestamp: 'desc' },
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
        activityLogs: {
          orderBy: { timestamp: 'desc' },
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
   * Supports flexible bi-directional manufacturing lifecycle and backdated cutting entries:
   * 1. If material is already allocated to the batch with uncut fabric remaining, consumes from it without double-deducting.
   * 2. If material is NOT yet allocated to the batch (e.g., Finishing-First batch), or if deductInventory is true,
   *    or if cut quantity exceeds existing uncut allocation:
   *    Validates warehouse stock, deducts from RawMaterialItem stock, creates a RawMaterialMovement ledger entry,
   *    and creates or increments ProductionMaterialUsage.
   * 3. Records MaterialCutLog with custom timestamp and operator role.
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

      let usage = order.materialUsages.find((u) => u.rawMaterialId === rawMaterialId);

      // Total already cut for this material in this batch
      const totalAlreadyCutQty = (order.cutLogs || [])
        .filter((c) => c.rawMaterialId === rawMaterialId)
        .reduce((sum, c) => sum + Number(c.quantityCut || 0), 0);

      const remainingUncut = usage
        ? Math.max(0, usage.issuedQty - totalAlreadyCutQty - usage.returnedQty)
        : 0;

      // Determine if warehouse stock deduction is required:
      // - If deductInventory is explicitly true
      // - If usage does not exist yet (finishing-first batch or new material)
      // - If deductInventory is not false and cut quantity exceeds remaining batch allocation
      const needsWarehouseDeduction =
        payload.deductInventory === true ||
        !usage ||
        (payload.deductInventory !== false && quantityCut > remainingUncut);

      if (!needsWarehouseDeduction && payload.deductInventory === false) {
        if (!usage) {
          throw new HttpException(
            400,
            `Raw material #${rawMaterialId} is not allocated to Batch #${order.productionNo}. Check "Deduct warehouse inventory" to allocate from warehouse stock.`
          );
        }
        if (quantityCut > remainingUncut) {
          throw new HttpException(
            400,
            `Cannot cut ${quantityCut} ${usage.rawMaterial.unit}. Remaining uncut allocation in batch is only ${remainingUncut} ${usage.rawMaterial.unit}. Check "Deduct warehouse inventory" to allocate additional fabric from warehouse.`
          );
        }
      }

      if (needsWarehouseDeduction) {
        const rawItem = await tx.rawMaterialItem.findUnique({
          where: { id: rawMaterialId },
        });

        if (!rawItem || !rawItem.isActive) {
          throw new HttpException(404, `Raw material #${rawMaterialId} not found or inactive`);
        }

        // Calculate quantity to deduct from warehouse
        const qtyToDeductFromWarehouse = usage && payload.deductInventory !== true
          ? quantityCut - remainingUncut
          : quantityCut;

        if (qtyToDeductFromWarehouse > 0) {
          if (rawItem.currentStock < qtyToDeductFromWarehouse) {
            throw new HttpException(
              400,
              `Insufficient warehouse stock for "${rawItem.name}". Available: ${rawItem.currentStock} ${rawItem.unit}, Required: ${qtyToDeductFromWarehouse} ${rawItem.unit}`
            );
          }

          const newStock = Math.max(0, rawItem.currentStock - qtyToDeductFromWarehouse);
          await tx.rawMaterialItem.update({
            where: { id: rawItem.id },
            data: { currentStock: newStock },
          });

          await tx.rawMaterialMovement.create({
            data: {
              rawMaterialItemId: rawItem.id,
              movementType: MaterialMovementType.PRODUCTION_USE,
              quantity: qtyToDeductFromWarehouse,
              previousStock: rawItem.currentStock,
              newStock,
              reference: `Material cut allocation for Batch #${order.productionNo} (${qtyToDeductFromWarehouse} ${rawItem.unit})`,
              recordedBy: userId || null,
              createdAt: cutDate,
            },
          });

          if (usage) {
            await tx.productionMaterialUsage.update({
              where: { id: usage.id },
              data: {
                issuedQty: { increment: qtyToDeductFromWarehouse },
                netConsumedQty: { increment: qtyToDeductFromWarehouse },
              },
            });
          } else {
            usage = await tx.productionMaterialUsage.create({
              data: {
                productionOrderId: orderId,
                rawMaterialId,
                issuedQty: qtyToDeductFromWarehouse,
                returnedQty: 0,
                netConsumedQty: qtyToDeductFromWarehouse,
                unitCost: rawItem.unitCostAverage || 0,
              },
              include: {
                rawMaterial: true,
              },
            });
          }
        }
      }

      // Record the MaterialCutLog
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
   * Update an existing MaterialCutLog entry (e.g. adjust Date, Time, and Quantity Cut).
   * Atomically recalculates inventory adjustments:
   * - If cut quantity increased, deducts difference from RawMaterialItem stock & increments usage.
   * - If cut quantity decreased, refunds difference back to RawMaterialItem stock & decrements usage.
   * - Records MaterialMovement and BatchActivityLog (action: 'EDIT_CUT').
   */
  async updateMaterialCutLog(
    orderId: number,
    cutLogId: number,
    payload: {
      quantityCut?: number;
      cutDate?: string | Date;
      loggedByRole?: string;
    },
    userId?: number,
    userRole?: string
  ) {
    const pOrderId = Number(orderId);
    const pCutLogId = Number(cutLogId);
    if (!pOrderId || isNaN(pOrderId) || !pCutLogId || isNaN(pCutLogId)) {
      throw new HttpException(400, 'Valid production order ID and cut log ID are required');
    }

    return prisma.$transaction(async (tx) => {
      const existingCutLog = await tx.materialCutLog.findUnique({
        where: { id: pCutLogId },
        include: { rawMaterial: true },
      });

      if (!existingCutLog || existingCutLog.productionOrderId !== pOrderId) {
        throw new HttpException(404, 'Material cut log not found for this production batch');
      }

      const order = await tx.productionOrder.findUnique({
        where: { id: pOrderId },
        include: {
          materialUsages: { include: { rawMaterial: true } },
          cutLogs: true,
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production batch not found');
      }

      if (order.status === 'CANCELLED') {
        throw new HttpException(400, 'Cannot edit cut log on a cancelled production batch');
      }

      const oldQty = Number(existingCutLog.quantityCut);
      const newQty = payload.quantityCut !== undefined ? Number(payload.quantityCut) : oldQty;
      if (isNaN(newQty) || newQty <= 0) {
        throw new HttpException(400, 'Quantity cut must be greater than zero');
      }

      const rawItem = await tx.rawMaterialItem.findUnique({
        where: { id: existingCutLog.rawMaterialId },
      });

      if (!rawItem) {
        throw new HttpException(404, 'Associated raw material not found');
      }

      const diff = Number((newQty - oldQty).toFixed(2));
      const usage = order.materialUsages.find((u) => u.rawMaterialId === existingCutLog.rawMaterialId);

      const targetCutDate = payload.cutDate ? new Date(payload.cutDate) : existingCutLog.cutDate;
      const targetRole = payload.loggedByRole?.trim() || userRole || existingCutLog.loggedByRole || 'Cutting Master';

      if (diff > 0) {
        // Cut quantity increased by diff -> deduct additional fabric from stock
        if (rawItem.currentStock < diff) {
          throw new HttpException(
            400,
            `Insufficient raw material stock for "${rawItem.name}". Available: ${rawItem.currentStock} ${rawItem.unit}, Additional needed: ${diff} ${rawItem.unit}`
          );
        }

        const newStock = Math.max(0, rawItem.currentStock - diff);
        await tx.rawMaterialItem.update({
          where: { id: rawItem.id },
          data: { currentStock: newStock },
        });

        await tx.rawMaterialMovement.create({
          data: {
            rawMaterialItemId: rawItem.id,
            movementType: MaterialMovementType.PRODUCTION_USE,
            quantity: diff,
            previousStock: rawItem.currentStock,
            newStock,
            reference: `Cut adjustment (+${diff} ${rawItem.unit}) for Batch #${order.productionNo}`,
            recordedBy: userId || null,
            createdAt: targetCutDate,
          },
        });

        if (usage) {
          await tx.productionMaterialUsage.update({
            where: { id: usage.id },
            data: {
              issuedQty: { increment: diff },
              netConsumedQty: { increment: diff },
            },
          });
        }
      } else if (diff < 0) {
        // Cut quantity decreased by Math.abs(diff) -> refund fabric back to warehouse stock
        const refundQty = Math.abs(diff);
        const newStock = rawItem.currentStock + refundQty;

        await tx.rawMaterialItem.update({
          where: { id: rawItem.id },
          data: { currentStock: newStock },
        });

        await tx.rawMaterialMovement.create({
          data: {
            rawMaterialItemId: rawItem.id,
            movementType: MaterialMovementType.SCRAP_RETURN,
            quantity: refundQty,
            previousStock: rawItem.currentStock,
            newStock,
            reference: `Cut adjustment rollback (-${refundQty} ${rawItem.unit}) for Batch #${order.productionNo}`,
            recordedBy: userId || null,
            createdAt: targetCutDate,
          },
        });

        if (usage) {
          const newIssued = Math.max(0, usage.issuedQty - refundQty);
          const newNet = Math.max(0, usage.netConsumedQty - refundQty);
          await tx.productionMaterialUsage.update({
            where: { id: usage.id },
            data: {
              issuedQty: newIssued,
              netConsumedQty: newNet,
            },
          });
        }
      }

      // Update the cut log
      await tx.materialCutLog.update({
        where: { id: pCutLogId },
        data: {
          quantityCut: newQty,
          cutDate: targetCutDate,
          loggedByRole: targetRole,
        },
      });

      // Record activity log
      await tx.batchActivityLog.create({
        data: {
          productionOrderId: pOrderId,
          stage: 'CUTTING',
          action: 'EDIT_CUT',
          notes: `Updated cutting log #${pCutLogId}: ${oldQty} -> ${newQty} ${rawItem.unit} on ${targetCutDate.toLocaleDateString()}`,
          timestamp: new Date(),
          userId: userId || null,
          userName: targetRole,
          quantity: newQty,
        },
      });

      return this.getByIdWithLogs(pOrderId, tx);
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
   * Finalize Finished Products (POST /api/production/:id/finalize)
   * Allows the user to input the actual final finished pieces (which may differ from initially planned quantity)
   * before pushing them to sellable Product / ProductVariant stock, marking status COMPLETED and recording
   * a 'FINALIZED' activity log in the timeline.
   */
  async finalizeBatch(
    id: number,
    payload: {
      finalQuantity?: number;
      notes?: string;
    },
    userId?: number,
    userRole?: string
  ) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          product: true,
          variant: true,
          finishLogs: true,
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production batch not found');
      }

      if (order.status === 'CANCELLED') {
        throw new HttpException(400, 'Cannot finalize a cancelled production batch');
      }

      // Determine actual finished pieces
      const actualQty = payload.finalQuantity !== undefined && Number(payload.finalQuantity) > 0
        ? Math.floor(Number(payload.finalQuantity))
        : (order.completedQty > 0 ? order.completedQty : (order.targetQuantity > 0 ? order.targetQuantity : 1));

      // Calculate quantity to push to sellable inventory
      let qtyToPush = actualQty;
      if (order.isStockSynced) {
        qtyToPush = Math.max(0, actualQty - order.completedQty);
      }

      if (qtyToPush > 0) {
        let targetVariantId = order.variantId;
        if (!targetVariantId) {
          const firstVariant = await tx.productVariant.findFirst({
            where: { productId: order.productId },
          });
          if (firstVariant) targetVariantId = firstVariant.id;
        }

        if (targetVariantId) {
          await tx.productVariant.update({
            where: { id: targetVariantId },
            data: {
              stock: { increment: qtyToPush },
            },
          });
        }
      }

      const syncTimestamp = new Date();
      const syncedRole = userRole || 'Inventory Admin';

      // Update finish logs to synced
      await tx.garmentFinishLog.updateMany({
        where: { productionOrderId: orderId },
        data: {
          isSyncedToStock: true,
          syncedAt: syncTimestamp,
        },
      });

      // If no finish logs existed, create one
      if (order.finishLogs.length === 0) {
        await tx.garmentFinishLog.create({
          data: {
            productionOrderId: orderId,
            quantityFinished: actualQty,
            isSyncedToStock: true,
            syncedAt: syncTimestamp,
            loggedByRole: syncedRole,
            finishDate: syncTimestamp,
          },
        });
      }

      const finalNotes = payload.notes?.trim()
        ? (order.notes ? `${order.notes} | Finalized: ${payload.notes.trim()}` : `Finalized: ${payload.notes.trim()}`)
        : order.notes;

      // Update production order to COMPLETED & isStockSynced: true
      await tx.productionOrder.update({
        where: { id: orderId },
        data: {
          completedQty: actualQty,
          isStockSynced: true,
          stockSyncedAt: syncTimestamp,
          stockSyncedByRole: syncedRole,
          status: 'COMPLETED',
          notes: finalNotes,
        },
      });

      // Record FINALIZED activity log in batch timeline
      await tx.batchActivityLog.create({
        data: {
          productionOrderId: orderId,
          stage: 'COMPLETED',
          action: 'FINALIZED',
          notes: payload.notes?.trim() || `Finalized ${actualQty} finished products pushed to active sellable stock`,
          timestamp: syncTimestamp,
          userId: userId || null,
          userName: syncedRole,
          quantity: actualQty,
        },
      });

      return this.getByIdWithLogs(orderId, tx);
    });
  }

  /**
   * Atomic Cancellation of a Production Order at Any Stage:
   * 1. Reverses consumed raw materials back into warehouse RawMaterialItem stock.
   * 2. Decrements finished goods from ProductVariant stock ONLY IF already synced to inventory.
   * 3. Sets batch status to "CANCELLED", updates finish log sync status, and appends cancellation reason.
   * 4. Retains order history in the ledger for complete accounting audit trail.
   */
  async cancelProductionOrder(id: number, userId?: number, userRole?: string, reason?: string) {
    const orderId = Number(id);
    if (!orderId || isNaN(orderId)) {
      throw new HttpException(400, 'Valid production order ID is required');
    }

    return prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id: orderId },
        include: {
          product: true,
          materialUsages: true,
          finishLogs: true,
        },
      });

      if (!order) {
        throw new HttpException(404, 'Production order not found');
      }

      if (order.status === 'CANCELLED') {
        throw new HttpException(400, `Production batch #${order.productionNo} is already cancelled.`);
      }

      const cancellationDate = new Date();

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
                reference: `Cancellation rollback for Production #${order.productionNo}${reason ? ` (${reason})` : ''}`,
                recordedBy: userId || null,
                createdAt: cancellationDate,
              },
            });
          }
        }
      }

      // 2. Decrement completed garments from variant stock ONLY IF already synced
      if (order.isStockSynced && order.completedQty > 0) {
        let targetVariantId = order.variantId;
        if (!targetVariantId) {
          const firstVariant = await tx.productVariant.findFirst({
            where: { productId: order.productId },
          });
          if (firstVariant) targetVariantId = firstVariant.id;
        }

        if (targetVariantId) {
          const variant = await tx.productVariant.findUnique({ where: { id: targetVariantId } });
          if (variant) {
            const updatedStock = Math.max(0, variant.stock - order.completedQty);
            await tx.productVariant.update({
              where: { id: variant.id },
              data: { stock: updatedStock },
            });
          }
        }
      }

      // 3. Mark finishLogs synced to false
      await tx.garmentFinishLog.updateMany({
        where: { productionOrderId: orderId },
        data: { isSyncedToStock: false },
      });

      // 4. Update status to CANCELLED and append cancellation note
      const cancellationNote = `Cancelled on ${cancellationDate.toISOString().slice(0, 10)}${reason ? `: ${reason}` : ''}${userRole ? ` by ${userRole}` : ''}`;
      const newNotes = order.notes ? `${order.notes} | ${cancellationNote}` : cancellationNote;

      const updated = await tx.productionOrder.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          isStockSynced: false,
          notes: newNotes,
        },
      });

      // Record cancellation activity log in batch timeline
      await tx.batchActivityLog.create({
        data: {
          productionOrderId: orderId,
          stage: 'CANCELLED',
          action: 'BATCH_CANCELLED',
          notes: cancellationNote,
          timestamp: cancellationDate,
          userId: userId || null,
          userName: userRole || 'Admin',
          quantity: 0,
        },
      });

      return this.getByIdWithLogs(updated.id, tx);
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
      if (order.completedQty > 0 && order.isStockSynced) {
        let targetVariantId = order.variantId;
        if (!targetVariantId) {
          const firstVariant = await tx.productVariant.findFirst({
            where: { productId: order.productId },
          });
          if (firstVariant) targetVariantId = firstVariant.id;
        }

        if (targetVariantId) {
          const variant = await tx.productVariant.findUnique({ where: { id: targetVariantId } });
          if (variant) {
            const updatedStock = Math.max(0, variant.stock - order.completedQty);
            await tx.productVariant.update({
              where: { id: variant.id },
              data: { stock: updatedStock },
            });
          }
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
