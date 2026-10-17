import { Router, type Request, type Response } from 'express';
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
  channel: string;
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
 * Enterprise Server-Sent Events (SSE) Synchronization Gateway
 * Adapted from high-reliability checkoutSync gateway architecture.
 *
 * Key Resilience Features:
 * 1. OS-Level TCP Keep-Alive and NoDelay to prevent dropped sockets through firewalls/proxies.
 * 2. Unbuffered SSE streaming headers ('X-Accel-Buffering: no') for Nginx / OpenLiteSpeed / CyberPanel compatibility.
 * 3. Dead socket detection with backpressure monitoring and proactive kernel socket destruction.
 * 4. Automatic 15-second heartbeat ping with immediate disconnect cleanup to prevent edge reverse proxy timeouts.
 * 5. Memory-leak-proof client tracking with automatic channel cleanup.
 */
export class SseGateway {
  private clients = new Map<string, SseClient>();
  private channels = new Map<string, Set<string>>();

  /**
   * Register a new client connection into the SSE gateway
   */
  public registerClient(client: SseClient): void {
    this.clients.set(client.id, client);

    if (!this.channels.has(client.channel)) {
      this.channels.set(client.channel, new Set());
    }
    this.channels.get(client.channel)!.add(client.id);

    console.log(`[SSE Gateway] Client connected: ${client.id} (User: ${client.userId || 'guest'}, Role: ${client.role || 'unknown'}, Channel: ${client.channel}). Total active: ${this.clients.size}`);
  }

  /**
   * Unregister and clean up a client connection from active tracking
   */
  public removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const channelSet = this.channels.get(client.channel);
    if (channelSet) {
      channelSet.delete(clientId);
      if (channelSet.size === 0) {
        this.channels.delete(client.channel);
      }
    }

    this.clients.delete(clientId);
    console.log(`[SSE Gateway] Client disconnected: ${clientId}. Total active: ${this.clients.size}`);
  }

  /**
   * Broadcast an event and payload to connected SSE clients with dead socket elimination
   */
  public broadcast(event: string, payload: any, options: BroadcastOptions = {}): void {
    const targetChannel = options.channel || 'global';
    const dataString = `data: ${JSON.stringify({ event, payload, timestamp: new Date().toISOString() })}\n\n`;
    const deadClientIds: string[] = [];

    // Identify target clients
    const targetClientIds = targetChannel === 'global'
      ? Array.from(this.clients.keys())
      : Array.from(this.channels.get(targetChannel) || []);

    for (const clientId of targetClientIds) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      // Exclude sender if requested
      if (options.senderClientId && client.id === options.senderClientId) {
        continue;
      }

      // Filter by role if specified
      if (options.roles && options.roles.length > 0) {
        const clientRole = (client.role || '').toUpperCase();
        const matchesRole = options.roles.some((r) => r.toUpperCase() === clientRole);
        if (!matchesRole) continue;
      }

      try {
        if (client.res.writableEnded || !client.res.writable) {
          deadClientIds.push(clientId);
          continue;
        }

        const canWrite = client.res.write(dataString);
        if (!canWrite) {
          // Socket buffer backpressure / network pipe hung - mark for cleanup
          deadClientIds.push(clientId);
        }
      } catch (err) {
        console.error(`[SSE Gateway] Error writing to client ${clientId}:`, err);
        deadClientIds.push(clientId);
      }
    }

    // Clean up dead sockets identified during broadcast
    if (deadClientIds.length > 0) {
      for (const id of deadClientIds) {
        const deadClient = this.clients.get(id);
        if (deadClient) {
          try {
            if (!deadClient.res.writableEnded) deadClient.res.end();
            deadClient.req.socket.destroy();
          } catch {
            // ignore socket destruction errors
          }
        }
        this.removeClient(id);
      }
    }
  }

  /**
   * Live Broadcast Helpers for Order and Invoice Lifecycle Events
   */
  public broadcastOrderCreated(order: any, senderClientId?: string): void {
    this.broadcast('order_created', order, { senderClientId });
  }

  public broadcastOrderUpdated(order: any, senderClientId?: string): void {
    this.broadcast('order_updated', order, { senderClientId });
  }

  public broadcastOrderDeleted(orderId: number, senderClientId?: string): void {
    this.broadcast('order_deleted', { id: orderId, orderId }, { senderClientId });
  }

  public broadcastInvoiceCreated(invoice: any, senderClientId?: string): void {
    this.broadcast('invoice_created', invoice, { senderClientId });
  }

  public broadcastInvoiceUpdated(invoice: any, senderClientId?: string): void {
    this.broadcast('invoice_updated', invoice, { senderClientId });
  }

  public broadcastInvoiceDeleted(invoiceId: number, senderClientId?: string): void {
    this.broadcast('invoice_deleted', { id: invoiceId, invoiceId }, { senderClientId });
  }

  /**
   * Returns current active connection count
   */
  public getActiveCount(): number {
    return this.clients.size;
  }
}

