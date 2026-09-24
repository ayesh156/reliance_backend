import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  if (process.env.ALLOW_DB_CLEAR !== 'true') {
    console.log('⚠️ Database clear skipped.');
    console.log('Set ALLOW_DB_CLEAR=true to explicitly allow clearing.');
    return;
  }

  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.category.deleteMany();

  console.log('✅ All data cleared');
}

main()
  .catch((error) => {
    console.error('❌ Clear failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });