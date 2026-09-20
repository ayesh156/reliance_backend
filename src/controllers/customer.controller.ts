import type { Request, Response, NextFunction } from 'express';
import { customerService } from '../services/customer.service';
import { sendSuccess, sendCreated } from '../utils/response';
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
 * Handle creation of a new customer account with payload validation
 */
export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    const customer = await customerService.createCustomer(req.body);
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
    const updated = await customerService.updateCustomer(id, req.body);
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