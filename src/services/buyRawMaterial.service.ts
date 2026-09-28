import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
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
   * Fetch all purchases with shop, item counts, and payment ledger history
   */
  async getAll(search?: string, shopId?: number) {
    const where: any = {};

    // ⭐ අදාළ supplier shop එකට අදාළ purchases පමණක් filter කිරීම සහ Credit Balance එක Reconcile කිරීම
    if (shopId && !isNaN(shopId)) {
      const sId = Number(shopId);
      where.rawMaterialShopId = sId;

      const shopPurchases = await prisma.buyRawMaterial.findMany({
        where: { rawMaterialShopId: sId },
        select: { totalAmount: true, paidAmount: true },
      });
      const actualOutstanding = shopPurchases.reduce((sum, p) => {
        const due = (Number(p.totalAmount) || 0) - (Number(p.paidAmount) || 0);
        return sum + Math.max(0, due);
      }, 0);

      await prisma.rawMaterialShop.update({
        where: { id: sId },
        data: { creditBalance: actualOutstanding },
      });
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { invoiceNumber: { contains: q } },
        { shop: { name: { contains: q } } },
      ];
    }

    const purchases = await prisma.buyRawMaterial.findMany({
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

    // ⭐ Parse payment audit history from structured notes ledger
    return purchases.map((purchase) => {
      let paymentHistory: any[] = [];
      try {
        if (purchase.notes && purchase.notes.startsWith('{') && purchase.notes.includes('"payments"')) {
          const parsed = JSON.parse(purchase.notes);
          if (Array.isArray(parsed.payments)) {
            paymentHistory = parsed.payments;
          }
        }
      } catch {
        paymentHistory = [];
      }

      // If initial payment exists but no installments recorded yet, show the creation payment
      if (paymentHistory.length === 0 && purchase.paidAmount > 0) {
        paymentHistory.push({
          id: purchase.id * 1000,
          amount: purchase.paidAmount,
          method: purchase.paymentMethod || 'CASH',
          reference: 'Initial Down Payment',
          createdAt: purchase.purchaseDate || purchase.createdAt,
        });
      }

      return {
        ...purchase,
        paymentHistory,
      };
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
   * Update Existing Purchase Order:
   * Safely rolls back old stock quantities and shop debt, then applies new items and amounts.
   */
  async update(id: number, data: CreateBuyRawMaterialDTO) {
    if (isNaN(id)) throw new HttpException(400, 'Invalid purchase ID');

    const existingPurchase = await prisma.buyRawMaterial.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingPurchase) {
      throw new HttpException(404, 'Purchase record not found');
    }

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new HttpException(400, 'At least one raw material item is required');
    }

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

    const paidAmount = data.paidAmount !== undefined ? Math.max(0, Number(data.paidAmount)) : existingPurchase.paidAmount;
    const dueAmount = totalAmount - paidAmount;
    const oldDueAmount = existingPurchase.totalAmount - existingPurchase.paidAmount;

    let paymentStatus: PurchasePaymentStatus = PurchasePaymentStatus.PAID;
    if (paidAmount === 0 && totalAmount > 0) {
      paymentStatus = PurchasePaymentStatus.DUE;
    } else if (paidAmount < totalAmount) {
      paymentStatus = PurchasePaymentStatus.PARTIAL;
    }

    return await prisma.$transaction(async (tx) => {
      // 1. පැරණි stock ප්‍රමාණයන් නැවත rollback කිරීම
      for (const oldItem of existingPurchase.items) {
        const mat = await tx.rawMaterialItem.findUnique({ where: { id: oldItem.rawMaterialItemId } });
        if (mat) {
          const revertedStock = Math.max(0, mat.currentStock - oldItem.quantity);
          await tx.rawMaterialItem.update({
            where: { id: oldItem.rawMaterialItemId },
            data: { currentStock: revertedStock },
          });
        }
      }

      // 2. Shop credit balance වෙනස යාවත්කාලීන කිරීම
      const debtDiff = dueAmount - oldDueAmount;
      if (debtDiff !== 0) {
        await tx.rawMaterialShop.update({
          where: { id: existingPurchase.rawMaterialShopId },
          data: {
            creditBalance: {
              increment: debtDiff,
            },
          },
        });
      }

      // 3. නව අයිතම සඳහා stock ප්‍රමාණය වැඩි කිරීම සහ weighted average cost ගණනය කිරීම
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

        const newAvgCost =
          newStock > 0
            ? (oldStock * oldAvgCost + item.quantity * item.pricePerUnit) / newStock
            : item.pricePerUnit;

        await tx.rawMaterialItem.update({
          where: { id: item.rawMaterialItemId },
          data: {
            currentStock: newStock,
            unitCostAverage: Math.round(newAvgCost * 100) / 100,
          },
        });
      }

      // 4. Purchase එක සහ එහි items (Prisma nested relation update)
      const updatedPurchase = await tx.buyRawMaterial.update({
        where: { id },
        data: {
          invoiceNumber: data.invoiceNumber?.trim() ? data.invoiceNumber.trim().toUpperCase() : existingPurchase.invoiceNumber,
          rawMaterialShopId: data.rawMaterialShopId ? Number(data.rawMaterialShopId) : existingPurchase.rawMaterialShopId,
          totalAmount,
          paidAmount,
          paymentMethod: data.paymentMethod || existingPurchase.paymentMethod,
          paymentStatus,
          purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : existingPurchase.purchaseDate,
          notes: data.notes !== undefined ? data.notes?.trim() || null : existingPurchase.notes,
          items: {
            deleteMany: {}, // ⭐ සියලුම පැරණි line items ස්වයංක්‍රීයව ඉවත් කරයි
            create: validatedItems, // ⭐ නව line items එකතු කරයි
          },
        },
        include: {
          items: true,
          shop: true,
        },
      });

      return updatedPurchase;
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
      // 1. Rollback stock quantities with safety check to prevent negative stocks
      for (const item of purchase.items) {
        const currentItem = await tx.rawMaterialItem.findUnique({
          where: { id: item.rawMaterialItemId },
        });

        if (currentItem) {
          const decremented = Math.max(0, currentItem.currentStock - item.quantity);
          await tx.rawMaterialItem.update({
            where: { id: item.rawMaterialItemId },
            data: { currentStock: decremented },
          });
        }
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

  /**
   * Record partial or full payment installment for a specific purchase order
   */
  async settlePurchasePayment(data: {
    purchaseId: number;
    amount: number;
    paymentMethod: string;
    paymentDate?: string | Date;
    reference?: string;
  }) {
    const purchase = await prisma.buyRawMaterial.findUnique({
      where: { id: Number(data.purchaseId) },
    });

    if (!purchase) {
      throw new HttpException(404, 'Purchase order not found');
    }

    const payNum = Number(data.amount);
    if (isNaN(payNum) || payNum <= 0) {
      throw new HttpException(400, 'Payment amount must be greater than zero');
    }

    const currentDue = purchase.totalAmount - purchase.paidAmount;
    if (payNum > currentDue) {
      throw new HttpException(400, `Amount exceeds remaining purchase balance of Rs. ${currentDue.toLocaleString()}`);
    }

    return await prisma.$transaction(async (tx) => {
      const newPaid = purchase.paidAmount + payNum;
      let newStatus: PurchasePaymentStatus = PurchasePaymentStatus.PARTIAL;
      if (newPaid >= purchase.totalAmount) {
        newStatus = PurchasePaymentStatus.PAID;
      }

      const transactionDate = data.paymentDate ? new Date(data.paymentDate) : new Date();

      // ⭐ පවතින Payment History Ledger එක කියවා නව ගෙවීම් වාර්තාව append කිරීම
      let paymentsList: any[] = [];
      let originalNotesText = '';

      try {
        if (purchase.notes && purchase.notes.startsWith('{') && purchase.notes.includes('"payments"')) {
          const parsed = JSON.parse(purchase.notes);
          paymentsList = Array.isArray(parsed.payments) ? parsed.payments : [];
          originalNotesText = parsed.userNotes || '';
        } else {
          originalNotesText = purchase.notes || '';
          if (purchase.paidAmount > 0) {
            paymentsList.push({
              id: purchase.id * 1000,
              amount: purchase.paidAmount,
              method: purchase.paymentMethod || 'CASH',
              reference: 'Initial Payment',
              createdAt: purchase.purchaseDate ? new Date(purchase.purchaseDate).toISOString() : new Date().toISOString(),
            });
          }
        }
      } catch {
        originalNotesText = purchase.notes || '';
      }

      // අලුත්ම ගෙවීම් වාරිකය ලැයිස්තුවේ මුලට එක් කිරීම (Prepend)
      paymentsList.unshift({
        id: Date.now(),
        amount: payNum,
        method: data.paymentMethod || 'CASH',
        reference: data.reference?.trim() || 'Part Payment',
        createdAt: transactionDate.toISOString(),
      });

      const updatedNotesPayload = JSON.stringify({
        userNotes: originalNotesText,
        payments: paymentsList,
      });

      // 1. Purchase එක සහ එහි structured payment audit notes යාවත්කාලීන කිරීම
      const updatedPurchase = await tx.buyRawMaterial.update({
        where: { id: purchase.id },
        data: {
          paidAmount: newPaid,
          paymentStatus: newStatus,
          notes: updatedNotesPayload,
          updatedAt: transactionDate,
        },
      });

      // ⭐ 2. Supplier Shop එකේ සත්‍ය හිඟ ණය ශේෂය Purchase Invoices මඟින් නැවත ගණනය කර සමපාත කිරීම
      const remainingPurchases = await tx.buyRawMaterial.findMany({
        where: { rawMaterialShopId: purchase.rawMaterialShopId },
        select: { totalAmount: true, paidAmount: true },
      });
      const realDue = remainingPurchases.reduce((sum, p) => {
        const d = (Number(p.totalAmount) || 0) - (Number(p.paidAmount) || 0);
        return sum + Math.max(0, d);
      }, 0);

      await tx.rawMaterialShop.update({
        where: { id: purchase.rawMaterialShopId },
        data: { creditBalance: realDue },
      });

      return updatedPurchase;
    });
  }
}

export default new BuyRawMaterialService();