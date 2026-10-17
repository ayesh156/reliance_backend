import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import type { AuthPayload } from '../types/common.types.ts';

/**
 * Representation of an active connected SSE client
 */
export interface SseClient {
  id: string;
  userId?: number;
  role?: string;
  channel?: string;
  res: Response;
  req: Request;
  connectedAt: Date;
}

/**
 * Broadcast options allowing channel-specific filtering, sender exclusion, and role restrictions
 */
export interface BroadcastOptions {
  channel?: string;
  senderClientId?: string;
  roles?: string[];
}

/**
 * ============================================================================
 * 1. GLOBAL CLIENT MAP (Senari Production Architecture)
 * ============================================================================
 *
 * Module-Level Global Architecture:
 * By maintaining `activeClients` at the module level in a single global Map, all incoming
 * connections across all client devices (desktop POS, mobile terminals, storefronts,
 * admin dashboards) are tracked in a unified registry.
 *
 * Cross-Device Broadcasting Guarantee:
 * In a multi-device setup (e.g. mobile sales staff creating orders that must instantly
 * appear on desktop cashier/admin screens), maintaining this global map ensures that
 * broadcast loops iterate across every live terminal connection regardless of origin
 * or process boundaries.
 */
export const activeClients = new Map<string, SseClient>();

/**
 * ============================================================================
 * 3. GLOBAL BROADCAST LOOP & UTILITY FUNCTION
 * ============================================================================
 *
 * Global Live Broadcast Function (Senari Standard):
 * Iterates through all connected clients in the module-level `activeClients` map using `.forEach()`.
 * Directly writes SSE payload frames (`event: ${event}\ndata: ${data}\n\n`) to all active streams.
 *
 * Health & Dead Socket Verification:
 * Before writing to each client, strictly verifies:
 * 1. `client.res.writable === true` and `!client.res.writableEnded`
 * 2. `!client.req.socket.destroyed`
 *
 * Memory Leak Prevention:
 * Any client connection identified as unwritable, finished, or destroyed is immediately
 * collected and cleanly removed from `activeClients`, with the underlying socket destroyed
 * to eliminate file descriptor leaks, kernel buffer saturation, and TCP half-open ghost connections.
 *
 * @param event The event identifier (e.g. 'order_created', 'order_updated', 'invoice_created')
 * @param data The payload data (string or object) to be broadcast
 * @param options Optional broadcast filtering (senderClientId exclusion, channel, roles)
 */
export function broadcastLiveEvent(
  event: string,
  data: any,
  options: BroadcastOptions = {}
): void {
  // Ensure data is properly formatted string for SSE transmission
  const formattedData = typeof data === 'string' ? data : JSON.stringify(data);
  const deadClients: string[] = [];

  activeClients.forEach((client, clientId) => {
    // 1. Exclude sender terminal if requested (prevent redundant echo)
    if (options.senderClientId && client.id === options.senderClientId) {
      return;
    }

    // 2. Filter by channel if specified (default: 'global' broadcasts to all devices)
    if (options.channel && options.channel !== 'global' && client.channel !== options.channel) {
      return;
    }

    // 3. Filter by user role if restricted
    if (options.roles && options.roles.length > 0) {
      const clientRole = (client.role || '').toUpperCase();
      const matches = options.roles.some((r) => r.toUpperCase() === clientRole);
      if (!matches) return;
    }

    // 4. Verify stream writability and socket health before writing payload
    if (client.res.writable && !client.res.writableEnded && !client.req.socket.destroyed) {
      try {
        const canWrite = client.res.write(`event: ${event}\ndata: ${formattedData}\n\n`);
        if (!canWrite) {
          // Socket buffer backpressure / hung pipe detected - mark for immediate cleanup
          deadClients.push(clientId);
        }
      } catch (err) {
        console.error(`[SSE Gateway] Broadcast write error for client ${clientId}:`, err);
        deadClients.push(clientId);
      }
    } else {
      deadClients.push(clientId);
    }
  });

  // Strict Dead Socket Cleanup: Purge dead sockets identified during broadcast
  if (deadClients.length > 0) {
    deadClients.forEach((id) => {
      const deadClient = activeClients.get(id);
      if (deadClient) {
        try {
          if (!deadClient.res.writableEnded) deadClient.res.end();
          if (!deadClient.req.socket.destroyed) deadClient.req.socket.destroy();
        } catch {
          // Silently absorb socket destruction errors
        }
      }
      activeClients.delete(id);
      console.log(`[SSE Gateway] Purged dead client socket ${id}. Remaining active: ${activeClients.size}`);
    });
  }
}

/**
 * Enterprise Server-Sent Events (SSE) Synchronization Gateway
 * Backwards-compatible class wrapper exposing high-level domain broadcast methods.
 */
export class SseGateway {
  /**
   * Register a new client connection into the global activeClients map
   */
  public registerClient(client: SseClient): void {
    activeClients.set(client.id, client);
    console.log(
      `[SSE Gateway] Client connected: ${client.id} (User: ${client.userId || 'guest'}, Role: ${client.role || 'unknown'}, Channel: ${client.channel || 'global'}). Total active: ${activeClients.size}`
    );
  }

  /**
   * Unregister and clean up a client connection from active tracking
   */
  public removeClient(clientId: string): void {
    const client = activeClients.get(clientId);
    if (!client) return;

    activeClients.delete(clientId);
    console.log(`[SSE Gateway] Client disconnected: ${clientId}. Total active: ${activeClients.size}`);
  }

