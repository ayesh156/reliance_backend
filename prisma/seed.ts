import { PrismaClient, Role, CustomerType } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Standard Direct Prisma Client instance
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Database Seeding Process for Reliance Suite...');

  // ----------------------------------------------------
  // 1. SEED DEFAULT ADMIN USER
  // ----------------------------------------------------
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@reliance.lk';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: Role.ADMIN,
      active: true,
    },
    create: {
      name: 'Super Administrator',
      email: adminEmail,
      phone: '0771234567',
      password: hashedPassword,
      role: Role.ADMIN,
      active: true,
    },
  });
  console.log(`✅ Admin User Ready: ${adminUser.email}`);

  // ----------------------------------------------------
  // 2. SEED DEFAULT WALK-IN POS CUSTOMER
  // ----------------------------------------------------
  const defaultCustomer = await prisma.customer.upsert({
    where: { phone: '0000000000' },
    update: {},
    create: {
      type: CustomerType.RETAIL,
      name: 'Walk-in Customer (General POS)',
      phone: '0000000000',
      email: 'pos.walkin@reliance.lk',
      address: 'Main Store Counter',
      city: 'Colombo',
      outstandingBalance: 0,
      creditLimit: 0,
      notes: 'Default walk-in retail buyer for instant cashier checkout',
    },
  });
  console.log(`✅ Default POS Customer Ready: ID #${defaultCustomer.id}`);

  // ----------------------------------------------------
  // 3. SEED GARMENT CATEGORIES
  // ----------------------------------------------------
  const categories = [
    { name: "Men's Wear", slug: 'mens-wear', description: 'Shirts, Trousers, T-shirts and Casual wear for men' },
    { name: "Women's Wear", slug: 'womens-wear', description: 'Dresses, Tops, Skirts, and Denim collection for women' },
    { name: 'Denim Collection', slug: 'denim-collection', description: 'Premium stretch jeans and cargo denim' },
    { name: 'Casual T-Shirts', slug: 'casual-tshirts', description: 'Cotton crew-neck and polo t-shirts' },
    { name: 'Accessories', slug: 'accessories', description: 'Belts, caps and garment accessories' },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: {
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        status: 'active',
      },
    });
  }
  console.log('✅ Garment Categories Seeded (5 categories)');

  // ----------------------------------------------------
  // 4. SEED STANDARD SIZES
  // ----------------------------------------------------
  const standardSizes = [
    { name: 'FREE', order: 1 },
    { name: 'XS', order: 2 },
    { name: 'S', order: 3 },
    { name: 'M', order: 4 },
    { name: 'L', order: 5 },
    { name: 'XL', order: 6 },
    { name: '2XL', order: 7 },
    { name: '3XL', order: 8 },
    { name: '28', order: 9 },
    { name: '30', order: 10 },
    { name: '32', order: 11 },
    { name: '34', order: 12 },
    { name: '36', order: 13 },
  ];

  for (const size of standardSizes) {
    await prisma.size.upsert({
      where: { name: size.name },
      update: { order: size.order },
      create: { name: size.name, order: size.order },
    });
  }
  console.log('✅ Standard Sizes Seeded (13 sizes)');

  // ----------------------------------------------------
  // 5. SEED STANDARD COLORS
  // ----------------------------------------------------
  const standardColors = [
    { name: 'Default', hexCode: '#94a3b8' },
    { name: 'Black', hexCode: '#000000' },
    { name: 'White', hexCode: '#FFFFFF' },
    { name: 'Navy Blue', hexCode: '#0f172a' },
    { name: 'Denim Blue', hexCode: '#1e40af' },
    { name: 'Sky Blue', hexCode: '#38bdf8' },
    { name: 'Dark Grey', hexCode: '#334155' },
    { name: 'Light Grey', hexCode: '#cbd5e1' },
    { name: 'Olive Green', hexCode: '#3f6212' },
    { name: 'Maroon', hexCode: '#881337' },
  ];

  for (const color of standardColors) {
    await prisma.color.upsert({
      where: { name: color.name },
      update: { hexCode: color.hexCode },
      create: { name: color.name, hexCode: color.hexCode },
    });
  }
  console.log('✅ Standard Garment Colors Seeded (10 colors)');

  // ----------------------------------------------------
  // 6. SEED MAJOR CITIES & SHIPPING CHARGES
  // ----------------------------------------------------
  const cities = [
    { name: 'Colombo 01-15', province: 'Western', shippingFee: 350 },
    { name: 'Gampaha', province: 'Western', shippingFee: 400 },
    { name: 'Kalutara', province: 'Western', shippingFee: 400 },
    { name: 'Kandy', province: 'Central', shippingFee: 450 },
    { name: 'Galle', province: 'Southern', shippingFee: 450 },
    { name: 'Matara', province: 'Southern', shippingFee: 450 },
    { name: 'Kurunegala', province: 'North Western', shippingFee: 450 },
  ];

  for (const city of cities) {
    await prisma.city.upsert({
      where: { name: city.name },
      update: { shippingFee: city.shippingFee },
      create: city,
    });
  }
  console.log('✅ Major Delivery Cities Seeded (7 locations)');

  // ----------------------------------------------------
  // 7. SEED STOREFRONT SETTINGS
  // ----------------------------------------------------
  const settings = [
    { key: 'STORE_NAME', value: 'Reliance Retail & Wholesale Suite' },
    { key: 'STORE_PHONE', value: '0771234567' },
    { key: 'STORE_ADDRESS', value: 'No. 123, Main Street, Colombo, Sri Lanka' },
    { key: 'CURRENCY_SYMBOL', value: 'Rs.' },
  ];

  for (const s of settings) {
    await prisma.storefrontSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log('✅ Storefront Base Configuration Seeded');

  console.log('🎉 Database Seeding Completed Successfully with Zero Errors!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding Fatal Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });