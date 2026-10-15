import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

/**
 * Format timestamp to standard 'YYYY-MM-DD' representation (e.g., '2026-10-15')
 */
function formatPdfDate(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve local image path or buffer safely for PDFKit embedding.
 * Handles local public files, uploads, and provides a guaranteed fallback to brand placeholder.
 */
function resolveImageSource(imageUrl?: string | null): string | Buffer | null {
  if (!imageUrl || typeof imageUrl !== 'string') {
    const fallback = path.resolve(process.cwd(), 'public', 'images', 'reliance-placeholder.jpg');
    return fs.existsSync(fallback) ? fallback : null;
  }

  const clean = imageUrl.trim();

  // 1. Data URI Base64
  if (clean.startsWith('data:image/')) {
    try {
      const parts = clean.split(',');
      if (parts.length === 2) {
        return Buffer.from(parts[1], 'base64');
      }
    } catch {
      // Fall through to fallback
    }
  }

  // 2. Local uploads or public static images
  if (clean.startsWith('/uploads/') || clean.startsWith('uploads/') || clean.startsWith('/images/')) {
    const relative = clean.replace(/^\//, '');
    const fullPath = path.resolve(process.cwd(), 'public', relative);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0) {
      return fullPath;
    }
  }

  // 3. Fallback to branded placeholder if remote or unresolved
  const fallback = path.resolve(process.cwd(), 'public', 'images', 'reliance-placeholder.jpg');
  if (fs.existsSync(fallback)) {
    return fallback;
  }

  return null;
}

export class SalesOrderPdfService {
  /**
   * Generate A4 Presales Order PDF matching the visual layout and design excellence of Reliance Invoices.
   *
   * Layout Workflow:
   * 1. Header with brand logo, contact details, and bold "ORDER" title.
   * 2. Customer billing & sales rep attribution box.
   * 3. Itemized purchases table where the VERY FIRST COLUMN displays the product image thumbnail.
   * 4. Financial summary with subtotal, discount, and net order total.
   * 5. Sales Representative and Customer Acceptance signature blocks with disclaimer.
   */
  static generate(order: any): InstanceType<typeof PDFDocument> {
    // A4 Portrait: 595.28 x 841.89 pt
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const orderNo = order.orderNumber || `ORD-${String(order.id || Date.now()).padStart(4, '0')}`;
    const dateStr = formatPdfDate(order.createdAt);

    const subtotalVal = Number(order.subtotal || 0);
    const discountVal = Number(order.discount || 0);
    const totalVal = Number(order.totalAmount || (subtotalVal - discountVal) || 0);
    const statusLabel = String(order.status || 'PENDING').toUpperCase();

    // Margins calibrated to 18mm Top/Bottom (51pt), 15mm Left/Right (42.5pt)
    const startX = 42.5;
    const rightMargin = 552.78;
    const pageWidth = rightMargin - startX; // 510.28pt

    // ── 1. HEADER SECTION (Calibrated to 62pt Logo & Thin Editorial Title) ──
    const headerTop = 51;

    // Resolve brand logo
    const potentialPaths = [
      path.resolve(process.cwd(), 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public', 'logo.jpg'),
      path.resolve(process.cwd(), 'dist', 'public', 'images', 'logo.jpg'),
    ];
    const logoPath = potentialPaths.find((p) => fs.existsSync(p));

    let brandTextX = startX;
    if (logoPath && fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
      try {
        doc.image(logoPath, startX, headerTop - 3, { width: 62, height: 62 });
        brandTextX = startX + 74;
      } catch {
        brandTextX = startX;
      }
    }

    // Brand Identification Text
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE', brandTextX, headerTop - 3, { characterSpacing: 1.5 });
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#111111').text('BRANDED MENS CLOTHING', brandTextX, headerTop + 24, { characterSpacing: 2 });
    doc.fontSize(8).font('Helvetica').fillColor('#222222');
    doc.text('Mawarala Road, Makandura, Matara.', brandTextX, headerTop + 36);
    doc.font('Helvetica-Bold').text('Tel: ', brandTextX, headerTop + 47, { continued: true }).font('Helvetica').text('041-2268739, 071-1350123');
    doc.font('Helvetica-Bold').text('Web: ', brandTextX, headerTop + 58, { continued: true }).font('Helvetica').text('relianceclothing.lk');

    // Right-aligned Document Title: ORDER
    doc
      .fontSize(24)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('ORDER', 280, headerTop - 3, { width: 272.78, align: 'right', characterSpacing: 3 });

    // Meta Table
    const metaY = headerTop + 28;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('ORDER NO:', 395, metaY, { width: 70, align: 'right' });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(orderNo, 470, metaY - 1, { width: 82.78, align: 'right' });

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('DATE:', 395, metaY + 14, { width: 70, align: 'right' });
    doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(dateStr, 470, metaY + 13.5, { width: 82.78, align: 'right' });

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('STATUS:', 395, metaY + 28, { width: 70, align: 'right' });
    doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#000000').text(statusLabel, 470, metaY + 27.5, { width: 82.78, align: 'right' });

    if (order.user?.name) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('SALES REP:', 395, metaY + 42, { width: 70, align: 'right' });
      doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(order.user.name, 470, metaY + 41.5, { width: 82.78, align: 'right' });
    }

    // Main Solid Divider Line
    const dividerY = headerTop + (order.user?.name ? 88 : 76);
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.2).strokeColor('#000000').stroke();

    // ── 2. CUSTOMER DETAILS & NOTES SECTION ──
    const customerTop = dividerY + 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('ORDER FOR', startX, customerTop, { characterSpacing: 0.8 });
    doc.moveTo(startX, customerTop + 10).lineTo(startX + 50, customerTop + 10).lineWidth(1.2).strokeColor('#000000').stroke();

    const customerDisplayName = order.customerName || order.customer?.name || 'Walk-in / Guest Customer';
    doc.fontSize(10.5).font('Helvetica-Bold').text(customerDisplayName, startX, customerTop + 15);
    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(order.customerAddress || order.customer?.address || '-', startX, customerTop + 28);
    doc.font('Helvetica-Bold').text('Contact: ', startX, customerTop + 40, { continued: true }).font('Helvetica').text(order.customerPhone || order.customer?.phone || '-');

    if (order.notes) {
      let displayNote = String(order.notes);
      if (typeof order.notes === 'string' && order.notes.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(order.notes);
          displayNote = parsed.userNotes || '';
        } catch {}
      } else if (typeof order.notes === 'object' && order.notes !== null) {
        displayNote = (order.notes as any).userNotes || '';
      }

      if (displayNote.trim()) {
        const noteBoxWidth = 210;
        const noteX = rightMargin - noteBoxWidth;
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('ORDER INSTRUCTIONS / NOTES', noteX, customerTop, { width: noteBoxWidth, align: 'right', characterSpacing: 0.8 });
        doc.moveTo(noteX, customerTop + 10).lineTo(rightMargin, customerTop + 10).lineWidth(1.2).strokeColor('#000000').stroke();
        doc.fontSize(8.5).font('Helvetica').fillColor('#222222').text(displayNote, noteX, customerTop + 15, { width: noteBoxWidth, align: 'right' });
      }
    }

    // ── 3. ITEMS TABLE WITH PRODUCT IMAGE IN THE VERY FIRST COLUMN ──
    // Width breakdown: Image (50), # (20), Style (77), Desc (175), Price (65), Qty (45), Amt (78.28) = 510.28 pt
    const tableTop = customerTop + 62;
    const colWidths = {
      image: 50,
      num: 20,
      style: 77,
      desc: 175,
      price: 65,
      qty: 45,
      amt: 78.28,
    };

    const colX = {
      image: startX,
      num: startX + colWidths.image,
      style: startX + colWidths.image + colWidths.num,
      desc: startX + colWidths.image + colWidths.num + colWidths.style,
      price: startX + colWidths.image + colWidths.num + colWidths.style + colWidths.desc,
      qty: startX + colWidths.image + colWidths.num + colWidths.style + colWidths.desc + colWidths.price,
      amt: startX + colWidths.image + colWidths.num + colWidths.style + colWidths.desc + colWidths.price + colWidths.qty,
    };

    // Table Header Borders
    doc.moveTo(startX, tableTop).lineTo(rightMargin, tableTop).lineWidth(1.2).strokeColor('#000000').stroke();

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    const thY = tableTop + 6;
    doc.text('PHOTO', colX.image, thY, { width: colWidths.image, align: 'center', lineBreak: false });
    doc.text('#', colX.num, thY, { width: colWidths.num, align: 'center', lineBreak: false });
    doc.text('STYLE NO', colX.style + 3, thY, { width: colWidths.style - 3, align: 'left', lineBreak: false });
    doc.text('ITEM DESCRIPTION', colX.desc + 3, thY, { width: colWidths.desc - 3, align: 'left', lineBreak: false });
    doc.text('UNIT PRICE', colX.price, thY, { width: colWidths.price - 4, align: 'right', lineBreak: false });
    doc.text('QTY', colX.qty, thY, { width: colWidths.qty, align: 'center', lineBreak: false });
    doc.text('AMOUNT', colX.amt, thY, { width: colWidths.amt - 3, align: 'right', lineBreak: false });

    doc.moveTo(startX, tableTop + 18).lineTo(rightMargin, tableTop + 18).lineWidth(1.2).strokeColor('#000000').stroke();

    let curY = tableTop + 24;

    const items = Array.isArray(order.items) ? order.items : [];

    items.forEach((item: any, idx: number) => {
      const variantObj = item.variant || {};
      const productObj = variantObj.product || {};
      const styleNo = item.sku || variantObj.sku || `STY-${String(idx + 1).padStart(3, '0')}`;
      const name = item.productName || productObj.name || 'Garment Item';
      const sizeStr = item.variantName || item.size || variantObj.size || '';
      const colorStr = item.color || variantObj.color || '';
      const meta = sizeStr || colorStr ? `Size: ${sizeStr || 'FREE'} | Color: ${colorStr || 'Default'}` : '';

      const descAvailableWidth = colWidths.desc - 6;

      doc.fontSize(9).font('Helvetica-Bold');
      const nameHeight = doc.heightOfString(name, { width: descAvailableWidth });

      let metaHeight = 0;
      if (meta) {
        doc.fontSize(7.8).font('Helvetica');
        metaHeight = doc.heightOfString(meta, { width: descAvailableWidth });
      }

      const totalDescHeight = nameHeight + (meta ? metaHeight + 2 : 0);
      // Enlarged wholesale photo (40x40): ensure minimum rowHeight of 48pt with generous vertical padding
      const imgSize = 40;
      const rowHeight = Math.max(48, totalDescHeight + 12);

      // Page break check (calibrated for taller rows)
      if (curY + rowHeight > 750) {
        doc.addPage();
        curY = 50;

        // Re-draw table header on new page
        doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
        doc.text('PHOTO', colX.image, curY + 6, { width: colWidths.image, align: 'center', lineBreak: false });
        doc.text('#', colX.num, curY + 6, { width: colWidths.num, align: 'center', lineBreak: false });
        doc.text('STYLE NO', colX.style + 3, curY + 6, { width: colWidths.style - 3, align: 'left', lineBreak: false });
        doc.text('ITEM DESCRIPTION', colX.desc + 3, curY + 6, { width: colWidths.desc - 3, align: 'left', lineBreak: false });
        doc.text('UNIT PRICE', colX.price, curY + 6, { width: colWidths.price - 4, align: 'right', lineBreak: false });
        doc.text('QTY', colX.qty, curY + 6, { width: colWidths.qty, align: 'center', lineBreak: false });
        doc.text('AMOUNT', colX.amt, curY + 6, { width: colWidths.amt - 3, align: 'right', lineBreak: false });
        doc.moveTo(startX, curY + 18).lineTo(rightMargin, curY + 18).lineWidth(1.2).strokeColor('#000000').stroke();
        curY += 24;
      }

      // ── CRITICAL: RENDER ENLARGED PRODUCT IMAGE IN FIRST COLUMN ──
      const imgSource = resolveImageSource(
        item.imageUrl ||
        variantObj.images?.[0]?.imageUrl ||
        productObj.images?.[0]?.imageUrl
      );

      // Center the 40pt image both horizontally inside the column and vertically inside rowHeight
      const imgBoxX = colX.image + (colWidths.image - imgSize) / 2;
      const imgBoxY = curY + (rowHeight - imgSize) / 2;

      if (imgSource) {
        try {
          doc.image(imgSource, imgBoxX, imgBoxY, {
            width: imgSize,
            height: imgSize,
            fit: [imgSize, imgSize],
            align: 'center',
            valign: 'center',
          });
          // Draw subtle outline around thumbnail
          doc.rect(imgBoxX, imgBoxY, imgSize, imgSize).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
        } catch {
          // Fallback box with label
          doc.rect(imgBoxX, imgBoxY, imgSize, imgSize).lineWidth(0.5).strokeColor('#CBD5E1').fillColor('#F1F5F9').fillAndStroke();
          doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748B').text('IMG', imgBoxX, imgBoxY + (imgSize - 7) / 2, { width: imgSize, align: 'center' });
        }
      } else {
        // Fallback placeholder box
        doc.rect(imgBoxX, imgBoxY, imgSize, imgSize).lineWidth(0.5).strokeColor('#CBD5E1').fillColor('#F1F5F9').fillAndStroke();
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748B').text('IMG', imgBoxX, imgBoxY + (imgSize - 7) / 2, { width: imgSize, align: 'center' });
      }

      // Vertical text centering offsets based on proportional rowHeight
      const textY = curY + Math.round((rowHeight - 9) / 2);
      const descY = curY + Math.max(6, Math.round((rowHeight - totalDescHeight) / 2));

      // # Column
      doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), colX.num, textY, { width: colWidths.num, align: 'center', lineBreak: false });

      // Style No Column
      doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#000000').text(styleNo, colX.style + 3, textY, { width: colWidths.style - 3, lineBreak: false });

      // Item Description Column (vertically centered as a composite block)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text(name, colX.desc + 3, descY, { width: descAvailableWidth });
      if (meta) {
        doc.fontSize(7.8).font('Helvetica').fillColor('#555555').text(meta, colX.desc + 3, descY + nameHeight + 2, { width: descAvailableWidth });
      }

      // Unit Price Column
      const uPrice = Number(item.unitPrice || 0);
      doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(
        uPrice.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        colX.price,
        textY,
        { width: colWidths.price - 4, align: 'right', lineBreak: false }
      );

      // Qty Column
      const qtyVal = Number(item.quantity || 1);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text(
        String(qtyVal),
        colX.qty,
        textY,
        { width: colWidths.qty, align: 'center', lineBreak: false }
      );

      // Amount Column
      const lineTotal = Number(item.totalPrice || item.price || (uPrice * qtyVal));
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text(
        lineTotal.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        colX.amt,
        textY,
        { width: colWidths.amt - 3, align: 'right', lineBreak: false }
      );

      // Row separator line
      const rowBottom = curY + rowHeight;
      doc.moveTo(startX, rowBottom).lineTo(rightMargin, rowBottom).lineWidth(0.4).strokeColor('#E2E8F0').stroke();

      curY = rowBottom + 6;
    });

    // ── 4. FINANCIAL SUMMARY SECTION ──
    const summaryWidth = 210;
    const summaryX = rightMargin - summaryWidth;
    let sumY = curY + 6;

    // Check if summary block has enough vertical space on the current page
    if (sumY + 70 > 760) {
      doc.addPage();
      sumY = 50;
    }

    doc.moveTo(summaryX, sumY).lineTo(rightMargin, sumY).lineWidth(0.8).strokeColor('#000000').stroke();

    const renderSummaryRow = (label: string, value: string, isBold: boolean = false, isAccent: boolean = false) => {
      sumY += 6;
      doc.fontSize(8.5).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(isAccent ? '#000000' : '#444444')
        .text(label, summaryX, sumY, { width: 100, align: 'left' });
      doc.fontSize(9).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(isAccent ? '#000000' : '#111111')
        .text(value, summaryX + 100, sumY, { width: summaryWidth - 100, align: 'right' });
      sumY += 12;
    };

    renderSummaryRow('SUBTOTAL:', `Rs. ${subtotalVal.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    if (discountVal > 0) {
      renderSummaryRow('DISCOUNT:', `- Rs. ${discountVal.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }

    doc.moveTo(summaryX, sumY + 2).lineTo(rightMargin, sumY + 2).lineWidth(1.2).strokeColor('#000000').stroke();
    sumY += 4;
    renderSummaryRow('ORDER TOTAL:', `Rs. ${totalVal.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, true, true);
    doc.moveTo(summaryX, sumY).lineTo(rightMargin, sumY).lineWidth(1.2).strokeColor('#000000').stroke();

    // ── 5. DYNAMIC PAGINATION: ACCEPTANCE & SIGNATURE BLOCK ──
    // Place signature lines with a clear vertical gap directly above signatures (min 50pt).
    // If remaining space on the page cannot fit signatures and footer, cleanly carry over to next page.
    let sigY = sumY + 50;
    if (sigY + 75 > 740) {
      doc.addPage();
      sigY = 100; // Generous margin when carried over to a new page
    } else {
      sigY = Math.max(sigY, 715);
    }

    const sigWidth = 95;
    const sigGap = (pageWidth - sigWidth * 4) / 3;

    ['CUSTOMER', 'SALES REPRESENTATIVE', 'DELIVERY OFFICER', 'AUTHORIZED SIGNATURE'].forEach((title, i) => {
      const sX = startX + i * (sigWidth + sigGap);
      doc.moveTo(sX, sigY).lineTo(sX + sigWidth, sigY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(7.1).font('Helvetica-Bold').fillColor('#000000')
        .text(title, sX, sigY + 4, { width: sigWidth, align: 'center', characterSpacing: 0.5, lineBreak: false });
    });

    // ── 6. STANDARD INVOICE FOOTER TEXT ──
    // Generous vertical gap below signatures (min 45pt) and ample breathing room below footer text
    const footerLineY = Math.max(sigY + 45, 770);
    doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000')
      .text('THANK YOU FOR YOUR BUSINESS', startX, footerLineY + 8, { width: pageWidth, align: 'center', characterSpacing: 1.1, lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor('#222222')
      .text('Notice: This booking order is subject to central warehouse inventory confirmation. Returns and exchanges are valid only with original document.', startX, footerLineY + 20, { width: pageWidth, align: 'center', lineBreak: false });

    return doc;
  }
}
