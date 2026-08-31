import { Response } from 'express';
import { HttpException } from '../middleware/error.middleware';

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
  return 500;
}

/**
 * Send a success response. Defaults to HTTP 200.
 */
export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(data);
}

/**
 * Send an error response with a message. Defaults to HTTP 400.
 */
export function sendError(res: Response, error: string, status = 400): void {
  res.status(status).json({ error });
}

/**
 * Send an error response based on an unknown thrown value.
 * If `error` is an HttpException, its status is respected.
 * If `error` is a Prisma error, the mapped status is used (e.g. P2002 → 409).
 */
export function sendErrorFrom(res: Response, error: unknown, fallbackMessage = 'Internal server error'): void {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const status = getErrorStatus(error);
  sendError(res, message, status);
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