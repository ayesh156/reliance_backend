import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import type { ReportModule } from './report.service.ts';

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

interface ColumnDef {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  key: string;
  format?: (val: any, row: any) => string;
}

interface KpiCard {
  label: string;
  value: string;
  subtext?: string;
}

const MODULE_TITLES: Record<ReportModule, string> = {
  sales: 'SALES & REVENUE REPORT',
  returns: 'RETURNS & RESTOCKING AUDIT',
  inventory: 'INVENTORY & STOCK VALUATION',
  products: 'PRODUCTS & SALES VELOCITY',
  materials: 'RAW MATERIALS & FABRIC LEDGER',
  production: 'GARMENT PRODUCTION & YIELD',
  suppliers: 'SUPPLIERS & GOODS RECEIVED NOTES',
  audit: 'INVOICE MODIFICATIONS & AUDIT',
};

// Module column definitions for tables
function getModuleColumns(module: ReportModule): ColumnDef[] {
  switch (module) {
    case 'sales':
      return [
        { header: 'INV #', width: 62, key: 'invoiceNumber' },
        { header: 'DATE', width: 65, key: 'createdAt', format: (d) => String(d).split('T')[0] },
        { header: 'CUSTOMER', width: 95, key: 'customerName' },
        { header: 'TYPE', width: 50, key: 'source', format: (s) => (s === 'POS_WHOLESALE' ? 'Wholesale' : 'Retail') },
        { header: 'SUBTOTAL', width: 60, align: 'right', key: 'subtotal', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'DISC', width: 45, align: 'right', key: 'discount', format: (v) => (v > 0 ? `-${v}` : '-') },
        { header: 'NET AMT', width: 65, align: 'right', key: 'totalAmount', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'DUE', width: 68.28, align: 'right', key: 'dueAmount', format: (v) => (v > 0 ? formatCurrency(v).replace('Rs. ', '') : '-') },
      ];

    case 'returns':
      return [
        { header: 'RETURN #', width: 68, key: 'returnId' },
        { header: 'DATE', width: 62, key: 'returnDate', format: (d) => String(d).split('T')[0] },
        { header: 'INV #', width: 55, key: 'invoiceNumber' },
        { header: 'CUSTOMER', width: 85, key: 'customerName' },
        { header: 'REASON', width: 75, key: 'reason' },
        { header: 'ITEMS', width: 85, key: 'itemsSummary' },
        { header: 'QTY', width: 30, align: 'center', key: 'itemsCount' },
        { header: 'REFUND', width: 50.28, align: 'right', key: 'totalRefund', format: (v) => formatCurrency(v).replace('Rs. ', '') },
      ];

    case 'inventory':
      return [
        { header: 'SKU', width: 75, key: 'sku' },
        { header: 'PRODUCT', width: 110, key: 'productName' },
        { header: 'CATEGORY', width: 70, key: 'categoryName' },
        { header: 'VARIANT', width: 60, key: 'variant' },
        { header: 'STOCK', width: 40, align: 'center', key: 'stock' },
        { header: 'COST', width: 50, align: 'right', key: 'costPrice', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'RETAIL', width: 50, align: 'right', key: 'retailPrice', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'STATUS', width: 55.28, align: 'center', key: 'status' },
      ];

    case 'products':
      return [
        { header: 'SKU', width: 75, key: 'sku' },
        { header: 'PRODUCT NAME', width: 120, key: 'productName' },
        { header: 'CATEGORY', width: 75, key: 'categoryName' },
        { header: 'VARIANT', width: 60, key: 'variantName' },
        { header: 'SOLD', width: 40, align: 'center', key: 'soldQty' },
        { header: 'REVENUE', width: 65, align: 'right', key: 'totalRevenue', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'STOCK', width: 40, align: 'center', key: 'currentStock' },
        { header: 'VELOCITY', width: 35.28, align: 'center', key: 'velocity' },
      ];

    case 'materials':
      return [
        { header: 'CODE', width: 70, key: 'code' },
        { header: 'MATERIAL NAME', width: 130, key: 'name' },
        { header: 'UNIT', width: 45, align: 'center', key: 'unit' },
        { header: 'BALANCE', width: 55, align: 'right', key: 'currentStock' },
        { header: 'ALERT', width: 45, align: 'right', key: 'alertThreshold' },
        { header: 'AVG COST', width: 55, align: 'right', key: 'unitCostAverage', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'VALUATION', width: 65, align: 'right', key: 'totalValuation', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'STATUS', width: 45.28, align: 'center', key: 'status' },
      ];

    case 'production':
      return [
        { header: 'PROD NO', width: 75, key: 'productionNo' },
        { header: 'GARMENT STYLE', width: 125, key: 'productName' },
        { header: 'SIZE/COLOR', width: 65, key: 'variant' },
        { header: 'TARGET', width: 45, align: 'center', key: 'targetQuantity' },
        { header: 'DONE', width: 40, align: 'center', key: 'completedQty' },
        { header: 'YIELD', width: 45, align: 'center', key: 'yieldPercentage', format: (v) => `${v}%` },
        { header: 'MAT COST', width: 60, align: 'right', key: 'materialCost', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'STATUS', width: 55.28, align: 'center', key: 'status' },
      ];

    case 'suppliers':
      return [
        { header: 'SUPPLIER NAME', width: 140, key: 'supplierName' },
        { header: 'CONTACT', width: 85, key: 'phone' },
        { header: 'GRN COUNT', width: 55, align: 'center', key: 'grnCount' },
        { header: 'PURCHASES', width: 75, align: 'right', key: 'totalPurchases', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'PAID', width: 75, align: 'right', key: 'totalPaid', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'OUTSTANDING', width: 80.28, align: 'right', key: 'outstandingBalance', format: (v) => formatCurrency(v).replace('Rs. ', '') },
      ];

    case 'audit':
      return [
        { header: 'INV #', width: 60, key: 'invoiceNumber' },
        { header: 'CUSTOMER', width: 85, key: 'customerName' },
        { header: 'CASHIER', width: 75, key: 'cashier' },
        { header: 'CREATED', width: 70, key: 'createdAt', format: (d) => String(d).split('T')[0] },
        { header: 'MODIFIED', width: 70, key: 'updatedAt', format: (d) => String(d).split('T')[0] },
        { header: 'DELTA (MIN)', width: 55, align: 'center', key: 'timeDeltaMinutes' },
        { header: 'AMOUNT', width: 55, align: 'right', key: 'totalAmount', format: (v) => formatCurrency(v).replace('Rs. ', '') },
        { header: 'STATUS', width: 40.28, align: 'center', key: 'status' },
      ];
  }
}

