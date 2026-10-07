import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

export class InvoicePdfService {
  /**
   * Generate A4 Invoice PDF perfectly identical to Frontend Print Engine (100% Visual Parity)
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
    const paidAmount = order.paidAmount !== undefined 
      ? Number(order.paidAmount) 
      : Math.min(total, tendered);
    const settledDue = Number(order.settledDueAmount || 0);
    const remainingChange = Math.max(0, Math.round((tendered - paidAmount - settledDue) * 100) / 100);
    const balanceDue = Math.max(0, Math.round((total - paidAmount) * 100) / 100);
    const discountVal = Number(order.discount || 0);
    const subtotalVal = Number(order.subtotal || (total + discountVal) || 0);

    const isWholesale = order.source === 'POS_WHOLESALE' || order.orderType === 'WHOLESALE';
    const paymentMethodLabel = order.paymentMethod 
      ? order.paymentMethod.toUpperCase() 
      : (isWholesale ? 'WHOLESALE CREDIT' : 'CASH');

    const invoiceTitle = isWholesale ? 'WHOLESALE INVOICE' : 'INVOICE';

    // ⭐ Enterprise Credit Synchronization: Prevents Double-Counting on PDF Re-print
    const isCreditOrder = paymentMethodLabel.includes('CREDIT') || balanceDue > 0;
    const currentBillCredit = isCreditOrder ? balanceDue : 0;
    
    // Total live balance recorded in database
    const liveCustomerBalance = Number(order.customer?.outstandingBalance ?? order.prevBalance ?? 0);
    
    // True prior debt is: live balance MINUS this invoice's credit PLUS settled due amount
    const truePreviousDue = Math.max(0, Math.round((liveCustomerBalance - currentBillCredit + settledDue) * 100) / 100);
    const hasCreditLedger = Boolean(order.customerId || order.customer?.id) && (truePreviousDue > 0.01 || settledDue > 0.01 || liveCustomerBalance > 0.01);
    
    // Cumulative total outstanding
    const grandTotalCreditDue = Math.max(0, Math.round((currentBillCredit + truePreviousDue - settledDue) * 100) / 100);

    let discountDisplay = 'Discount:';
    if (discountVal > 0) {
      const percent = order.discountRate !== undefined && Number(order.discountRate) > 0
        ? Number(order.discountRate)
        : (subtotalVal > 0 ? Math.round((discountVal / subtotalVal) * 100) : 0);
      discountDisplay = percent > 0 ? `Discount (${percent}%):` : 'Discount:';
    }

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

    doc.fontSize(10.5).font('Helvetica-Bold').text(order.customerName || 'Walk-in Customer', startX, customerTop + 15);
    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(order.customer?.address || order.shippingAddress || '-', startX, customerTop + 28);
    doc.font('Helvetica-Bold').text('Contact: ', startX, customerTop + 40, { continued: true }).font('Helvetica').text(order.customerPhone || order.customer?.phone || '-');

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

      const totalDescHeight = nameHeight + (meta ? metaHeight + 2 : 0);
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
      
      // Item Description (Title + Multi-line Variant Wrap)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text(name, colX.desc + 3, curY, { width: descAvailableWidth });

      if (meta) {
        const metaY = curY + nameHeight + 2;
        doc.fontSize(7.8).font('Helvetica').fillColor('#555555').text(meta, colX.desc + 3, metaY, { width: descAvailableWidth, lineBreak: true });
      }

      doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(`Rs ${Number(item.unitPrice).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.price, curY, { width: colWidths.price - 13.5, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').text(String(item.quantity), colX.qty, curY, { width: colWidths.qty, align: 'center', lineBreak: false });
      doc.text(`Rs ${Number(item.price).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.amt, curY, { width: colWidths.amt - 3, align: 'right', lineBreak: false });

      curY += rowHeight;
      // Dashed row separator
      doc.moveTo(startX, curY - 4).lineTo(rightMargin, curY - 4).lineWidth(0.75).strokeColor('#bbbbbb').dash(2, { space: 2 }).stroke().undash();
    });

    curY += 12; // Gap before summary

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

    // 1. Sub Total
    renderSummaryRow('Sub Total', `Rs ${subtotalVal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
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

    // Total Due (Current Bill): Solid 1.2pt Top, Solid 1.8pt Bottom
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
    curY += 4;
    renderSummaryRow('Total Due (Current Bill)', `Rs ${total.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
      isBold: true,
      fontSize: 10.5,
      labelColor: '#000000',
      valColor: '#000000',
      bottomPadding: 4
    });
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.8).strokeColor('#000000').stroke();
    curY += 5;

    // 2. Tendered & Payment Breakdown (shown when customer tendered/paid cash or payment)
    if (tendered > 0 || paidAmount > 0) {
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(0.75).strokeColor('#888888').dash(2, { space: 2 }).stroke().undash();
      curY += 4;

      renderSummaryRow(`Customer Tendered (${paymentMethodLabel})`, `Rs ${tendered.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 8.8,
        labelColor: '#000000',
        valColor: '#000000'
      });

      renderSummaryRow('Paid for Current Bill', `Rs ${paidAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 8.8,
        labelColor: '#000000',
        valColor: '#000000'
      });

      if (settledDue > 0) {
        renderSummaryRow('Due Settled from Tendered', `- Rs ${settledDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
          isBold: true,
          fontSize: 8.8,
          labelColor: '#000000',
          valColor: '#000000'
        });
      }

      if (remainingChange > 0) {
        renderSummaryRow('Change Returned', `Rs ${remainingChange.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
          isBold: true,
          fontSize: 8.8,
          labelColor: '#000000',
          valColor: '#000000'
        });
      }
    }

    // 3. Previous Due & Total Accumulated Credit
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
      renderSummaryRow('Total Accumulated Credit Due', `Rs ${grandTotalCreditDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, {
        isBold: true,
        fontSize: 10.5,
        labelColor: '#000000',
        valColor: '#000000',
        bottomPadding: 4
      });
      doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(2).strokeColor('#000000').stroke();
      curY += 8;
    }

    // ── 5. SIGNATURES (Dynamically positioned with a generous 1-inch gap) ──
    
    // Require at least 80px (approx 1 inch gap + signature lines) space to print signatures on the same page.
    // If not enough space before footer policy (approx Y: 776), move to a new page.
    let sigY = curY + 65; // ~1 inch gap from the bottom of the summary
    
    if (sigY + 30 > 750) {
      doc.addPage();
      sigY = 700; // Place cleanly at the bottom of the new page
    } else {
      // Pin to bottom if there's plenty of space, otherwise keep the 1-inch gap
      sigY = Math.max(sigY, 720); 
    }

    const sigWidth = 95; 
    const sigGap = (pageWidth - sigWidth * 4) / 3;

    ['CUSTOMER', 'MARKETING OFFICER', 'DELIVERY', 'AUTHORIZED'].forEach((title, i) => {
      const sX = startX + i * (sigWidth + sigGap);
      doc.moveTo(sX, sigY).lineTo(sX + sigWidth, sigY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(7.1).font('Helvetica-Bold').fillColor('#000000').text(title, sX, sigY + 4, { width: sigWidth, align: 'center', characterSpacing: 0.5, lineBreak: false });
    });

    // ── 6. FOOTER POLICY (Pinned Exactly to Bottom Margin) ──
    const footerLineY = 776;
    doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('THANK YOU FOR YOUR BUSINESS', startX, footerLineY + 8, { width: pageWidth, align: 'center', characterSpacing: 1.1, lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor('#222222').text('Returns and exchanges are valid only for 7 days with original invoice.', startX, footerLineY + 20, { width: pageWidth, align: 'center', lineBreak: false });

    return doc;
  }
}