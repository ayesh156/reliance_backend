import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

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

/** Prisma error code → HTTP status + message mapping. */
const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: 'A record with this unique value already exists.' },
  P2025: { status: 404, message: 'Record not found.' },
  P2021: { status: 404, message: 'Table does not exist in the database.' },
  P2003: { status: 400, message: 'Foreign key constraint failed.' },
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
  // Expected custom errors
  if (err instanceof HttpException) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Prisma known errors
  if (isPrismaError(err) && PRISMA_ERROR_MAP[err.code]) {
    const mapped = PRISMA_ERROR_MAP[err.code];
    res.status(mapped.status).json({ error: mapped.message });
    return;
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