// Extract module KPI cards
function getModuleKpiCards(module: ReportModule, sum: any): KpiCard[] {
  const cards: KpiCard[] = [];
  if (!sum) return cards;

  if (module === 'sales') {
    cards.push(
      { label: 'GROSS REVENUE', value: formatCurrency(sum.grossRevenue) },
      { label: 'NET SALES', value: formatCurrency(sum.netSales) },
      { label: 'TOTAL PAID', value: formatCurrency(sum.totalPaid) },
      { label: 'OUTSTANDING DUE', value: formatCurrency(sum.totalDue) }
    );
  } else if (module === 'returns') {
    cards.push(
      { label: 'RETURN EVENTS', value: String(sum.totalReturnEvents || 0) },
      { label: 'ITEMS RESTOCKED', value: `${sum.totalItemsReturned || 0} Pcs` },
      { label: 'TOTAL RETURN VALUE', value: formatCurrency(sum.totalReturnValue) },
      { label: 'CASH REFUNDED', value: formatCurrency(sum.totalCashRefund) }
    );
  } else if (module === 'inventory') {
    cards.push(
      { label: 'TOTAL SKUs', value: String(sum.totalSkus || 0) },
      { label: 'TOTAL STOCK UNITS', value: `${sum.totalStockUnits || 0} Pcs` },
      { label: 'COST VALUATION', value: formatCurrency(sum.totalCostValuation) },
      { label: 'RETAIL VALUATION', value: formatCurrency(sum.totalRetailValuation) }
    );
  } else if (module === 'products') {
    cards.push(
      { label: 'UNITS SOLD', value: `${sum.totalProductsSold || 0} Pcs` },
      { label: 'TOTAL REVENUE', value: formatCurrency(sum.totalRevenue) },
      { label: 'TOP PRODUCT', value: String(sum.topProduct || 'N/A') },
      { label: 'TOP CATEGORY', value: String(sum.topCategory || 'N/A') }
    );
  } else if (module === 'materials') {
    cards.push(
      { label: 'MATERIAL ITEMS', value: String(sum.totalMaterials || 0) },
      { label: 'STOCK BALANCE', value: `${sum.totalStockUnits || 0}` },
      { label: 'STOCK VALUATION', value: formatCurrency(sum.totalValuation) },
      { label: 'SCRAP/WASTE QTY', value: `${sum.periodScrapQty || 0}` }
    );
  } else if (module === 'production') {
    cards.push(
      { label: 'PRODUCTION BATCHES', value: String(sum.totalBatches || 0) },
      { label: 'TARGET UNITS', value: `${sum.targetQuantity || 0}` },
      { label: 'COMPLETED OUTPUT', value: `${sum.completedQuantity || 0}` },
      { label: 'OVERALL YIELD', value: `${sum.overallYieldPercentage || 0}%` }
    );
  } else if (module === 'suppliers') {
    cards.push(
      { label: 'SUPPLIERS', value: String(sum.totalSuppliers || 0) },
      { label: 'TOTAL PURCHASES', value: formatCurrency(sum.totalPurchases) },
      { label: 'TOTAL PAID', value: formatCurrency(sum.totalPaid) },
      { label: 'OUTSTANDING DEBT', value: formatCurrency(sum.totalOutstandingPayables) }
    );
  } else if (module === 'audit') {
    cards.push(
      { label: 'INVOICES AUDITED', value: String(sum.totalInvoicesInPeriod || 0) },
      { label: 'MODIFIED INVOICES', value: String(sum.modifiedInvoicesCount || 0) },
      { label: 'MODIFICATION RATE', value: `${sum.modificationRate || 0}%` },
      { label: 'TOP REVISOR', value: String(sum.topCashierWithEdits || 'N/A') }
    );
  }
  return cards;
}

