import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Standard Direct Prisma Client connection without external driver adapters
const prisma = new PrismaClient();

async function seedAdmin() {
  console.log('🛡️  Seeding Super Admin User...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@reliance.lk';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';

  // Check if admin already exists to prevent duplicate key violations
  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: adminEmail },
        { role: Role.ADMIN }
      ]
    }
  });

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  if (existingAdmin) {
    console.log(`ℹ️  Admin user already exists with email: ${existingAdmin.email}. Updating role and credentials...`);
    const updated = await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        role: Role.ADMIN,
        active: true,
        password: hashedPassword,
      }
    });
    console.log(`✅ Admin updated successfully: ID #${updated.id} (${updated.email})`);
  } else {
    const newAdmin = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        phone: '0770000000',
        password: hashedPassword,
        role: Role.ADMIN,
        active: true,
      }
    });
    console.log(`✅ Super Admin created successfully: ID #${newAdmin.id} (${newAdmin.email})`);
  }
}

seedAdmin()
  .catch((error) => {
    console.error('❌ Error seeding admin:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });