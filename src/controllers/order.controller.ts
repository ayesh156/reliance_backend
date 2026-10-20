import type { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service.ts';
import { sendCreated, sendSuccess } from '../utils/response.ts';

/**
 * Handle creation of new POS cashier invoice order with authenticated user validation
 * Allows ADMIN, STAFF, CASHIER, and REP roles.
 */
export const createPosOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawUserId = (req as any).user?.userId ?? (req as any).user?.id;
    const userId = parseInt(String(rawUserId), 10);
    if (!userId || isNaN(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Authenticated user session invalid' });
    }

    const userRole = String((req as any).user?.role || '').toUpperCase();

    if (!req.body || !Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one valid line item' });
    }

    // Role-based wholesale billing constraint for Sales Representatives (REP)
    if (userRole === 'REP') {
      if (req.body.source && req.body.source !== 'POS_WHOLESALE') {
        return res.status(403).json({ error: 'Representatives are strictly restricted to wholesale POS billing.' });
      }
      req.body.source = 'POS_WHOLESALE';
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
 * Handle listing paginated invoices with sanitized search, multi-tenant filters, and safe limits.
 *
 * RBAC Data Scoping:
 * - REP: Strictly scoped to invoices authored by the authenticated representative (where: { userId }).
 * - ADMIN, STAFF, CASHIER: Unrestricted access to retrieve the global invoice ledger.
 *
 * Supported `sortBy` modes:
 * - 'newest': Descending issue timestamp (default)
 * - 'oldest': Ascending issue timestamp
 * - 'most_overdue' / 'overdue_oldest': Isolates unpaid invoices (creditDue > 0) ordered by oldest issue date first (createdAt ASC)
 * - 'least_overdue' / 'overdue_newest': Isolates unpaid invoices (creditDue > 0) ordered by newest issue date first (createdAt DESC)
 * - 'highest_amount': Orders by totalAmount DESC
 * - 'lowest_amount': Orders by totalAmount ASC
 * - 'highest_due': Orders by totalAmount DESC, paidAmount ASC
 */
export const getInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, customerId, paymentMethod, source, startDate, endDate, sortBy, page, limit } = req.query;
    const cleanSearch = typeof search === 'string' ? search.trim().slice(0, 100) : undefined;
    const cleanCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : undefined;
    const cleanPaymentMethod = typeof paymentMethod === 'string' ? paymentMethod.trim().slice(0, 20) : undefined;
    const cleanStartDate = typeof startDate === 'string' ? startDate.trim() : undefined;
    const cleanEndDate = typeof endDate === 'string' ? endDate.trim() : undefined;
    const cleanSortBy = typeof sortBy === 'string' ? sortBy.trim().slice(0, 30) : undefined;

    const parsedPage = Math.max(1, parseInt(String(page || 1), 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(String(limit || 15), 10) || 15));

    // Role-Based Access Control (RBAC) Scoping:
    // Sales Representatives (REP) are strictly scoped to bills they authored.
    // ADMIN, STAFF, and CASHIER roles bypass this filter and retrieve the entire ledger.
    const user = (req as any).user;
    const userRole = String(user?.role || '').toUpperCase();
    const rawUserId = user?.userId ?? user?.id;
    const authUserId = parseInt(String(rawUserId), 10);
    const repUserId = userRole === 'REP' && !isNaN(authUserId) && authUserId > 0 ? authUserId : undefined;

    const result = await orderService.getInvoices({
      search: cleanSearch,
      customerId: cleanCustomerId,
      paymentMethod: cleanPaymentMethod,
      source: source as any,
      startDate: cleanStartDate,
      endDate: cleanEndDate,
      sortBy: cleanSortBy,
      page: parsedPage,
      limit: parsedLimit,
      userId: repUserId,
    });
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle single invoice retrieval with strict positive integer ID validation
 * Enforces RBAC: REPs are restricted to viewing invoices they authored.
 */
export const getInvoiceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer invoice ID is required' });
    }
    const invoice = await orderService.getInvoiceById(id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Role-Based Access Control: REPs can only view invoices they authored
    const user = (req as any).user;
    const userRole = String(user?.role || '').toUpperCase();
    const rawUserId = user?.userId ?? user?.id;
    const authUserId = parseInt(String(rawUserId), 10);
    if (userRole === 'REP' && !isNaN(authUserId) && authUserId > 0) {
      if (invoice.userId && Number(invoice.userId) !== authUserId) {
        return res.status(403).json({ error: 'Access denied: You can only view invoices you authored' });
      }
    }

    sendSuccess(res, invoice);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle invoice order modification with parameter sanitization
 * Enforces RBAC: REPs can edit their own authored bills, while ADMIN, STAFF, CASHIER have full editing authority.
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

    const user = (req as any).user;
    const userRole = String(user?.role || '').toUpperCase();
    const rawUserId = user?.userId ?? user?.id;
    const authUserId = parseInt(String(rawUserId), 10);

    // Ensure Sales Representatives (REP) stay locked to wholesale POS billing
    if (userRole === 'REP') {
      req.body.source = 'POS_WHOLESALE';
    }

    const currentUser = {
      id: !isNaN(authUserId) ? authUserId : undefined,
      userId: !isNaN(authUserId) ? authUserId : undefined,
      role: userRole,
      name: user?.name,
      email: user?.email,
    };

    const updated = await orderService.updateInvoiceOrder(id, req.body, currentUser);
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
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authenticated user session invalid' });
    }
    const currentUser = {
      id: Number(user.userId ?? user.id),
      userId: Number(user.userId ?? user.id),
      role: String(user.role || ''),
      name: user.name,
      email: user.email,
    };
    const result = await orderService.deleteInvoiceOrder(id, currentUser);
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

    const paymentDate = req.body.paymentDate && !isNaN(new Date(req.body.paymentDate).getTime())
      ? new Date(req.body.paymentDate)
      : new Date();

    const result = await orderService.settleCustomerDebt({
      customerId,
      amount,
      strategy,
      selectedInvoiceIds,
      paymentMethod: typeof req.body.paymentMethod === 'string' ? req.body.paymentMethod.trim().slice(0, 30) : 'CASH',
      notes: typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 255) : undefined,
      paymentDate,
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

/**
 * Handle in-store invoice item return & stock restoration
 */
export const processInvoiceReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer invoice ID is required' });
    }

    if (!req.body || !Array.isArray(req.body.returnedItems) || req.body.returnedItems.length === 0) {
      return res.status(400).json({ error: 'At least one returned item must be specified' });
    }

    const user = (req as any).user;
    const recordedBy = req.body.recordedBy || user?.name || user?.email || (user?.userId ? `User #${user.userId}` : 'Cashier');

    const result = await orderService.processInvoiceReturn(
      id,
      {
        ...req.body,
        recordedBy,
      },
      user
    );

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle toggling or updating invoice dispatch tracking status (Rep Sent)
 * Records isDispatched and captures the authenticated user's role into dispatchedByRole
 * PATCH /api/invoices/:id/dispatch or PATCH /api/orders/:id/dispatch
 */
export const toggleInvoiceDispatch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer invoice ID is required' });
    }

    const user = (req as any).user;
    const isDispatched = typeof req.body?.isDispatched === 'boolean' ? req.body.isDispatched : undefined;

    const result = await orderService.toggleInvoiceDispatch(id, { isDispatched }, user);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};