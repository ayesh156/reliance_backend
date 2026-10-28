import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

export class CustomerStatementPdfService {
  /**
   * Generates an official A4 Customer Due Statement PDF with matching Reliance typography and header/footer.
   *
   * Pending Cheque Integration:
   * Inspects customer's uncleared/unrealized cheques in hand. When present, renders a clean
   * secondary ledger table below the balance summary displaying Cheque No, Bank, Realization Date, and Amount.
   * If both outstanding balance is 0 and no pending cheques exist, retains a clean "No Outstanding Dues" statement.
   */
  static generate(
    customer: any,
    dueBills: any[],
    pendingCheques: any[] = [],
    masterReceipt: any = null
  ): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const currentDate = new Date().toISOString().split('T')[0];
    const totalDue = Number(customer.outstandingBalance || 0);

    // ---------------------------------------------------------------------------------
    // Pending Cheque Ledger Inspection Logic:
    // Identifies all pending, unrealized, or uncleared cheques in hand associated with
    // this customer. Normalizes cheque numbers, bank affiliations, and realization dates.
    // Preserves in-hand cheque visibility even when outstanding balance is 0 or cleared.
    // ---------------------------------------------------------------------------------
    const rawCheques: any[] = (pendingCheques && pendingCheques.length > 0)
      ? pendingCheques
      : (customer.pendingCheques || (dueBills as any)?.pendingCheques || []);

