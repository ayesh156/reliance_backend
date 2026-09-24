import type { Request, Response, NextFunction } from 'express';
import { customerService } from '../services/customer.service.ts';
import { sendSuccess, sendCreated } from '../utils/response.ts';
import { CustomerType } from '@prisma/client';

/**
 * Handle listing customers with sanitized query keyword and validated customer type
 */
export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawQuery = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 100) : undefined;
    const rawType = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : undefined;
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

    // Security Whitelist: Strip client-injected financial balances on account creation
    const { outstandingBalance: _forbiddenBal, id: _forbiddenId, ...safePayload } = req.body;

    const customer = await customerService.createCustomer(safePayload);
    sendCreated(res, customer);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle updating an existing customer record with strict ID check and financial field tampering protection
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

    // Security Whitelist: Prevent direct mutation of outstanding balances via profile updates
    const { outstandingBalance: _forbiddenBal, id: _forbiddenId, createdAt: _forbiddenCreated, ...safeUpdateData } = req.body;

    const updated = await customerService.updateCustomer(id, safeUpdateData);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle safe deletion of customer record with strict ID validation
 */
export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(String(rawId), 10);
    if (!id || isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid positive integer customer ID is required' });
    }
    await customerService.deleteCustomer(id);
    sendSuccess(res, { success: true, message: 'Customer record deleted' });
  } catch (err) {
    next(err);
  }
};