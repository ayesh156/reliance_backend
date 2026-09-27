import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

export class CustomerStatementPdfService {
  /**
   * Generates an official A4 Customer Due Statement PDF with matching Reliance typography and header/footer
   */
  static generate(customer: any, dueBills: any[]): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const currentDate = new Date().toISOString().split('T')[0];
    const totalDue = Number(customer.outstandingBalance || 0);

    // Margins: Top/Bottom 51pt (18mm), Left/Right 42.5pt (15mm)
    const startX = 42.5;
    const rightMargin = 552.78;
    const pageWidth = rightMargin - startX; // 510.28pt

    // ── 1. HEADER SECTION ──
    const headerTop = 51;
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

    // Right-aligned Document Title
    doc.fontSize(19).font('Helvetica-Bold').fillColor('#000000').text('STATEMENT OF ACCOUNT', 280, headerTop - 3, { width: 272.78, align: 'right', characterSpacing: 1 });

    const metaY = headerTop + 28;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('STATEMENT DATE:', 370, metaY, { width: 95, align: 'right' });
    doc.fontSize(8.6).font('Helvetica').fillColor('#000000').text(currentDate, 470, metaY - 0.5, { width: 82.78, align: 'right' });

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text('ACCOUNT TYPE:', 370, metaY + 14, { width: 95, align: 'right' });
    doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#000000').text(customer.type || 'RETAIL', 470, metaY + 13.5, { width: 82.78, align: 'right' });

