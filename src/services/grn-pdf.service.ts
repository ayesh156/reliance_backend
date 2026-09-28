import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

export class GrnPdfService {
  /**
   * Generate A4 Goods Received Note (GRN) PDF identical to standard business layout
   */
  static generate(purchase: any): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 0, 
      bufferPages: true 
    });

    const grnNo = purchase.invoiceNumber || `PO-${String(purchase.id).padStart(4, '0')}`;
    const dateStr = purchase.purchaseDate
      ? new Date(purchase.purchaseDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const total = Number(purchase.totalAmount || 0);
    const paid = Number(purchase.paidAmount || 0);
    const due = Math.max(0, total - paid);
    const paymentMethod = purchase.paymentMethod ? String(purchase.paymentMethod).toUpperCase() : 'CASH';

    const startX = 42.5; 
    const rightMargin = 552.78; 
    const pageWidth = rightMargin - startX;
    const headerTop = 51;

    // Header Logo & Brand
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
      } catch (e) {
        brandTextX = startX;
      }
    }

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE', brandTextX, headerTop - 3);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#111111').text('APPAREL MANUFACTURING & WAREHOUSE', brandTextX, headerTop + 24);
    doc.fontSize(8).font('Helvetica').fillColor('#222222').text('Makandura, Matara, Sri Lanka.', brandTextX, headerTop + 36);
    doc.font('Helvetica-Bold').text('Contact: ', brandTextX, headerTop + 47, { continued: true }).font('Helvetica').text('041-2268739, 071-1350123');

    // ⭐ GOODS RECEIVED NOTE මාතෘකාව විශාල කර (STOCK-IN VOUCHER) ඉවත් කිරීම
    doc.fontSize(21).font('Helvetica-Bold').fillColor('#000000').text('GOODS RECEIVED NOTE', 260, headerTop - 2, { width: 292.78, align: 'right', characterSpacing: 1 });

    const metaY = headerTop + 26; // ⭐ ඉඩ ප්‍රමාණය ප්‍රශස්ත කිරීම සඳහා මෙටා දත්ත පෙළ මඳක් ඉහළට ගැනීම
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('GRN / PO NO:', 380, metaY, { width: 85, align: 'right' });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(grnNo, 470, metaY - 1, { width: 82.78, align: 'right' });

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('RECEIVED DATE:', 380, metaY + 14, { width: 85, align: 'right' });
    doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(dateStr, 470, metaY + 13.5, { width: 82.78, align: 'right' });

    // Divider
    const dividerY = headerTop + 68;
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.2).strokeColor('#000000').stroke();

    // Supplier Section
    const suppTop = dividerY + 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('SUPPLIER DETAILS', startX, suppTop);
    doc.fontSize(10).font('Helvetica-Bold').text(purchase.shop?.name || 'Unknown Supplier', startX, suppTop + 14);
    doc.fontSize(8.5).font('Helvetica').text(`Phone: ${purchase.shop?.phone || '-'} | Contact: ${purchase.shop?.contactPerson || '-'}`, startX, suppTop + 27);

    // Items Table
    const tableTop = suppTop + 48;
    const colWidths = { num: 25.5, code: 80, name: 195, qty: 65, cost: 70, total: 74.78 };
    const colX = {
      num: startX,
      code: startX + colWidths.num,
      name: startX + colWidths.num + colWidths.code,
      qty: startX + colWidths.num + colWidths.code + colWidths.name,
      cost: startX + colWidths.num + colWidths.code + colWidths.name + colWidths.qty,
      total: startX + colWidths.num + colWidths.code + colWidths.name + colWidths.qty + colWidths.cost,
    };

    doc.moveTo(startX, tableTop).lineTo(rightMargin, tableTop).lineWidth(1.2).strokeColor('#000000').stroke();
    const thY = tableTop + 6;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    doc.text('#', colX.num, thY, { width: colWidths.num, align: 'center' });
    doc.text('ITEM CODE', colX.code + 3, thY, { width: colWidths.code });
    doc.text('MATERIAL DESCRIPTION', colX.name + 3, thY, { width: colWidths.name });
    doc.text('RECEIVED QTY', colX.qty, thY, { width: colWidths.qty, align: 'center' });
    doc.text('UNIT COST', colX.cost, thY, { width: colWidths.cost, align: 'right' });
    doc.text('TOTAL AMOUNT', colX.total, thY, { width: colWidths.total - 3, align: 'right' });
    doc.moveTo(startX, tableTop + 18).lineTo(rightMargin, tableTop + 18).lineWidth(1.2).strokeColor('#000000').stroke();

    let curY = tableTop + 24;
    (purchase.items || []).forEach((item: any, idx: number) => {
      const mat = item.rawMaterialItem || {};
      const unit = mat.unit ? mat.unit.toLowerCase() : '';

      doc.fontSize(8.5).font('Helvetica').fillColor('#444444').text(String(idx + 1), colX.num, curY, { width: colWidths.num, align: 'center' });
      doc.font('Helvetica-Bold').fillColor('#000000').text(mat.code || '-', colX.code + 3, curY, { width: colWidths.code });
      doc.text(mat.name || 'Raw Material Item', colX.name + 3, curY, { width: colWidths.name });
      doc.text(`${item.quantity} ${unit}`, colX.qty, curY, { width: colWidths.qty, align: 'center' });
      doc.font('Helvetica').text(`Rs. ${Number(item.pricePerUnit).toLocaleString()}`, colX.cost, curY, { width: colWidths.cost, align: 'right' });
      doc.font('Helvetica-Bold').text(`Rs. ${Number(item.rowTotal || (item.quantity * item.pricePerUnit)).toLocaleString()}`, colX.total, curY, { width: colWidths.total - 3, align: 'right' });

      curY += 20;
      doc.moveTo(startX, curY - 3).lineTo(rightMargin, curY - 3).lineWidth(0.5).strokeColor('#cccccc').dash(2, { space: 2 }).stroke().undash();
    });

    // Summary Section
    const sumX = rightMargin - 190;
    const sumValW = 185;
    curY += 10;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('Total Stock-In Value:', sumX, curY);
    doc.text(`Rs. ${total.toLocaleString()}`, sumX, curY, { width: sumValW, align: 'right' });
    curY += 16;

    doc.font('Helvetica').text(`Paid Amount (${paymentMethod}):`, sumX, curY);
    doc.font('Helvetica-Bold').text(`Rs. ${paid.toLocaleString()}`, sumX, curY, { width: sumValW, align: 'right' });
    curY += 16;

    doc.moveTo(sumX, curY - 2).lineTo(rightMargin, curY - 2).lineWidth(1).strokeColor('#000000').stroke();
    doc.fontSize(10).font('Helvetica-Bold').fillColor(due > 0 ? '#b91c1c' : '#15803d').text('Outstanding Due Balance:', sumX, curY + 2);
    doc.text(`Rs. ${due.toLocaleString()}`, sumX, curY + 2, { width: sumValW, align: 'right' });
    curY += 20;
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.5).strokeColor('#000000').stroke();

    // ⭐ Statement PDF එකේ ආකාරයට අත්සන් තීරු 4 කට සකස් කිරීම
    const sigY = 740;
    const sigW = 95; 
    const sigGap = (pageWidth - sigW * 4) / 3;
    ['STORE KEEPER', 'CHECKED BY (QUALITY)', 'WAREHOUSE OFFICER', 'AUTHORIZED MANAGER'].forEach((title, i) => {
      const sX = startX + i * (sigW + sigGap);
      doc.moveTo(sX, sigY).lineTo(sX + sigW, sigY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000').text(title, sX, sigY + 4, { width: sigW, align: 'center', characterSpacing: 0.5 });
    });

    // ⭐ Statement PDF එකේ ආකාරයට වෘත්තීය පාදක සටහන (Footer Policy) එකතු කිරීම
    const footerLineY = 776;
    doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE CLOTHING · WAREHOUSE & INVENTORY DIVISION', startX, footerLineY + 8, { width: pageWidth, align: 'center', characterSpacing: 1.1 });
    doc.fontSize(7.5).font('Helvetica').fillColor('#222222').text('Goods received are verified and entered into raw material stock ledger. For inquiries contact warehouse manager.', startX, footerLineY + 20, { width: pageWidth, align: 'center' });

    return doc;
  }
}