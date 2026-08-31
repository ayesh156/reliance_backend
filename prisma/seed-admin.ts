import { PrismaClient, Role } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  const pw = await bcrypt.hash('Ayesh123', 12);
  await prisma.user.upsert({
    where: { email: 'ayesh@gmail.com' },
    update: { password: pw },
    create: { name: 'Ayesh', email: 'ayesh@gmail.com', password: pw, role: Role.ADMIN },
  });
  console.log('Admin user ayesh@gmail.com / Ayesh123 created');

  const pw2 = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { password: pw2 },
    create: { name: 'Admin', email: 'admin@example.com', password: pw2, role: Role.ADMIN },
  });
  console.log('Fallback admin admin@example.com / admin123 created');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });