import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env';

/**
 * Singleton Prisma client for Reliance POS & Inventory.
 * Uses MariaDB adapter with explicit connection pooling and timeout thresholds matching Senari standard.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// URL parsing for granular pool management on VPS
const rawUrl = env.databaseUrl || process.env.DATABASE_URL || 'mysql://root:@localhost:3306/reliance_db';
const parsedUrl = new URL(rawUrl);

// Optimized for Promotion Traffic: 4 workers x 10 conns = 40 max DB connections
const adapter = new PrismaMariaDb({
  host: parsedUrl.hostname,
  port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306,
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: parsedUrl.pathname.replace(/^\//, ''),
  connectionLimit: 10,   // Worker instance එකකට connections 10ක් (Promotion capacity boost)
  connectTimeout: 10000, // 10s connection wait threshold under high flash-sale bursts
  idleTimeout: 45,       // 45s idle release (reclaims unused threads back to MariaDB quickly)
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.isDevelopment ? ['query', 'warn', 'error'] : ['error'],
  });

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma;
}

// Database connection check helper with pool verification
export async function connectDB(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('✅ MariaDB Driver Adapter connected successfully (Worker Pool: 10)');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

export default prisma;