import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';
import { PurchasePaymentStatus } from '@prisma/client';

export interface CreatePurchaseItemDTO {
  rawMaterialItemId: number;
  quantity: number;
  pricePerUnit: number;
  batchNumber?: string | null;
}

export interface CreateBuyRawMaterialDTO {
  invoiceNumber?: string | null;
  rawMaterialShopId: number;
  paidAmount?: number;
  paymentMethod?: string;
  purchaseDate?: string | Date;
  notes?: string | null;
  items: CreatePurchaseItemDTO[];
}

export class BuyRawMaterialService {
  /**
   * Fetch all purchases with shop and item counts
   */
  async getAll(search?: string) {
    const where: any = {};

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { invoiceNumber: { contains: q } },
        { shop: { name: { contains: q } } },
      ];
    }

    return prisma.buyRawMaterial.findMany({
      where,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            phone: true,
            contactPerson: true,
          },
        },
        items: {
          include: {
            rawMaterialItem: {
              select: {
                id: true,
                name: true,
                code: true,
                unit: true,
              },
            },
          },
        },
      },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  /**
   * Fetch single purchase order breakdown by ID
   */
  async getById(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid purchase ID');

    const purchase = await prisma.buyRawMaterial.findUnique({
      where: { id },
      include: {
        shop: true,
        items: {
          include: {
            rawMaterialItem: true,
          },
        },
      },
    });

    if (!purchase) throw new HttpException(404, 'Purchase record not found');
    return purchase;
  }

  /**
   * Atomic Purchase Recording:
   * 1. Creates BuyRawMaterial record and line items
   * 2. Increments RawMaterialItem stock
   * 3. Calculates and updates Weighted Average Cost (unitCostAverage)
   * 4. Updates RawMaterialShop credit balance if paidAmount < totalAmount
   */
  /**
   * Inspect database and generate next sequential purchase order invoice number (e.g. PO-0001)
   */
  async getNextInvoiceNumber(): Promise<string> {
    const lastPurchase = await prisma.buyRawMaterial.findFirst({
      where: {
        invoiceNumber: {
          startsWith: 'PO-',
        },
      },
      orderBy: { id: 'desc' },
      select: { invoiceNumber: true, id: true },
    });

    if (!lastPurchase || !lastPurchase.invoiceNumber) {
      const count = await prisma.buyRawMaterial.count();
      return `PO-${String(count + 1).padStart(4, '0')}`;
    }

    const match = lastPurchase.invoiceNumber.match(/PO-(\d+)/i);
    const lastNumber = match ? parseInt(match[1], 10) : lastPurchase.id;
    const nextNumber = isNaN(lastNumber) ? lastPurchase.id + 1 : lastNumber + 1;

    return `PO-${String(nextNumber).padStart(4, '0')}`;
  }

  async create(data: CreateBuyRawMaterialDTO) {
    if (!data.rawMaterialShopId) {
      throw new HttpException(400, 'Supplier shop selection is required');
    }

    let finalInvoiceNo = data.invoiceNumber?.trim() ? data.invoiceNumber.trim().toUpperCase() : null;

    // Auto-generate sequential invoice number if left blank
    if (!finalInvoiceNo) {
      finalInvoiceNo = await this.getNextInvoiceNumber();
    } else {
      // Meaningful duplicate check: verify if the same invoice number already exists for this shop
      const existing = await prisma.buyRawMaterial.findFirst({
        where: {
          rawMaterialShopId: data.rawMaterialShopId,
          invoiceNumber: finalInvoiceNo,
        },
      });

      if (existing) {
        throw new HttpException(
          409,
          `Invoice number "${finalInvoiceNo}" has already been registered for this supplier shop.`
        );
      }
    }

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new HttpException(400, 'At least one raw material item is required');
    }

    // Verify shop exists
    const shop = await prisma.rawMaterialShop.findUnique({
      where: { id: data.rawMaterialShopId },
    });
    if (!shop) {
      throw new HttpException(404, 'Selected supplier shop does not exist');
    }

    // Calculate row totals and total bill amount
    let totalAmount = 0;
    const validatedItems = data.items.map((item) => {
      const qty = Number(item.quantity);
      const unitPrice = Number(item.pricePerUnit);

      if (isNaN(qty) || qty <= 0) {
        throw new HttpException(400, 'Item quantity must be greater than zero');
      }
      if (isNaN(unitPrice) || unitPrice < 0) {
        throw new HttpException(400, 'Unit price cannot be negative');
      }

      const rowTotal = qty * unitPrice;
      totalAmount += rowTotal;

      return {
        rawMaterialItemId: Number(item.rawMaterialItemId),
        quantity: qty,
        pricePerUnit: unitPrice,
        rowTotal,
        batchNumber: item.batchNumber?.trim() || null,
      };
    });

    const paidAmount = Math.max(0, Number(data.paidAmount) || 0);
    const dueAmount = totalAmount - paidAmount;

    // Determine Payment Status enum
    let paymentStatus: PurchasePaymentStatus = PurchasePaymentStatus.PAID;
    if (paidAmount === 0 && totalAmount > 0) {
      paymentStatus = PurchasePaymentStatus.DUE;
    } else if (paidAmount < totalAmount) {
      paymentStatus = PurchasePaymentStatus.PARTIAL;
    }

    // Atomic Execution
    return await prisma.$transaction(async (tx) => {
      // 1. Create Purchase Entry
      const purchase = await tx.buyRawMaterial.create({
        data: {
          invoiceNumber: finalInvoiceNo,
          rawMaterialShopId: data.rawMaterialShopId,
          totalAmount,
          paidAmount,
          paymentMethod: data.paymentMethod || 'CASH',
          paymentStatus,
          purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : new Date(),
          notes: data.notes?.trim() || null,
          items: {
            create: validatedItems,
          },
        },
        include: {
          items: true,
          shop: true,
        },
      });

      // 2. Process Stock & Weighted Average Cost for each material
      for (const item of validatedItems) {
        const currentItem = await tx.rawMaterialItem.findUnique({
          where: { id: item.rawMaterialItemId },
        });

        if (!currentItem) {
          throw new HttpException(404, `Raw material item #${item.rawMaterialItemId} not found`);
        }

        const oldStock = Number(currentItem.currentStock) || 0;
        const oldAvgCost = Number(currentItem.unitCostAverage) || 0;
        const newStock = oldStock + item.quantity;

        // Weighted Average Cost Calculation
        // New Avg = ((Old Stock * Old Avg) + (Incoming Qty * Incoming Unit Price)) / Total New Stock
        const newAvgCost =
          newStock > 0
            ? (oldStock * oldAvgCost + item.quantity * item.pricePerUnit) / newStock
            : item.pricePerUnit;

        await tx.rawMaterialItem.update({
          where: { id: item.rawMaterialItemId },
          data: {
            currentStock: newStock,
            unitCostAverage: Math.round(newAvgCost * 100) / 100, // Round to 2 decimals
          },
        });
      }

      // 3. Update Shop Credit Balance if there is an unpaid balance
      if (dueAmount > 0) {
        await tx.rawMaterialShop.update({
          where: { id: data.rawMaterialShopId },
          data: {
            creditBalance: {
              increment: dueAmount,
            },
          },
        });
      }

      return purchase;
    });
  }

  /**
   * Delete / Cancel Purchase Record
   * Safely reverses stock quantities, recalculates stock, and offsets shop debt balance.
   */
  async delete(id: number) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid purchase ID');

    const purchase = await prisma.buyRawMaterial.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!purchase) {
      throw new HttpException(404, 'Purchase record not found');
    }

    const dueAmount = purchase.totalAmount - purchase.paidAmount;

    return await prisma.$transaction(async (tx) => {
      // 1. Rollback stock quantities
      for (const item of purchase.items) {
        await tx.rawMaterialItem.update({
          where: { id: item.rawMaterialItemId },
          data: {
            currentStock: {
              decrement: item.quantity,
            },
          },
        });
      }

      // 2. Revert shop debt balance if there was an outstanding balance
      if (dueAmount > 0) {
        await tx.rawMaterialShop.update({
          where: { id: purchase.rawMaterialShopId },
          data: {
            creditBalance: {
              decrement: dueAmount,
            },
          },
        });
      }

      // 3. Delete purchase record (cascade deletes purchase items)
      return await tx.buyRawMaterial.delete({
        where: { id },
      });
    });
  }
}

export default new BuyRawMaterialService();