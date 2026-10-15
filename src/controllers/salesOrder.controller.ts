import type { Request, Response, NextFunction } from 'express';
import { salesOrderService } from '../services/salesOrder.service.ts';
import { sendCreated, sendSuccess } from '../utils/response.ts';

/**
 * Handle creation of new Presales Order taken by Field Sales Representatives
 */
export const createSalesOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawUserId = (req as any).user?.userId;
    const userId = parseInt(String(rawUserId), 10);

    if (!userId || isNaN(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Authenticated user session invalid' });
    }

    if (!req.body || !Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one valid line item' });
    }

    const order = await salesOrderService.createSalesOrder({
      ...req.body,
      userId,
    });

    sendCreated(res, order);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle listing presales orders with search, status filters, and pagination
 */
export const getSalesOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = String((req as any).user?.role || '').toUpperCase();
    const userId = (req as any).user?.userId;

    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const search = req.query.search ? String(req.query.search) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;

    const customerId = req.query.customerId ? String(req.query.customerId) : undefined;
    const sortBy = req.query.sortBy ? String(req.query.sortBy) : undefined;

    // Field reps only view their own presales bookings by default
    let repId: number | undefined = undefined;
    if (userRole === 'REP') {
      repId = Number(userId);
    } else if (req.query.repId) {
      repId = parseInt(String(req.query.repId), 10);
    }

    const result = await salesOrderService.getSalesOrders({
      page,
      limit,
      search,
      status,
      startDate,
      endDate,
      repId,
      customerId,
      sortBy,
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle fetching single presales order details by ID
 */
export const getSalesOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid order ID provided' });
    }

    const order = await salesOrderService.getSalesOrderById(orderId);
    sendSuccess(res, order);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle updating an existing presales order
 */
export const updateSalesOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid order ID provided' });
    }

    const updated = await salesOrderService.updateSalesOrder(orderId, req.body);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle updating the status of a sales order
 */
export const updateSalesOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid order ID provided' });
    }

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status field is required' });
    }

    const updated = await salesOrderService.updateSalesOrderStatus(orderId, status);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle Convert to Invoice future action skeleton
 */
export const convertSalesOrderToInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);
    const userId = Number((req as any).user?.userId);

    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid order ID provided' });
    }

    const result = await salesOrderService.convertSalesOrderToInvoice(orderId, userId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Stream generated Presales Order PDF directly to browser with product photos in first column
 */
export const downloadSalesOrderPdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid order ID provided' });
    }

    const doc = await salesOrderService.generateSalesOrderPdf(orderId);

    if (!doc) {
      return res.status(404).json({ error: `Sales Order #${orderId} not found` });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Order-ORD${orderId}.pdf"`);

    doc.on('error', (streamErr) => {
      console.error('[SALES ORDER PDF STREAM ERROR]:', streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: 'PDF streaming failed' });
      }
    });

    doc.pipe(res);
    doc.end();
  } catch (err: any) {
    console.error('[SALES ORDER PDF ERROR]:', err);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'Failed to render Order PDF' });
    }
  }
};
