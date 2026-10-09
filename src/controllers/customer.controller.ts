import type { Request, Response, NextFunction } from 'express';
import { customerService } from '../services/customer.service.ts';
import { sendSuccess, sendCreated } from '../utils/response.ts';
import { CustomerType } from '@prisma/client';

/**
 * Handle listing customers with sanitized query keyword and validated customer type
 */
export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = String((req as any).user?.role || '').toUpperCase();
    const rawQuery = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 100) : undefined;
    let rawType = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : undefined;

    // Strict wholesale customer visibility scope for Sales Representatives (REP)
    if (userRole === 'REP') {
      rawType = CustomerType.WHOLESALE;
    }

    const type = (rawType && Object.values(CustomerType).includes(rawType as CustomerType))
      ? (rawType as CustomerType)
      : undefined;

    const customers = await customerService.getCustomers(rawQuery, type);
    sendSuccess(res, customers);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle retrieving single customer profile details with positive integer ID check
 */
export const getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer customer ID is required' });
    }
    const customer = await customerService.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const userRole = String((req as any).user?.role || '').toUpperCase();
    if (userRole === 'REP' && customer.type !== CustomerType.WHOLESALE) {
      return res.status(403).json({ error: 'Forbidden: Representatives are strictly restricted to wholesale customer records.' });
    }

    sendSuccess(res, customer);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle creation of a new customer account with payload sanitization and financial field protection
 */
export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const userRole = String((req as any).user?.role || '').toUpperCase();
    const { id: _forbiddenId, ...safePayload } = req.body;
    if (req.body.outstandingBalance !== undefined) {
      safePayload.outstandingBalance = Number(req.body.outstandingBalance) || 0;
    }

    // Sales Representatives can only create wholesale customers
    if (userRole === 'REP') {
      safePayload.type = CustomerType.WHOLESALE;
    }

    const customer = await customerService.createCustomer(safePayload);
    sendCreated(res, customer);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle updating an existing customer record with strict ID check
 */
export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer customer ID is required' });
    }

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    const userRole = String((req as any).user?.role || '').toUpperCase();
    if (userRole === 'REP') {
      const existing = await customerService.getCustomerById(id);
      if (!existing || existing.type !== CustomerType.WHOLESALE) {
        return res.status(403).json({ error: 'Forbidden: Representatives can only update wholesale customer records.' });
      }
    }

    const { id: _forbiddenId, createdAt: _forbiddenCreated, ...safeUpdateData } = req.body;
    if (req.body.outstandingBalance !== undefined) {
      safeUpdateData.outstandingBalance = Number(req.body.outstandingBalance) || 0;
    }

    if (userRole === 'REP') {
      safeUpdateData.type = CustomerType.WHOLESALE;
    }

    const updated = await customerService.updateCustomer(id, safeUpdateData);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle safe deletion of customer record with strict ID validation
 * ⭐ Handles soft deletion/archiving gracefully when orders or debt ledgers exist
 */
export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = String((req as any).user?.role || '').toUpperCase();
    if (userRole === 'REP') {
      return res.status(403).json({ error: 'Forbidden: Representatives are not permitted to delete customer records.' });
    }

    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer customer ID is required' });
    }
    const result = await customerService.deleteCustomer(id);
    sendSuccess(res, result || { success: true, message: 'Customer record deleted or archived successfully' });
  } catch (err) {
    next(err);
  }
};