import { AuthPayload } from './common.types';

declare global {
  namespace Express {
    interface Request {
      /** Authenticated user payload set by the auth middleware. */
      user?: AuthPayload;
      /** Unique request ID for tracing. Populated from `x-request-id` header or a random UUID. */
      requestId?: string;
    }
  }
}

export {};