import { Role } from '../config/constants';

/**
 * Shared DTO / utility types used across controllers, services, and routes.
 */

/** User payload embedded in the JWT. */
export interface AuthPayload {
  userId: number;
  role: string;
  name: string;
}

/** Minimal authenticated request body helpers. */
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

/** Pagination metadata (reserved for future extensions). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Strongly-typed role union re-exported for convenience. */
export type { Role };