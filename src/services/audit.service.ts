import { prisma } from '../lib/prisma.ts';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { resolveDateFilter, type DateFilterResult } from './report.service.ts';
import { parseOrderStructuredNotes } from './order.service.ts';
import { OrderStatus } from '@prisma/client';

export interface FinancialWaterfallItem {
  component: string;
  category: string;
  operator: '+' | '-' | '=';
  amount: number;
  description: string;
}

export interface FinancialAuditSummary {
  dateFilter: DateFilterResult;
  grossRevenue: number;
  totalDiscount: number;
  totalReturns: number;
  netSales: number;
  totalPaid: number;
  totalDue: number; // Customer Credit Receivables
  orderCount: number;
  costOfGoodsSold: number;
  grossProfit: number;
  grossProfitMargin: number;
  totalProductionCost: number;
  completedGarments: number;
  totalGrnExpenses: number;
  totalGrnPaid: number;
  totalGrnLiabilities: number; // Supplier Payables
  netOperationalRevenue: number;
  netOperationalProfit: number;
  waterfallBreakdown: FinancialWaterfallItem[];
  productionBatchesCount: number;
  grnNotesCount: number;
}

function formatReportTimestamp(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hh = String(hours).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${minutes} ${ampm}`;
}

function formatCurrency(val: number): string {
  return `Rs. ${Number(val || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export class AuditService {
  /**
   * Computes comprehensive financial audit analytics:
   * Gross sales, discounts, customer credit balances, COGS, production costs, and GRN liabilities
   * to determine exact Net Operational Revenue and Profit over the selected period.
   */
  async getFinancialAuditData(params: {
    preset?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<FinancialAuditSummary> {
    const dateFilter = resolveDateFilter(params);
    const { startDate, endDate } = dateFilter;

    // 1. Fetch Orders within period
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: { not: OrderStatus.CANCELLED },
      },
      include: {
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            isReturn: true,
            variant: {
              select: {
                id: true,
                costPrice: true,
                retailPrice: true,
                wholesalePrice: true,
              },
            },
          },
        },
      },
    });

    let grossRevenue = 0;
    let totalDiscount = 0;
    let netSales = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let totalReturns = 0;
    let costOfGoodsSold = 0;

    for (const order of orders) {
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

      if (order.notes && order.notes.includes('returns')) {
        const parsed = parseOrderStructuredNotes(order.notes);
        if (Array.isArray(parsed.returns)) {
          for (const ret of parsed.returns) {
            totalReturns += Number(ret.totalReturnRefund || 0);
          }
        }
      }

      for (const item of order.items) {
        if (!item.isReturn) {
          const cost = Number(item.variant?.costPrice || 0);
          costOfGoodsSold += cost * Number(item.quantity || 0);
        }
      }
    }

    // 2. Fetch Production Material Usages & Finished Garments in period
    const [periodMaterialUsages, productionOrders] = await Promise.all([
      prisma.productionMaterialUsage.findMany({
        where: {
          productionOrder: {
            OR: [
              { productionDate: { gte: startDate, lte: endDate } },
              { createdAt: { gte: startDate, lte: endDate } },
            ],
            status: { not: 'CANCELLED' },
          },
        },
        select: {
          netConsumedQty: true,
          unitCost: true,
        },
      }),
      prisma.productionOrder.findMany({
        where: {
          OR: [
            { productionDate: { gte: startDate, lte: endDate } },
            { createdAt: { gte: startDate, lte: endDate } },
          ],
          status: { not: 'CANCELLED' },
        },
        select: {
          completedQty: true,
        },
      }),
    ]);

    const totalProductionCost = periodMaterialUsages.reduce(
      (sum, u) => sum + Number(u.netConsumedQty || 0) * Number(u.unitCost || 0),
      0
    );
    const completedGarments = productionOrders.reduce(
      (sum, p) => sum + (Number(p.completedQty) || 0),
      0
    );

    // 3. Fetch GRN Supplier Purchases in period
    const grnPurchases = await prisma.buyRawMaterial.findMany({
      where: {
        OR: [
          { purchaseDate: { gte: startDate, lte: endDate } },
          { createdAt: { gte: startDate, lte: endDate } },
        ],
      },
      select: {
        totalAmount: true,
        paidAmount: true,
      },
    });

    const totalGrnExpenses = grnPurchases.reduce(
      (sum, p) => sum + Number(p.totalAmount || 0),
      0
    );
    const totalGrnPaid = grnPurchases.reduce(
      (sum, p) => sum + Number(p.paidAmount || 0),
      0
    );
    const totalGrnLiabilities = Math.max(0, totalGrnExpenses - totalGrnPaid);

    // 4. Exact Mathematical Metrics
    const grossProfit = Math.round((netSales - costOfGoodsSold) * 100) / 100;
    const grossProfitMargin =
      netSales > 0 ? Math.round(((netSales - costOfGoodsSold) / netSales) * 10000) / 100 : 0;

    // Net Operational Revenue formula: Realized Cash Inflow - Direct Production Expenses - GRN Procurement Expenses
    const netOperationalRevenue =
      Math.round((totalPaid - totalProductionCost - totalGrnExpenses) * 100) / 100;
    // Operational Profit: Net Sales minus Production Costs minus GRN Expenses
    const netOperationalProfit =
      Math.round((netSales - totalProductionCost - totalGrnExpenses) * 100) / 100;

    // 5. Build Waterfall Ledger Items
    const waterfallBreakdown: FinancialWaterfallItem[] = [
      {
        component: 'Gross Sales Revenue',
        category: 'Revenue Inflow',
        operator: '+',
        amount: Math.round(grossRevenue * 100) / 100,
        description: 'Aggregate retail & wholesale catalogue list value before deductions',
      },
      {
        component: 'Discounts Granted',
        category: 'Revenue Deduction',
        operator: '-',
        amount: Math.round(totalDiscount * 100) / 100,
        description: 'Customer bill & line-item promotional discounts deducted',
      },
      {
        component: 'Restocked Garment Returns',
        category: 'Revenue Deduction',
        operator: '-',
        amount: Math.round(totalReturns * 100) / 100,
        description: 'Approved returns, credit adjustments, and refunds issued',
      },
      {
        component: 'Net Sales Invoices Value',
        category: 'Net Billed',
        operator: '=',
        amount: Math.round(netSales * 100) / 100,
        description: 'Billed sales accrued to the business: Gross - Discounts - Returns',
      },
      {
        component: 'Customer Credit Receivables (Unpaid)',
        category: 'Working Capital',
        operator: '-',
        amount: Math.round(totalDue * 100) / 100,
        description: 'Outstanding customer debt balances awaiting collection',
      },
      {
        component: 'Realized Liquid Cash Inflow',
        category: 'Cash Inflow',
        operator: '=',
        amount: Math.round(totalPaid * 100) / 100,
        description: 'Actual liquid funds collected (Cash, Card, Cleared Cheques)',
      },
      {
        component: 'Direct Production Material Cost',
        category: 'Operational Cost',
        operator: '-',
        amount: Math.round(totalProductionCost * 100) / 100,
        description: 'Fabric & raw materials consumed in active cutting & production batches',
      },
      {
        component: 'GRN Supplier Procurement Expenses',
        category: 'Operational Cost',
        operator: '-',
        amount: Math.round(totalGrnExpenses * 100) / 100,
        description: 'Raw materials & accessories received from vendors on Goods Received Notes',
      },
      {
        component: 'Net Operational Revenue (Cashflow)',
        category: 'Bottom Line',
        operator: '=',
        amount: netOperationalRevenue,
        description: 'Net operational liquidity: Realized Inflow - Production Costs - GRN Outflows',
      },
      {
        component: 'Net Operational Profit (Accrual)',
        category: 'Bottom Line',
        operator: '=',
        amount: netOperationalProfit,
        description: 'Net operating surplus: Net Billed Sales - Production Costs - GRN Expenses',
      },
    ];

    return {
      dateFilter,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalReturns: Math.round(totalReturns * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalDue: Math.round(totalDue * 100) / 100,
      orderCount: orders.length,
      costOfGoodsSold: Math.round(costOfGoodsSold * 100) / 100,
      grossProfit,
      grossProfitMargin,
      totalProductionCost: Math.round(totalProductionCost * 100) / 100,
      completedGarments,
      totalGrnExpenses: Math.round(totalGrnExpenses * 100) / 100,
      totalGrnPaid: Math.round(totalGrnPaid * 100) / 100,
      totalGrnLiabilities: Math.round(totalGrnLiabilities * 100) / 100,
      netOperationalRevenue,
      netOperationalProfit,
      waterfallBreakdown,
      productionBatchesCount: productionOrders.length,
      grnNotesCount: grnPurchases.length,
    };
  }

  /**
   * Generates a clean, professional Master Financial Audit & Operational Revenue PDF document.
   */
  generateMasterAuditPdf(
    audit: FinancialAuditSummary,
    user?: { name?: string; role?: string }
  ): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const startX = 42.5;
    const rightMargin = 552.78;
    const pageWidth = 510.28;
    const headerTop = 32;

    const dateLabel = audit.dateFilter?.presetLabel || 'Audit Period';
    const timestamp = formatReportTimestamp();
    const auditorName = user?.name ? `${user.name} (${user.role || 'Auditor'})` : 'Internal Accounts';

    // ── Official Branding Header ──
    const potentialPaths = [
      path.resolve(process.cwd(), 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public', 'logo.jpg'),
      path.resolve(process.cwd(), 'dist', 'public', 'images', 'logo.jpg'),
    ];
    const logoPath = potentialPaths.find((p) => fs.existsSync(p));

    let brandTextX = startX;
    if (logoPath && fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
      try {
        doc.image(logoPath, startX, headerTop - 2, { width: 48, height: 48 });
        brandTextX = startX + 56;
      } catch {
        brandTextX = startX;
      }
    }

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE', brandTextX, headerTop - 3, { characterSpacing: 1.5 });
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#111111').text('BRANDED MENS CLOTHING', brandTextX, headerTop + 24, { characterSpacing: 2 });
    doc.fontSize(8).font('Helvetica').fillColor('#222222').text('Mawarala Road, Makandura, Matara.', brandTextX, headerTop + 36);
    doc.font('Helvetica-Bold').fontSize(8).text('Tel: ', brandTextX, headerTop + 47, { continued: true }).font('Helvetica').text('041-2268739, 071-1350123');
    doc.font('Helvetica-Bold').fontSize(8).text('Web: ', brandTextX, headerTop + 58, { continued: true }).font('Helvetica').text('relianceapparel.lk');

    const metaX = doc.page.width - 200;
    const metaWidth = 160;

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
    doc.text('MASTER FINANCIAL AUDIT & OPERATIONAL REVENUE SUMMARY', 260, headerTop - 1, { width: rightMargin - 260, align: 'right' });
    const titleBottomY = doc.y;

    let metaY = headerTop + 20;

    const metaRows = [
      { label: 'AUDIT PERIOD:', value: dateLabel, isBold: true },
      { label: 'GENERATED:', value: timestamp, isBold: false },
      { label: 'CERTIFIED BY:', value: auditorName, isBold: false },
    ];

    metaRows.forEach((row) => {
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#555555').text(row.label, metaX, metaY, { width: 62, align: 'left' });
      const valFont = row.isBold ? 'Helvetica-Bold' : 'Helvetica';
      doc.fontSize(7.5).font(valFont).fillColor('#000000');
      doc.text(row.value, metaX + 62, metaY, { width: metaWidth - 62, align: 'right', lineBreak: true });
      metaY += 12;
    });

    const dividerY = Math.max(headerTop + 68, Math.max(titleBottomY, metaY)) + 6;
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.2).strokeColor('#000000').stroke();

    let curY = dividerY + 12;

    // ── Primary Executive KPI Cards Row 1 ──
    const drawCards = (cards: Array<{ label: string; value: string; color?: string }>, y: number): number => {
      const cardGap = 8;
      const cardWidth = (pageWidth - (cards.length - 1) * cardGap) / cards.length;
      const cardHeight = 38;

      cards.forEach((card, idx) => {
        const cardX = startX + idx * (cardWidth + cardGap);
        doc.rect(cardX, y, cardWidth, cardHeight).lineWidth(0.8).strokeColor('#000000').fillColor('#ffffff').fillAndStroke();
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#555555').text(card.label, cardX + 6, y + 6, { width: cardWidth - 12 });
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(card.color || '#000000').text(card.value, cardX + 6, y + 19, { width: cardWidth - 12, align: 'right' });
      });

      return y + cardHeight + 8;
    };

    curY = drawCards([
      { label: 'GROSS SALES VALUE', value: formatCurrency(audit.grossRevenue) },
      { label: 'TOTAL DISCOUNTS', value: formatCurrency(audit.totalDiscount) },
      { label: 'NET BILLED SALES', value: formatCurrency(audit.netSales) },
      { label: 'REALIZED CASH INFLOW', value: formatCurrency(audit.totalPaid) },
    ], curY);

    curY = drawCards([
      { label: 'PRODUCTION COSTS', value: formatCurrency(audit.totalProductionCost) },
      { label: 'GRN PURCHASES', value: formatCurrency(audit.totalGrnExpenses) },
      { label: 'SUPPLIER LIABILITIES', value: formatCurrency(audit.totalGrnLiabilities) },
      { label: 'CUSTOMER DEBT DUE', value: formatCurrency(audit.totalDue) },
    ], curY);

    curY = drawCards([
      { label: 'NET OPERATIONAL REV.', value: formatCurrency(audit.netOperationalRevenue), color: audit.netOperationalRevenue >= 0 ? '#000000' : '#b91c1c' },
      { label: 'OPERATIONAL PROFIT', value: formatCurrency(audit.netOperationalProfit), color: audit.netOperationalProfit >= 0 ? '#000000' : '#b91c1c' },
      { label: 'GROSS PROFIT (COGS)', value: formatCurrency(audit.grossProfit) },
      { label: 'PROFIT MARGIN', value: `${audit.grossProfitMargin}%` },
    ], curY);

    curY += 6;

    // ── Mathematical Waterfall Ledger Table ──
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('FINANCIAL WATERFALL & LEDGER RECONCILIATION', startX, curY);
    curY += 14;

    const colWidths = {
      op: 24,
      comp: 170,
      cat: 95,
      amt: 85,
      desc: 136.28,
    };

    // Table Header
    doc.rect(startX, curY, pageWidth, 16).fillColor('#000000').fill();
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#ffffff');
    let hX = startX + 4;
    doc.text('OP', hX, curY + 4, { width: colWidths.op, align: 'center' });
    hX += colWidths.op;
    doc.text('COMPONENT / LEDGER ENTRY', hX, curY + 4, { width: colWidths.comp });
    hX += colWidths.comp;
    doc.text('CLASSIFICATION', hX, curY + 4, { width: colWidths.cat });
    hX += colWidths.cat;
    doc.text('AMOUNT (RS.)', hX, curY + 4, { width: colWidths.amt, align: 'right' });
    hX += colWidths.amt + 6;
    doc.text('AUDIT NOTES & FORMULA', hX, curY + 4, { width: colWidths.desc });

    curY += 16;

    audit.waterfallBreakdown.forEach((item, rIdx) => {
      const isTotal = item.operator === '=';
      const rowHeight = 18;
      const bg = isTotal ? '#f1f5f9' : rIdx % 2 === 0 ? '#ffffff' : '#f8fafc';

      doc.rect(startX, curY, pageWidth, rowHeight).lineWidth(0.4).strokeColor('#e2e8f0').fillColor(bg).fillAndStroke();

      let rX = startX + 4;
      const fontName = isTotal ? 'Helvetica-Bold' : 'Helvetica';
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(item.operator === '+' ? '#15803d' : item.operator === '-' ? '#b91c1c' : '#000000');
      doc.text(item.operator, rX, curY + 4, { width: colWidths.op, align: 'center' });
      rX += colWidths.op;

      doc.fontSize(7.5).font(fontName).fillColor('#000000');
      doc.text(item.component, rX, curY + 4, { width: colWidths.comp });
      rX += colWidths.comp;

      doc.fontSize(7).font('Helvetica').fillColor('#475569');
      doc.text(item.category, rX, curY + 4, { width: colWidths.cat });
      rX += colWidths.cat;

      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(item.amount < 0 ? '#b91c1c' : '#000000');
      doc.text(formatCurrency(item.amount).replace('Rs. ', ''), rX, curY + 4, { width: colWidths.amt, align: 'right' });
      rX += colWidths.amt + 6;

      doc.fontSize(6.5).font('Helvetica').fillColor('#64748b');
      doc.text(item.description, rX, curY + 4, { width: colWidths.desc, lineBreak: false });

      curY += rowHeight;
    });

    curY += 14;

    // ── Production & Procurement Notes ──
    doc.rect(startX, curY, pageWidth, 42).lineWidth(0.8).strokeColor('#000000').fillColor('#f8fafc').fillAndStroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text('EXECUTIVE AUDIT NOTICE & LEDGER VERIFICATION', startX + 10, curY + 8);
    doc.fontSize(6.8).font('Helvetica').fillColor('#333333').text(
      `During this audit period, ${audit.orderCount} customer orders were logged totaling ${formatCurrency(audit.grossRevenue)} list value. ` +
      `Direct production consumed ${formatCurrency(audit.totalProductionCost)} across ${audit.productionBatchesCount} manufacturing orders delivering ${audit.completedGarments} finished garments. ` +
      `Raw materials procurement totaled ${formatCurrency(audit.totalGrnExpenses)} across ${audit.grnNotesCount} Goods Received Notes (GRN) with ${formatCurrency(audit.totalGrnLiabilities)} remaining in payables liabilities.`,
      startX + 10,
      curY + 18,
      { width: pageWidth - 20, lineBreak: true }
    );

    curY += 54;

    // ── Triple Sign-Off Block ──
    const signBoxWidth = (pageWidth - 24) / 3;
    const signBoxHeight = 52;
    const roles = [
      { role: 'PREPARED BY', desc: 'Accounts Officer / Cashier' },
      { role: 'CHECKED BY', desc: 'Internal Audit & Accounts' },
      { role: 'APPROVED BY', desc: 'Managing Director / Board' },
    ];

    roles.forEach((r, idx) => {
      const bX = startX + idx * (signBoxWidth + 12);
      doc.rect(bX, curY, signBoxWidth, signBoxHeight).lineWidth(0.8).strokeColor('#000000').fillColor('#ffffff').fillAndStroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text(r.role, bX + 6, curY + 6);
      doc.fontSize(6).font('Helvetica').fillColor('#64748b').text(r.desc, bX + 6, curY + 15);
      doc.moveTo(bX + 8, curY + 38).lineTo(bX + signBoxWidth - 8, curY + 38).lineWidth(0.4).strokeColor('#94a3b8').stroke();
      doc.fontSize(6).font('Helvetica').fillColor('#94a3b8').text('Signature & Date', bX + 8, curY + 41, { align: 'center', width: signBoxWidth - 16 });
    });

    // ── Master Page Numbers ──
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      const footerY = 841.89 - 28;
      doc.moveTo(startX, footerY - 4).lineTo(rightMargin, footerY - 4).lineWidth(0.4).strokeColor('#cbd5e1').stroke();
      doc.fontSize(6.5).font('Helvetica').fillColor('#64748b');
      doc.text('Reliance Master Financial Audit Report • Confidential & Proprietary', startX, footerY, { align: 'left' });
      doc.text(`Page ${i + 1} of ${totalPages}`, startX, footerY, { align: 'right', width: pageWidth });
    }

    return doc;
  }
}

export const auditService = new AuditService();

