import { Request, Response, NextFunction } from 'express';
import { customerService } from '../services/customer.service';
import { sendSuccess, sendCreated } from '../utils/response';
import { CustomerType } from '@prisma/client';

/**
 * Handle listing all customers with keyword and role/type filter
 */
export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.query ? String(req.query.query) : undefined;
    const type = req.query.type ? (req.query.type as CustomerType) : undefined;
    const customers = await customerService.getCustomers(query, type);
    sendSuccess(res, customers);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle retrieving single customer profile details
 */
export const getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await customerService.getCustomerById(Number(req.params.id));
    sendSuccess(res, customer);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle creation of a new customer account
 */
export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await customerService.createCustomer(req.body);
    sendCreated(res, customer);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle updating an existing customer record
 */
export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await customerService.updateCustomer(Number(req.params.id), req.body);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle safe deletion of customer record
 */
export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await customerService.deleteCustomer(Number(req.params.id));
    sendSuccess(res, { success: true, message: 'Customer record deleted' });
  } catch (err) {
    next(err);
  }
};