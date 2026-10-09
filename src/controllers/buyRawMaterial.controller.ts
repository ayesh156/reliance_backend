import type { Request, Response, NextFunction } from 'express';
import buyRawMaterialService from '../services/buyRawMaterial.service.ts';
import { sendSuccess } from '../utils/response.ts';
import { GrnPdfService } from '../services/grn-pdf.service.ts';

export class BuyRawMaterialController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const shopId = req.query.shopId ? Number(req.query.shopId) : undefined;
      // ⭐ search සහ shopId යන දෙකම service එකට pass කිරීම
      const purchases = await buyRawMaterialService.getAll(search, shopId);
      return sendSuccess(res, purchases);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const purchase = await buyRawMaterialService.getById(id);
      return sendSuccess(res, purchase);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const purchase = await buyRawMaterialService.create(req.body);
      return sendSuccess(res, purchase, 201);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userRole = String((req as any).user?.role || '').toUpperCase();
      if (userRole === 'REP') {
        return res.status(403).json({ error: 'Forbidden: Representatives cannot delete raw material purchases.' });
      }
      const id = Number(req.params.id);
      const result = await buyRawMaterialService.delete(id);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/buy-raw-materials/next-invoice
   */
  async getNextInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const nextInvoice = await buyRawMaterialService.getNextInvoiceNumber();
      return sendSuccess(res, { invoiceNumber: nextInvoice });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Download A4 GRN Note PDF with secure buffer chunking
   */
 async downloadGrnPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid purchase ID is required' });
      }

      const purchase = await buyRawMaterialService.getById(id);
      if (!purchase) {
        return res.status(404).json({ error: 'Purchase record not found' });
      }

      const doc = GrnPdfService.generate(purchase);
      const filename = `GRN-${purchase.invoiceNumber || purchase.id}.pdf`;

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const resultBuffer = Buffer.concat(chunks);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': resultBuffer.length,
        });
        res.end(resultBuffer);
      });
      doc.on('error', (err) => {
        next(err);
      });

      doc.end();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Record installment payment for purchase
   */
  async settlePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await buyRawMaterialService.settlePurchasePayment(req.body);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const purchase = await buyRawMaterialService.update(id, req.body);
      return sendSuccess(res, purchase);
    } catch (err) {
      next(err);
    }
  }
}

export default new BuyRawMaterialController();