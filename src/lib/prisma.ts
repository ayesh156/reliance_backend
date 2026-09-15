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

const adapter = new PrismaMariaDb({
  host: parsedUrl.hostname,
  port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306,
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: parsedUrl.pathname.replace(/^\//, ''),
  connectionLimit: 5,   // Pool එකට max connections 5ක් (VPS RAM & MariaDB threads ආරක්ෂා කරගැනීමට)
  connectTimeout: 5000, // 5s connection timeout (endless waiting loops නැවැත්වීමට)
  idleTimeout: 60,      // 60s idle timeout
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
    console.log('✅ MariaDB Driver Adapter connected successfully (Max pool: 5)');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

export default prisma;