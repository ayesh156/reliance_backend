import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { parseAllowedOrigins } from './config/cors';
import { env } from './config/env';
import { MAX_JSON_BODY_SIZE } from './config/constants';
import apiRouter from './routes';
import errorMiddleware from './middleware/error.middleware';
import { connectDB } from './lib/prisma';
import { renderStatusPage } from './utils/statusPage';

// 🛡️ ==========================================================
// ZERO-CRASH PROCESS SHIELD (Senari Production Standard)
// Prevents entire server shutdown on dropped socket connections, client aborts, or broken pipes
// ==========================================================
process.on('uncaughtException', (err: any) => {
  if (
    err?.code === 'EPIPE' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ERR_STREAM_WRITE_AFTER_END' ||
    err?.code === 'ECANCELED' ||
    err?.message?.includes('write after end')
  ) {
    // Gracefully ignore closed client streams / broken sockets
    return;
  }
  console.error('[Process Shield] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Process Shield] Unhandled Rejection:', reason);
});

const app = express();

// NOTE: Robust multi-path .env loading (process.cwd(), backend/, __dirname)
// is handled inside `./config/env` at module load time — before this file's
// `env` import resolves — so CWD differences between tsx-dev, PM2 production
// runs, and Contabo VPS deployments are covered automatically.

const allowedOrigins = parseAllowedOrigins();

// ===================================
// 1. TRUST PROXY
// Required for accurate client IP resolution behind Nginx / CyberPanel /
// OpenLiteSpeed / Contabo VPS reverse proxies. Without this, rate limiters
// and logging will see the proxy IP instead of the real client IP.
// ===================================
app.set('trust proxy', 1);
console.log(
  `🔒 Trust proxy enabled (${env.isProduction ? 'production' : 'development'})`
);

// [FIX] Origin Header Cleaning Middleware (prevents CORS failures from reverse-proxy header comma splitting)
app.use((req, _res, next) => {
  const origin = req.headers.origin;
  if (origin && typeof origin === 'string' && origin.includes(',')) {
    req.headers.origin = origin.split(',')[0].trim();
  }
  next();
});

// ===================================
// 2. HEADER DE-DUPLICATION GUARD
// Prevents duplicate Access-Control-Allow-Origin / Vary headers caused by
// Nginx / CyberPanel / LiteSpeed + Express both adding them. Intercepts
// res.writeHead to collapse any duplicated header values into a single
// trimmed string before flushing headers to the client.
// ===================================
app.use((_req, res, next) => {
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function (this: typeof res, statusCode: number, ...args: any[]) {
    const dedupe = (name: string) => {
      const val = res.getHeader(name);
      if (val) {
        const first = Array.isArray(val)
          ? String(val[0])
          : String(val).split(',')[0];
        res.setHeader(name, first.trim());
      }
    };
    dedupe('Access-Control-Allow-Origin');
    dedupe('Vary');
    return originalWriteHead.call(this, statusCode, ...args);
  } as typeof res.writeHead;
  next();
});

// ===================================
// 3. REQUEST ID TRACING
// Attaches a unique requestId to every request (existing x-request-id
// header, otherwise a fresh random UUID) for tracing and logging.
// ===================================
app.use((req, _res, next) => {
  req.requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
  next();
});

// ===================================
// 4. SECURITY HEADERS (HELMET) - Senari Production Pattern
// ===================================
app.use(
  helmet({
    contentSecurityPolicy: env.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: [
              "'self'",
              `http://localhost:${env.port}`,
              ...allowedOrigins,
            ],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: env.isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })
);

