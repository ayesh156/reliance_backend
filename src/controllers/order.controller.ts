import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service';
import { sendCreated, sendSuccess } from '../utils/response';

/**
 * Handle creation of new POS cashier invoice order
 */
export const createPosOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    const order = await orderService.createPosOrder({
      ...req.body,
      userId: Number(userId),
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
 * Handle listing paginated invoices with search & filters
 */
export const getInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, customerId, paymentMethod, source, page, limit } = req.query;
    const result = await orderService.getInvoices({
      search: search ? String(search) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      paymentMethod: paymentMethod ? String(paymentMethod) : undefined,
      source: source as any,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 15,
    });
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle single invoice retrieval
 */
export const getInvoiceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await orderService.getInvoiceById(Number(req.params.id));
    sendSuccess(res, invoice);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle invoice order modification
 */
export const updateInvoiceOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await orderService.updateInvoiceOrder(Number(req.params.id), req.body);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle invoice deletion
 */
export const deleteInvoiceOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orderService.deleteInvoiceOrder(Number(req.params.id));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Stream generated Invoice PDF directly to browser download
 */
export const downloadInvoicePdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);
    const doc = await orderService.generateInvoicePdf(orderId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-INV${orderId}.pdf"`);

    doc.pipe(res);
    doc.end();
  } catch (err) {
    next(err);
  }
};


/**
 * Handle debt settlement and invoice reconciliation
 */
export const settleCustomerDebt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orderService.settleCustomerDebt({
      customerId: Number(req.params.customerId),
      amount: Number(req.body.amount || 0),
      strategy: req.body.strategy || 'FIFO',
      selectedInvoiceIds: Array.isArray(req.body.selectedInvoiceIds) 
        ? req.body.selectedInvoiceIds.map(Number) 
        : [],
      paymentMethod: req.body.paymentMethod || 'CASH',
      notes: req.body.notes,
    });
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieve list of pending debt invoices for specific customer
 */
export const getCustomerPendingInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoices = await orderService.getCustomerPendingInvoices(Number(req.params.customerId));
    sendSuccess(res, invoices);
  } catch (err) {
    next(err);
  }
};