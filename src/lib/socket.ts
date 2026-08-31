/**
 * Socket.io singleton
 *
 * Holds the single `Server` instance so any module (especially route handlers)
 * can import `getIO()` without creating a circular dependency back to index.ts.
 *
 * Usage:
 *   import { initIO, getIO } from '../lib/socket';
 *
 *   // In index.ts — called once after httpServer is ready:
 *   initIO(httpServer, corsOptions);
 *
 *   // In any route file:
 *   getIO().emit('someEvent', payload);
 */

import { Server, ServerOptions } from 'socket.io';
import type { Server as HttpServer } from 'http';

let ioInstance: Server | null = null;

/**
 * Initialise the Socket.io server and store it as a module-level singleton.
 * Must be called exactly once, before any route handler tries to use `getIO()`.
 */
export function initIO(
  httpServer: HttpServer,
  opts?: Partial<ServerOptions>
): Server {
  if (ioInstance) return ioInstance;
  ioInstance = new Server(httpServer, opts);
  return ioInstance;
}

/**
 * Retrieve the Socket.io server instance.
 * Throws if `initIO()` has not been called yet.
 */
export function getIO(): Server {
  if (!ioInstance) {
    throw new Error(
      '[socket] getIO() called before initIO(). Make sure initIO() is called in index.ts before any route handlers emit events.'
    );
  }
  return ioInstance;
}