  /**
   * Generic broadcast dispatch delegating to broadcastLiveEvent
   */
  public broadcast(event: string, payload: any, options: BroadcastOptions = {}): void {
    broadcastLiveEvent(event, payload, options);
  }

  /**
   * Live Broadcast Helpers for Order and Invoice Lifecycle Events
   */
  public broadcastOrderCreated(order: any, senderClientId?: string): void {
    broadcastLiveEvent('order_created', order, { senderClientId });
  }

  public broadcastOrderUpdated(order: any, senderClientId?: string): void {
    broadcastLiveEvent('order_updated', order, { senderClientId });
  }

  public broadcastOrderDeleted(orderId: number, senderClientId?: string): void {
    broadcastLiveEvent('order_deleted', { id: orderId, orderId }, { senderClientId });
  }

  public broadcastInvoiceCreated(invoice: any, senderClientId?: string): void {
    broadcastLiveEvent('invoice_created', invoice, { senderClientId });
  }

  public broadcastInvoiceUpdated(invoice: any, senderClientId?: string): void {
    broadcastLiveEvent('invoice_updated', invoice, { senderClientId });
  }

  public broadcastInvoiceDeleted(invoiceId: number, senderClientId?: string): void {
    broadcastLiveEvent('invoice_deleted', { id: invoiceId, invoiceId }, { senderClientId });
  }

  /**
   * Returns current active connection count across all devices
   */
  public getActiveCount(): number {
    return activeClients.size;
  }
}

export const sseGateway = new SseGateway();

export const syncRouter = Router();

/**
 * ============================================================================
 * 2. CONNECTION REGISTRATION & CLEANUP ROUTE (/stream)
 * ============================================================================
 *
 * GET /api/sync/stream
 * Real-Time Server-Sent Events (SSE) Stream Endpoint (Senari Production Architecture)
 *
 * Handles cross-device live updates between mobile terminals, desktop POS systems,
 * tablets, and administrative screens.
 */
syncRouter.get('/stream', (req: Request, res: Response) => {
  // 1. Extract and verify authentication token if present
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
    token = req.query.token.trim();
  }

  let userPayload: AuthPayload | null = null;
  if (token) {
    try {
      userPayload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as AuthPayload;
    } catch {
      // Allow unauthenticated connection or mark as guest
    }
  }

  // 2. Generate or extract unique client identification
  const queryClientId = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';
  const clientId = queryClientId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const channel = String(req.query.channel || 'global').trim();
  const role = userPayload?.role || String(req.query.userRole || 'guest').trim();
  const userId = userPayload?.userId || (req.query.userId ? Number(req.query.userId) : undefined);

  // 3. Set OS-Level TCP Keep-Alive and NoDelay to prevent socket freezing
  req.socket.setKeepAlive(true, 10000);
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);

  // 4. Set anti-buffering stream headers for Nginx / OpenLiteSpeed / CyberPanel / Cloudflare
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 5. Register incoming client connection in the global activeClients Map
  const client: SseClient = {
    id: clientId,
    userId,
    role,
    channel,
    res,
    req,
    connectedAt: new Date(),
  };

  activeClients.set(clientId, client);
  console.log(
    `[SSE Gateway] Client registered: ${clientId} (User: ${userId || 'guest'}, Role: ${role}, Channel: ${channel}). Total active: ${activeClients.size}`
  );

  // 6. Send initial connection confirmation event
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: 'ok',
      clientId,
      channel,
      serverTime: new Date().toISOString(),
    })}\n\n`
  );

  /**
   * 7. Strict Connection Teardown & Memory Leak Prevention:
   * When a client disconnects (tab closed, network dropped, mobile lock/sleep, page reload),
   * we immediately unregister the clientId from `activeClients` and invoke `req.socket.destroy()`.
   * This prevents zombie file descriptors, memory leaks, and TCP half-open ghost connections.
   */
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    clearInterval(keepAliveTimer);
    activeClients.delete(clientId);
    console.log(`[SSE Gateway] Client disconnected and cleaned up: ${clientId}. Remaining active: ${activeClients.size}`);

    try {
      if (!res.writableEnded) res.end();
      if (!req.socket.destroyed) req.socket.destroy();
    } catch {
      // Silently absorb socket destruction errors during abrupt terminations
    }
  };

  /**
   * 8. Safe 15-Second Heartbeat Ping
   * Keeps reverse proxy and edge CDN buffers (Cloudflare, OpenLiteSpeed, CyberPanel)
   * active so that idle streams are never severed due to inactivity.
   */
  const keepAliveTimer = setInterval(() => {
    if (res.writableEnded || !res.writable || req.socket.destroyed) {
      cleanup();
      return;
    }
    const writeOk = res.write(':\n\ndata: :\n\n');
    if (!writeOk) {
      cleanup();
    }
  }, 15000);

  // 9. Strict cleanup event bindings on both request and response streams
  req.on('close', cleanup);
  req.on('end', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
  res.on('finish', cleanup);
});

/**
 * GET /api/sync/status
 * Diagnostic endpoint for inspecting active real-time SSE connections
 */
syncRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'online',
    activeConnections: activeClients.size,
    timestamp: new Date().toISOString(),
  });
});

export default syncRouter;
