import { prisma } from '../lib/prisma.ts';
import { HttpException } from '../middleware/error.middleware.ts';
import { parseOrderStructuredNotes } from './order.service.ts';
import { OrderStatus } from '@prisma/client';

export type ReportPreset = 'daily' | 'monthly' | 'yearly' | 'custom';
export type ReportModule =
  | 'sales'
  | 'returns'
  | 'inventory'
  | 'products'
  | 'materials'
  | 'production'
  | 'suppliers'
  | 'audit';

export interface DateFilterResult {
  startDate: Date;
  endDate: Date;
  preset: ReportPreset;
  presetLabel: string;
}

/**
 * Safely parses input date strings supporting YYYY-MM-DD, UTC ISO, and Local ISO formats.
 * Normalizes start to 00:00:00.000 and end to 23:59:59.999.
 */
function parseBoundaryDate(raw?: string | null, isEnd: boolean = false): Date | null {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  const str = raw.trim();

  // 1. Check for pure calendar date YYYY-MM-DD to avoid timezone off-by-one shifts
  const ymdMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (isEnd) {
      return new Date(year, month, day, 23, 59, 59, 999);
    }
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  // 2. Parse general ISO or timestamp strings
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;

  if (isEnd) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

/**
 * Defensive Date Boundary Normalization & Security Safeguard:
 * - Parses startDate and endDate query parameters safely (handling UTC and Local ISO strings).
 * - Normalizes start to 00:00:00.000 beginning of day and end to 23:59:59.999 end of day.
 * - Auto-swaps if startDate > endDate or clamps if needed without throwing 400/500 errors.
 * - Defaults safely to the current calendar month if dates are missing, undefined, or invalid without crashing.
 * - Clamps excessive custom date ranges to 366 days defensively instead of throwing errors.
 */
export function resolveDateFilter(params: {
  preset?: string;
  startDate?: string;
  endDate?: string;
}): DateFilterResult {
  const now = new Date();
  const rawPreset = (params.preset || '').toLowerCase();

  if (rawPreset === 'daily') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startStr = start.toISOString().split('T')[0];
    return {
      startDate: start,
      endDate: end,
      preset: 'daily',
      presetLabel: `Today (${startStr})`,
    };
  }

  if (rawPreset === 'yearly') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return {
      startDate: start,
      endDate: end,
      preset: 'yearly',
      presetLabel: `Year ${now.getFullYear()} (${startStr} to ${endStr})`,
    };
  }

  if (rawPreset === 'custom' || params.startDate || params.endDate) {
    let parsedStart = parseBoundaryDate(params.startDate, false);
    let parsedEnd = parseBoundaryDate(params.endDate, true);

    // Single-date selection handling: if only one boundary provided, set end = start or start = end
    if (parsedStart && !parsedEnd) {
      parsedEnd = new Date(parsedStart.getFullYear(), parsedStart.getMonth(), parsedStart.getDate(), 23, 59, 59, 999);
    } else if (!parsedStart && parsedEnd) {
      parsedStart = new Date(parsedEnd.getFullYear(), parsedEnd.getMonth(), parsedEnd.getDate(), 0, 0, 0, 0);
    }

    // Fallback: If both dates missing or invalid, default safely to current calendar month
    if (!parsedStart || !parsedEnd || isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const startStr = defaultStart.toISOString().split('T')[0];
      const endStr = defaultEnd.toISOString().split('T')[0];
      return {
        startDate: defaultStart,
        endDate: defaultEnd,
        preset: 'monthly',
        presetLabel: `${startStr} to ${endStr}`,
      };
    }

    // Safe Guard: If start > end, swap them instead of throwing 400/500 errors
    if (parsedStart.getTime() > parsedEnd.getTime()) {
      const tempTime = parsedStart.getTime();
      parsedStart = new Date(parsedEnd.getFullYear(), parsedEnd.getMonth(), parsedEnd.getDate(), 0, 0, 0, 0);
      const tempDate = new Date(tempTime);
      parsedEnd = new Date(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate(), 23, 59, 59, 999);
    }

    // DoS Safeguard: Clamping max range to 366 days defensively without crashing
    const MAX_DAYS = 366;
    const diffDays = (parsedEnd.getTime() - parsedStart.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_DAYS) {
      parsedEnd = new Date(parsedStart.getTime() + MAX_DAYS * 24 * 60 * 60 * 1000);
      parsedEnd.setHours(23, 59, 59, 999);
    }

    const startStr = parsedStart.toISOString().split('T')[0];
    const endStr = parsedEnd.toISOString().split('T')[0];
    return {
      startDate: parsedStart,
      endDate: parsedEnd,
      preset: 'custom',
      presetLabel: `${startStr} to ${endStr}`,
    };
  }

  // Default: 'monthly' (1st of month to end of current month)
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  const monthName = start.toLocaleString('default', { month: 'long' });
  return {
    startDate: start,
    endDate: end,
    preset: 'monthly',
    presetLabel: `${monthName} ${now.getFullYear()} (${startStr} to ${endStr})`,
  };
}