// ===================================
// 5. BULLETPROOF CORS CONFIGURATION (Senari Official Library Standard)
// Utilizes official cors() middleware with dynamic origin resolver and 24h preflight cache
// ===================================
const configuredAllowedOrigins = [
  'https://reliance.ecosystemlk.app',
  'https://api.reliance.ecosystemlk.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL || '',
  ...allowedOrigins,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser, server-to-server, or same-origin requests (no origin header)
      if (!origin) return callback(null, true);

      const cleanOrigin = origin.replace(/\/+$/, '');
      const isAllowed =
        configuredAllowedOrigins.some((item) => cleanOrigin === item.replace(/\/+$/, '')) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin) ||
        /\.ecosystemlk\.app$/i.test(cleanOrigin);

      if (isAllowed) {
        return callback(null, cleanOrigin);
      }

      // Safe Fallback: Echoes default domain instead of crashing with a 500 error
      return callback(null, 'https://reliance.ecosystemlk.app');
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'X-Requested-With',
      'Accept',
      'X-Request-ID',
      'Cache-Control',
      'Pragma',
      'Expires',
    ],
    exposedHeaders: ['Set-Cookie', 'X-Request-ID'],
    maxAge: 86400, // 24-hour preflight cache
  })
);

// ===================================
// 6. COMPRESSION (GZIP)
// Compresses responses > 1KB. MUST be registered BEFORE body parsers.
// ===================================
app.use(compression({ threshold: 1024 }));

// ===================================
// 7. BODY PARSERS
// ===================================
app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_JSON_BODY_SIZE }));

// ===================================
// 8. COOKIE PARSER (for refresh token cookies)
// ===================================
app.use(cookieParser());

// ===================================
// 9. ADDITIONAL SECURITY RESPONSE HEADERS
// ===================================
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (env.isProduction) {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }
  next();
});

// ===================================
// 10. STATIC FILE SERVING (UPLOADS)
// ===================================
const uploadsDir = path.join(process.cwd(), 'public/uploads');

app.use('/uploads', express.static(uploadsDir));
app.use('/api/uploads', express.static(uploadsDir));

// Static file fallback via fs.existsSync (handles non-express.static cases)
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsDir, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

app.use('/api/uploads', (req, res, next) => {
  const filePath = path.join(uploadsDir, req.path.replace(/^\/api\/uploads/, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

// ===================================
// 11. HEALTH CHECK — instant response, never opens a DB connection
// ===================================
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Reliance API is running',
    timestamp: new Date().toISOString(),
  });
});

// ===================================
// 12. API STATUS DASHBOARD (/api/test & /test)
// ===================================
app.get('/api/test', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const html = await renderStatusPage();
  res.status(200).send(html);
});

app.get('/test', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const html = await renderStatusPage();
  res.status(200).send(html);
});

// ===================================
// 13. CENTRALIZED API ROUTES
// ===================================
app.use('/api', apiRouter);

// ===================================
// 14. GLOBAL ERROR HANDLER (must be after all routes)
// ===================================
app.use(errorMiddleware);

// ===================================
// 15. SERVER INITIALIZATION & LIFECYCLE
// ===================================

/**
 * Verified server startup: Tests database connection pool before opening port.
 * Seamlessly binds to OpenLiteSpeed AppServer (lsnode) dynamic port/pipe or fallback port.
 */
async function startServer(): Promise<void> {
  try {
    await connectDB();

    // Prioritize OpenLiteSpeed/environment injected PORT (pipe or numeric), fallback to env.port
    const PORT = process.env.PORT || env.port || 3010;

    const server = app.listen(PORT, () => {
      console.log(`🚀 Reliance API running on port ${PORT}`);
      console.log(`🌐 Environment: ${env.nodeEnv}`);
      console.log(`📡 API available at http://localhost:${PORT}/api`);
      console.log(`📊 Status page at http://localhost:${PORT}/api/test`);
      console.log(`🩺 Health check at http://localhost:${PORT}/api/health`);
    });

    // 🛡️ OpenLiteSpeed / lsnode socket timeout configurations
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  } catch (error) {
    console.error('❌ Failed to start Reliance API due to database connection failure:', error);
    process.exit(1);
  }
}

startServer();

// 🌟 Required for OpenLiteSpeed appserver (lsnode) integration
export default app;