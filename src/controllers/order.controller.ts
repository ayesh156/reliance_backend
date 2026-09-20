import type { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service';
import { sendCreated, sendSuccess } from '../utils/response';

/**
 * Handle creation of new POS cashier invoice order with authenticated user validation
 */
export const createPosOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawUserId = (req as any).user?.userId;
    const userId = parseInt(String(rawUserId), 10);
    if (!userId || isNaN(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Authenticated user session invalid' });
    }

    if (!req.body || !Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one valid line item' });
    }

    const order = await orderService.createPosOrder({
      ...req.body,
      userId,
    });
    sendCreated(res, order);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle listing all product variants optimized for POS terminal grid
 */
export const getPosCatalog = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const catalog = await orderService.getPosCatalog();
    sendSuccess(res, catalog);
  } catch (err) {
    next(err);
  }
};


/**
 * Handle listing paginated invoices with sanitized search and safe limits
 */
export const getInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, customerId, paymentMethod, source, page, limit } = req.query;
    const cleanSearch = typeof search === 'string' ? search.trim().slice(0, 100) : undefined;
    const cleanCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : undefined;
    const cleanPaymentMethod = typeof paymentMethod === 'string' ? paymentMethod.trim().slice(0, 20) : undefined;

    const parsedPage = Math.max(1, parseInt(String(page || 1), 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(String(limit || 15), 10) || 15));

    const result = await orderService.getInvoices({
      search: cleanSearch,
      customerId: cleanCustomerId,
      paymentMethod: cleanPaymentMethod,
      source: source as any,
      page: parsedPage,
      limit: parsedLimit,
    });
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle single invoice retrieval
 */
/**
 * Handle single invoice retrieval with strict positive integer ID validation
 */
export const getInvoiceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer invoice ID is required' });
    }
    const invoice = await orderService.getInvoiceById(id);
    sendSuccess(res, invoice);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle invoice order modification
 */
/**
 * Handle invoice order modification with parameter sanitization
 */
export const updateInvoiceOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer invoice ID is required' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid invoice payload provided' });
    }
    const updated = await orderService.updateInvoiceOrder(id, req.body);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle invoice deletion
 */
/**
 * Handle safe invoice deletion with strict integer ID check
 */
export const deleteInvoiceOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer invoice ID is required' });
    }
    const result = await orderService.deleteInvoiceOrder(id);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Stream generated Invoice PDF directly to browser preview/download with safe stream guards and explicit stderr logging
 */
export const downloadInvoicePdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);

    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid order invoice ID provided' });
    }

    const doc = await orderService.generateInvoicePdf(orderId);

    if (!doc) {
      return res.status(404).json({ error: `Invoice order #${orderId} not found` });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-INV${orderId}.pdf"`);

    // Handle asynchronous streaming errors gracefully with direct logging
    doc.on('error', (streamErr) => {
      console.error('[PDF STREAM RUNTIME ERROR]:', streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: 'PDF stream rendering failed' });
      }
    });

    doc.pipe(res);
    doc.end();
  } catch (err: any) {
    // Explicitly write exact stack trace to server console/stderr
    console.error('[PDF GENERATION ERROR]:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    res.status(500).json({ error: err?.message || 'Failed to generate PDF' });
  }
};

/**
 * Handle debt settlement and invoice reconciliation
 */
/**
 * Handle debt settlement with strict amount and customer parameter validation
 */
export const settleCustomerDebt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawCustId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
    const customerId = parseInt(String(rawCustId), 10);
    if (!customerId || isNaN(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Valid positive customer ID is required' });
    }

    const amount = Math.max(0, Number(req.body.amount) || 0);
    const strategy = ['FULL', 'FIFO', 'LIFO', 'CUSTOM'].includes(req.body.strategy)
      ? req.body.strategy
      : 'FIFO';

    const selectedInvoiceIds = Array.isArray(req.body.selectedInvoiceIds)
      ? req.body.selectedInvoiceIds
          .map((id: any) => parseInt(String(id), 10))
          .filter((id: number) => !isNaN(id) && id > 0)
      : [];

    const result = await orderService.settleCustomerDebt({
      customerId,
      amount,
      strategy,
      selectedInvoiceIds,
      paymentMethod: typeof req.body.paymentMethod === 'string' ? req.body.paymentMethod.trim().slice(0, 30) : 'CASH',
      notes: typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 255) : undefined,
    });
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieve pending debt invoices with validated customer ID parameter
 */
export const getCustomerPendingInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawCustId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
    const customerId = parseInt(String(rawCustId), 10);
    if (!customerId || isNaN(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Valid positive customer ID is required' });
    }
    const invoices = await orderService.getCustomerPendingInvoices(customerId);
    sendSuccess(res, invoices);
  } catch (err) {
    next(err);
  }
};