import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// ===================================
// ROBUST ENVIRONMENT LOADING
// ===================================
// Try multiple .env paths to handle tsx (dev), production builds, and
// Contabo VPS / CyberPanel deployment scenarios where CWD may differ
// from the project root. This runs at module load time — BEFORE the
// `env` object below is constructed — so values are always resolved
// from the correct .env file regardless of execution scope.
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'backend', '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
];

let loadedEnvPath: string | null = null;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`📁 Loading .env from: ${envPath}`);
    dotenv.config({ path: envPath });
    loadedEnvPath = envPath;
    break;
  }
}

if (!loadedEnvPath) {
  console.warn('⚠️  No .env file found. Using default environment values.');
}

/**
 * Strongly-typed environment configuration.
 * Centralizes all .env parsing so the rest of the app
 * never reads `process.env` directly.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5174',
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'reliance-jwt-secret-change-in-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'reliance-jwt-refresh-secret-change-in-production',
  accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || '24h',
  refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  isDevelopment: (process.env.NODE_ENV || 'development') !== 'production',
} as const;

export default env;