    const cheques: any[] = rawCheques.map((c: any) => {
      let chqNo = c.chequeNumber || c.number || '';
      let bank = c.bankName || c.bank || '';
      const ref = c.reference || '';

      if (!chqNo && ref) {
        const chqMatch = /Cheque\s*#?([^\s(]+)/i.exec(ref);
        if (chqMatch) {
          chqNo = chqMatch[1];
        } else {
          chqNo = ref.replace(/\s*\[Edit:.*?\]$/, '').slice(0, 25);
        }
      }
      if ((!bank || bank === '-') && ref) {
        const bankMatch = /\(([^)]+)\)/.exec(ref);
        if (bankMatch) {
          bank = bankMatch[1];
        }
      }

      const rawDate = c.realizeDate || c.chequeDate || c.date || c.createdAt;
      let dateStr = '-';
      if (rawDate) {
        try {
          dateStr = new Date(rawDate).toISOString().split('T')[0];
        } catch {
          dateStr = String(rawDate);
        }
      }

      const amt = Number(c.amount || 0);
      return {
        chequeNumber: String(chqNo || '-').replace(/^#/, '').trim(),
        bankName: String(bank || '-').trim(),
        realizeDate: dateStr,
        amount: isNaN(amt) ? 0 : amt,
      };
    }).filter((c: any) => c.amount > 0 || (c.chequeNumber && c.chequeNumber !== '-'));

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
    doc.fontSize(13).font('Helvetica-Bold').fillColor(totalDue > 0 ? '#b91c1c' : '#15803d').text(`Rs. ${totalDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, summaryBoxX + 6, customerTop + 28, { width: 148, align: 'center' });

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
      if (totalDue <= 0 && cheques.length === 0) {
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#15803d').text('No Outstanding Dues: All prior accounts, invoices, and ledger credits are fully settled.', startX, curY + 10, { width: pageWidth, align: 'center' });
      } else if (totalDue <= 0 && cheques.length > 0) {
        doc.fontSize(9).font('Helvetica').fillColor('#444444').text('All prior invoices are fully settled. In-hand pending cheques are detailed below.', startX, curY + 10, { width: pageWidth, align: 'center' });
      } else {
        doc.fontSize(9).font('Helvetica').fillColor('#555555').text('No pending invoices found for this customer.', startX, curY + 10, { width: pageWidth, align: 'center' });
      }
      curY += 35;
    } else {
      dueBills.forEach((bill: any, idx: number) => {
        if (curY > 710) {
          doc.addPage();
          curY = 51;
        }

        const invNo = bill.invoiceNumber || `INV${bill.orderId || bill.id}`;
        const rawDate = bill.createdAt || bill.date;
        let bDateStr = '-';
        if (rawDate) {
          try {
            const d = new Date(rawDate);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            bDateStr = `${yyyy}-${mm}-${dd} ${time}`;
          } catch {
            bDateStr = String(rawDate);
          }
        }

        const bType = bill.source === 'POS_WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
        const bTotal = Number(bill.totalAmount || 0);
        const bPaid = Number(bill.paidAmount || 0);
        const bDue = Number(bill.dueAmount || (bTotal - bPaid));

        doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), colX.num, curY, { width: colWidths.num, align: 'center', lineBreak: false });
        doc.font('Helvetica-Bold').fillColor('#000000').text(invNo, colX.inv + 2, curY, { width: colWidths.inv - 2, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).text(bDateStr, colX.date + 2, curY + 0.5, { width: colWidths.date - 2, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(8.6).text(bType, colX.type + 2, curY, { width: colWidths.type - 2, lineBreak: false });
        doc.font('Helvetica').text(`Rs. ${bTotal.toLocaleString('en-LK')}`, colX.total, curY, { width: colWidths.total - 4, align: 'right', lineBreak: false });
        doc.text(`Rs. ${bPaid.toLocaleString('en-LK')}`, colX.paid, curY, { width: colWidths.paid - 4, align: 'right', lineBreak: false });
        doc.font('Helvetica-Bold').text(`Rs. ${bDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, colX.due, curY, { width: colWidths.due - 3, align: 'right', lineBreak: false });

        curY += 16;

        // Render line-by-line list of payments/allocations made against this specific bill
        const paymentsList = Array.isArray(bill.payments) && bill.payments.length > 0
          ? bill.payments
          : (Array.isArray(bill.paymentHistory) ? bill.paymentHistory : []);

        if (paymentsList.length > 0) {
          paymentsList.forEach((p: any) => {
            if (curY > 730) {
              doc.addPage();
              curY = 51;
            }
            const pRawDate = p.createdAt || p.paidAt || p.date;
            let pDateStr = '-';
            if (pRawDate) {
              try {
                const pd = new Date(pRawDate);
                const py = pd.getFullYear();
                const pm = String(pd.getMonth() + 1).padStart(2, '0');
                const pday = String(pd.getDate()).padStart(2, '0');
                const pTime = pd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                pDateStr = `${py}-${pm}-${pday} ${pTime}`;
              } catch {}
            }
            const pMethod = String(p.method || 'CASH').toUpperCase();
            const pRef = p.reference ? ` (${p.reference})` : '';
            const pAmt = Number(p.amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 });

            doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#374151');
            doc.text(`↳ Payment: ${pDateStr} | ${pMethod}${pRef} | Paid Amount: Rs. ${pAmt}`, colX.inv + 12, curY, {
              width: pageWidth - (colX.inv - startX) - 12,
              lineBreak: false,
            });
            curY += 12;
          });
        }