export class ReportService {
  /**
   * 1. SALES & INVOICES REPORT
   * Aggregates gross revenue, discounts, net sales, paid amounts, credit/debt accumulation,
   * and payment method splits across POS retail, wholesale, and ecommerce orders.
   */
  async getSalesReport(dateFilter: DateFilterResult, repUserId?: number) {
    const { startDate, endDate } = dateFilter;

    // Use strictly indexed createdAt & status filters (with optional repUserId filter)
    const whereClause: any = {
      createdAt: { gte: startDate, lte: endDate },
      status: { not: OrderStatus.CANCELLED },
    };
    if (repUserId) {
      whereClause.userId = repUserId;
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { select: { id: true, quantity: true, price: true } },
      },
    });

    let grossRevenue = 0;
    let totalDiscount = 0;
    let netSales = 0;
    let totalPaid = 0;
    let totalDue = 0;
    const paymentSplit: Record<string, { count: number; amount: number }> = {
      CASH: { count: 0, amount: 0 },
      CARD: { count: 0, amount: 0 },
      CHEQUE: { count: 0, amount: 0 },
      CREDIT: { count: 0, amount: 0 },
      OTHER: { count: 0, amount: 0 },
    };

    const tableItems = orders.map((order) => {
      const sub = Number(order.subtotal || order.totalAmount + (order.discount || 0));
      const disc = Number(order.discount || 0);
      const total = Number(order.totalAmount || 0);
      const paid = Number(order.paidAmount || 0);
      const due = Math.max(0, Math.round((total - paid) * 100) / 100);

      grossRevenue += sub;
      totalDiscount += disc;
      netSales += total;
      totalPaid += paid;
      totalDue += due;

      const rawMethod = (order.paymentMethod || (due > 0 ? 'CREDIT' : 'CASH')).toUpperCase();
      let normalizedMethod = 'OTHER';
      if (rawMethod.includes('CASH')) normalizedMethod = 'CASH';
      else if (rawMethod.includes('CARD')) normalizedMethod = 'CARD';
      else if (rawMethod.includes('CHEQUE')) normalizedMethod = 'CHEQUE';
      else if (rawMethod.includes('CREDIT') || due > 0) normalizedMethod = 'CREDIT';

      if (!paymentSplit[normalizedMethod]) {
        paymentSplit[normalizedMethod] = { count: 0, amount: 0 };
      }
      paymentSplit[normalizedMethod].count += 1;
      paymentSplit[normalizedMethod].amount += total;

      const itemCount = order.items.reduce((s, it) => s + it.quantity, 0);

      return {
        id: order.id,
        invoiceNumber: order.invoiceNumber || `INV${order.id}`,
        createdAt: order.createdAt.toISOString(),
        customerName: order.customer?.name || order.customerName || 'Walk-in Customer',
        customerPhone: order.customer?.phone || order.customerPhone || '-',
        source: order.source,
        subtotal: Math.round(sub * 100) / 100,
        discount: Math.round(disc * 100) / 100,
        totalAmount: Math.round(total * 100) / 100,
        paidAmount: Math.round(paid * 100) / 100,
        dueAmount: due,
        paymentMethod: rawMethod,
        status: order.status,
        itemCount,
      };
    });

    const orderCount = orders.length;
    const averageOrderValue = orderCount > 0 ? Math.round((netSales / orderCount) * 100) / 100 : 0;

    return {
      module: 'sales',
      dateFilter,
      summary: {
        orderCount,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        netSales: Math.round(netSales * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalDue: Math.round(totalDue * 100) / 100,
        averageOrderValue,
        paymentSplit,
      },
      tableItems,
    };
  }

  /**
   * 2. RETURNS & ADJUSTMENTS REPORT
   * Extracts return records from Order notes JSON and aggregates restocked garment quantities,
   * refund reasons, cash refunds, and customer credit adjustments.
   */
  async getReturnsReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;

    // Fetch orders containing return records within clamped date window
    const orders = await prisma.order.findMany({
      where: {
        notes: { contains: 'returns' },
        OR: [
          { createdAt: { gte: startDate, lte: endDate } },
          { updatedAt: { gte: startDate, lte: endDate } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    let totalReturnEvents = 0;
    let totalItemsReturned = 0;
    let totalReturnValue = 0;
    let totalCashRefund = 0;
    let totalCreditAdjustment = 0;
    const reasonsBreakdown: Record<string, { count: number; refund: number; qty: number }> = {};

    interface ReturnReportItem {
      returnId: string;
      invoiceId: number;
      invoiceNumber: string;
      returnDate: string;
      customerName: string;
      reason: string;
      recordedBy: string;
      itemsCount: number;
      itemsSummary: string;
      totalRefund: number;
      cashRefund: number;
      creditAdjustment: number;
    }

    const tableItems: ReturnReportItem[] = [];

    for (const order of orders) {
      const parsed = parseOrderStructuredNotes(order.notes);
      const returns = parsed.returns || [];

      for (const ret of returns) {
        const retDate = new Date(ret.returnDate || order.updatedAt || order.createdAt);
        // Date window check for this return event
        if (isNaN(retDate.getTime()) || retDate < startDate || retDate > endDate) {
          continue;
        }

        totalReturnEvents += 1;
        const refundAmount = Number(ret.totalReturnRefund || 0);
        const cashRefund = Number(ret.cashRefundAmount || 0);
        const creditAdj = Number(ret.creditDueAdjustment || (refundAmount - cashRefund));

        totalReturnValue += refundAmount;
        totalCashRefund += cashRefund;
        totalCreditAdjustment += creditAdj;

        const reason = (ret.reason || 'General Return').trim();
        if (!reasonsBreakdown[reason]) {
          reasonsBreakdown[reason] = { count: 0, refund: 0, qty: 0 };
        }
        reasonsBreakdown[reason].count += 1;
        reasonsBreakdown[reason].refund += refundAmount;

        let itemsCount = 0;
        const itemDescriptions: string[] = [];

        (ret.returnedItems || []).forEach((rit: any) => {
          const qty = Number(rit.returnQty || 0);
          itemsCount += qty;
          totalItemsReturned += qty;
          reasonsBreakdown[reason].qty += qty;
          const label = rit.productName
            ? `${rit.productName}${rit.variantName ? ` (${rit.variantName})` : ''} x${qty}`
            : `Variant #${rit.variantId} x${qty}`;
          itemDescriptions.push(label);
        });

        tableItems.push({
          returnId: ret.returnId || `RET-${order.id}-${tableItems.length + 1}`,
          invoiceId: order.id,
          invoiceNumber: order.invoiceNumber || `INV${order.id}`,
          returnDate: retDate.toISOString(),
          customerName: order.customer?.name || order.customerName || 'Walk-in Customer',
          reason,
          recordedBy: ret.recordedBy || 'Cashier',
          itemsCount,
          itemsSummary: itemDescriptions.join(', ') || 'Returned Items',
          totalRefund: Math.round(refundAmount * 100) / 100,
          cashRefund: Math.round(cashRefund * 100) / 100,
          creditAdjustment: Math.round(creditAdj * 100) / 100,
        });
      }
    }

    // Sort descending by returnDate
    tableItems.sort((a, b) => new Date(b.returnDate).getTime() - new Date(a.returnDate).getTime());

    return {
      module: 'returns',
      dateFilter,
      summary: {
        totalReturnEvents,
        totalItemsReturned,
        totalReturnValue: Math.round(totalReturnValue * 100) / 100,
        totalCashRefund: Math.round(totalCashRefund * 100) / 100,
        totalCreditAdjustment: Math.round(totalCreditAdjustment * 100) / 100,
        reasonsBreakdown,
      },
      tableItems,
    };
  }

  /**
   * 3. INVENTORY & STOCK VALUATION REPORT
   * Real-time warehouse inventory valuation (Cost vs Retail), low-stock warning detection,
   * and potential gross profit margin calculation.
   */
  async getInventoryReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;
    const variants = await prisma.productVariant.findMany({
      where: {
        OR: [
          { createdAt: { gte: startDate, lte: endDate } },
          { updatedAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
            isActive: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { stock: 'asc' }, { id: 'asc' }],
    });

    let totalSkus = 0;
    let totalStockUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    const tableItems = variants.map((v) => {
      totalSkus += 1;
      const stock = Number(v.stock || 0);
      const cost = Number(v.costPrice || 0);
      const retail = Number(v.retailPrice || 0);

      totalStockUnits += stock;
      const costVal = stock * cost;
      const retailVal = stock * retail;
      totalCostValuation += costVal;
      totalRetailValuation += retailVal;

      let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
      if (stock <= 0) {
        status = 'Out of Stock';
        outOfStockCount += 1;
      } else if (stock <= 5) {
        status = 'Low Stock';
        lowStockCount += 1;
      }

      const variantName = [v.size, v.color].filter(Boolean).join(' / ') || 'Standard';

      return {
        id: v.id,
        sku: v.sku || `SKU-${v.id}`,
        barcode: v.barcode || '-',
        productName: v.product?.name || 'Unnamed Product',
        categoryName: v.product?.category?.name || 'Uncategorized',
        variant: variantName,
        stock,
        costPrice: cost,
        retailPrice: retail,
        costValuation: Math.round(costVal * 100) / 100,
        retailValuation: Math.round(retailVal * 100) / 100,
        status,
      };
    });

    const potentialGrossProfit = totalRetailValuation - totalCostValuation;

    return {
      module: 'inventory',
      dateFilter,
      summary: {
        totalSkus,
        totalStockUnits,
        totalCostValuation: Math.round(totalCostValuation * 100) / 100,
        totalRetailValuation: Math.round(totalRetailValuation * 100) / 100,
        potentialGrossProfit: Math.round(potentialGrossProfit * 100) / 100,
        lowStockCount,
        outOfStockCount,
      },
      tableItems,
    };
  }

  /**
   * 4. PRODUCTS & VARIANTS SALES VELOCITY REPORT
   * Evaluates velocity (fast/slow moving SKUs), units sold, and revenue generated per product category.
   */
  async getProductsReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;

    // Fetch order items sold during the period
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: startDate, lte: endDate },
          status: { not: OrderStatus.CANCELLED },
        },
      },
      include: {
        variant: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Aggregate by variantId
    const aggregatedMap = new Map<number, {
      variantId: number;
      sku: string;
      productName: string;
      categoryName: string;
      variantName: string;
      soldQty: number;
      totalRevenue: number;
      currentStock: number;
    }>();

    const categoryRevenueMap: Record<string, { revenue: number; qty: number }> = {};
    let totalProductsSold = 0;
    let totalRevenue = 0;

    for (const item of orderItems) {
      const v = item.variant;
      if (!v) continue;

      const variantId = v.id;
      const qty = item.quantity || 0;
      const rev = item.price || 0;

      totalProductsSold += qty;
      totalRevenue += rev;

      const catName = v.product?.category?.name || 'General';
      if (!categoryRevenueMap[catName]) {
        categoryRevenueMap[catName] = { revenue: 0, qty: 0 };
      }
      categoryRevenueMap[catName].revenue += rev;
      categoryRevenueMap[catName].qty += qty;

      const existing = aggregatedMap.get(variantId);
      if (existing) {
        existing.soldQty += qty;
        existing.totalRevenue += rev;
      } else {
        const vDesc = [v.size, v.color].filter(Boolean).join(' / ') || 'Standard';
        aggregatedMap.set(variantId, {
          variantId,
          sku: v.sku || `SKU-${v.id}`,
          productName: v.product?.name || 'Garment Product',
          categoryName: catName,
          variantName: vDesc,
          soldQty: qty,
          totalRevenue: rev,
          currentStock: v.stock || 0,
        });
      }
    }

    const tableItems = Array.from(aggregatedMap.values()).map((row) => {
      let velocity: 'Fast' | 'Moderate' | 'Slow' = 'Moderate';
      if (row.soldQty >= 20) velocity = 'Fast';
      else if (row.soldQty <= 3) velocity = 'Slow';

      return {
        ...row,
        totalRevenue: Math.round(row.totalRevenue * 100) / 100,
        velocity,
      };
    });

    // Sort by soldQty descending
    tableItems.sort((a, b) => b.soldQty - a.soldQty);

    const categoryBreakdown = Object.entries(categoryRevenueMap).map(([category, val]) => ({
      category,
      revenue: Math.round(val.revenue * 100) / 100,
      quantity: val.qty,
    }));

    const topProduct = tableItems.length > 0 ? tableItems[0].productName : 'None';
    const topCategory = categoryBreakdown.length > 0
      ? [...categoryBreakdown].sort((a, b) => b.revenue - a.revenue)[0].category
      : 'None';

    return {
      module: 'products',
      dateFilter,
      summary: {
        totalProductsSold,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        topProduct,
        topCategory,
        categoryBreakdown,
      },
      tableItems,
    };
  }

  /**
   * 5. RAW MATERIALS & FABRIC LEDGER REPORT
   * Current fabric warehouse balances, weighted average cost valuation, and scrap/wastage aggregates.
   */
  async getMaterialsReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;

    const materials = await prisma.rawMaterialItem.findMany({
      where: {
        isActive: true,
        OR: [
          { createdAt: { gte: startDate, lte: endDate } },
          { updatedAt: { gte: startDate, lte: endDate } },
          {
            movements: {
              some: {
                createdAt: { gte: startDate, lte: endDate },
              },
            },
          },
        ],
      },
      orderBy: { name: 'asc' },
    });

    // Fetch scrap and damage movements recorded in the period
    const movements = await prisma.rawMaterialMovement.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    let totalMaterials = materials.length;
    let totalStockUnits = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let periodScrapQty = 0;
    let periodDamageWasteQty = 0;
    let periodScrapValuation = 0;

    // Movement maps
    const materialScrapMap = new Map<number, number>();
    const materialUsageMap = new Map<number, number>();

    for (const m of movements) {
      if (m.movementType === 'SCRAP_RETURN') {
        periodScrapQty += m.quantity;
        materialScrapMap.set(m.rawMaterialItemId, (materialScrapMap.get(m.rawMaterialItemId) || 0) + m.quantity);
      } else if (m.movementType === 'DAMAGE_WASTE') {
        periodDamageWasteQty += m.quantity;
        materialScrapMap.set(m.rawMaterialItemId, (materialScrapMap.get(m.rawMaterialItemId) || 0) + m.quantity);
      } else if (m.movementType === 'PRODUCTION_USE') {
        materialUsageMap.set(m.rawMaterialItemId, (materialUsageMap.get(m.rawMaterialItemId) || 0) + m.quantity);
      }
    }

    const tableItems = materials.map((mat) => {
      const stock = Number(mat.currentStock || 0);
      const unitCost = Number(mat.unitCostAverage || 0);
      const val = stock * unitCost;

      totalStockUnits += stock;
      totalValuation += val;

      const isLow = stock <= mat.alertThreshold;
      if (isLow) lowStockCount += 1;

      const scrapForMat = materialScrapMap.get(mat.id) || 0;
      periodScrapValuation += scrapForMat * unitCost;

      return {
        id: mat.id,
        code: mat.code || `RM-${mat.id}`,
        name: mat.name,
        unit: mat.unit,
        currentStock: Math.round(stock * 100) / 100,
        alertThreshold: mat.alertThreshold,
        unitCostAverage: Math.round(unitCost * 100) / 100,
        totalValuation: Math.round(val * 100) / 100,
        periodUsage: Math.round((materialUsageMap.get(mat.id) || 0) * 100) / 100,
        periodScrap: Math.round(scrapForMat * 100) / 100,
        status: isLow ? ('Low Stock' as const) : ('Optimal' as const),
      };
    });

    return {
      module: 'materials',
      dateFilter,
      summary: {
        totalMaterials,
        totalStockUnits: Math.round(totalStockUnits * 100) / 100,
        totalValuation: Math.round(totalValuation * 100) / 100,
        lowStockCount,
        periodScrapQty: Math.round(periodScrapQty * 100) / 100,
        periodDamageWasteQty: Math.round(periodDamageWasteQty * 100) / 100,
        periodScrapValuation: Math.round(periodScrapValuation * 100) / 100,
      },
      tableItems,
    };
  }

  /**
   * 6. GARMENT PRODUCTION REPORT
   * Batch statuses, total completed garment output, fabric consumption vs actual yield, and scrap variance.
   */
  async getProductionReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;

    const productionOrders = await prisma.productionOrder.findMany({
      where: {
        OR: [
          { productionDate: { gte: startDate, lte: endDate } },
          { createdAt: { gte: startDate, lte: endDate } },
          { updatedAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, size: true, color: true } },
        materialUsages: {
          include: {
            rawMaterial: { select: { id: true, name: true, unit: true } },
          },
        },
      },
      orderBy: { productionDate: 'desc' },
    });

    let totalBatches = productionOrders.length;
    let targetQuantity = 0;
    let completedQuantity = 0;
    let totalMaterialCost = 0;
    let scrapVariance = 0;

    const tableItems = productionOrders.map((batch) => {
      const target = Number(batch.targetQuantity || 0);
      const completed = Number(batch.completedQty || 0);
      targetQuantity += target;
      completedQuantity += completed;

      let batchCost = 0;
      let batchReturned = 0;

      batch.materialUsages.forEach((u) => {
        const netConsumed = Number(u.netConsumedQty || 0);
        const cost = Number(u.unitCost || 0);
        batchCost += netConsumed * cost;
        batchReturned += Number(u.returnedQty || 0);
      });

      totalMaterialCost += batchCost;
      scrapVariance += batchReturned;

      const yieldPercentage = target > 0 ? Math.round((completed / target) * 1000) / 10 : 0;
      const vDesc = batch.variant
        ? [batch.variant.size, batch.variant.color].filter(Boolean).join(' / ')
        : 'All Sizes';

      return {
        id: batch.id,
        productionNo: batch.productionNo,
        productName: batch.product?.name || 'Garment Production Order',
        variant: vDesc,
        targetQuantity: target,
        completedQty: completed,
        yieldPercentage,
        materialCost: Math.round(batchCost * 100) / 100,
        scrapReturned: Math.round(batchReturned * 100) / 100,
        productionDate: batch.productionDate.toISOString(),
        status: batch.status || 'COMPLETED',
      };
    });

    const overallYieldPercentage =
      targetQuantity > 0 ? Math.round((completedQuantity / targetQuantity) * 1000) / 10 : 0;

    return {
      module: 'production',
      dateFilter,
      summary: {
        totalBatches,
        targetQuantity,
        completedQuantity,
        overallYieldPercentage,
        totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
        scrapVariance: Math.round(scrapVariance * 100) / 100,
      },
      tableItems,
    };
  }

  /**
   * 7. SUPPLIERS & GRN (GOODS RECEIVED NOTES) REPORT
   * Inward stock purchases, supplier payment records, and outstanding payables ledger.
   */
  async getSuppliersReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;

    const suppliers = await prisma.rawMaterialShop.findMany({
      where: {
        isActive: true,
        OR: [
          { createdAt: { gte: startDate, lte: endDate } },
          { updatedAt: { gte: startDate, lte: endDate } },
          {
            purchases: {
              some: {
                OR: [
                  { purchaseDate: { gte: startDate, lte: endDate } },
                  { createdAt: { gte: startDate, lte: endDate } },
                ],
              },
            },
          },
        ],
      },
      include: {
        purchases: {
          where: {
            OR: [
              { purchaseDate: { gte: startDate, lte: endDate } },
              { createdAt: { gte: startDate, lte: endDate } },
            ],
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Also get recent purchases for the breakdown
    const recentPurchases = await prisma.buyRawMaterial.findMany({
      where: {
        OR: [
          { purchaseDate: { gte: startDate, lte: endDate } },
          { createdAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        shop: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { purchaseDate: 'desc' },
      take: 100,
    });

    let totalSuppliers = suppliers.length;
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalOutstandingPayables = 0;

    const tableItems = suppliers.map((sup) => {
      let supPurchases = 0;
      let supPaid = 0;

      sup.purchases.forEach((p) => {
        supPurchases += Number(p.totalAmount || 0);
        supPaid += Number(p.paidAmount || 0);
      });

      totalPurchases += supPurchases;
      totalPaid += supPaid;
      const creditBal = Number(sup.creditBalance || 0);
      totalOutstandingPayables += creditBal;

      return {
        supplierId: sup.id,
        supplierName: sup.name,
        contactPerson: sup.contactPerson || '-',
        phone: sup.phone || '-',
        grnCount: sup.purchases.length,
        totalPurchases: Math.round(supPurchases * 100) / 100,
        totalPaid: Math.round(supPaid * 100) / 100,
        outstandingBalance: Math.round(creditBal * 100) / 100,
      };
    });

    const recentPurchaseLogs = recentPurchases.map((p) => {
      const tot = Number(p.totalAmount || 0);
      const paid = Number(p.paidAmount || 0);
      return {
        id: p.id,
        grnNo: p.invoiceNumber || `GRN-${String(p.id).padStart(4, '0')}`,
        supplierName: p.shop?.name || 'Unknown Supplier',
        date: p.purchaseDate.toISOString(),
        totalAmount: tot,
        paidAmount: paid,
        balanceDue: Math.max(0, tot - paid),
        paymentStatus: p.paymentStatus,
      };
    });

    return {
      module: 'suppliers',
      dateFilter,
      summary: {
        totalSuppliers,
        totalPurchases: Math.round(totalPurchases * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalOutstandingPayables: Math.round(totalOutstandingPayables * 100) / 100,
        grnCount: recentPurchases.length,
      },
      tableItems,
      recentPurchaseLogs,
    };
  }

  /**
   * 8. AUDIT & INVOICE EDITS REPORT
   * Modifications audit trail, cashier revision frequency, and financial reconciliations.
   */
  async getAuditReport(dateFilter: DateFilterResult) {
    const { startDate, endDate } = dateFilter;

    // Fetch invoices within the window (filtering revisions by updatedAt with fallback to createdAt)
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { updatedAt: { gte: startDate, lte: endDate } },
          { createdAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    let totalInvoicesInPeriod = orders.length;
    let modifiedInvoicesCount = 0;
    const cashierEditsMap: Record<string, number> = {};

    const tableItems = orders
      .filter((order) => {
        // Condition for modified invoice:
        // updatedAt differs from createdAt by > 30 seconds, or notes indicate history
        const diffSeconds = Math.abs(order.updatedAt.getTime() - order.createdAt.getTime()) / 1000;
        const parsed = parseOrderStructuredNotes(order.notes);
        const hasReturns = parsed.returns.length > 0;
        const isModified = diffSeconds > 30 || hasReturns;
        return isModified;
      })
      .map((order) => {
        modifiedInvoicesCount += 1;
        const cashierName = order.user?.name || 'Cashier Terminal';
        cashierEditsMap[cashierName] = (cashierEditsMap[cashierName] || 0) + 1;

        const diffMinutes = Math.round(
          (Math.abs(order.updatedAt.getTime() - order.createdAt.getTime()) / (1000 * 60)) * 10
        ) / 10;

        const parsed = parseOrderStructuredNotes(order.notes);

        return {
          id: order.id,
          invoiceNumber: order.invoiceNumber || `INV${order.id}`,
          customerName: order.customer?.name || order.customerName || 'Walk-in Customer',
          cashier: cashierName,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          timeDeltaMinutes: diffMinutes,
          totalAmount: Number(order.totalAmount || 0),
          paidAmount: Number(order.paidAmount || 0),
          status: order.status,
          hasReturn: parsed.returns.length > 0,
          returnCount: parsed.returns.length,
          userNotes: parsed.userNotes || '-',
        };
      });

    const modificationRate =
      totalInvoicesInPeriod > 0
        ? Math.round((modifiedInvoicesCount / totalInvoicesInPeriod) * 1000) / 10
        : 0;

    const topCashierEntry = Object.entries(cashierEditsMap).sort((a, b) => b[1] - a[1])[0];
    const topCashierWithEdits = topCashierEntry ? `${topCashierEntry[0]} (${topCashierEntry[1]} revisions)` : 'None';

    return {
      module: 'audit',
      dateFilter,
      summary: {
        totalInvoicesInPeriod,
        modifiedInvoicesCount,
        modificationRate,
        topCashierWithEdits,
        cashierEditsBreakdown: cashierEditsMap,
      },
      tableItems,
    };
  }

  /**
   * Master Consolidated Audit Compiler:
   * Aggregates all domain modules (Sales, Returns, Inventory, Products, Materials, Production, GRN, Audit Edits)
   * into a single unified analytical report payload with master executive summary.
   */
  async getConsolidatedReportData(dateFilter: DateFilterResult) {
    const [sales, returns, inventory, products, materials, production, suppliers, audit] = await Promise.all([
      this.getSalesReport(dateFilter),
      this.getReturnsReport(dateFilter),
      this.getInventoryReport(dateFilter),
      this.getProductsReport(dateFilter),
      this.getMaterialsReport(dateFilter),
      this.getProductionReport(dateFilter),
      this.getSuppliersReport(dateFilter),
      this.getAuditReport(dateFilter),
    ]);

    const masterSummary = {
      grossRevenue: sales.summary?.grossRevenue || 0,
      netSales: sales.summary?.netSales || 0,
      totalPaid: sales.summary?.totalPaid || 0,
      totalDue: sales.summary?.totalDue || 0,
      totalReturnValue: returns.summary?.totalReturnValue || 0,
      totalItemsReturned: returns.summary?.totalItemsReturned || 0,
      totalSkus: inventory.summary?.totalSkus || 0,
      totalStockUnits: inventory.summary?.totalStockUnits || 0,
      inventoryCostValuation: inventory.summary?.totalCostValuation || 0,
      inventoryRetailValuation: inventory.summary?.totalRetailValuation || 0,
      materialsValuation: materials.summary?.totalValuation || 0,
      supplierPurchases: suppliers.summary?.totalPurchases || 0,
      supplierDebt: suppliers.summary?.totalOutstandingPayables || 0,
      productionCompletedQty: production.summary?.completedQuantity || 0,
      productionYieldPct: production.summary?.overallYieldPercentage || 0,
      auditedInvoices: audit.summary?.totalInvoicesInPeriod || 0,
      modifiedInvoices: audit.summary?.modifiedInvoicesCount || 0,
    };

    return {
      module: 'consolidated' as const,
      dateFilter,
      masterSummary,
      sections: {
        sales,
        returns,
        inventory,
        products,
        materials,
        production,
        suppliers,
        audit,
      },
    };
  }

  /**
   * Router Dispatcher: Delegates to domain-specific analytical aggregation service
   */
  async getReportData(module: ReportModule, filter: DateFilterResult, repUserId?: number) {
    switch (module) {
      case 'sales':
        return this.getSalesReport(filter, repUserId);
      case 'returns':
        return this.getReturnsReport(filter);
      case 'inventory':
        return this.getInventoryReport(filter);
      case 'products':
        return this.getProductsReport(filter);
      case 'materials':
        return this.getMaterialsReport(filter);
      case 'production':
        return this.getProductionReport(filter);
      case 'suppliers':
        return this.getSuppliersReport(filter);
      case 'audit':
        return this.getAuditReport(filter);
      default:
        throw new HttpException(400, `Unsupported report domain module: ${module}`);
    }
  }
}

export const reportService = new ReportService();
