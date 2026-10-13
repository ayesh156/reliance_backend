import { prisma } from '../src/lib/prisma.ts';
import { customerService } from '../src/services/customer.service.ts';

/**
 * Enterprise Balance Reconciliation Migration Script
 * Scans all customer records, compares stored outstandingBalance against true live active invoice debts,
 * and fixes all mismatches atomically.
 */
async function main() {
  console.log('--- STARTING CUSTOMER BALANCE RECONCILIATION MIGRATION ---');
  const result = await customerService.reconcileCustomerBalances();
  console.log(`Checked ${result.totalChecked} customers.`);
  console.log(`Reconciled ${result.reconciledCount} customers with mismatched balances:`);
  for (const item of result.reconciled) {
    console.log(`- Customer #${item.id} (${item.name}): Rs. ${item.oldBalance} -> Rs. ${item.newBalance}`);
  }

  // Verify Rathna Fashion specifically
  const rathna = await prisma.customer.findFirst({
    where: { name: { contains: 'Rathna' } },
    include: {
      orders: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, totalAmount: true, paidAmount: true, status: true },
      },
    },
  });

  if (rathna) {
    console.log('\nVerified Rathna Fashion:');
    console.log(`ID: ${rathna.id}, Name: ${rathna.name}`);
    console.log(`Stored outstandingBalance: Rs. ${rathna.outstandingBalance}`);
    console.log('Active Orders:');
    for (const o of rathna.orders) {
      console.log(`  Order #${o.id}: total=${o.totalAmount}, paid=${o.paidAmount}, due=${o.totalAmount - o.paidAmount}, status=${o.status}`);
    }
  }

  console.log('--- RECONCILIATION COMPLETED SUCCESSFULLY ---');
}

main()
  .catch((err) => {
    console.error('Reconciliation failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