        curY += 4;
        doc.moveTo(startX, curY - 2).lineTo(rightMargin, curY - 2).lineWidth(0.75).strokeColor('#bbbbbb').dash(2, { space: 2 }).stroke().undash();
      });
    }

    // ── Dedicated Recent Settlement / Total Balance Deduction Summary Section ──
    if (curY > 640) {
      doc.addPage();
      curY = 51;
    }

    curY += 12;
    const totalHistoricalDue = dueBills.reduce((sum: number, b: any) => sum + Number(b.totalAmount || 0), 0);
    const totalPaidAcrossBills = dueBills.reduce((sum: number, b: any) => sum + Number(b.paidAmount || 0), 0);
    const finalNetDue = totalDue > 0 ? totalDue : Math.max(0, totalHistoricalDue - totalPaidAcrossBills);

    // Resolve master receipt if provided or available on customer
    const activeReceipt = masterReceipt || customer.latestReceipt || (dueBills as any)?.latestReceipt || null;
    const hasMasterReceipt = Boolean(activeReceipt && Number(activeReceipt.totalAmount) > 0);

    const sumBoxHeight = hasMasterReceipt ? 104 : 70;
    const sumBoxWidth = 310;
    const sumBoxX = rightMargin - sumBoxWidth;
    const lblW = 180;
    const valW = sumBoxWidth - lblW;

    doc.rect(sumBoxX, curY, sumBoxWidth, sumBoxHeight).lineWidth(1).strokeColor('#000000').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#111111').text('RECENT SETTLEMENT / TOTAL BALANCE SUMMARY', sumBoxX + 10, curY + 8, { width: sumBoxWidth - 20, align: 'center', characterSpacing: 0.5 });
    doc.moveTo(sumBoxX + 10, curY + 20).lineTo(rightMargin - 10, curY + 20).lineWidth(0.8).strokeColor('#444444').stroke();

    let lineY = curY + 25;
    if (hasMasterReceipt) {
      const receiptDateStr = activeReceipt.receiptDate ? new Date(activeReceipt.receiptDate).toISOString().split('T')[0] : currentDate;
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#0284c7').text(`Master Receipt / Full Payment (${activeReceipt.receiptNumber || 'REC'} - ${receiptDateStr}):`, sumBoxX + 10, lineY);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0284c7').text(`Rs. ${Number(activeReceipt.totalAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumBoxX + lblW, lineY, { width: valW - 10, align: 'right' });
      lineY += 12;

      if (Array.isArray(activeReceipt.payments) && activeReceipt.payments.length > 0) {
        const clearedInvoicesSummary = activeReceipt.payments
          .slice(0, 3)
          .map((p: any) => `#${p.invoiceNumber || p.order?.invoiceNumber || p.orderId}: Rs. ${Number(p.amount).toLocaleString('en-LK')}`)
          .join(', ');
        doc.fontSize(6.5).font('Helvetica').fillColor('#555555').text(`Cleared: ${clearedInvoicesSummary}${activeReceipt.payments.length > 3 ? '...' : ''}`, sumBoxX + 10, lineY, { width: sumBoxWidth - 20, lineBreak: false });
        lineY += 11;
      }
      doc.moveTo(sumBoxX + 10, lineY).lineTo(rightMargin - 10, lineY).lineWidth(0.5).strokeColor('#cccccc').stroke();
      lineY += 4;
    }

    doc.fontSize(8).font('Helvetica').fillColor('#333333').text('Total Historical / Previous Due:', sumBoxX + 10, lineY);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text(`Rs. ${totalHistoricalDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumBoxX + lblW, lineY, { width: valW - 10, align: 'right' });
    lineY += 13;

    doc.fontSize(8).font('Helvetica').fillColor('#15803d').text('Total Paid / Settled Across Bills:', sumBoxX + 10, lineY);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#15803d').text(`- Rs. ${totalPaidAcrossBills.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumBoxX + lblW, lineY, { width: valW - 10, align: 'right' });
    lineY += 13;

    doc.moveTo(sumBoxX + 10, lineY).lineTo(rightMargin - 10, lineY).lineWidth(1).strokeColor('#000000').stroke();
    lineY += 4;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('Final Net Outstanding Balance Due:', sumBoxX + 10, lineY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(finalNetDue > 0 ? '#b91c1c' : '#15803d').text(`Rs. ${finalNetDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, sumBoxX + lblW, lineY - 1, { width: valW - 10, align: 'right' });

    curY += sumBoxHeight + 15;

    // ── 4. PENDING / UNREALIZED CHEQUES IN HAND TABLE (When Present) ──
    if (cheques.length > 0) {
      // Check if starting the secondary cheques table requires wrapping to a new page
      if (curY > 580) {
        doc.addPage();
        curY = 51;
      }

      curY += 10;
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#000000').text('Pending / Uncleared Cheques in Hand', startX, curY, { characterSpacing: 0.5 });
      curY += 16;

      const chqColWidths = { num: 25.5, chq: 120, bank: 155, date: 105, amount: 104.78 };
      const chqColX = {
        num: startX,
        chq: startX + chqColWidths.num,
        bank: startX + chqColWidths.num + chqColWidths.chq,
        date: startX + chqColWidths.num + chqColWidths.chq + chqColWidths.bank,
        amount: startX + chqColWidths.num + chqColWidths.chq + chqColWidths.bank + chqColWidths.date,
      };

      doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      const chqThY = curY + 6;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
      doc.text('#', chqColX.num, chqThY, { width: chqColWidths.num, align: 'center', lineBreak: false });
      doc.text('CHEQUE NO', chqColX.chq + 2, chqThY, { width: chqColWidths.chq - 2, align: 'left', lineBreak: false });
      doc.text('BANK', chqColX.bank + 2, chqThY, { width: chqColWidths.bank - 2, align: 'left', lineBreak: false });
      doc.text('REALIZATION DATE', chqColX.date + 2, chqThY, { width: chqColWidths.date - 2, align: 'left', lineBreak: false });
      doc.text('AMOUNT', chqColX.amount, chqThY, { width: chqColWidths.amount - 3, align: 'right', lineBreak: false });

      curY += 18;
      doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 6;

      cheques.forEach((chq: any, idx: number) => {
        if (curY > 680) {
          doc.addPage();
          curY = 51;
        }

        const chqNum = chq.chequeNumber || '-';
        const bank = chq.bankName || '-';
        const rDate = chq.realizeDate || '-';
        const amt = Number(chq.amount || 0);

        doc.fontSize(8.6).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), chqColX.num, curY, { width: chqColWidths.num, align: 'center', lineBreak: false });
        doc.font('Helvetica-Bold').fillColor('#000000').text(chqNum, chqColX.chq + 2, curY, { width: chqColWidths.chq - 2, lineBreak: false });
        doc.font('Helvetica').text(bank, chqColX.bank + 2, curY, { width: chqColWidths.bank - 2, lineBreak: false });
        doc.text(rDate, chqColX.date + 2, curY, { width: chqColWidths.date - 2, lineBreak: false });
        doc.font('Helvetica-Bold').text(`Rs. ${amt.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, chqColX.amount, curY, { width: chqColWidths.amount - 3, align: 'right', lineBreak: false });

        curY += 20;
        doc.moveTo(startX, curY - 4).lineTo(rightMargin, curY - 4).lineWidth(0.75).strokeColor('#bbbbbb').dash(2, { space: 2 }).stroke().undash();
      });

      // Total In-Hand Cheques Summary Row
      curY += 6;
      const totalChequesAmt = cheques.reduce((acc: number, c: any) => acc + Number(c.amount || 0), 0);
      const chqSumX = rightMargin - 220;
      const chqLabelWidth = 120;
      const chqValX = chqSumX + chqLabelWidth;
      const chqValWidth = 100;
      doc.moveTo(chqSumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 5;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Total In-Hand Cheques', chqSumX, curY, { width: chqLabelWidth, align: 'left' });
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#0369a1').text(`Rs. ${totalChequesAmt.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, chqValX, curY, { width: chqValWidth, align: 'right' });
      curY += 15;
      doc.moveTo(chqSumX, curY).lineTo(rightMargin, curY).lineWidth(1.5).strokeColor('#000000').stroke();
      curY += 15;
    }

    // ── 5. SIGNATURES & FOOTER (Pinned Exactly to A4 Bottom Margin) ──
    const pinnedSigY = 735;
    let sigY = pinnedSigY;

    // If content extends near or over the footer area, wrap safely to the next page
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