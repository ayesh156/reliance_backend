import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// ===================================
// ROBUST ENVIRONMENT LOADING (100% CWD & VPS Safe)
// Works cleanly in both CommonJS (tsc) and ESM/tsx runtime
// without triggering import.meta or __dirname compilation errors.
// ===================================
const rootDir = process.cwd();
const envPaths = [
  path.join(rootDir, '.env'),
  path.join(rootDir, 'backend', '.env'),
  path.resolve(rootDir, '..', '.env'),
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