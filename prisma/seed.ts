import { PrismaClient, Role } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding minimal data...');

  const defaultPassword = await bcrypt.hash('Admin@123', 12);
  const repPassword = await bcrypt.hash('Rep@123', 12);
  const cashierPassword = await bcrypt.hash('Cashier@123', 12);

  // 1. Admin User
  await prisma.user.upsert({
    where: { email: 'ayesh@gmail.com' },
    update: {},
    create: {
      name: 'Ayesh Chathuranga',
      email: 'ayesh@gmail.com',
      password: defaultPassword,
      role: Role.ADMIN,
    },
  });

  // 2. Sales Rep (Wholesale)
  await prisma.user.upsert({
    where: { email: 'rep@reliance.lk' },
    update: {},
    create: {
      name: 'Sales Rep',
      email: 'rep@reliance.lk',
      password: repPassword,
      role: Role.REP,
    },
  });

  // 3. Cashier (Retail POS)
  await prisma.user.upsert({
    where: { email: 'cashier@reliance.lk' },
    update: {},
    create: {
      name: 'Cashier',
      email: 'cashier@reliance.lk',
      password: cashierPassword,
      role: Role.CASHIER,
    },
  });

  // 4. Default Main Categories (Dashboard එකේ select කරන්න ලේසි වෙන්න)
  const defaultCategories = ["Men's Wear", "Women's Wear", "Kids' Wear", "Accessories"];
  for (const name of defaultCategories) {
    const slug = name.toLowerCase().replace(/['\s]+/g, '-');
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name, slug, status: 'active' },
    });
  }

  console.log('Seeded Users and Default Categories successfully!');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });