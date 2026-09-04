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
    const paid = Number(order.paidAmount || 0);
    const change = Math.max(0, paid - total);
    const balanceDue = Math.max(0, total - paid);
    const discountVal = Number(order.discount || 0);
    const subtotalVal = Number(order.subtotal || 0);
    const paymentMethodLabel = order.paymentMethod ? order.paymentMethod.toUpperCase() : 'CASH';

    // Dynamic Old Bill check
    const prevBalance = Number(order.customer?.outstandingBalance || order.prevBalance || 0);
    const hasOldBill = Boolean(order.customerId || order.customer?.id) && prevBalance > 0;

    let discountDisplay = 'Discount:';
    if (discountVal > 0) {
      if (order.discountType === 'PERCENT') {
        const percent = order.discountRate !== undefined
          ? order.discountRate
          : (subtotalVal > 0 ? Math.round((discountVal / subtotalVal) * 100) : 0);
        discountDisplay = `Discount (${percent}%):`;
      } else {
        discountDisplay = 'Discount:';
      }
    }

    // Margins calibrated to 18mm Top/Bottom (51pt), 15mm Left/Right (42.5pt)
    const startX = 42.5; 
    const rightMargin = 552.78; 
    const pageWidth = rightMargin - startX; // 510.28pt

    // ── 1. HEADER SECTION (Calibrated to 82px Logo & Thin Editorial Title) ──
    const headerTop = 51;

    const potentialPaths = [
      path.resolve(process.cwd(), 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public', 'logo.jpg'),
      path.resolve(__dirname, '..', '..', 'public', 'images', 'logo.jpg'),
      path.resolve(__dirname, '..', '..', 'public', 'logo.jpg'),
    ];
    const logoPath = potentialPaths.find((p) => fs.existsSync(p));

    let brandTextX = startX;
    if (logoPath) {
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

    // Right-aligned Modern Light Invoice Title (Changed to Uppercase INVOICE)
    doc.fontSize(24).font('Helvetica').fillColor('#000000').text('INVOICE', 350, headerTop - 3, { width: 202.78, align: 'right', characterSpacing: 3 });

    // Meta Table (Gap tightened between label and value)
    const metaY = headerTop + 30;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('INVOICE NO:', 395, metaY, { width: 70, align: 'right' });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(invoiceNo, 470, metaY - 1, { width: 82.78, align: 'right' });

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('DATE:', 395, metaY + 14, { width: 70, align: 'right' });
    doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(dateStr, 470, metaY + 13.5, { width: 82.78, align: 'right' });

    // Main Solid Divider Line
    const dividerY = headerTop + 76;
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.2).strokeColor('#000000').stroke();

    // ── 2. BILLED TO SECTION ──
    const customerTop = dividerY + 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('BILLED TO', startX, customerTop, { characterSpacing: 0.8 });
    doc.moveTo(startX, customerTop + 10).lineTo(startX + 50, customerTop + 10).lineWidth(1.2).strokeColor('#000000').stroke();

    doc.fontSize(10.5).font('Helvetica-Bold').text(order.customerName || 'Walk-in Customer', startX, customerTop + 15);
    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(order.customer?.address || order.shippingAddress || '-', startX, customerTop + 28);
    doc.font('Helvetica-Bold').text('Contact: ', startX, customerTop + 40, { continued: true }).font('Helvetica').text(order.customerPhone || order.customer?.phone || '-');

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
      const styleNo = item.variant?.sku || item.variant?.styleNo || `STY-${String(idx + 1).padStart(3, '0')}`;
      const name = item.variant?.product?.name || 'Garment Item';
      const meta = item.variant?.size || item.variant?.color
        ? `Size: ${item.variant?.size || 'FREE'} | Color: ${item.variant?.color || 'Default'}`
        : '';

      doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), colX.num, curY, { width: colWidths.num, align: 'center', lineBreak: false });
      doc.font('Helvetica-Bold').fillColor('#000000').text(styleNo, colX.style + 3, curY, { width: colWidths.style - 3, lineBreak: false });
      doc.fontSize(9).font('Helvetica-Bold').text(name, colX.desc + 3, curY, { width: colWidths.desc - 3 });

      if (meta) {
        doc.fontSize(7.8).font('Helvetica').fillColor('#555555').text(meta, colX.desc + 3, curY + 12, { width: colWidths.desc - 3, lineBreak: false });
      }

      doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(`Rs ${Number(item.unitPrice).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.price, curY, { width: colWidths.price - 13.5, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').text(String(item.quantity), colX.qty, curY, { width: colWidths.qty, align: 'center', lineBreak: false });
      doc.text(`Rs ${Number(item.price).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.amt, curY, { width: colWidths.amt - 3, align: 'right', lineBreak: false });

      curY += meta ? 28 : 20;
      // Dashed row separator
      doc.moveTo(startX, curY - 4).lineTo(rightMargin, curY - 4).lineWidth(0.75).strokeColor('#bbbbbb').dash(2, { space: 2 }).stroke().undash();
    });

    // ── Dynamic Old Bill Row (Colors matching frontend monochrome CSS override) ──
    if (hasOldBill) {
      const oldBillLabelWidth = (colX.amt - startX) - 13.5;
      
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('OLD BILL (PREVIOUS DUE)', startX, curY + 5, { 
        width: oldBillLabelWidth, 
        align: 'right', 
        characterSpacing: 0.5,
        lineBreak: false 
      });
      doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#000000').text(
        `Rs ${prevBalance.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, 
        colX.amt, 
        curY + 5, 
        { width: colWidths.amt - 3, align: 'right', lineBreak: false }
      );
      curY += 24;
    } else {
      curY += 12;
    }

    // ── 4. FINANCIAL SUMMARY SECTION ──
    const sumX = rightMargin - 202.5;
    const sumRightEdge = rightMargin - 3;
    const sumValueWidth = sumRightEdge - sumX;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#222222').text('Sub Total', sumX, curY, { lineBreak: false });
    doc.fontSize(9.4).text(`Rs ${Number(order.subtotal || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
    curY += 16;

    if (discountVal > 0) {
      doc.fontSize(9).font('Helvetica-Bold').text(discountDisplay, sumX, curY, { lineBreak: false });
      doc.fontSize(9.4).text(`- Rs ${discountVal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
      curY += 16;
    }

    // Total Due: Solid 1.2pt Top, Solid 1.8pt Bottom
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
    curY += 6;
    doc.fontSize(11.25).font('Helvetica-Bold').fillColor('#000000').text('Total Due', sumX, curY, { lineBreak: false });
    doc.fontSize(12).text(`Rs ${total.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
    curY += 18;
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.8).strokeColor('#000000').stroke();
    curY += 8;

    doc.fontSize(9).font('Helvetica').text(`Customer Tendered (${paymentMethodLabel})`, sumX, curY, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.4).text(`Rs ${paid.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
    curY += 16;

    if (change > 0) {
      doc.fontSize(9).font('Helvetica').text('Change', sumX, curY, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9.4).text(`Rs ${change.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
      curY += 16;
    }

    if (balanceDue > 0) {
      doc.fontSize(9).font('Helvetica-Bold').text('Credit / Balance Due', sumX, curY, { lineBreak: false });
      doc.fontSize(9.4).text(`- Rs ${balanceDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
      curY += 16;
    }

    // ── 5. SIGNATURES (Natural flow matching frontend, NOT forced to page bottom) ──
    let sigY = curY + 40; 
    if (sigY > 760) {
      doc.addPage();
      sigY = 50;
    }

    const sigWidth = 95; 
    const sigGap = (pageWidth - sigWidth * 4) / 3;

    ['CUSTOMER', 'MARKETING OFFICER', 'DELIVERY', 'AUTHORIZED'].forEach((title, i) => {
      const sX = startX + i * (sigWidth + sigGap);
      doc.moveTo(sX, sigY).lineTo(sX + sigWidth, sigY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(7.1).font('Helvetica-Bold').fillColor('#000000').text(title, sX, sigY + 4, { width: sigWidth, align: 'center', characterSpacing: 0.5, lineBreak: false });
    });

    // ── 6. FOOTER POLICY ──
    const footerLineY = sigY + 26;
    doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
    doc.fontSize(9).font('Helvetica-Bold').text('THANK YOU FOR YOUR BUSINESS', startX, footerLineY + 8, { width: pageWidth, align: 'center', characterSpacing: 1.1, lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor('#222222').text('Returns and exchanges are valid only for 7 days with original invoice.', startX, footerLineY + 20, { width: pageWidth, align: 'center', lineBreak: false });

    return doc;
  }
}