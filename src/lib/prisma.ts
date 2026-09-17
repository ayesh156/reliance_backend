import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error('❌ Critical Architecture Error: DATABASE_URL is missing in environment variables.');
}

// අනාගත Load Balancing සහ Spikes වලට මුහුණ දීම සඳහා URL එක මඟින්ම Native Params සැකසීම
const dbUrl = new URL(rawUrl);
dbUrl.searchParams.set('connection_limit', '5'); // උපරිම connections 5යි
dbUrl.searchParams.set('connect_timeout', '15'); // 15s handshake timeout
dbUrl.searchParams.set('pool_timeout', '15');    // 15s pool checkout timeout

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: dbUrl.toString(),
      },
    },
    // Heavy load එකකදී performance බැලීමට warnings පමණක් log කිරීම
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

// Worker processes recycle වීමේදී memory leaks වැළැක්වීම සඳහා අනිවාර්ය Singleton Cache කිරීම
globalForPrisma.prisma = prisma;

let isConnected = false;

export function isDbConnected(): boolean {
  return isConnected;
}

// Server crash වීම වළක්වන Graceful DB Connection Handler
export async function connectDB() {
  try {
    await prisma.$connect();
    isConnected = true;
    console.log(`✅ [${dbUrl.pathname.replace(/^\//, '')}] Prisma Native Engine connected successfully (Pool: 5, Timeout: 15s)`);
  } catch (error) {
    isConnected = false;
    console.error('❌ Database connection queue timeout or failure:', error);
  }
}

export default prisma;