import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { MaterialMovementType } from '@prisma/client';

export class RawMaterialMovementService {
  /**
   * නිෂ්පාදන කටයුතු (Production cutting) හෝ හානිවීම් (Damage write-off) සඳහා Stock එකෙන් අඩු කිරීමේ function එක
   */
  static async deductMaterial(data: {
    rawMaterialItemId: number;
    quantity: number;
    movementType: 'PRODUCTION_USE' | 'DAMAGE_WASTE';
    reference?: string;
    customDate?: string;
    userId?: number;
  }) {
    const qty = Math.max(0, Number(data.quantity) || 0);
    if (qty <= 0) {
      throw new HttpException(400, 'Deduction quantity must be greater than zero');
    }

    return prisma.$transaction(async (tx) => {
      const item = await tx.rawMaterialItem.findUnique({
        where: { id: Number(data.rawMaterialItemId) },
      });

      if (!item) {
        throw new HttpException(404, 'Raw material item not found');
      }

      if (item.currentStock < qty) {
        throw new HttpException(
          400,
          `Insufficient stock. Available: ${item.currentStock} ${item.unit}, requested deduction: ${qty} ${item.unit}`
        );
      }

      const updatedStock = item.currentStock - qty;

      // වත්මන් Stock ශේෂය update කිරීම
      const updatedItem = await tx.rawMaterialItem.update({
        where: { id: item.id },
        data: { currentStock: updatedStock }, // ⭐ Stock එකෙන් අඩු වූ අලුත් ශේෂය මෙතැනදී යාවත්කාලීන වේ
      });

      // Audit movement log එකක් ලෙස save කිරීම
      const movement = await tx.rawMaterialMovement.create({
        data: {
          rawMaterialItemId: item.id,
          movementType: data.movementType as MaterialMovementType,
          quantity: qty,
          previousStock: item.currentStock,
          newStock: updatedStock,
          reference: data.reference || 'Production cutting deduction',
          recordedBy: data.userId || null,
          createdAt: data.customDate ? new Date(data.customDate) : new Date(),
        },
      });

      return { item: updatedItem, movement };
    });
  }

  /**
   * ඉතිරි වූ කොටස් (Leftover scrap pieces) නැවත Warehouse Stock එකට එකතු කිරීමේ function එක
   */
  static async returnLeftoverMaterial(data: {
    rawMaterialItemId: number;
    quantity: number;
    reference?: string;
    customDate?: string;
    userId?: number;
  }) {
    const qty = Math.max(0, Number(data.quantity) || 0);
    if (qty <= 0) {
      throw new HttpException(400, 'Return quantity must be greater than zero');
    }

    return prisma.$transaction(async (tx) => {
      const item = await tx.rawMaterialItem.findUnique({
        where: { id: Number(data.rawMaterialItemId) },
      });

      if (!item) {
        throw new HttpException(404, 'Raw material item not found');
      }

      const updatedStock = item.currentStock + qty;

      // Scrap return මඟින් Stock එක වැඩි කිරීම (Increment)
      const updatedItem = await tx.rawMaterialItem.update({
        where: { id: item.id },
        data: { currentStock: updatedStock },
      });

      // Audit movement log එකක් ලෙස save කිරීම
      const movement = await tx.rawMaterialMovement.create({
        data: {
          rawMaterialItemId: item.id,
          movementType: MaterialMovementType.SCRAP_RETURN,
          quantity: qty,
          previousStock: item.currentStock,
          newStock: updatedStock,
          reference: data.reference || 'Leftover scrap returned back to warehouse inventory',
          recordedBy: data.userId || null,
          createdAt: data.customDate ? new Date(data.customDate) : new Date(),
        },
      });

      return { item: updatedItem, movement };
    });
  }

