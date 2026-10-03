import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.ts';

/**
 * Custom HTTP exception with status code.
 * Services / controllers can throw this to signal an expected error.
 */
export class HttpException extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpException';
    this.status = status;
  }
}

/** 
 * ⭐ Prisma දෝෂ කේත පරිශීලකයාට තේරුම් ගත හැකි පැහැදිලි පණිවිඩ බවට පත් කිරීම
 */
const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: 'A record with this unique value already exists.' },
  P2025: { status: 404, message: 'The requested record was not found or has already been removed.' },
  P2021: { status: 404, message: 'Table does not exist in the database.' },
  // ⭐ Foreign key බිඳවැටීම් සඳහා පැහැදිලි පණිවිඩයක් ලබා දීම
  P2003: { 
    status: 400, 
    message: 'Cannot delete or modify this item because it is linked to active transactions, orders, or suppliers.' 
  },
};

/** Whether a value looks like a Prisma error (has a numeric `code`). */
function isPrismaError(err: unknown): err is { code: string; message?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}

/**
 * Global error-handling middleware.
 * Catches HttpException, Prisma errors, and any uncaught errors.
 * Must be registered AFTER all routes.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Expected custom errors (Frontend එකට message සහ error යන දෙකම යැවීම)
  if (err instanceof HttpException) {
    res.status(err.status).json({ 
      success: false,
      error: err.message, 
      message: err.message 
    });
    return;
  }

  // Prisma known errors
  if (isPrismaError(err)) {
    if (err.code === 'P2002') {
      const target = (err as any).meta?.target;
      let fieldName = 'unique value';
      if (typeof target === 'string') {
        if (target.includes('barcode')) fieldName = 'Barcode';
        else if (target.includes('sku')) fieldName = 'SKU';
        else if (target.includes('email')) fieldName = 'Email Address';
        else if (target.includes('phone')) fieldName = 'Phone Number';
      } else if (Array.isArray(target)) {
        fieldName = target.join(', ');
      }
      const msg = `A record with this ${fieldName} already exists in the system.`;
      res.status(409).json({ success: false, error: msg, message: msg });
      return;
    }

    if (PRISMA_ERROR_MAP[err.code]) {
      const mapped = PRISMA_ERROR_MAP[err.code];
      res.status(mapped.status).json({ 
        success: false,
        error: mapped.message, 
        message: mapped.message 
      });
      return;
    }
  }

  // Prisma known errors
  if (isPrismaError(err)) {
    if (err.code === 'P2002') {
      const target = (err as any).meta?.target;
      const rawMsg = String((err as any).message || '');
      let fieldName = 'unique value';

      const checkString = (typeof target === 'string' ? target : Array.isArray(target) ? target.join(' ') : '') + ' ' + rawMsg;

      if (/sku/i.test(checkString)) {
        fieldName = 'SKU (Item Code)';
      } else if (/barcode/i.test(checkString)) {
        fieldName = 'Barcode';
      } else if (/phone/i.test(checkString)) {
        fieldName = 'Phone Number';
      } else if (/email/i.test(checkString)) {
        fieldName = 'Email Address';
      } else if (/invoice/i.test(checkString)) {
        fieldName = 'Invoice Number';
      } else if (/name|title/i.test(checkString)) {
        fieldName = 'Name / Title';
      }

      const cleanMessage = `A product or record with this ${fieldName} is already registered in the system. Please enter a different one.`;
      
      res.status(409).json({
        success: false,
        error: cleanMessage,
        message: cleanMessage,
      });
      return;
    }

    if (PRISMA_ERROR_MAP[err.code]) {
      const mapped = PRISMA_ERROR_MAP[err.code];
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
  }

  // CORS errors (from cors middleware)
  if (err instanceof Error && err.message.includes('not allowed by CORS')) {
    res.status(403).json({ error: err.message });
    return;
  }

  // Generic unknown error
  const message = err instanceof Error ? err.message : 'Internal server error';
  if (env.isDevelopment) {
    console.error('[ErrorMiddleware]', message, err);
  } else {
    console.error('[ErrorMiddleware]', message);
  }
  res.status(500).json({ error: 'Internal server error' });
}

export default errorMiddleware;