    // Divider Line
    const dividerY = headerTop + 78;
    doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.2).strokeColor('#000000').stroke();

    // ── 2. CUSTOMER DETAILS ──
    const customerTop = dividerY + 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('STATEMENT ISSUED TO', startX, customerTop, { characterSpacing: 0.8 });
    doc.moveTo(startX, customerTop + 10).lineTo(startX + 80, customerTop + 10).lineWidth(1.2).strokeColor('#000000').stroke();

    doc.fontSize(10.5).font('Helvetica-Bold').text(customer.name || 'Valued Customer', startX, customerTop + 15);
    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(customer.address || customer.city || 'No registered address', startX, customerTop + 28);
    doc.font('Helvetica-Bold').text('Contact: ', startX, customerTop + 40, { continued: true }).font('Helvetica').text(customer.phone || '-');

    // Total Due Box on the right
    const summaryBoxX = rightMargin - 160;
    doc.rect(summaryBoxX, customerTop + 8, 160, 42).lineWidth(1).strokeColor('#000000').stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#555555').text('TOTAL OUTSTANDING BALANCE', summaryBoxX + 6, customerTop + 14, { width: 148, align: 'center' });
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#b91c1c').text(`Rs. ${totalDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, summaryBoxX + 6, customerTop + 28, { width: 148, align: 'center' });

    // ── 3. INVOICES TABLE ──
    const tableTop = customerTop + 62;
    const colWidths = { num: 25.5, inv: 85, date: 75, type: 85, total: 80, paid: 75, due: 84.78 };
    const colX = {
      num: startX,
      inv: startX + colWidths.num,
      date: startX + colWidths.num + colWidths.inv,
      type: startX + colWidths.num + colWidths.inv + colWidths.date,
      total: startX + colWidths.num + colWidths.inv + colWidths.date + colWidths.type,
      paid: startX + colWidths.num + colWidths.inv + colWidths.date + colWidths.type + colWidths.total,
      due: startX + colWidths.num + colWidths.inv + colWidths.date + colWidths.type + colWidths.total + colWidths.paid,
    };

    doc.moveTo(startX, tableTop).lineTo(rightMargin, tableTop).lineWidth(1.2).strokeColor('#000000').stroke();

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    const thY = tableTop + 6;
    doc.text('#', colX.num, thY, { width: colWidths.num, align: 'center', lineBreak: false });
    doc.text('INVOICE NO', colX.inv + 2, thY, { width: colWidths.inv - 2, align: 'left', lineBreak: false });
    doc.text('DATE', colX.date + 2, thY, { width: colWidths.date - 2, align: 'left', lineBreak: false });
    doc.text('BILL TYPE', colX.type + 2, thY, { width: colWidths.type - 2, align: 'left', lineBreak: false });
    doc.text('BILL TOTAL', colX.total, thY, { width: colWidths.total - 4, align: 'right', lineBreak: false });
    doc.text('PAID', colX.paid, thY, { width: colWidths.paid - 4, align: 'right', lineBreak: false });
    doc.text('DUE AMOUNT', colX.due, thY, { width: colWidths.due - 3, align: 'right', lineBreak: false });

    doc.moveTo(startX, tableTop + 18).lineTo(rightMargin, tableTop + 18).lineWidth(1.2).strokeColor('#000000').stroke();

    let curY = tableTop + 24;

    if (dueBills.length === 0) {
      doc.fontSize(9).font('Helvetica').fillColor('#555555').text('No pending invoices found for this customer.', startX, curY + 10, { width: pageWidth, align: 'center' });
      curY += 35;
    } else {
      dueBills.forEach((bill: any, idx: number) => {
        const invNo = bill.invoiceNumber || `INV${bill.orderId || bill.id}`;
        const rawDate = bill.createdAt || bill.date;
        const bDate = rawDate ? new Date(rawDate).toISOString().split('T')[0] : '-';
        const bType = bill.source === 'POS_WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
        const bTotal = Number(bill.totalAmount || 0);
        const bPaid = Number(bill.paidAmount || 0);
        const bDue = Number(bill.dueAmount || (bTotal - bPaid));

        doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), colX.num, curY, { width: colWidths.num, align: 'center', lineBreak: false });
        doc.font('Helvetica-Bold').fillColor('#000000').text(invNo, colX.inv + 2, curY, { width: colWidths.inv - 2, lineBreak: false });
        doc.font('Helvetica').text(bDate, colX.date + 2, curY, { width: colWidths.date - 2, lineBreak: false });
        doc.font('Helvetica-Bold').text(bType, colX.type + 2, curY, { width: colWidths.type - 2, lineBreak: false });
        doc.font('Helvetica').text(`Rs. ${bTotal.toLocaleString('en-LK')}`, colX.total, curY, { width: colWidths.total - 4, align: 'right', lineBreak: false });
        doc.text(`Rs. ${bPaid.toLocaleString('en-LK')}`, colX.paid, curY, { width: colWidths.paid - 4, align: 'right', lineBreak: false });
        doc.font('Helvetica-Bold').text(`Rs. ${bDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.due, curY, { width: colWidths.due - 3, align: 'right', lineBreak: false });

        curY += 20;
        doc.moveTo(startX, curY - 4).lineTo(rightMargin, curY - 4).lineWidth(0.75).strokeColor('#bbbbbb').dash(2, { space: 2 }).stroke().undash();
      });
    }

    // Total Summary Row
    curY += 10;
    const sumX = rightMargin - 220;
    const sumValueWidth = rightMargin - sumX - 3;
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
    curY += 6;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text('Total Due Balance', sumX, curY, { lineBreak: false });
    doc.fontSize(11.5).text(`Rs. ${totalDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumX, curY, { width: sumValueWidth, align: 'right', lineBreak: false });
    curY += 18;
    doc.moveTo(sumX, curY).lineTo(rightMargin, curY).lineWidth(1.8).strokeColor('#000000').stroke();
    curY += 15;

    // ── 4. SIGNATURES & FOOTER (Pinned Exactly to A4 Bottom Margin) ──
    const pinnedSigY = 735;
    let sigY = pinnedSigY;

    // If due bills table extends near or over the footer area, wrap safely to the next page
    if (curY > 690) {
      doc.addPage();
      sigY = pinnedSigY;
    }

    const sigWidth = 100;
    const sigGap = (pageWidth - sigWidth * 4) / 3;

    ['CUSTOMER ACKNOWLEDGEMENT', 'ACCOUNTS OFFICER', 'CREDIT CONTROLLER', 'AUTHORIZED SIGNATURE'].forEach((title, i) => {
      const sX = startX + i * (sigWidth + sigGap);
      doc.moveTo(sX, sigY).lineTo(sX + sigWidth, sigY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#000000').text(title, sX, sigY + 4, { width: sigWidth, align: 'center', characterSpacing: 0.4, lineBreak: false });
    });

    const footerLineY = 774;
    doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE CLOTHING - CREDIT MANAGEMENT DIVISION', startX, footerLineY + 8, { width: pageWidth, align: 'center', characterSpacing: 1, lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor('#333333').text('Please verify all listed invoice dues. For settlement receipts, contact our finance hotline: 041-2268739.', startX, footerLineY + 20, { width: pageWidth, align: 'center', lineBreak: false });

    return doc;
  }
}