  /**
   * Fetch paginated movement history with date range and type filters
   */
  /**
   * Fetch all movement records for a specific raw material item ordered chronologically
   */
  static async getMaterialMovements(rawMaterialItemId: number) {
    const itemId = Number(rawMaterialItemId);

    let recalculatedStock = 0;
    // Auto-reconcile and fix any broken ledger links in single transaction
    await prisma.$transaction(async (tx) => {
      recalculatedStock = await this.recalculateItemLedgerChain(tx, itemId);
    });

    const items = await prisma.rawMaterialMovement.findMany({
      where: {
        rawMaterialItemId: itemId,
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
    });

    return items;
  }

  /**
   * Helper: Recalculate entire historical ledger chain for an item from bottom to top
   * Uses strictly validated opening balance and sequential ID chaining
   */
  public static async recalculateItemLedgerChain(tx: any, rawMaterialItemId: number) {
    const itemId = Number(rawMaterialItemId);

    // කාලානුක්‍රමිකව ආරම්භක record එකේ සිට අලුත්ම record එක දක්වා නිවැරදි ID පිළිවෙළට ගැනීම
    const allMovements = await tx.rawMaterialMovement.findMany({
      where: { rawMaterialItemId: itemId },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ],
    });

    if (allMovements.length === 0) {
      const currentItem = await tx.rawMaterialItem.findUnique({ where: { id: itemId } });
      return currentItem?.currentStock || 0;
    }

    // මුල්ම record එකේ නියම ආරම්භක stock balance එක නිවැරදිව තහවුරු කිරීම
    let runningBalance = Number(allMovements[0].previousStock) || 0;

    for (const mov of allMovements) {
      const prev = runningBalance;
      const qty = Number(mov.quantity) || 0;
      const isDeduction =
        mov.movementType === 'PRODUCTION_USE' || mov.movementType === 'DAMAGE_WASTE';

      if (isDeduction) {
        runningBalance = Math.round((runningBalance - qty) * 1000) / 1000;
      } else {
        runningBalance = Math.round((runningBalance + qty) * 1000) / 1000;
      }

      // Snapshot values දාමයක් ලෙස පිළිවෙළට update කිරීම
      await tx.rawMaterialMovement.update({
        where: { id: mov.id },
        data: {
          previousStock: prev,
          newStock: runningBalance,
        },
      });
    }

    // අලුත්ම අවසාන නිවැරදි stock balance එක Material master table එකෙහි currentStock ලෙස update කිරීම
    await tx.rawMaterialItem.update({
      where: { id: itemId },
      data: { currentStock: runningBalance },
    });

    return runningBalance;
  }

  /**
   * Delete movement and rollback warehouse stock with full chronological recalculation
   */
  static async deleteMovement(movementId: number) {
    return prisma.$transaction(async (tx) => {
      const movement = await tx.rawMaterialMovement.findUnique({
        where: { id: Number(movementId) },
      });

      if (!movement) {
        throw new HttpException(404, 'Movement record not found');
      }

      const itemId = movement.rawMaterialItemId;

      await tx.rawMaterialMovement.delete({
        where: { id: movement.id },
      });

      const finalStock = await this.recalculateItemLedgerChain(tx, itemId);

      const updatedItem = await tx.rawMaterialItem.findUnique({
        where: { id: itemId },
      });

      return { success: true, updatedItem, finalStock };
    });
  }

  /**
   * Update existing movement details, date, or quantity with full chronological recalculation
   */
  static async updateMovement(
    movementId: number,
    data: {
      quantity?: number;
      reference?: string;
      customDate?: string;
    }
  ) {
    return prisma.$transaction(async (tx) => {
      const movement = await tx.rawMaterialMovement.findUnique({
        where: { id: Number(movementId) },
      });

      if (!movement) {
        throw new HttpException(404, 'Movement record not found');
      }

      const newQty =
        data.quantity !== undefined ? Math.max(0, Number(data.quantity)) : movement.quantity;

      if (newQty <= 0) {
        throw new HttpException(400, 'Quantity must be greater than zero');
      }

      await tx.rawMaterialMovement.update({
        where: { id: movement.id },
        data: {
          quantity: newQty,
          reference: data.reference !== undefined ? data.reference.trim() : movement.reference,
          createdAt: data.customDate ? new Date(data.customDate) : movement.createdAt,
        },
      });

      const finalStock = await this.recalculateItemLedgerChain(tx, movement.rawMaterialItemId);

      return { success: true, currentStock: finalStock };
    });
  }

  
}


