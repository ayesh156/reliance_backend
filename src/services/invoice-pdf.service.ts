import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

/**
 * Format timestamp to standard 'YYYY-MM-DD' representation (e.g., '2026-10-07')
 * for uniform presentation across backend PDF streaming and frontend print preview.
 */
function formatPdfReturnDate(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
const formatPdfReturnDateTime = formatPdfReturnDate;

export class InvoicePdfService {
  /**
   * Generate A4 Invoice PDF perfectly identical to Frontend Print Engine (100% Visual Parity)
   *
   * Layout & Financial Reconciliation Workflow:
   * 1. Header with brand logo, enterprise details, and wholesale/retail badge.
   * 2. Customer billing information & structured split/note payment box.
   * 3. Itemized purchases table with style number, variant metadata (Size/Color), and unit rates.
   * 4. Return Adjustment History ledger (when returns exist) formatted as:
   *    `# | DATE | RETURNED ITEM & REASON | QTY | CREDIT / REFUND`.
   * 5. Financial Summary section mirroring A4 print modal breakdown:
   *    - Sub Total
   *    - Discount (with dynamic percentage)
   *    - Original Bill Total & Return Adjustments (when returns exist)
   *    - Net Total Due (After Returns) / Total Due (Current Bill)
   *    - Tendered breakdown & change returned
   *    - True Previous Due (Old Bills) & Total Accumulated Credit Due
   * 6. Four-column signature block & bottom tear-off store policy.
   */
  static generate(order: any): InstanceType<typeof PDFDocument> {
    // A4 Portrait: 595.28 x 841.89 pt
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 0, 
      bufferPages: true 
    });

    const invoiceNo = `INV${order.id || String(Date.now()).slice(-4)}`;
    const dateStr = order.createdAt
      ? new Date(order.createdAt).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const total = Number(order.totalAmount || 0);
    const tendered = order.tenderedAmount !== undefined 
      ? Number(order.tenderedAmount) 
      : Number(order.paidAmount || 0);
    const isReturnBill = Boolean(order.isReturnBill === true || Number(order.totalAmount) < 0);
    const trueReturnCreditApplied = Math.abs(Number(order.totalAmount || total || 0)) - (Number(order.refundedCashAmount) || 0);
    const returnCreditApplied = trueReturnCreditApplied;
    const refundedCashAmount = Number(order.refundedCashAmount || 0);

    const isWholesale = order.source === 'POS_WHOLESALE' || order.orderType === 'WHOLESALE';
    const paymentMethodLabel = order.paymentMethod 
      ? order.paymentMethod.toUpperCase() 
      : (isReturnBill ? 'RETURN CREDIT' : (isWholesale ? 'WHOLESALE CREDIT' : 'CASH'));

    const invoiceTitle = isReturnBill ? 'RETURN INVOICE' : (isWholesale ? 'WHOLESALE INVOICE' : 'INVOICE');

    // Extract itemized payments from order.payments or splits
    interface PdfPaymentHistoryEntry {
      dateTimeStr: string;
      method: string;
      amount: number;
      reference?: string;
    }
    const pdfPayments: PdfPaymentHistoryEntry[] = [];
    if (Array.isArray(order.payments) && order.payments.length > 0) {
      order.payments.forEach((p: any) => {
        const d = p.paymentDate || p.createdAt || order.createdAt;
        const dateStr = d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '-';
        pdfPayments.push({
          dateTimeStr: dateStr,
          method: String(p.method || 'CASH').toUpperCase(),
          amount: Number(p.amount) || 0,
          reference: p.reference || p.transactionId || (p.notes ? String(p.notes) : undefined),
        });
      });
    }

    // ⭐ Enterprise Credit Synchronization: Prevents Double-Counting on PDF Re-print
    const rawPaid = Number(order.paidAmount);
    const paidAmount = (!isNaN(rawPaid))
      ? (paymentMethodLabel.includes('CREDIT') && pdfPayments.length === 0 && rawPaid === 0 ? 0 : rawPaid)
      : (paymentMethodLabel.includes('CREDIT') ? 0 : Math.min(total, tendered));

    if (pdfPayments.length === 0 && paidAmount > 0) {
      const dStr = order.createdAt ? new Date(order.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '-';
      pdfPayments.push({
        dateTimeStr: dStr,
        method: paymentMethodLabel.includes('CREDIT') ? 'CASH' : paymentMethodLabel,
        amount: paidAmount,
      });
    }

    const settledDue = Number(order.settledDueAmount || 0);
    const remainingChange = Math.max(0, Math.round((tendered - paidAmount - settledDue) * 100) / 100);
    const balanceDue = Math.max(0, Math.round((total - paidAmount) * 100) / 100);
    const discountVal = Number(order.discountAmount ?? order.discount ?? 0);
    const subtotalVal = Number(order.subtotal || (total + discountVal) || 0);

    const isPercentDiscount = order.discountType === 'PERCENT' || (!order.discountType && Number(order.discountRate) > 0);
    const rawDiscountVal = Number(order.discountValue ?? order.discountRate ?? 0);
    const computedPercent = subtotalVal > 0 ? (discountVal / subtotalVal) * 100 : 0;
    const displayPercent = rawDiscountVal > 0 ? rawDiscountVal : Math.round(computedPercent * 10) / 10;
    const discountDisplay = isPercentDiscount && displayPercent > 0
      ? `Discount (${displayPercent}%):`
      : 'Discount (Rs.):';

    const isCreditOrder = paymentMethodLabel.includes('CREDIT') || balanceDue > 0;
    const currentBillCredit = isCreditOrder ? balanceDue : 0;
    
    // Total live balance recorded in database
    const liveCustomerBalance = Number(order.customer?.outstandingBalance ?? order.prevBalance ?? 0);
    
    // True prior debt is: live balance MINUS this invoice's credit PLUS settled due amount
    const truePreviousDue = Math.max(0, Math.round((liveCustomerBalance - currentBillCredit + settledDue) * 100) / 100);
    const hasCreditLedger = Boolean(order.customerId || order.customer?.id) && (truePreviousDue > 0.01 || settledDue > 0.01 || liveCustomerBalance > 0.01);
    
    // Cumulative total outstanding
    const grandTotalCreditDue = Math.max(0, Math.round((currentBillCredit + truePreviousDue - settledDue) * 100) / 100);
    const updatedOutstandingBalance = Number(order.customer?.outstandingBalance ?? liveCustomerBalance);
    const customerOutstanding = updatedOutstandingBalance;
    const previousDueBeforeReturn = Math.max(0, Math.round((customerOutstanding + trueReturnCreditApplied) * 100) / 100);

    // Extract return records for PDF rendering
    let returnsList: any[] = [];
    if (Array.isArray(order.returns) && order.returns.length > 0) {
      returnsList = order.returns;
    } else if (order.notes) {
      try {
        let current = order.notes;
        while (typeof current === 'string' && current.trim().startsWith('{')) {
          current = JSON.parse(current);
        }
        if (typeof current === 'object' && current !== null && Array.isArray(current.returns)) {
          returnsList = current.returns;
        }
      } catch {}
    }

    // Consolidate duplicate return items occurring on the exact same date with identical variant and reason
    interface ConsolidatedPdfReturnRow {
      returnDateFormatted: string;
      prodDesc: string;
      reasonText: string;
      totalQty: number;
      totalRefund: number;
    }

    const consolidatedReturnMap = new Map<string, ConsolidatedPdfReturnRow>();
    let totalReturnRefund = returnsList.reduce((acc: number, r: any) => acc + (Number(r.totalReturnRefund) || 0), 0);

    returnsList.forEach((ret: any) => {
      const retDateFormatted = formatPdfReturnDate(ret.returnDate || ret.createdAt || ret.date || order.createdAt);
      const reasonText = (ret.reason || 'Return').trim();

      (ret.returnedItems || []).forEach((rit: any) => {
        const itemReason = (rit.reason || reasonText).trim();
        const variantIdentifier = rit.variantId !== undefined && rit.variantId !== null
          ? String(rit.variantId)
          : (rit.sku || `${rit.productName || rit.name || 'Garment Item'}_${rit.variantName || ''}`);
        const groupKey = `${retDateFormatted}_${variantIdentifier}_${itemReason}`;

        const qty = Number(rit.returnQty ?? rit.quantity ?? 1);
        const amt = Number(rit.refundAmount ?? rit.amount ?? 0);

        if (consolidatedReturnMap.has(groupKey)) {
          const existing = consolidatedReturnMap.get(groupKey)!;
          existing.totalQty += qty;
          existing.totalRefund += amt;
        } else {
          const varDesc = rit.variantName ? ` (${rit.variantName})` : '';
          const prodDesc = `${rit.productName || 'Garment Item'}${varDesc}`;
          consolidatedReturnMap.set(groupKey, {
            returnDateFormatted: retDateFormatted,
            prodDesc,
            reasonText: itemReason,
            totalQty: qty,
            totalRefund: amt,
          });
        }
      });
    });

    const consolidatedReturns = Array.from(consolidatedReturnMap.values());
    const hasReturns = returnsList.length > 0 && consolidatedReturns.length > 0;
    if (totalReturnRefund === 0 && consolidatedReturns.length > 0) {
      totalReturnRefund = consolidatedReturns.reduce((acc, r) => acc + r.totalRefund, 0);
    }

    const originalBillTotal = order.originalTotalAmount !== undefined
      ? Number(order.originalTotalAmount)
      : (total + totalReturnRefund);



    // Margins calibrated to 18mm Top/Bottom (51pt), 15mm Left/Right (42.5pt)
    const startX = 42.5; 
    const rightMargin = 552.78; 
    const pageWidth = rightMargin - startX; // 510.28pt

    // ── 1. HEADER SECTION (Calibrated to 82px Logo & Thin Editorial Title) ──
    const headerTop = 51;

    // Resolve logo strictly using process.cwd() to maintain pure ESM runtime compatibility
    const potentialPaths = [
      path.resolve(process.cwd(), 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public', 'logo.jpg'),
      path.resolve(process.cwd(), 'dist', 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public_html', 'images', 'logo.jpg'),
    ];
    const logoPath = potentialPaths.find((p) => fs.existsSync(p));

    let brandTextX = startX;
    // Safely verify file existence and image header before passing to PDFKit
    if (logoPath && fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
      try {
        // Logo width 82px -> 61.5pt exactly matching frontend aspect
        doc.image(logoPath, startX, headerTop - 3, { width: 62, height: 62 });
        brandTextX = startX + 74; 
      } catch (e) {
        brandTextX = startX;
      }
    }

    // Brand Details
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE', brandTextX, headerTop - 3, { characterSpacing: 1.5 });
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#111111').text('BRANDED MENS CLOTHING', brandTextX, headerTop + 24, { characterSpacing: 2 });
    doc.fontSize(8).font('Helvetica').fillColor('#222222');
    doc.text('Mawarala Road, Makandura, Matara.', brandTextX, headerTop + 36);
    doc.font('Helvetica-Bold').text('Tel: ', brandTextX, headerTop + 47, { continued: true }).font('Helvetica').text('041-2268739, 071-1350123');
    doc.font('Helvetica-Bold').text('Web: ', brandTextX, headerTop + 58, { continued: true }).font('Helvetica').text('relianceclothing.lk');

    // Right-aligned Modern Invoice Title (Preserves exact standard black color)
    doc
      .fontSize(isWholesale ? 20 : 24)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text(invoiceTitle, 280, headerTop - 3, { width: 272.78, align: 'right', characterSpacing: isWholesale ? 1.5 : 3 });

    // Meta Table (Gap tightened between label and value)
    const metaY = headerTop + 28;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('INVOICE NO:', 395, metaY, { width: 70, align: 'right' });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(invoiceNo, 470, metaY - 1, { width: 82.78, align: 'right' });

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('DATE:', 395, metaY + 14, { width: 70, align: 'right' });
    doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(dateStr, 470, metaY + 13.5, { width: 82.78, align: 'right' });

    if (isWholesale) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('BILLING TYPE:', 395, metaY + 28, { width: 70, align: 'right' });
      doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#000000').text('WHOLESALE', 470, metaY + 27.5, { width: 82.78, align: 'right' });
    }

    // Main Solid Divider Line
    const dividerY = headerTop + (isWholesale ? 82 : 76);
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.2).strokeColor('#000000').stroke();

    // ── 2. BILLED TO & PAYMENT / NOTE DETAILS SECTION ──
    const customerTop = dividerY + 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('BILLED TO', startX, customerTop, { characterSpacing: 0.8 });
    doc.moveTo(startX, customerTop + 10).lineTo(startX + 50, customerTop + 10).lineWidth(1.2).strokeColor('#000000').stroke();

    const custName = order.customerName || order.customer?.name || 'Walk-in Customer';
    const custPhone = order.customerPhone || order.customer?.phone || '-';
    const rawAddr = (order.shippingAddress || order.customer?.address || '').trim();
    const rawCity = (order.city || order.customer?.city || '').trim();
    let custAddr = '-';
    if (rawAddr && rawCity) {
      custAddr = rawAddr.toLowerCase().includes(rawCity.toLowerCase()) ? rawAddr : `${rawAddr}, ${rawCity}`;
    } else if (rawAddr) {
      custAddr = rawAddr;
    } else if (rawCity) {
      custAddr = rawCity;
    }

    // Clean 3-Column Compact Layout
    const col1X = startX;
    const col2X = startX + 155;
    const col3X = startX + 275;
    const labelY = customerTop + 14;
    const valY = customerTop + 23;

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#666666').text('CUSTOMER NAME', col1X, labelY);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(custName, col1X, valY, { width: 145 });

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#666666').text('CONTACT PHONE', col2X, labelY);
    doc.fontSize(8.5).font('Helvetica').fillColor('#000000').text(custPhone, col2X, valY, { width: 110 });

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#666666').text('ADDRESS / CITY', col3X, labelY);
    doc.fontSize(8.5).font('Helvetica').fillColor('#000000').text(custAddr, col3X, valY, { width: 155 });

    // Clean user note text and split payment details for PDF
    let displayPdfNote = '';
    if (order.notes) {
      try {
        let current = order.notes;
        while (typeof current === 'string' && current.trim().startsWith('{')) {
          current = JSON.parse(current);
        }
        if (typeof current === 'object' && current !== null) {
          displayPdfNote = current.userNotes || '';
        } else {
          displayPdfNote = String(current || '');
        }
      } catch {
        displayPdfNote = typeof order.notes === 'string' && order.notes.trim().startsWith('{') ? '' : String(order.notes || '');
      }
    }
    if (typeof displayPdfNote === 'string' && displayPdfNote.trim().startsWith('{')) {
      displayPdfNote = '';
    }
    if (!displayPdfNote && typeof order.userNotes === 'string') {
      displayPdfNote = order.userNotes;
    }

    if (displayPdfNote) {
      const noteBoxWidth = 200;
      const noteX = rightMargin - noteBoxWidth;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('PAYMENT / NOTE DETAILS', noteX, customerTop, { width: noteBoxWidth, align: 'right', characterSpacing: 0.8 });
      doc.moveTo(noteX, customerTop + 10).lineTo(rightMargin, customerTop + 10).lineWidth(1.2).strokeColor('#000000').stroke();
      doc.fontSize(8.5).font('Helvetica').fillColor('#222222').text(displayPdfNote, noteX, customerTop + 15, { width: noteBoxWidth, align: 'right' });
    }

    // ── 3. ITEMS TABLE (Proportions: # 5%, Style 17%, Desc 38%, Price 16%, Qty 8%, Amount 16%) ──
    const tableTop = customerTop + 62;
    const colWidths = { num: 25.5, style: 86.7, desc: 193.9, price: 81.6, qty: 40.8, amt: 81.6 };
    const colX = {
      num: startX,
      style: startX + colWidths.num,
      desc: startX + colWidths.num + colWidths.style,
      price: startX + colWidths.num + colWidths.style + colWidths.desc,
      qty: startX + colWidths.num + colWidths.style + colWidths.desc + colWidths.price,
      amt: startX + colWidths.num + colWidths.style + colWidths.desc + colWidths.price + colWidths.qty,
    };

    // Table Header Borders
    doc.moveTo(startX, tableTop).lineTo(rightMargin, tableTop).lineWidth(1.2).strokeColor('#000000').stroke();
    
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    const thY = tableTop + 6;
    doc.text('#', colX.num, thY, { width: colWidths.num, align: 'center', lineBreak: false });
    doc.text('STYLE NO', colX.style + 3, thY, { width: colWidths.style - 3, align: 'left', lineBreak: false });
    doc.text('ITEM DESCRIPTION', colX.desc + 3, thY, { width: colWidths.desc - 3, align: 'left', lineBreak: false });
    doc.text('UNIT PRICE', colX.price, thY, { width: colWidths.price - 13.5, align: 'right', lineBreak: false }); 
    doc.text('QTY', colX.qty, thY, { width: colWidths.qty, align: 'center', lineBreak: false });
    doc.text('AMOUNT', colX.amt, thY, { width: colWidths.amt - 3, align: 'right', lineBreak: false });
    
    doc.moveTo(startX, tableTop + 18).lineTo(rightMargin, tableTop + 18).lineWidth(1.2).strokeColor('#000000').stroke();

    let curY = tableTop + 24;

    (order.items || []).forEach((item: any, idx: number) => {
      const variantObj = item.variant || {};
      const productObj = variantObj.product || {};
      const styleNo = variantObj.sku || variantObj.styleNo || item.sku || `STY-${String(idx + 1).padStart(3, '0')}`;
      const name = productObj.name || item.productName || item.name || 'Garment Item';
      const sizeStr = item.sizes || item.size || item.selectedSize || variantObj.sizes || variantObj.size || '';
      const colorStr = item.colors || item.color || item.selectedColor || variantObj.colors || variantObj.color || '';
      const meta = sizeStr || colorStr ? `Size: ${sizeStr || 'FREE'} | Color: ${colorStr || 'Default'}` : '';

      const descAvailableWidth = colWidths.desc - 6;

      // Calculate dynamic text height for Item Description column
      doc.fontSize(9).font('Helvetica-Bold');
      const nameHeight = doc.heightOfString(name, { width: descAvailableWidth });

      let metaHeight = 0;
      if (meta) {
        doc.fontSize(7.8).font('Helvetica');
        metaHeight = doc.heightOfString(meta, { width: descAvailableWidth });
      }

      const itemDiscVal = Number(item.discount || 0);
      const discHeight = itemDiscVal > 0 ? 10 : 0;
      const totalDescHeight = nameHeight + (meta ? metaHeight + 2 : 0) + (itemDiscVal > 0 ? discHeight + 2 : 0);
      const rowHeight = Math.max(22, totalDescHeight + 8);

      // ⭐ Safe Page Break Guard: Prevents items from printing outside A4 bounds
      if (curY + rowHeight > 780) {
        doc.addPage();
        curY = 50; // Reset to top of new page
        
        // Re-draw table header on new page for better readability
        doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
        doc.text('#', colX.num, curY + 6, { width: colWidths.num, align: 'center', lineBreak: false });
        doc.text('STYLE NO', colX.style + 3, curY + 6, { width: colWidths.style - 3, align: 'left', lineBreak: false });
        doc.text('ITEM DESCRIPTION', colX.desc + 3, curY + 6, { width: colWidths.desc - 3, align: 'left', lineBreak: false });
        doc.text('UNIT PRICE', colX.price, curY + 6, { width: colWidths.price - 13.5, align: 'right', lineBreak: false });
        doc.text('QTY', colX.qty, curY + 6, { width: colWidths.qty, align: 'center', lineBreak: false });
        doc.text('AMOUNT', colX.amt, curY + 6, { width: colWidths.amt - 3, align: 'right', lineBreak: false });
        doc.moveTo(startX, curY + 18).lineTo(rightMargin, curY + 18).lineWidth(1.2).strokeColor('#000000').stroke();
        curY += 24;
      }

      doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), colX.num, curY, { width: colWidths.num, align: 'center', lineBreak: false });
      doc.font('Helvetica-Bold').fillColor('#000000').text(styleNo, colX.style + 3, curY, { width: colWidths.style - 3, lineBreak: false });
      
      // Item Description (Title + Multi-line Variant Wrap + Item Discount)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text(name, colX.desc + 3, curY, { width: descAvailableWidth });

      let runningY = curY + nameHeight + 2;
      if (meta) {
        doc.fontSize(7.8).font('Helvetica').fillColor('#555555').text(meta, colX.desc + 3, runningY, { width: descAvailableWidth, lineBreak: true });
        runningY += metaHeight + 2;
      }

      if (itemDiscVal > 0) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#059669').text(`(Item Disc: -Rs ${itemDiscVal.toLocaleString('en-LK', { minimumFractionDigits: 2 })})`, colX.desc + 3, runningY, { width: descAvailableWidth, lineBreak: false });
      }

      doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(`Rs ${Number(item.unitPrice).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.price, curY, { width: colWidths.price - 13.5, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').text(String(item.quantity), colX.qty, curY, { width: colWidths.qty, align: 'center', lineBreak: false });
      doc.text(`Rs ${Number(item.price).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.amt, curY, { width: colWidths.amt - 3, align: 'right', lineBreak: false });

      curY += rowHeight;
      // Dashed row separator
      doc.moveTo(startX, curY - 4).lineTo(rightMargin, curY - 4).lineWidth(0.75).strokeColor('#bbbbbb').dash(2, { space: 2 }).stroke().undash();
    });

    curY += 12; // Gap before summary

    // ── 3.5. ITEM RETURN ADJUSTMENT HISTORY (Rendered before financial summary when returns exist) ──
    if (hasReturns) {
      if (curY + 55 > 760) {
        doc.addPage();
        curY = 50;
      }

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#b91c1c').text(
        `ITEM RETURN ADJUSTMENT HISTORY (REFUND / CREDIT DEDUCTED: RS ${totalReturnRefund.toLocaleString('en-LK', { minimumFractionDigits: 2 })})`,
        startX,
        curY
      );
      curY += 13;

      // Table Header: # | DATE | RETURNED ITEM & REASON | QTY | CREDIT / REFUND
      const retColWidths = { num: 25.5, date: 85, item: 235, qty: 50, amt: 114.78 };
      const retColX = {
        num: startX,
        date: startX + retColWidths.num,
        item: startX + retColWidths.num + retColWidths.date,
        qty: startX + retColWidths.num + retColWidths.date + retColWidths.item,
        amt: startX + retColWidths.num + retColWidths.date + retColWidths.item + retColWidths.qty,
      };

      const drawRetHeader = (y: number) => {
        doc.moveTo(startX, y).lineTo(rightMargin, y).lineWidth(1).strokeColor('#000000').stroke();
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000');
        const thY = y + 4;
        doc.text('#', retColX.num, thY, { width: retColWidths.num, align: 'center', lineBreak: false });
        doc.text('DATE', retColX.date + 2, thY, { width: retColWidths.date - 2, align: 'left', lineBreak: false });
        doc.text('RETURNED ITEM & REASON', retColX.item + 2, thY, { width: retColWidths.item - 2, align: 'left', lineBreak: false });
        doc.text('QTY', retColX.qty, thY, { width: retColWidths.qty, align: 'center', lineBreak: false });
        doc.text('CREDIT / REFUND', retColX.amt, thY, { width: retColWidths.amt - 3, align: 'right', lineBreak: false });
        doc.moveTo(startX, y + 15).lineTo(rightMargin, y + 15).lineWidth(0.8).strokeColor('#888888').stroke();
        return y + 18;
      };

      curY = drawRetHeader(curY);

      let rCounter = 0;
      consolidatedReturns.forEach((cItem) => {
        rCounter++;
        const qtyText = `${cItem.totalQty} pcs`;
        const refundText = `- Rs ${Number(cItem.totalRefund).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;

        const itemAvailableWidth = retColWidths.item - 4;
        doc.fontSize(8).font('Helvetica');
        const fullDescText = `${cItem.prodDesc} [${cItem.reasonText}]`;
        const textHeight = doc.heightOfString(fullDescText, { width: itemAvailableWidth });
        const rowHeight = Math.max(16, textHeight + 5);

        if (curY + rowHeight > 770) {
          doc.addPage();
          curY = drawRetHeader(50);
        }

        doc.fontSize(8).font('Helvetica').fillColor('#555555').text(String(rCounter), retColX.num, curY, { width: retColWidths.num, align: 'center', lineBreak: false });
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text(cItem.returnDateFormatted, retColX.date + 2, curY, { width: retColWidths.date - 2, align: 'left', lineBreak: false });
        
        doc.fontSize(8).font('Helvetica').fillColor('#000000').text(cItem.prodDesc, retColX.item + 2, curY, { width: itemAvailableWidth, continued: true })
          .fillColor('#555555').text(` [${cItem.reasonText}]`);

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text(qtyText, retColX.qty, curY, { width: retColWidths.qty, align: 'center', lineBreak: false });
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#b91c1c').text(refundText, retColX.amt, curY, { width: retColWidths.amt - 3, align: 'right', lineBreak: false });

        curY += rowHeight;
        doc.moveTo(startX, curY - 2).lineTo(rightMargin, curY - 2).lineWidth(0.5).strokeColor('#cccccc').dash(1.5, { space: 1.5 }).stroke().undash();
      });

      curY += 10;
    }

    // ── 4. FINANCIAL SUMMARY SECTION (Strict Column Bounds to Eliminate Any Overlap) ──
    const sumWidth = 265;
    const sumX = rightMargin - sumWidth;
    const labelWidth = 160;
    const valX = sumX + labelWidth;
    const valWidth = sumWidth - labelWidth; // 105pt

    const renderSummaryRow = (
      label: string, 
      value: string, 
      options: { 
        isBold?: boolean; 
        fontSize?: number; 
        labelColor?: string; 
        valColor?: string; 
        topPadding?: number; 
        bottomPadding?: number; 
      } = {}
    ) => {
      const fSize = options.fontSize || 9;
      const isBold = options.isBold !== undefined ? options.isBold : true;
      const topPad = options.topPadding || 0;
      const bottomPad = options.bottomPadding || 3.5;
      const labelColor = options.labelColor || '#000000';
      const valColor = options.valColor || '#000000';

      curY += topPad;

      doc.fontSize(fSize).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(labelColor);
      const labelHeight = doc.heightOfString(label, { width: labelWidth });
      doc.text(label, sumX, curY, { width: labelWidth, align: 'left' });

      doc.fontSize(fSize).font('Helvetica-Bold').fillColor(valColor);
      const valHeight = doc.heightOfString(value, { width: valWidth });
      doc.text(value, valX, curY, { width: valWidth, align: 'right' });

      const rowHeight = Math.max(labelHeight, valHeight);
      curY += rowHeight + bottomPad;
    };

    const formatNumber = (num: number) => Number(num || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // 1. Sub Total
    const displaySubTotal = isReturnBill ? Math.abs(Number(order.totalAmount || total)) : subtotalVal;
    renderSummaryRow('Sub Total', `Rs ${formatNumber(displaySubTotal)}`, {
      isBold: true,
      fontSize: 9,
      labelColor: '#222222',
      valColor: '#000000'
    });

    // Discount if present
    if (discountVal > 0) {
      renderSummaryRow(discountDisplay, `- Rs ${discountVal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 9,
        labelColor: '#000000',
        valColor: '#000000'
      });
    }

    // Original Bill & Return Adjustments if returns exist
    if (hasReturns) {
      renderSummaryRow('Original Bill Total', `Rs ${originalBillTotal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 9,
        labelColor: '#000000',
        valColor: '#000000'
      });

      renderSummaryRow('Return Adjustments (Net Credit)', `- Rs ${totalReturnRefund.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 9,
        labelColor: '#b91c1c',
        valColor: '#b91c1c'
      });
    }

    if (isReturnBill) {
      const creditApplied = Math.abs(Number(order.totalAmount || total || 0)) - (Number(order.refundedCashAmount) || 0);
      const updatedBalance = Number(order.customer?.outstandingBalance || 0);
      const prevDue = updatedBalance + creditApplied;

      // 2. Total Return Value
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 4;
      renderSummaryRow('Total Return Value', `Rs ${formatNumber(Math.abs(Number(order.totalAmount || total)))}`, {
        isBold: true,
        fontSize: 10.5,
        labelColor: '#000000',
        valColor: '#000000',
        bottomPadding: 4
      });
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.8).strokeColor('#000000').stroke();
      curY += 5;

      // 3. Previous Due (Before Return):
      renderSummaryRow('Previous Due (Before Return):', `Rs ${formatNumber(prevDue)}`, {
        isBold: true,
        fontSize: 9,
        labelColor: '#000000',
        valColor: '#000000'
      });

      // 4. Deducted from Previous Due:
      renderSummaryRow('Deducted from Previous Due:', `- Rs ${formatNumber(creditApplied)}`, {
        isBold: true,
        fontSize: 9,
        labelColor: '#059669',
        valColor: '#059669'
      });

      // 5. Cash Refunded (If Any):
      renderSummaryRow('Cash Refunded (If Any):', `Rs ${formatNumber(Number(order.refundedCashAmount) || 0)}`, {
        isBold: true,
        fontSize: 9,
        labelColor: (Number(order.refundedCashAmount) || 0) > 0 ? '#b91c1c' : '#374151',
        valColor: (Number(order.refundedCashAmount) || 0) > 0 ? '#b91c1c' : '#374151'
      });

      // 6. Updated Outstanding Balance:
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 4;
      renderSummaryRow('Updated Outstanding Balance:', `Rs ${formatNumber(updatedBalance)}`, {
        isBold: true,
        fontSize: 10.5,
        labelColor: '#000000',
        valColor: '#000000',
        bottomPadding: 4
      });
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(2).strokeColor('#000000').stroke();
      curY += 8;
    } else {
      // 3. Net Bill Total: Solid 1.2pt Top, Solid 1.8pt Bottom
      const totalDueLabel = hasReturns ? 'Net Bill Total (After Returns)' : 'Net Bill Total';
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 4;
      renderSummaryRow(totalDueLabel, `Rs ${total.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 10.5,
        labelColor: '#000000',
        valColor: '#000000',
        bottomPadding: 4
      });
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.8).strokeColor('#000000').stroke();
      curY += 5;

      // 4. Paid Amount & Itemized Payment Breakdown
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(0.75).strokeColor('#888888').dash(2, { space: 2 }).stroke().undash();
      curY += 4;

      renderSummaryRow('Paid Amount (Current Bill)', `Rs ${paidAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 9,
        labelColor: '#000000',
        valColor: '#000000'
      });

      // Itemized payments
      if (pdfPayments.length > 0) {
        pdfPayments.forEach((p) => {
          doc.fontSize(7).font('Helvetica').fillColor('#444444');
          const pLabel = `  • ${p.dateTimeStr} | ${p.method}${p.reference ? ` (${p.reference})` : ''}`;
          const pVal = `Rs ${p.amount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
          doc.text(pLabel, sumX, curY, { width: sumWidth - 80, align: 'left' });
          doc.text(pVal, sumX + sumWidth - 80, curY, { width: 80, align: 'right' });
          curY += 9;
        });
        curY += 2;
      }

      if (tendered > paidAmount && !paymentMethodLabel.includes('CREDIT')) {
        renderSummaryRow('Cash Tendered', `Rs ${tendered.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
          fontSize: 8,
          labelColor: '#555555',
          valColor: '#555555'
        });
        if (remainingChange > 0) {
          renderSummaryRow('Change Returned', `Rs ${remainingChange.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
            fontSize: 8,
            labelColor: '#555555',
            valColor: '#555555'
          });
        }
      }

      if (settledDue > 0) {
        renderSummaryRow('Due Settled from Tendered', `- Rs ${settledDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
          isBold: true,
          fontSize: 8.5,
          labelColor: '#059669',
          valColor: '#059669'
        });
      }

      // 5. Balance Due (Current Bill)
      renderSummaryRow('Balance Due (Current Bill)', `Rs ${balanceDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 9,
        labelColor: balanceDue > 0 ? '#b91c1c' : '#000000',
        valColor: balanceDue > 0 ? '#b91c1c' : '#000000'
      });

      // 6. Previous Due & Total Accumulated Credit
      if (hasCreditLedger) {
        doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(0.75).strokeColor('#888888').dash(2, { space: 2 }).stroke().undash();
        curY += 4;

        renderSummaryRow('Previous Due (Old Bills)', `Rs ${truePreviousDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
          isBold: true,
          fontSize: 9,
          labelColor: '#000000',
          valColor: '#000000'
        });

        doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
        curY += 4;
        renderSummaryRow('Total Outstanding Due Balance', `Rs ${grandTotalCreditDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
          isBold: true,
          fontSize: 10.5,
          labelColor: '#000000',
          valColor: '#000000',
          bottomPadding: 4
        });
        doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(2).strokeColor('#000000').stroke();
        curY += 8;
      }
    }

    // ── 5. SIGNATURES (Dynamically positioned with clear vertical gaps) ──
    // Provide a clear vertical gap directly above signature lines (min 50pt)
    // If not enough room before footer, carry over to next page with generous top breathing room
    let sigY = curY + 50;
    
    if (sigY + 75 > 740) {
      doc.addPage();
      sigY = 100; // Generous margin when carried over to a new page
    } else {
      sigY = Math.max(sigY, 715); 
    }

    const sigWidth = 95; 
    const sigGap = (pageWidth - sigWidth * 4) / 3;

    ['CUSTOMER', 'MARKETING OFFICER', 'DELIVERY', 'AUTHORIZED'].forEach((title, i) => {
      const sX = startX + i * (sigWidth + sigGap);
      doc.moveTo(sX, sigY).lineTo(sX + sigWidth, sigY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(7.1).font('Helvetica-Bold').fillColor('#000000').text(title, sX, sigY + 4, { width: sigWidth, align: 'center', characterSpacing: 0.5, lineBreak: false });
    });

    // ── 6. FOOTER POLICY (Clear gap below signatures and below footer text) ──
    const footerLineY = Math.max(sigY + 45, 770);
    doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('THANK YOU FOR YOUR BUSINESS', startX, footerLineY + 8, { width: pageWidth, align: 'center', characterSpacing: 1.1, lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor('#222222').text('Returns and exchanges are valid only for 7 days with original invoice.', startX, footerLineY + 20, { width: pageWidth, align: 'center', lineBreak: false });

    return doc;
  }
}