import type { Response } from 'express';
import { HttpException } from '../middleware/error.middleware.ts';

/**
 * Standardized HTTP response helpers.
 * Controllers should use these to keep response formatting consistent.
 */

/** Prisma error code → HTTP status mapping. */
const PRISMA_STATUS_MAP: Record<string, number> = {
  P2002: 409, // Unique constraint
  P2025: 404, // Record not found
  P2021: 404, // Table does not exist
  P2003: 400, // Foreign key constraint
};

/** Whether a value looks like a Prisma error (has a string `code`). */
function isPrismaError(error: unknown): error is { code: string; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/**
 * Extract the HTTP status code from an error.
 * HttpException carries its own status; Prisma errors are mapped; everything else → 500.
 */
function getErrorStatus(error: unknown): number {
  if (error instanceof HttpException) return error.status;
  if (isPrismaError(error) && PRISMA_STATUS_MAP[error.code]) return PRISMA_STATUS_MAP[error.code];
  
  // Raw Prisma string errors (e.g. nested constraint errors thrown during invocation)
  const rawStr = error instanceof Error ? error.message : '';
  if (rawStr.includes('Unique constraint failed') || rawStr.includes('P2002')) return 409;
  if (rawStr.includes('Foreign key constraint failed') || rawStr.includes('P2003')) return 400;

  return 500;
}

/**
 * ⭐ Enterprise Error Sanitizer:
 * Translates low-level Prisma invocation dumps and SQL constraints into human-readable messages
 */
function sanitizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof HttpException) {
    return error.message;
  }

  const rawMessage = error instanceof Error ? error.message : String(error || fallbackMessage);

  // 1. Prisma P2002 Unique Constraint handling (e.g., SKU, Barcode, Phone duplicates)
  if (rawMessage.includes('Unique constraint failed') || (isPrismaError(error) && error.code === 'P2002')) {
    const target = (error as any)?.meta?.target;
    const checkTarget = (typeof target === 'string' ? target : Array.isArray(target) ? target.join(' ') : '') + ' ' + rawMessage;

    if (/sku/i.test(checkTarget)) {
      return 'This SKU code is already registered to another item. Please enter or generate a unique SKU.';
    }
    if (/barcode/i.test(checkTarget)) {
      return 'This Barcode is already registered to another product. Please use a unique barcode.';
    }
    if (/phone/i.test(checkTarget)) {
      return 'This phone number is already registered to an existing customer or account.';
    }
    if (/email/i.test(checkTarget)) {
      return 'This email address is already registered in the system.';
    }
    if (/invoice/i.test(checkTarget)) {
      return 'This invoice number already exists in the system.';
    }
    return 'A record with duplicate unique details already exists. Please verify the unique fields.';
  }

  // 2. Prisma P2003 Foreign Key Constraint handling
  if (rawMessage.includes('Foreign key constraint failed') || (isPrismaError(error) && error.code === 'P2003')) {
    return 'Cannot delete or modify this record because it is referenced in orders, invoices, or transactions.';
  }

  // 3. Prisma P2025 Record Not Found
  if (rawMessage.includes('Record to update not found') || (isPrismaError(error) && error.code === 'P2025')) {
    return 'The requested record could not be found or has already been removed.';
  }

  // Return standard clean message if not a Prisma low-level dump
  if (!rawMessage.includes('prisma.') && !rawMessage.includes('invocation')) {
    return rawMessage;
  }

  return fallbackMessage;
}

/**
 * Send a success response. Defaults to HTTP 200.
 */
export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(data);
}

/**
 * Send an error response with both 'error' and 'message' keys for seamless UI toast rendering. Defaults to HTTP 400.
 */
export function sendError(res: Response, error: string, status = 400): void {
  res.status(status).json({
    success: false,
    error,
    message: error,
  });
}

/**
 * Send an error response based on an unknown thrown value.
 * Sanitizes technical Prisma stack traces into actionable notifications.
 */
export function sendErrorFrom(res: Response, error: unknown, fallbackMessage = 'Internal server error'): void {
  const status = getErrorStatus(error);
  const cleanMessage = sanitizeErrorMessage(error, fallbackMessage);
  sendError(res, cleanMessage, status);
}

/**
 * Send a 201 Created response.
 */
export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, 201);
}

/**
 * Send a 204 No Content response.
 */
export function sendNoContent(res: Response): void {
  res.status(204).send();
}