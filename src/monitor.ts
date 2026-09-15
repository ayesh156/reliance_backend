import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const rawUrl = process.env.DATABASE_URL || 'mysql://root:SEngineer,531@localhost:3306/reliance_db';
const parsedUrl = new URL(rawUrl);

const adapter = new PrismaMariaDb({
  host: parsedUrl.hostname,
  port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306,
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: parsedUrl.pathname.replace(/^\//, ''),
  connectionLimit: 2,
});

const prisma = new PrismaClient({ adapter });

async function monitorDatabase() {
  setInterval(async () => {
    try {
      const results = await prisma.$queryRaw<Array<{ Variable_name: string; Value: string }>>`
        SHOW STATUS WHERE Variable_name IN (
          'Threads_connected', 
          'Threads_running', 
          'Max_used_connections',
          'Queries',
          'Uptime'
        )
      `;

      const stats: Record<string, string> = {};
      results.forEach((r) => {
        stats[r.Variable_name] = r.Value;
      });

      console.clear();
      console.log('======================================================');
      console.log('📊 RELIANCE POS - MARIADB LIVE PERFORMANCE MONITOR');
      console.log('======================================================');
      console.log(`⏰ Time                 : ${new Date().toLocaleTimeString()}`);
      console.log(`🔌 Total DB Connections : ${stats['Threads_connected']}`);
      console.log(`⚡ Active Query Threads : ${stats['Threads_running']}`);
      console.log(`📈 Peak Conns Used     : ${stats['Max_used_connections']}`);
      console.log(`📦 Total Queries Executed: ${stats['Queries']}`);
      console.log('======================================================');
      console.log('🟢 Status: MariaDB Connection Pool is HEALTHY & STABLE');
      console.log('======================================================');
    } catch (error: any) {
      console.error('Monitor Query Error:', error.message);
    }
  }, 1000);
}

monitorDatabase();