export class ReportPdfService {
  private static readonly startX = 42.5; // 15mm left margin
  private static readonly rightMargin = 552.78; // 15mm right margin (595.28 - 42.5)
  private static readonly pageWidth = 510.28; // 552.78 - 42.5
  private static readonly pageBottomThreshold = 750;

  /**
   * Helper: Draws official Reliance corporate header with crisp monochrome styling
   */
  private static drawHeader(
    doc: InstanceType<typeof PDFDocument>,
    reportTitle: string,
    dateLabel: string,
    generatedTimestamp: string,
    generatedBy: string
  ): number {
    const headerTop = 35;
    const startX = this.startX;
    const rightMargin = this.rightMargin;

    // Logo path resolution
    const potentialPaths = [
      path.resolve(process.cwd(), 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public', 'logo.jpg'),
      path.resolve(process.cwd(), 'dist', 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public_html', 'images', 'logo.jpg'),
    ];
    const logoPath = potentialPaths.find((p) => fs.existsSync(p));

    let brandTextX = startX;
    if (logoPath && fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
      try {
        doc.image(logoPath, startX, headerTop - 2, { width: 36, height: 36 });
        brandTextX = startX + 44;
      } catch {
        brandTextX = startX;
      }
    }

    // Brand details (Crisp black monochrome typography)
    doc.fontSize(15).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE', brandTextX, headerTop - 2, { characterSpacing: 1.2 });
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000').text('BRANDED MENS CLOTHING & APPAREL MFG', brandTextX, headerTop + 14, { characterSpacing: 1.2 });
    doc.fontSize(7).font('Helvetica').fillColor('#333333').text('Mawarala Road, Makandura, Matara | Tel: 041-2268739, 071-1350123  •  Web: relianceclothing.lk', brandTextX, headerTop + 24);

    // Dynamic Header Block Below Brand
    const headerContentY = headerTop + 38;

    // 1. Constrain Report Section Title to width: 320 with align: 'left' and allow auto-wrapping (lineBreak: true)
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
    doc.text(reportTitle, startX, headerContentY, { width: 320, align: 'left', lineBreak: true });
    const titleBottomY = doc.y;

    // 2. Position metadata block (PERIOD, GENERATED, PRINTED BY) at dedicated right-aligned X coordinate
    const metaX = doc.page.width - 200;
    const metaWidth = 160;
    let metaY = headerContentY;

    const metaRows = [
      { label: 'PERIOD:', value: dateLabel, isBold: true },
      { label: 'GENERATED:', value: generatedTimestamp, isBold: false },
      { label: 'PRINTED BY:', value: generatedBy, isBold: false },
    ];

    metaRows.forEach((row) => {
      // Separate the label ('PERIOD:') and the value ('October 2026') on distinct coordinate lines/columns
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#555555')
        .text(row.label, metaX, metaY, { width: 55, align: 'left' });

      const valFont = row.isBold ? 'Helvetica-Bold' : 'Helvetica';
      doc.fontSize(7.5).font(valFont).fillColor('#000000');
      const valHeight = doc.heightOfString(row.value, { width: metaWidth - 55, align: 'right' });
      doc.text(row.value, metaX + 55, metaY, { width: metaWidth - 55, align: 'right', lineBreak: true });

      metaY += Math.max(10, valHeight + 2);
    });
    const metaBottomY = metaY;

    // 3. Move the Y-cursor dynamically after the header block before drawing top divider line and KPI cards
    const dividerY = Math.max(titleBottomY, metaBottomY) + 15;
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1).strokeColor('#000000').stroke();
    doc.y = dividerY + 12;

    return doc.y;
  }

  /**
   * Helper: Draws Monochrome KPI metric cards
   * Pure white background with crisp 1px clean border (#000000), bold black titles, and black metrics
   */
  private static drawKpiCards(
    doc: InstanceType<typeof PDFDocument>,
    kpiCards: KpiCard[],
    curY: number
  ): number {
    if (kpiCards.length === 0) return curY;

    const startX = this.startX;
    const pageWidth = this.pageWidth;
    const cardGap = 8;
    const cardWidth = (pageWidth - (kpiCards.length - 1) * cardGap) / kpiCards.length;
    const cardHeight = 38;

    kpiCards.forEach((card, idx) => {
      const cardX = startX + idx * (cardWidth + cardGap);
      // Pure white card with clean 1px black border
      doc.rect(cardX, curY, cardWidth, cardHeight)
        .lineWidth(0.8)
        .strokeColor('#000000')
        .fillColor('#ffffff')
        .fillAndStroke();

      // Bold black uppercase label
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000').text(card.label, cardX + 6, curY + 6, { width: cardWidth - 12 });
      // Bold black metric value
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(card.value, cardX + 6, curY + 18, { width: cardWidth - 12 });
    });

    return curY + cardHeight + 14;
  }

  /**
   * Helper: Draws table header row in Monochrome print theme
   * Clean 1px bottom/top border with minimal off-white shading (#f8fafc) and crisp black bold uppercase headers
   */
  private static drawTableHeader(
    doc: InstanceType<typeof PDFDocument>,
    columns: ColumnDef[],
    y: number
  ): number {
    const startX = this.startX;
    const rightMargin = this.rightMargin;
    const pageWidth = this.pageWidth;

    // Off-white light shading
    doc.rect(startX, y, pageWidth, 16).fillColor('#f8fafc').fill();
    // 1px clean black borders on top and bottom
    doc.moveTo(startX, y).lineTo(rightMargin, y).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(startX, y + 16).lineTo(rightMargin, y + 16).lineWidth(0.8).strokeColor('#000000').stroke();

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000');

    let colX = startX;
    columns.forEach((col) => {
      const align = col.align || 'left';
      doc.text(col.header, colX + 3, y + 4.5, { width: col.width - 6, align });
      colX += col.width;
    });

    return y + 17;
  }

  /**
   * Helper: Draws table rows in Monochrome print theme with dynamic row height and text wrapping
   * Pure white background with thin divider lines (#e2e8f0) ensuring 100% legibility on thermal & B&W printers
   */
  private static drawTableRows(
    doc: InstanceType<typeof PDFDocument>,
    columns: ColumnDef[],
    rows: any[],
    initialY: number,
    onPageBreak: () => number
  ): number {
    const startX = this.startX;
    const rightMargin = this.rightMargin;
    let curY = initialY;

    rows.forEach((row: any) => {
      // 1. Prepare cell texts and widths
      const cellData = columns.map((col) => {
        const rawVal = row[col.key];
        const displayVal = col.format ? col.format(rawVal, row) : String(rawVal ?? '-');
        const colWidth = col.width - 6;
        return {
          col,
          text: displayVal,
          colWidth,
        };
      });

      // 2. Calculate dynamic row height with lineBreak: true
      doc.fontSize(7).font('Helvetica');
      const measuredHeights = cellData.map((c) => doc.heightOfString(c.text, { width: c.colWidth }));
      const dynamicRowHeight = Math.max(...measuredHeights) + 6;
      const rowHeight = Math.max(16, dynamicRowHeight);

      // 3. Check page break with dynamic row height: if y + rowHeight > doc.page.height - 60
      if (curY + rowHeight > doc.page.height - 60) {
        doc.addPage();
        curY = onPageBreak();
        curY = this.drawTableHeader(doc, columns, curY);
      }

      // 4. Render multi-line wrapped cells
      let colX = startX;
      cellData.forEach((cell) => {
        const align = cell.col.align || 'left';
        doc.fontSize(7).font('Helvetica').fillColor('#000000');
        doc.text(cell.text, colX + 3, curY + 3, {
          width: cell.colWidth,
          align,
          lineBreak: true,
        });
        colX += cell.col.width;
      });

      // 5. Draw row divider at curY + rowHeight and advance curY by rowHeight
      doc.moveTo(startX, curY + rowHeight).lineTo(rightMargin, curY + rowHeight).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
      curY += rowHeight;
    });

    return curY;
  }

  /**
   * Helper: Draws authorized sign-off footer columns
   */
  private static drawSignOff(
    doc: InstanceType<typeof PDFDocument>,
    curY: number,
    onPageBreak: () => number
  ): number {
    const startX = this.startX;
    const pageWidth = this.pageWidth;
    const footerNeededHeight = 65;

    if (curY + footerNeededHeight > this.pageBottomThreshold) {
      doc.addPage();
      curY = onPageBreak();
    }

    curY += 20;

    const signColWidth = (pageWidth - 30) / 3;
    const signY = curY;

    // Prepared By
    doc.moveTo(startX, signY + 25).lineTo(startX + signColWidth, signY + 25).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text('PREPARED BY', startX, signY + 28, { width: signColWidth, align: 'center' });
    doc.fontSize(6.5).font('Helvetica').fillColor('#444444').text('Finance & Reporting Officer', startX, signY + 38, { width: signColWidth, align: 'center' });

    // Checked By
    const checkedX = startX + signColWidth + 15;
    doc.moveTo(checkedX, signY + 25).lineTo(checkedX + signColWidth, signY + 25).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text('CHECKED & VERIFIED BY', checkedX, signY + 28, { width: signColWidth, align: 'center' });
    doc.fontSize(6.5).font('Helvetica').fillColor('#444444').text('Internal Audit / Accounts', checkedX, signY + 38, { width: signColWidth, align: 'center' });

    // Authorized By
    const authX = checkedX + signColWidth + 15;
    doc.moveTo(authX, signY + 25).lineTo(authX + signColWidth, signY + 25).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text('AUTHORIZED SIGNATURE', authX, signY + 28, { width: signColWidth, align: 'center' });
    doc.fontSize(6.5).font('Helvetica').fillColor('#444444').text('Managing Director / Partner', authX, signY + 38, { width: signColWidth, align: 'center' });

    // Bottom official legal disclaimer
    const bottomDisclaimerY = 805;
    doc.fontSize(6.5).font('Helvetica').fillColor('#666666').text(
      'Confidential & Proprietary — Reliance Clothing ERP Management Suite. All financial figures are strictly verified against the system ledger.',
      startX,
      bottomDisclaimerY,
      { width: pageWidth, align: 'center' }
    );

    return curY + footerNeededHeight;
  }

  /**
   * Helper: Injects master page numbers across all buffered pages
   */
  private static applyPageNumbers(
    doc: InstanceType<typeof PDFDocument>,
    subtitle: string
  ): void {
    const range = doc.bufferedPageRange();
    const startX = this.startX;
    const pageWidth = this.pageWidth;

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(6.5).font('Helvetica').fillColor('#444444').text(
        `${subtitle}  •  Page ${i + 1} of ${range.count}`,
        startX,
        816,
        { width: pageWidth, align: 'right' }
      );
    }
  }

