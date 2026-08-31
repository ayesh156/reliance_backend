import { CorsOptions } from 'cors';
import { env } from './env';

/**
 * Build the list of allowed origins from the FRONTEND_URL env var.
 * When sitting behind a reverse proxy (Nginx / CyberPanel / OpenLiteSpeed),
 * the incoming `Origin` header may be a comma-separated list of origins
 * (e.g. "https://a.com, https://b.com"). We split on commas and trim so
 * the CORS middleware can match each origin independently.
 */
export function parseAllowedOrigins(): string[] {
  const raw = env.frontendUrl;
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Always allow common localhost dev ports so the storefront can
  // run on any Vite port during development.
  const suffixes = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
  for (const s of suffixes) {
    if (!origins.includes(s)) origins.push(s);
  }

  return origins;
}

/**
 * Normalise a possibly comma-separated origin header value
 * (or an array of them) into a clean array of origin strings.
 */
export function splitOriginHeader(origin: string | string[] | undefined): string[] {
  if (!origin) return [];
  if (Array.isArray(origin)) {
    return origin.flatMap((o) => o.split(',').map((s) => s.trim())).filter(Boolean);
  }
  return origin.split(',').map((o) => o.trim()).filter(Boolean);
}

/**
 * Dynamically resolve the CORS origin callback.
 * - If the request has an Origin header, we check it against the allowed
 *   list (after splitting any multi-origin header that proxies inject).
 * - If there is no Origin header (same-origin / curl / server-to-server),
 *   we allow the request.
 */
export const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    const allowed = parseAllowedOrigins();
    if (!origin) {
      // No Origin header (curl, server-to-server, same-origin) — allow.
      callback(null, true);
      return;
    }

    const incoming = splitOriginHeader(origin);
    const ok = incoming.some((o) => allowed.includes(o) || o === 'null');
    if (ok) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
};

export default corsOptions;