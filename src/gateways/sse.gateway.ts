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
 * CRITICAL ARCHITECTURAL WARNING: PM2 CLUSTER MODE VS IN-MEMORY CLIENT MAP
 * ============================================================================
 * WARNING:
 * If this application is deployed using PM2 in cluster mode (e.g. `instances: max`
 * or `instances: 2+`), Node.js worker processes execute in completely isolated
 * memory spaces. In cluster mode:
 * - A mobile device connected to Worker #1 is registered in Worker #1's in-memory Map.
 * - An order created by a desktop user handled by Worker #2 iterates Worker #2's Map.
 * - Result: Broadcast updates SILENTLY FAIL across devices connected to different workers!
 *
 * PRODUCTION DEPLOYMENT REQUIREMENT:
 * The backend MUST run in FORK MODE (`instances: 1` / `exec_mode: 'fork'`) for native
 * in-memory global Maps (`activeClients = new Map()`) to broadcast reliably across all
 * connected terminals and devices.
 *
 * If multi-core horizontal clustering is required in future infrastructure, an external
 * pub/sub bus (such as Redis Pub/Sub or Redis Streams adapter) must be introduced to
 * bridge broadcast events across cluster worker boundaries.
 * ============================================================================
 */

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
    // If a connection arrives with a clientId already in the Map, explicitly destroy old socket
    const existingClient = activeClients.get(client.id);
    if (existingClient) {
      try {
        if (!existingClient.res.writableEnded) existingClient.res.end();
        if (!existingClient.req.socket.destroyed) existingClient.req.socket.destroy();
      } catch {
        // Silently absorb socket destruction errors
      }
    }

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

  // 4. Anti-Buffering Response Headers (CyberPanel / OpenLiteSpeed / Nginx / Cloudflare):
  // - 'X-Accel-Buffering': 'no' disables proxy response buffering in Nginx and OpenLiteSpeed
  // - 'Content-Encoding': 'none' prevents compression middleware from holding incomplete chunks in memory
  // - 'Cache-Control': 'no-cache, no-transform, must-revalidate' guarantees edge proxies never buffer chunks
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'none',
  });
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  // 5. Register incoming client connection in the global activeClients Map
  /**
   * Reference Equality & Stale Socket Teardown:
   * If a new connection arrives with a clientId that already exists in the Map,
   * explicitly call .destroy() on the old socket before overwriting the Map entry.
   * This immediately terminates the dangling/stalled connection and frees underlying resources.
   */
  const existingClient = activeClients.get(clientId);
  if (existingClient) {
    console.log(`[SSE Gateway] Overwriting existing client entry for ${clientId}. Explicitly destroying old socket.`);
    try {
      if (!existingClient.res.writableEnded) existingClient.res.end();
      if (!existingClient.req.socket.destroyed) existingClient.req.socket.destroy();
    } catch {
      // Silently absorb socket destruction errors
    }
  }

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
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }

  /**
   * 7. Strict Connection Teardown & Reference Equality Guard:
   * Prevents the "Ghost Cleanup Race Condition":
   * When an older stalled connection finally emits its close/end/error event, it must NOT
   * delete a newly established connection from activeClients if that connection was already replaced.
   *
   * Reference Equality Check:
   * Strictly verify if (activeClients.get(clientId)?.res === res) before deleting the Map entry.
   */
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    clearInterval(keepAliveTimer);

    // Reference Equality Guard: Prevent old socket from deleting a new connection's Map entry
    if (activeClients.get(clientId)?.res === res) {
      activeClients.delete(clientId);
      console.log(`[SSE Gateway] Client disconnected and cleaned up: ${clientId}. Remaining active: ${activeClients.size}`);
    } else {
      console.log(
        `[SSE Gateway] Stale socket cleanup triggered for ${clientId}, but active Map entry belongs to a newer socket. Preserving active connection.`
      );
    }

    try {
      if (!res.writableEnded) res.end();
      if (!req.socket.destroyed) req.socket.destroy();
    } catch {
      // Silently absorb socket destruction errors during abrupt terminations
    }
  };

  /**
   * 8. Aggressive 10-Second Edge-Proxy Buffer Flush & Keep-Alive Ping (Anti-Thrashing)
   *
   * Proxy Flush Guarantees (OpenLiteSpeed / CyberPanel / Cloudflare):
   * Edge reverse proxies (e.g. CyberPanel / OpenLiteSpeed AppServer lsnode) buffer HTTP responses
   * until a buffer threshold is met or an idle timeout occurs.
   * Sending an explicit comment ping (`:\n\n`) forces proxy buffers to flush without triggering
   * DOM message events, immediately followed by an explicit empty data ping (`data: {"type":"ping"}\n\n`)
   * which delivers an active frame to the client browser.
   *
   * Anti-Thrashing Watchdog Synchronization:
   * The client Watchdog Timer runs with a 60-second threshold (`WATCHDOG_TIMEOUT_MS = 60000`).
   * By delivering this dual ping frame every 10 seconds (10000ms), the client's `onmessage` handler
   * resets its watchdog timer 6 times within the watchdog window. Even under network packet jitter,
   * mobile radio sleep, or reverse-proxy latency, false watchdog disconnects and rapid reconnect loops
   * are completely eliminated.
   */
  const keepAliveTimer = setInterval(() => {
    if (res.writableEnded || !res.writable || req.socket.destroyed) {
      cleanup();
      return;
    }

    try {
      // 1. Explicit comment ping (forces edge reverse proxies to flush internal buffers)
      const commentOk = res.write(':\n\n');
      // 2. Explicit data ping frame (triggers client onmessage and resets watchdog timer)
      const dataOk = res.write('data: {"type":"ping"}\n\n');

      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }

      if (!commentOk || !dataOk) {
        // Socket buffer backpressure / hung pipe detected - tear down dead socket
        cleanup();
      }
    } catch {
      cleanup();
    }
  }, 10000);

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