  /**
   * 1. GRANULAR SINGLE-MODULE REPORT GENERATION
   * Generates a focused, monochrome-optimized PDF report for the active module.
   */
  static generate(
    module: ReportModule,
    reportData: any,
    user?: { name?: string; role?: string }
  ): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const reportTitle = MODULE_TITLES[module] || 'EXECUTIVE BUSINESS REPORT';
    const dateLabel = reportData.dateFilter?.presetLabel || 'All Recorded History';
    const generatedTimestamp = formatReportTimestamp();
    const generatedBy = user?.name ? `${user.name} (${user.role || 'Staff'})` : 'System Administrator';

    const renderHeader = () => {
      return this.drawHeader(doc, reportTitle, dateLabel, generatedTimestamp, generatedBy);
    };

    let curY = renderHeader();

    // ── KPI Summary Cards ──
    const kpiCards = getModuleKpiCards(module, reportData.summary);
    curY = this.drawKpiCards(doc, kpiCards, curY);

    // ── Data Table ──
    const columns = getModuleColumns(module);
    curY = this.drawTableHeader(doc, columns, curY);

    const rows = reportData.tableItems || [];
    curY = this.drawTableRows(doc, columns, rows, curY, () => renderHeader());

    // ── Sign-Off Block ──
    this.drawSignOff(doc, curY, () => renderHeader());