export const sseGateway = new SseGateway();

export const syncRouter = Router();

/**
 * GET /api/sync/stream
 * Freeze-proof real-time Server-Sent Events stream endpoint
 */
syncRouter.get('/stream', (req: Request, res: Response) => {
  // 1. Extract and optionally verify token
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
      // Allow unauthenticated connection or mark as guest, or return 401 if token expired
    }
  }

  const clientId = String(req.query.clientId || Math.random().toString(36).slice(2) + Date.now().toString(36)).trim();
  const channel = String(req.query.channel || 'global').trim();
  const role = userPayload?.role || String(req.query.userRole || 'guest').trim();
  const userId = userPayload?.userId || (req.query.userId ? Number(req.query.userId) : undefined);

  // 2. Set OS-Level TCP Keep-Alive and NoDelay to prevent socket freezing
  req.socket.setKeepAlive(true, 10000);
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);

  // 3. Set anti-buffering stream headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const client: SseClient = {
    id: clientId,
    userId,
    role,
    channel,
    res,
    req,
    connectedAt: new Date(),
  };

  sseGateway.registerClient(client);

  // 4. Send initial connection confirmation event
  res.write(
    `data: ${JSON.stringify({
      event: 'connected',
      payload: {
        status: 'ok',
        clientId,
        channel,
        serverTime: new Date().toISOString(),
      },
    })}\n\n`
  );

  // 5. Cleanup function ensuring socket destruction at OS level
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    clearInterval(keepAliveTimer);
    sseGateway.removeClient(clientId);

    try {
      if (!res.writableEnded) res.end();
      req.socket.destroy();
    } catch {
      // ignore destruction errors
    }
  };

  /**
   * 6. Safe Server Heartbeat: 15-Second Ping & Watchdog Synchronization
   *
   * Reverse Proxy & Edge CDN Keep-Alive:
   * Aggressive edge reverse proxies (Cloudflare has a 100s HTTP idle timeout; OpenLiteSpeed
   * and CyberPanel default to 30-60s timeouts) terminate idle HTTP streams if zero bytes
   * are transmitted over the connection. Broadcasting an SSE ping comment (`:\n\n`) every
   * 15 seconds keeps proxy buffers active and guarantees the HTTP stream is never severed
   * due to inactivity.
   *
   * Watchdog Synchronization & TCP Half-Open Recovery:
   * Under standard W3C EventSource specifications, pure comment lines (`:\n\n`) are
   * stripped by browser networking layers and do not fire JavaScript `onmessage` handlers.
   * To ensure client-side watchdog timers (`WATCHDOG_TIMEOUT_MS = 35000`) continuously
   * receive liveness pulses even during zero-business-traffic intervals, we bundle both
   * the reverse-proxy comment (`:\n\n`) and a lightweight heartbeat data frame (`data: :\n\n`).
   *
   * Dead Socket Detection & Backpressure Cleanup:
   * If an idle client experiences an ungraceful disconnect (TCP half-open, Wi-Fi handover,
   * mobile device sleep), the local socket buffer will quickly saturate. `res.write()`
   * will return `false`, immediately triggering socket teardown and kernel resource disposal.
   */
  const keepAliveTimer = setInterval(() => {
    if (res.writableEnded || !res.writable) {
      cleanup();
      return;
    }
    const writeOk = res.write(':\n\ndata: :\n\n');
    if (!writeOk) {
      cleanup();
    }
  }, 15000);

  // 7. Socket and response disconnect listeners
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
    activeConnections: sseGateway.getActiveCount(),
    timestamp: new Date().toISOString(),
  });
});

export default syncRouter;
