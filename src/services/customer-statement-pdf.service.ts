import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

/**
 * Aggressively extracts a clean numeric cheque number from any raw cheque field,
 * reference text, or payment note string by stripping non-numeric prefixes and prioritizing
 * 4-8 digit sequences (e.g. "000080").
 */
export const extractCleanChequeNumber = (...sources: any[]): string => {
  for (const src of sources) {
    if (!src || src === '-' || src === 'undefined' || src === 'null') continue;
    const str = String(src).trim();
    if (!str || str === '-') continue;

    // Remove ISO dates (e.g. 2027-01-05) so calendar years are never mistakenly captured as cheque numbers
    const withoutDates = str.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');

    // 1. Explicit prefix pattern: "Chq #000080", "Cheque: 000080", "Cheque #000080"
    const explicitPrefixMatch = /(?:Cheque|Chq)\s*#?:?\s*([A-Za-z0-9-]+)/i.exec(withoutDates);
    if (explicitPrefixMatch && explicitPrefixMatch[1]) {
      const candidate = explicitPrefixMatch[1].trim();
      if (!/^(?:Bank|Date|Mat|-)$/i.test(candidate)) {
        const digits = candidate.replace(/\D/g, '');
        if (digits.length >= 4) {
          return digits;
        }
      }
    }

    // 2. Standalone 4 to 8 digit sequence (standard Sri Lankan cheque number format e.g. "000080", "143006")
    const digitsMatch = /\b(\d{4,8})\b/.exec(withoutDates);
    if (digitsMatch && digitsMatch[1]) {
      return digitsMatch[1];
    }

    // 3. Fallback: Any 3+ digits found in the source string
    const anyDigitsMatch = /(\d{3,8})/.exec(withoutDates);
    if (anyDigitsMatch && anyDigitsMatch[1]) {
      return anyDigitsMatch[1];
    }

    // 4. Fallback for alphanumeric cheque codes without digits - MUST contain at least one digit
    const cleaned = withoutDates
      .replace(/^(?:Chq|Cheque)\s*#?/gi, '')
      .replace(/^#+/, '')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/^-+|-+$/g, '')
      .trim();
    if (cleaned && cleaned !== '-' && cleaned.length >= 3 && /\d/.test(cleaned)) {
      return cleaned;
    }
  }
  return '-';
};

/**
 * Normalizes bank name from candidate fields, stripping prefixes, hyphens, and noise.
 * If multiple representations exist, prioritizes cleaner, capitalized bank names.
 */
export const extractCleanBankName = (...sources: any[]): string => {
  for (const src of sources) {
    if (!src || src === '-' || src === 'undefined' || src === 'null') continue;
    let str = String(src).trim();
    if (!str || str === '-') continue;

    let candidate = '';

    // Check for explicit "Bank: ..." or "Branch: ..."
    const bankColonMatch = /(?:Bank|Branch):\s*([^|\n]+)/i.exec(str);
    if (bankColonMatch && bankColonMatch[1]) {
      candidate = bankColonMatch[1].trim();
    } else {
      // Check for parenthesized bank name e.g. "(Sampath Bank - Wariyapola)"
      const parenMatch = /\(([^)]+)\)/.exec(str);
      if (parenMatch && parenMatch[1] && !/^\d+$/.test(parenMatch[1])) {
        candidate = parenMatch[1].trim();
      } else {
        // Check for text following leading cheque digits e.g. "000080 sampath bank - wariyapola"
        const afterDigitsMatch = /^\s*\d{4,8}\s+([A-Za-z0-9\s&/.-]+)$/i.exec(str);
        if (afterDigitsMatch && afterDigitsMatch[1]) {
          candidate = afterDigitsMatch[1].trim();
        } else {
          // If this is an explicit bank property (not a long generic memo/sentence)
          const isExplicitField = !/(?:settlement|payment|invoice|bill|cash|card|due|transfer)/i.test(str);
          if (isExplicitField && (/(?:Bank|Branch|BOC|HNB|NSB|NDB|Commercial|Sampath|Seylan|DFCC|Peoples|Nations)/i.test(str) || str.length < 35)) {
            candidate = str;
          }
        }
      }
    }

    if (candidate) {
      // Strip leading/trailing punctuation and keywords
      candidate = candidate
        .replace(/^(?:Bank|Branch)[:\s-]*/i, '')
        .replace(/^[-\s|]+/, '')
        .replace(/[-\s|]+$/, '')
        .trim();

      if (candidate && candidate !== '-' && !/^\d+$/.test(candidate)) {
        // Capitalize first letter of each word if lowercase
        if (candidate === candidate.toLowerCase()) {
          candidate = candidate
            .split(/\s+/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
            .replace(/\s*-\s*/g, ' - ');
        }
        return candidate;
      }
    }
  }
  return '-';
};

/**
 * Normalizes maturity/realization date to YYYY-MM-DD.
 */
export const extractCleanMaturityDate = (...sources: any[]): string => {
  for (const src of sources) {
    if (!src || src === '-' || src === 'undefined' || src === 'null') continue;
    const str = String(src).trim();
    if (!str || str === '-') continue;

    // Look for YYYY-MM-DD
    const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(str);
    if (isoMatch && isoMatch[1]) {
      return isoMatch[1];
    }

    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch {}
  }
  return '-';
};

export class CustomerStatementPdfService {
  /**
   * Generates an official condensed A4 Customer Due Statement PDF in Single Copy
   * with tight typography, old vs. new balance reconciliation, grouped multi-bill cheques,
   * signature lines, and dynamic "PAID IN FULL" stamping.
   */
  static generate(
    customer: any,
    dueBills: any[],
    pendingCheques: any[] = [],
    masterReceipt: any = null,
    returnBills: any[] = []
  ): InstanceType<typeof PDFDocument> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const currentDate = new Date().toISOString().split('T')[0];
    const totalDue = Number(customer.outstandingBalance || 0);

    // ---------------------------------------------------------------------------------
    // 1. Pending Cheque Ledger Inspection & Consolidation Logic:
    // Identifies all pending, unrealized, or uncleared cheques in hand associated with
    // this customer. Normalizes cheque numbers, bank affiliations, and realization dates.
    // AGGREGATION: If multiple payments share the same raw numeric cheque number, groups
    // them into a single row summing their amounts and noting multiple invoice numbers.
    // ---------------------------------------------------------------------------------
    const rawCheques: any[] = (pendingCheques && pendingCheques.length > 0)
      ? pendingCheques
      : (customer.pendingCheques || (dueBills as any)?.pendingCheques || []);

    const normalizedCheques = rawCheques.map((c: any) => {
      const cleanChq = extractCleanChequeNumber(
        c.chequeNumber,
        c.number,
        c.chqNo,
        c.reference,
        c.notes
      );
      const cleanBank = extractCleanBankName(
        c.bankName,
        c.bank,
        c.branch,
        c.reference,
        c.notes
      );
      const dateStr = extractCleanMaturityDate(
        c.realizeDate,
        c.chequeDate,
        c.date,
        c.createdAt,
        c.reference,
        c.notes
      );
      const invNo = c.invoiceNumber || c.invNo || '';
      const amt = Number(c.amount || 0);

      return {
        chequeNumber: cleanChq || '-',
        bankName: cleanBank || '-',
        realizeDate: dateStr,
        amount: isNaN(amt) ? 0 : amt,
        invoiceNumber: String(invNo || '').replace(/^#+/, '').trim(),
      };
    }).filter((c: any) => c.amount > 0 || (c.chequeNumber && c.chequeNumber !== '-'));

    // Consolidate cheques sharing the same raw numeric cheque number
    const groupedChequesMap = new Map<string, {
      chequeNumber: string;
      bankName: string;
      realizeDate: string;
      amount: number;
      invoiceNumbers: string[];
      invoiceNumber: string;
    }>();

    for (const chq of normalizedCheques) {
      const normChq = String(chq.chequeNumber || '-').trim();
      const normBank = String(chq.bankName || '-').trim();

      let targetKey = (normChq && normChq !== '-')
        ? `CHQ_${normChq.toUpperCase()}`
        : `RAW_${Math.random()}`;

      if (normChq && normChq !== '-') {
        for (const [existingKey, existingVal] of groupedChequesMap.entries()) {
          if (existingVal.chequeNumber.toUpperCase() === normChq.toUpperCase()) {
            targetKey = existingKey;
            break;
          }
        }
      }

      const existing = groupedChequesMap.get(targetKey);
      if (existing) {
        existing.amount = Math.round((existing.amount + chq.amount) * 100) / 100;
        if (chq.invoiceNumber && !existing.invoiceNumbers.includes(chq.invoiceNumber)) {
          existing.invoiceNumbers.push(chq.invoiceNumber);
        }
        existing.invoiceNumber = existing.invoiceNumbers.join(', ');
        if ((!existing.bankName || existing.bankName === '-') && normBank !== '-') {
          existing.bankName = normBank;
        } else if (normBank !== '-' && normBank.length > existing.bankName.length) {
          existing.bankName = normBank;
        }
        if ((!existing.realizeDate || existing.realizeDate === '-') && chq.realizeDate !== '-') {
          existing.realizeDate = chq.realizeDate;
        }
      } else {
        const invs = chq.invoiceNumber ? [chq.invoiceNumber] : [];
        groupedChequesMap.set(targetKey, {
          ...chq,
          chequeNumber: normChq,
          bankName: normBank,
          invoiceNumbers: invs,
          invoiceNumber: invs.join(', '),
        });
      }
    }
    const cheques = Array.from(groupedChequesMap.values());

    // ---------------------------------------------------------------------------------
    // 2. Old vs. New Balance Reconciliation:
    // Computes Active Bill totals vs. Previous Old Balance carried forward.
    // ---------------------------------------------------------------------------------
    const currentBillsTotal = dueBills.reduce((sum: number, b: any) => sum + Number(b.totalAmount || 0), 0);
    const currentBillsPaid = dueBills.reduce((sum: number, b: any) => sum + Number(b.paidAmount || 0), 0);
    const currentBillsDue = dueBills.reduce((sum: number, b: any) => {
      const bTotal = Number(b.totalAmount || 0);
      const bPaid = Number(b.paidAmount || 0);
      return sum + Number(b.dueAmount !== undefined ? b.dueAmount : Math.max(0, bTotal - bPaid));
    }, 0);

    const totalCustomerDue = Number(customer.outstandingBalance || 0);
    const totalNetOutstanding = totalDue > 0 ? totalDue : Math.max(0, currentBillsDue);
    const previousOldBalance = Math.max(0, Math.round((totalNetOutstanding - currentBillsDue) * 100) / 100);

    // Margins: Top/Bottom 45pt, Left/Right 42.5pt (15mm)
    const startX = 42.5;
    const rightMargin = 552.78;
    const pageWidth = rightMargin - startX; // 510.28pt

    const potentialPaths = [
      path.resolve(process.cwd(), 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public', 'logo.jpg'),
      path.resolve(process.cwd(), 'dist', 'public', 'images', 'logo.jpg'),
      path.resolve(process.cwd(), 'public_html', 'images', 'logo.jpg'),
    ];
    const logoPath = potentialPaths.find((p) => fs.existsSync(p));

    // ---------------------------------------------------------------------------------
    // 3. Single Copy Statement Layout:
    // Renders a clean, unified standard A4 Customer Statement of Account.
    // ---------------------------------------------------------------------------------

    // ── Header Section ──
    const headerTop = 45;
    let brandTextX = startX;
    if (logoPath && fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
      try {
        doc.image(logoPath, startX, headerTop - 2, { width: 50, height: 50 });
        brandTextX = startX + 60;
      } catch {
        brandTextX = startX;
      }
    }

    // Brand Typography (Condensed Commercial Header)
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE', brandTextX, headerTop - 2, { characterSpacing: 1.2 });
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#111111').text('BRANDED MENS CLOTHING', brandTextX, headerTop + 18, { characterSpacing: 1.5 });
    doc.fontSize(7).font('Helvetica').fillColor('#222222');
    doc.text('Mawarala Road, Makandura, Matara.', brandTextX, headerTop + 28);
    doc.font('Helvetica-Bold').text('Tel: ', brandTextX, headerTop + 37, { continued: true }).font('Helvetica').text('041-2268739, 071-1350123');
    doc.font('Helvetica-Bold').text('Web: ', brandTextX, headerTop + 46, { continued: true }).font('Helvetica').text('relianceapparel.lk');

    // Right-aligned Document Title & Metadata
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('STATEMENT OF ACCOUNT', 280, headerTop - 2, { width: 272.78, align: 'right', characterSpacing: 0.8 });

    const metaY = headerTop + 22;
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#444444').text('STATEMENT DATE:', 370, metaY, { width: 95, align: 'right' });
    doc.fontSize(7.5).font('Helvetica').fillColor('#000000').text(currentDate, 470, metaY - 0.5, { width: 82.78, align: 'right' });

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#444444').text('ACCOUNT TYPE:', 370, metaY + 12, { width: 95, align: 'right' });
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text(customer.type || 'RETAIL', 470, metaY + 11.5, { width: 82.78, align: 'right' });

      // Top Divider Line
      const dividerY = headerTop + 62;
      doc.moveTo(startX, dividerY).lineTo(rightMargin, dividerY).lineWidth(1).strokeColor('#000000').stroke();

      // ── Customer Details Section ──
      const customerTop = dividerY + 8;
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text('STATEMENT ISSUED TO', startX, customerTop, { characterSpacing: 0.6 });
      doc.moveTo(startX, customerTop + 9).lineTo(startX + 80, customerTop + 9).lineWidth(1).strokeColor('#000000').stroke();

      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000000').text(customer.name || 'Valued Customer', startX, customerTop + 13);
      doc.fontSize(7.5).font('Helvetica').fillColor('#222222');
      doc.text(customer.address || customer.city || 'No registered address', startX, customerTop + 24);
      doc.font('Helvetica-Bold').text('Contact: ', startX, customerTop + 34, { continued: true }).font('Helvetica').text(customer.phone || '-');

      // Total Due Summary Box on the right
      const summaryBoxWidth = 150;
      const summaryBoxX = rightMargin - summaryBoxWidth;
      doc.rect(summaryBoxX, customerTop + 6, summaryBoxWidth, 36).lineWidth(1).strokeColor('#000000').stroke();
      doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#555555').text('TOTAL OUTSTANDING BALANCE', summaryBoxX + 4, customerTop + 11, { width: summaryBoxWidth - 8, align: 'center' });
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(totalNetOutstanding > 0 ? '#b91c1c' : '#15803d').text(`Rs. ${totalNetOutstanding.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, summaryBoxX + 4, customerTop + 22, { width: summaryBoxWidth - 8, align: 'center' });

      // ── Invoices Table (Condensed Commercial Layout) ──
      const tableTop = customerTop + 50;
      const colWidths = { num: 20, inv: 80, date: 80, type: 60, total: 85, paid: 85, due: 100.28 };
      const colX = {
        num: startX,
        inv: startX + colWidths.num,
        date: startX + colWidths.num + colWidths.inv,
        type: startX + colWidths.num + colWidths.inv + colWidths.date,
        total: startX + colWidths.num + colWidths.inv + colWidths.date + colWidths.type,
        paid: startX + colWidths.num + colWidths.inv + colWidths.date + colWidths.type + colWidths.total,
        due: startX + colWidths.num + colWidths.inv + colWidths.date + colWidths.type + colWidths.total + colWidths.paid,
      };

      doc.moveTo(startX, tableTop).lineTo(rightMargin, tableTop).lineWidth(1).strokeColor('#000000').stroke();

      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000');
      const thY = tableTop + 5;
      doc.text('#', colX.num, thY, { width: colWidths.num, align: 'center', lineBreak: false });
      doc.text('INVOICE NO', colX.inv + 2, thY, { width: colWidths.inv - 2, align: 'left', lineBreak: false });
      doc.text('DATE', colX.date + 2, thY, { width: colWidths.date - 2, align: 'left', lineBreak: false });
      doc.text('BILL TYPE', colX.type + 2, thY, { width: colWidths.type - 2, align: 'left', lineBreak: false });
      doc.text('BILL TOTAL', colX.total, thY, { width: colWidths.total - 4, align: 'right', lineBreak: false });
      doc.text('PAID', colX.paid, thY, { width: colWidths.paid - 4, align: 'right', lineBreak: false });
      doc.text('DUE AMOUNT', colX.due, thY, { width: colWidths.due - 3, align: 'right', lineBreak: false });

      doc.moveTo(startX, tableTop + 16).lineTo(rightMargin, tableTop + 16).lineWidth(1).strokeColor('#000000').stroke();

      let curY = tableTop + 21;

      if (dueBills.length === 0) {
        doc.fontSize(8).font('Helvetica').fillColor('#555555').text('No recorded invoices found for this customer.', startX, curY + 6, { width: pageWidth, align: 'center' });
        curY += 25;
      } else {
        dueBills.forEach((bill: any, idx: number) => {
          if (curY > 700) {
            doc.addPage();
            curY = 45;
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
              bDateStr = `${yyyy}-${mm}-${dd}`;
            } catch {
              bDateStr = String(rawDate);
            }
          }

          const bType = bill.source === 'POS_WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
          const bTotal = Number(bill.totalAmount || 0);
          const bPaid = Number(bill.paidAmount || 0);
          const bDue = Number(bill.dueAmount !== undefined ? bill.dueAmount : Math.max(0, bTotal - bPaid));
          const dueStr = bDue <= 0 ? '0.00 (PAID)' : `Rs. ${bDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;

          doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), colX.num, curY, { width: colWidths.num, align: 'center', lineBreak: false });
          doc.font('Helvetica-Bold').fillColor('#000000').text(invNo, colX.inv + 2, curY, { width: colWidths.inv - 2, lineBreak: false });
          doc.font('Helvetica').fontSize(7.5).text(bDateStr, colX.date + 2, curY, { width: colWidths.date - 2, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(7.5).text(bType, colX.type + 2, curY, { width: colWidths.type - 2, lineBreak: false });
          doc.font('Helvetica').text(`Rs. ${bTotal.toLocaleString('en-LK')}`, colX.total, curY, { width: colWidths.total - 4, align: 'right', lineBreak: false });
          doc.text(`Rs. ${bPaid.toLocaleString('en-LK')}`, colX.paid, curY, { width: colWidths.paid - 4, align: 'right', lineBreak: false });
          doc.font('Helvetica-Bold').text(dueStr, colX.due, curY, { width: colWidths.due - 3, align: 'right', lineBreak: false });

          curY += 13;

          // Render payments list for this specific bill with clean multi-bill breakdown & typography
          const paymentsList = Array.isArray(bill.payments) && bill.payments.length > 0
            ? bill.payments
            : (Array.isArray(bill.paymentHistory) ? bill.paymentHistory : []);

          if (paymentsList.length > 0) {
            paymentsList.forEach((p: any) => {
              if (curY > 715) {
                doc.addPage();
                curY = 45;
              }
              const pRawDate = p.createdAt || p.paidAt || p.date || p.paymentDate;
              let pDateStr = '-';
              if (pRawDate) {
                try {
                  const pd = new Date(pRawDate);
                  const py = pd.getFullYear();
                  const pm = String(pd.getMonth() + 1).padStart(2, '0');
                  const pday = String(pd.getDate()).padStart(2, '0');
                  pDateStr = `${py}-${pm}-${pday}`;
                } catch {}
              }
              const pMethod = String(p.method || p.paymentMethod || 'CASH').toUpperCase();
              const pAmt = Number(p.amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 });

              // Extract structured cheque metadata if method is CHEQUE or reference contains cheque indicators
              let chqNum = p.chequeNumber || '';
              let bnkName = p.bankName || p.branch || '';
              let matDate = p.chequeDate ? String(p.chequeDate).split('T')[0] : '';
              const rawRef = p.reference ? String(p.reference).trim() : '';

              if (rawRef) {
                if (!chqNum) {
                  const chqMatch = /(?:Cheque|Chq)\s*#?\s*([A-Za-z0-9-]+)/i.exec(rawRef);
                  if (chqMatch) chqNum = chqMatch[1];
                  else {
                    const leadDigits = /^(\d{4,})\b/.exec(rawRef);
                    if (leadDigits) chqNum = leadDigits[1];
                  }
                }
                if (!bnkName) {
                  const bMatch = /Bank:\s*([^|\n]+)/i.exec(rawRef) || /\(([^)]+)\)/.exec(rawRef);
                  if (bMatch) bnkName = bMatch[1].trim();
                }
                if (!matDate) {
                  const mMatch = /(?:Mat|Maturity|Due)[:\s]*(\d{4}-\d{2}-\d{2})/i.exec(rawRef);
                  if (mMatch) matDate = mMatch[1].trim();
                }
              }

              // Correlate fullChequeAmount from normalizedCheques if shared across multiple bills
              let fullChequeAmount = p.fullChequeAmount;
              if (!fullChequeAmount && chqNum) {
                const cleanNum = String(chqNum).replace(/^(?:Chq|Cheque)\s*#?/i, '').replace(/^#+/, '').trim().toUpperCase();
                const matchedChq = normalizedCheques.find((nc: any) =>
                  String(nc.chequeNumber || '').replace(/^(?:Chq|Cheque)\s*#?/i, '').replace(/^#+/, '').trim().toUpperCase() === cleanNum
                );
                if (matchedChq && Number(matchedChq.amount) > Number(p.amount || 0)) {
                  fullChequeAmount = Number(matchedChq.amount);
                }
              }

              let paymentText = '';
              const subLineWidth = rightMargin - (colX.inv + 10);

              if (pMethod === 'RETURN_CREDIT') {
                const refText = rawRef ? ` (${rawRef})` : '';
                paymentText = `• Return Credit: ${pDateStr}${refText} | Applied to Bill: Rs. ${pAmt}`;
                doc.fontSize(6.8).font('Helvetica-BoldOblique').fillColor('#6b21a8');
              } else if (pMethod === 'CHEQUE') {
                const cleanChqNum = chqNum.replace(/^(?:Chq|Cheque)\s*#?/i, '').replace(/^#+/, '').trim();
                const chqNumStr = cleanChqNum ? `Chq #${cleanChqNum}` : 'Cheque';
                const bankStr = bnkName ? ` (${bnkName})` : '';
                const matStr = matDate ? ` | Mat: ${matDate}` : '';
                const multiBillNote = (fullChequeAmount && fullChequeAmount > Number(p.amount || 0))
                  ? ` [Shared Cheque Total: Rs. ${Number(fullChequeAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}]`
                  : '';
                paymentText = `• Payment: ${pDateStr} | CHEQUE: ${chqNumStr}${bankStr}${matStr} | Applied to Bill: Rs. ${pAmt}${multiBillNote}`;
                doc.fontSize(6.8).font('Helvetica-Oblique').fillColor('#374151');
              } else {
                const refText = rawRef && !rawRef.match(/^Cheque/i) ? ` (${rawRef})` : '';
                paymentText = `• Payment: ${pDateStr} | ${pMethod}${refText} | Applied to Bill: Rs. ${pAmt}`;
                doc.fontSize(6.8).font('Helvetica-Oblique').fillColor('#374151');
              }

              const subTextHeight = doc.heightOfString(paymentText, { width: subLineWidth });
              doc.text(paymentText, colX.inv + 10, curY, {
                width: subLineWidth,
                lineBreak: true,
              });
              curY += Math.max(10, Math.ceil(subTextHeight) + 2);
            });
          }

          curY += 3;
          doc.moveTo(startX, curY - 2).lineTo(rightMargin, curY - 2).lineWidth(0.5).strokeColor('#cccccc').dash(2, { space: 2 }).stroke().undash();
        });
      }

      // ── Recent Return Bills & Credit Notes (When Present) ──
      const rawReturnBills: any[] = (returnBills && returnBills.length > 0)
        ? returnBills
        : (customer.returnBills || (dueBills as any)?.returnBills || []);

      if (rawReturnBills.length > 0) {
        if (curY > 580) {
          doc.addPage();
          curY = 45;
        }

        curY += 8;
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('RECENT RETURN BILLS & CREDIT NOTES', startX, curY, { characterSpacing: 0.5 });
        curY += 13;

        const retColWidths = { num: 20, inv: 110, date: 100, ref: 160, value: 120.28 };
        const retColX = {
          num: startX,
          inv: startX + retColWidths.num,
          date: startX + retColWidths.num + retColWidths.inv,
          ref: startX + retColWidths.num + retColWidths.inv + retColWidths.date,
          value: startX + retColWidths.num + retColWidths.inv + retColWidths.date + retColWidths.ref,
        };

        doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1).strokeColor('#000000').stroke();
        const retThY = curY + 4;
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000');
        doc.text('#', retColX.num, retThY, { width: retColWidths.num, align: 'center', lineBreak: false });
        doc.text('INVOICE NO', retColX.inv + 2, retThY, { width: retColWidths.inv - 2, align: 'left', lineBreak: false });
        doc.text('DATE', retColX.date + 2, retThY, { width: retColWidths.date - 2, align: 'left', lineBreak: false });
        doc.text('OFFSET ALLOCATION', retColX.ref + 2, retThY, { width: retColWidths.ref - 2, align: 'left', lineBreak: false });
        doc.text('RETURN VALUE', retColX.value, retThY, { width: retColWidths.value - 3, align: 'right', lineBreak: false });

        curY += 15;
        doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1).strokeColor('#000000').stroke();
        curY += 4;

        rawReturnBills.forEach((rb: any, idx: number) => {
          if (curY > 690) {
            doc.addPage();
            curY = 45;
          }

          const invNum = rb.invoiceNumber || `INV${rb.id || idx + 1}`;
          const rawDate = rb.createdAt || rb.date;
          let rDateStr = '-';
          if (rawDate) {
            try {
              const d = new Date(rawDate);
              rDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } catch {
              rDateStr = String(rawDate);
            }
          }
          const retVal = Math.abs(Number(rb.totalAmount || 0));
          const statusNote = rb.returnCreditApplied > 0
            ? `Credit Applied: Rs. ${Number(rb.returnCreditApplied).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`
            : (rb.status || 'RETURN NOTE');

          doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), retColX.num, curY, { width: retColWidths.num, align: 'center', lineBreak: false });
          doc.font('Helvetica-Bold').fillColor('#000000').text(invNum, retColX.inv + 2, curY, { width: retColWidths.inv - 2, lineBreak: false });
          doc.font('Helvetica').fontSize(7.5).text(rDateStr, retColX.date + 2, curY, { width: retColWidths.date - 2, lineBreak: false });
          doc.font('Helvetica').fontSize(7.5).fillColor('#4b5563').text(statusNote, retColX.ref + 2, curY, { width: retColWidths.ref - 2, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#b91c1c').text(`- Rs. ${retVal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, retColX.value, curY, { width: retColWidths.value - 3, align: 'right', lineBreak: false });

          curY += 14;
          doc.moveTo(startX, curY - 2).lineTo(rightMargin, curY - 2).lineWidth(0.5).strokeColor('#cccccc').dash(2, { space: 2 }).stroke().undash();
        });
        curY += 6;
      }

      // ── Distinct Old vs. New Balance Reconciliation Section ──
      if (curY > 580) {
        doc.addPage();
        curY = 45;
      }

      curY += 8;
      const balBoxWidth = 320;
      const balBoxX = rightMargin - balBoxWidth;
      const balBoxHeight = 84;
      const lblColW = 190;
      const valColW = balBoxWidth - lblColW;

      doc.rect(balBoxX, curY, balBoxWidth, balBoxHeight).lineWidth(1).strokeColor('#000000').stroke();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('BALANCE RECONCILIATION SUMMARY', balBoxX + 10, curY + 7, { width: balBoxWidth - 20, align: 'center', characterSpacing: 0.5 });
      doc.moveTo(balBoxX + 10, curY + 18).lineTo(rightMargin - 10, curY + 18).lineWidth(0.8).strokeColor('#000000').stroke();

      let bLineY = curY + 23;
      doc.fontSize(7.5).font('Helvetica').fillColor('#333333').text('Current Bill Total (Active Dues):', balBoxX + 10, bLineY);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text(`Rs. ${currentBillsDue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, balBoxX + lblColW, bLineY, { width: valColW - 10, align: 'right' });
      bLineY += 13;

      doc.fontSize(7.5).font('Helvetica').fillColor('#444444').text('Previous Old Balance (Carried Forward):', balBoxX + 10, bLineY);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text(`Rs. ${previousOldBalance.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, balBoxX + lblColW, bLineY, { width: valColW - 10, align: 'right' });
      bLineY += 13;

      doc.moveTo(balBoxX + 10, bLineY).lineTo(rightMargin - 10, bLineY).lineWidth(0.8).strokeColor('#000000').stroke();
      bLineY += 4;

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('Total Net Outstanding:', balBoxX + 10, bLineY);
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(totalNetOutstanding > 0 ? '#b91c1c' : '#15803d').text(`Rs. ${totalNetOutstanding.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, balBoxX + lblColW, bLineY - 1, { width: valColW - 10, align: 'right' });

      // ── "PAID IN FULL" Stamp (Bold Black Overlay When Fully Settled) ──
      if (totalNetOutstanding <= 0) {
        doc.save();
        const stampX = startX + 30;
        const stampY = curY + 18;
        const stampW = 140;
        const stampH = 34;
        doc.rotate(-14, { origin: [stampX + stampW / 2, stampY + stampH / 2] });
        doc.rect(stampX, stampY, stampW, stampH).lineWidth(2).strokeColor('#000000').stroke();
        doc.rect(stampX + 2, stampY + 2, stampW - 4, stampH - 4).lineWidth(0.6).strokeColor('#000000').stroke();
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('PAID IN FULL', stampX, stampY + 9, {
          width: stampW,
          align: 'center',
          characterSpacing: 1.5,
        });
        doc.restore();
      }

      curY += balBoxHeight + 12;

      // ── 4. Grouped Pending Cheques in Hand Table (When Present) ──
      if (cheques.length > 0) {
        if (curY > 590) {
          doc.addPage();
          curY = 45;
        }

        curY += 6;
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('PENDING / UNCLEARED CHEQUES IN HAND', startX, curY, { characterSpacing: 0.5 });
        curY += 13;

        const chqColWidths = { num: 20, chq: 160, bank: 130, date: 95, amount: 105.28 };
        const chqColX = {
          num: startX,
          chq: startX + chqColWidths.num,
          bank: startX + chqColWidths.num + chqColWidths.chq,
          date: startX + chqColWidths.num + chqColWidths.chq + chqColWidths.bank,
          amount: startX + chqColWidths.num + chqColWidths.chq + chqColWidths.bank + chqColWidths.date,
        };

        doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1).strokeColor('#000000').stroke();
        const chqThY = curY + 4;
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000');
        doc.text('#', chqColX.num, chqThY, { width: chqColWidths.num, align: 'center', lineBreak: false });
        doc.text('CHEQUE NO & INVOICES', chqColX.chq + 2, chqThY, { width: chqColWidths.chq - 2, align: 'left', lineBreak: false });
        doc.text('BANK', chqColX.bank + 2, chqThY, { width: chqColWidths.bank - 2, align: 'left', lineBreak: false });
        doc.text('REALIZATION DATE', chqColX.date + 2, chqThY, { width: chqColWidths.date - 2, align: 'left', lineBreak: false });
        doc.text('AMOUNT', chqColX.amount, chqThY, { width: chqColWidths.amount - 3, align: 'right', lineBreak: false });

        curY += 15;
        doc.moveTo(startX, curY).lineTo(rightMargin, curY).lineWidth(1).strokeColor('#000000').stroke();
        curY += 4;

        cheques.forEach((chq: any, idx: number) => {
          if (curY > 690) {
            doc.addPage();
            curY = 45;
          }

          const chqNum = chq.chequeNumber || '-';
          const invsJoined = chq.invoiceNumbers && chq.invoiceNumbers.length > 0
            ? chq.invoiceNumbers.join(', ')
            : (chq.invoiceNumber || '');
          const invsNote = invsJoined ? ` (${invsJoined})` : '';
          const bankPart = chq.bankName && chq.bankName !== '-' ? ` | Bank: ${chq.bankName}` : '';
          const chqDisplay = `Cheque #${chqNum}${bankPart}${invsNote}`;
          const bank = chq.bankName || '-';
          const rDate = chq.realizeDate || '-';
          const amt = Number(chq.amount || 0);

          // Dynamically compute row height to avoid text overlapping or line clipping on multi-line cheque details
          const textHeight = Math.max(
            doc.heightOfString(chqDisplay, { width: chqColWidths.chq - 4 }),
            doc.heightOfString(bank, { width: chqColWidths.bank - 4 }),
            10
          );
          const rowHeight = textHeight + 6;

          doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#444444').text(String(idx + 1), chqColX.num, curY, { width: chqColWidths.num, align: 'center' });
          doc.font('Helvetica-Bold').fillColor('#000000').text(chqDisplay, chqColX.chq + 2, curY, { width: chqColWidths.chq - 2 });
          doc.font('Helvetica').text(bank, chqColX.bank + 2, curY, { width: chqColWidths.bank - 2 });
          doc.text(rDate, chqColX.date + 2, curY, { width: chqColWidths.date - 2 });
          doc.font('Helvetica-Bold').text(`Rs. ${amt.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, chqColX.amount, curY, { width: chqColWidths.amount - 3, align: 'right' });

          curY += rowHeight;
          doc.moveTo(startX, curY - 2).lineTo(rightMargin, curY - 2).lineWidth(0.5).strokeColor('#cccccc').dash(2, { space: 2 }).stroke().undash();
        });

        // Total In-Hand Cheques Summary Row
        curY += 5;
        const totalChequesAmt = cheques.reduce((acc: number, c: any) => acc + Number(c.amount || 0), 0);
        const chqSumX = rightMargin - 220;
        const chqLabelWidth = 120;
        const chqValX = chqSumX + chqLabelWidth;
        const chqValWidth = 100;
        doc.moveTo(chqSumX, curY).lineTo(rightMargin, curY).lineWidth(1).strokeColor('#000000').stroke();
        curY += 4;
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000').text('Total In-Hand Cheques', chqSumX, curY, { width: chqLabelWidth, align: 'left' });
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#0369a1').text(`Rs. ${totalChequesAmt.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`, chqValX, curY, { width: chqValWidth, align: 'right' });
        curY += 12;
        doc.moveTo(chqSumX, curY).lineTo(rightMargin, curY).lineWidth(1.2).strokeColor('#000000').stroke();
        curY += 10;
      }

      // ── 5. Distinct Signature Blocks & Pinned Footer ──
      const sigY = 745;
      const sigBoxWidth = 180;
      const custSigX = startX + 15;
      const repSigX = rightMargin - sigBoxWidth - 15;

      // Customer Signature Block (with dotted line above)
      doc.moveTo(custSigX, sigY).lineTo(custSigX + sigBoxWidth, sigY).lineWidth(1).strokeColor('#000000').dash(2, { space: 2 }).stroke().undash();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('Customer Signature', custSigX, sigY + 5, { width: sigBoxWidth, align: 'center', characterSpacing: 0.5 });
      doc.fontSize(6.8).font('Helvetica').fillColor('#555555').text('Goods & statement received in good order', custSigX, sigY + 15, { width: sigBoxWidth, align: 'center' });

      // Authorized Rep Signature Block (with dotted line above)
      doc.moveTo(repSigX, sigY).lineTo(repSigX + sigBoxWidth, sigY).lineWidth(1).strokeColor('#000000').dash(2, { space: 2 }).stroke().undash();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('Authorized Rep Signature', repSigX, sigY + 5, { width: sigBoxWidth, align: 'center', characterSpacing: 0.5 });
      doc.fontSize(6.8).font('Helvetica').fillColor('#555555').text('Reliance Sales / Credit Representative', repSigX, sigY + 15, { width: sigBoxWidth, align: 'center' });

      // Legal & Credit Management Division Footer
      const footerLineY = 780;
      doc.moveTo(startX, footerLineY).lineTo(rightMargin, footerLineY).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000').text('RELIANCE CLOTHING - CREDIT MANAGEMENT DIVISION', startX, footerLineY + 6, { width: pageWidth, align: 'center', characterSpacing: 0.8, lineBreak: false });
      doc.fontSize(6.8).font('Helvetica').fillColor('#444444').text('Please verify all listed invoice dues. For settlement receipts, contact our finance hotline: 041-2268739.', startX, footerLineY + 16, { width: pageWidth, align: 'center', lineBreak: false });

    return doc;
  }
}