    // ── Master Page Numbers ──
    this.applyPageNumbers(doc, `Reliance ${reportTitle}`);

    return doc;
  }

  /**
   * 2. CONSOLIDATED MASTER AUDIT REPORT GENERATION
   * Compiles all 8 domain modules (Sales, Returns, Inventory, Products, Materials, Production, GRN, Audit)
   * into a unified multi-page executive audit report with Table of Contents and Master Financial Summary.
   */
  static generateConsolidated(
    consolidatedData: any,
    user?: { name?: string; role?: string }
  ): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const startX = this.startX;
    const rightMargin = this.rightMargin;
    const pageWidth = this.pageWidth;
    const reportTitle = 'CONSOLIDATED MASTER AUDIT REPORT';
    const dateLabel = consolidatedData.dateFilter?.presetLabel || 'Comprehensive Audit Period';
    const generatedTimestamp = formatReportTimestamp();
    const generatedBy = user?.name ? `${user.name} (${user.role || 'Staff'})` : 'System Administrator';

    const renderHeader = (sectionTitle?: string) => {
      return this.drawHeader(
        doc,
        sectionTitle ? `${reportTitle} — ${sectionTitle}` : reportTitle,
        dateLabel,
        generatedTimestamp,
        generatedBy
      );
    };

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 1: EXECUTIVE COVER & MASTER FINANCIAL AUDIT SUMMARY
    // ══════════════════════════════════════════════════════════════════════
    let curY = renderHeader();

    // Executive Subtitle
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('EXECUTIVE FINANCIAL & OPERATIONAL AUDIT SUMMARY', startX, curY);
    curY += 15;

    const master = consolidatedData.masterSummary || {};

    // Master Primary 4 KPI Cards (Financial Core)
    const primaryCards: KpiCard[] = [
      { label: 'GROSS REVENUE', value: formatCurrency(master.grossRevenue) },
      { label: 'NET SALES', value: formatCurrency(master.netSales) },
      { label: 'COLLECTED / PAID', value: formatCurrency(master.totalPaid) },
      { label: 'CUSTOMER DEBT DUE', value: formatCurrency(master.totalDue) },
    ];
    curY = this.drawKpiCards(doc, primaryCards, curY);

    // Master Secondary 4 KPI Cards (Valuation & Procurement)
    const secondaryCards: KpiCard[] = [
      { label: 'FINISHED GOODS VAL.', value: formatCurrency(master.inventoryRetailValuation) },
      { label: 'RAW MATERIALS VAL.', value: formatCurrency(master.materialsValuation) },
      { label: 'PURCHASES (GRN)', value: formatCurrency(master.supplierPurchases) },
      { label: 'SUPPLIER PAYABLES', value: formatCurrency(master.supplierDebt) },
    ];
    curY = this.drawKpiCards(doc, secondaryCards, curY);

    // Operational KPI Cards
    const operationalCards: KpiCard[] = [
      { label: 'RETURN EVENTS VALUE', value: formatCurrency(master.totalReturnValue) },
      { label: 'WAREHOUSE UNITS', value: `${master.totalStockUnits || 0} Pcs` },
      { label: 'PRODUCTION YIELD', value: `${master.productionCompletedQty || 0} Pcs (${master.productionYieldPct || 0}%)` },
      { label: 'AUDITED EDITS', value: `${master.modifiedInvoices || 0} / ${master.auditedInvoices || 0}` },
    ];
    curY = this.drawKpiCards(doc, operationalCards, curY);

    // Table of Contents / Domain Audit Index Box
    doc.rect(startX, curY, pageWidth, 120).lineWidth(0.8).strokeColor('#000000').fillColor('#ffffff').fillAndStroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('TABLE OF CONTENTS & DOMAIN AUDIT INDEX', startX + 12, curY + 10);

    const tocItems = [
      { section: 'SECTION 1', title: 'Sales & Revenue Ledger', desc: 'Customer invoices, retail vs wholesale splits, payment collection metrics' },
      { section: 'SECTION 2', title: 'Returns & Restocking Audit', desc: 'Items returned to stock, reasons breakdown, cash vs credit adjustments' },
      { section: 'SECTION 3', title: 'Inventory & Warehouse Stock', desc: 'Finished garment SKUs, unit stock levels, cost vs retail valuation' },
      { section: 'SECTION 4', title: 'Products & Sales Velocity', desc: 'Fast vs slow moving products, revenue distribution, SKU velocity' },
      { section: 'SECTION 5', title: 'Raw Materials & Fabric Ledger', desc: 'Fabric rolls/yards, weighted average cost valuation, scrap & waste logs' },
      { section: 'SECTION 6', title: 'Garment Production & Yield', desc: 'Production batches, target vs completed output, efficiency yield rates' },
      { section: 'SECTION 7', title: 'Suppliers & Goods Received Notes', desc: 'Inward GRN purchase totals, vendor disbursements, outstanding debt' },
      { section: 'SECTION 8', title: 'Invoice Modifications & Security Trail', desc: 'Audit trail of modified sales records, cashier revision frequency' },
    ];

    let tocY = curY + 26;
    tocItems.forEach((item, i) => {
      const isCol2 = i >= 4;
      const colX = isCol2 ? startX + (pageWidth / 2) + 6 : startX + 12;
      const rowY = isCol2 ? tocY + ((i - 4) * 21) : tocY + (i * 21);

      doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text(`${item.section}: ${item.title}`, colX, rowY);
      doc.fontSize(6).font('Helvetica').fillColor('#444444').text(item.desc, colX, rowY + 9, { width: (pageWidth / 2) - 20 });
    });

    curY += 132;

    // Executive Notice Box
    doc.rect(startX, curY, pageWidth, 42).lineWidth(0.8).strokeColor('#000000').fillColor('#f8fafc').fillAndStroke();
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text('EXECUTIVE AUDIT NOTICE & LEDGER VERIFICATION', startX + 10, curY + 8);
    doc.fontSize(6.5).font('Helvetica').fillColor('#333333').text(
      'This Consolidated Master Audit Report aggregates verified operational ledger data across all business domains. ' +
      'All inventory counts, revenue totals, supplier disbursements, and production logs have been cross-checked ' +
      'against physical counts and database transaction records.',
      startX + 10,
      curY + 18,
      { width: pageWidth - 20, lineBreak: true }
    );

    // ══════════════════════════════════════════════════════════════════════
    // DETAILED SECTIONS (1 TO 8)
    // ══════════════════════════════════════════════════════════════════════
    const sectionKeys: ReportModule[] = [
      'sales',
      'returns',
      'inventory',
      'products',
      'materials',
      'production',
      'suppliers',
      'audit',
    ];

    const sectionsData = consolidatedData.sections || {};

    sectionKeys.forEach((mod, sIndex) => {
      // Each major domain starts on its own fresh page for pristine executive presentation
      doc.addPage();
      const secTitle = `SEC ${sIndex + 1}: ${MODULE_TITLES[mod]}`;
      curY = renderHeader(secTitle);

      const modData = sectionsData[mod] || {};

      // Section KPI Cards
      const modKpiCards = getModuleKpiCards(mod, modData.summary);
      curY = this.drawKpiCards(doc, modKpiCards, curY);

      // Section Table Header
      const columns = getModuleColumns(mod);
      curY = this.drawTableHeader(doc, columns, curY);

      // Section Table Rows
      const rows = modData.tableItems || [];
      if (rows.length === 0) {
        doc.rect(startX, curY, pageWidth, 24).fillColor('#ffffff').strokeColor('#e2e8f0').lineWidth(0.4).fillAndStroke();
        doc.fontSize(7.5).font('Helvetica').fillColor('#555555').text('No recorded ledger entries found for this module in the selected period.', startX, curY + 8, { width: pageWidth, align: 'center' });
        curY += 28;
      } else {
        curY = this.drawTableRows(doc, columns, rows, curY, () => renderHeader(secTitle));
      }
    });

    // ── Sign-Off Block on Final Page ──
    this.drawSignOff(doc, curY, () => renderHeader('AUDIT SIGN-OFF'));

    // ── Master Page Numbers ──
    this.applyPageNumbers(doc, 'Reliance Consolidated Master Audit Report');

    return doc;
  }
}
