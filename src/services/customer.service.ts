import { prisma } from '../lib/prisma.ts';
import { CustomerType } from '@prisma/client';
import { HttpException } from '../middleware/error.middleware.ts';
import { isValidSriLankanPhone, isValidSriLankanNIC } from '../utils/validators.ts';

export class CustomerService {
  /**
   * Fetch customers with connection pool protection, explicit projection, query limits,
   * and live dynamic debt reconciliation against active non-cancelled invoice ledgers.
   */
  async getCustomers(query?: string, type?: CustomerType) {
    const cleanQuery = query ? query.trim().slice(0, 100) : undefined;

    const customers = await prisma.customer.findMany({
      where: {
        isActive: true, // ⭐ Exclude archived customers
        ...(type ? { type } : {}),
        ...(cleanQuery
          ? {
              OR: [
                { name: { contains: cleanQuery } },
                { phone: { contains: cleanQuery } },
                { nic: { contains: cleanQuery } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        type: true,
        email: true,
        address: true,
        city: true,
        creditLimit: true,
        outstandingBalance: true,
        notes: true,
        nic: true,
        repId: true,
        createdAt: true,
        updatedAt: true,
        rep: {
          select: { id: true, name: true },
        },
        orders: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            totalAmount: true,
            paidAmount: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Reconcile and calculate live dynamic debt for each customer
    return customers.map((c) => {
      const liveDebt = c.orders.reduce(
        (sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0)),
        0
      );
      const reconciledDebt = Math.round(liveDebt * 100) / 100;
      const { orders: _orders, ...rest } = c;

      return {
        ...rest,
        outstandingBalance: reconciledDebt,
        totalOutstandingDue: reconciledDebt,
      };
    });
  }

  /**
   * Retrieve a single customer profile by primary key ID with live reconciled debt
   */
  async getCustomerById(id: number) {
    const customer = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: {
        rep: { select: { id: true, name: true } },
        orders: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true,
            source: true,
            createdAt: true,
          },
        },
      },
    });

    if (!customer) {
      throw new HttpException(404, 'Customer record not found');
    }

    const allActiveOrders = await prisma.order.findMany({
      where: { customerId: Number(id), status: { not: 'CANCELLED' } },
      select: { totalAmount: true, paidAmount: true },
    });

    const liveDebt = allActiveOrders.reduce(
      (sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0)),
      0
    );
    const reconciledDebt = Math.round(liveDebt * 100) / 100;

    // Atomically fix stored balance if mismatched
    if (Math.abs((Number(customer.outstandingBalance) || 0) - reconciledDebt) > 0.01) {
      await prisma.customer.update({
        where: { id: Number(id) },
        data: { outstandingBalance: reconciledDebt },
      });
    }

    return {
      ...customer,
      outstandingBalance: reconciledDebt,
      totalOutstandingDue: reconciledDebt,
    };
  }

  /**
   * Create a new retail or wholesale customer with duplicate phone validation
   */
  async createCustomer(data: {
    name: string;
    phone: string;
    type?: CustomerType;
    email?: string;
    address?: string;
    city?: string;
    creditLimit?: number;
    outstandingBalance?: number;
    notes?: string;
    nic?: string;
    repId?: number;
  }) {
    const cleanPhone = data.phone.trim();
    if (!data.name.trim() || !cleanPhone) {
      throw new HttpException(400, 'Customer name and phone number are required');
    }

    // Validate Sri Lankan phone number format
    if (!isValidSriLankanPhone(cleanPhone)) {
      throw new HttpException(400, 'Invalid Sri Lankan phone number (Use 07XXXXXXXX, 0XXXXXXXXX, or +94...)');
    }

    // Validate Sri Lankan NIC if provided
    if (data.nic && data.nic.trim()) {
      if (!isValidSriLankanNIC(data.nic.trim())) {
        throw new HttpException(400, 'Invalid Sri Lankan NIC (Requires 9 digits + V/X or 12 digits)');
      }
    }

    const existing = await prisma.customer.findUnique({
      where: { phone: cleanPhone },
      select: { id: true },
    });

    if (existing) {
      throw new HttpException(400, `A customer with phone ${cleanPhone} already exists`);
    }

    // Email format validation
    let cleanEmail: string | null = null;
    if (data.email && data.email.trim()) {
      cleanEmail = data.email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        throw new HttpException(400, 'Invalid customer email address format');
      }
    }

    const sanitizedCreditLimit = Math.max(0, Number(data.creditLimit) || 0);
    const sanitizedOutstandingBalance = Number(data.outstandingBalance) || 0;

    return prisma.customer.create({
      data: {
        name: data.name.trim().slice(0, 100),
        phone: cleanPhone,
        type: data.type || CustomerType.RETAIL,
        email: cleanEmail,
        address: data.address?.trim() ? data.address.trim().slice(0, 255) : null,
        city: data.city?.trim() ? data.city.trim().slice(0, 100) : null,
        creditLimit: sanitizedCreditLimit,
        outstandingBalance: sanitizedOutstandingBalance,
        notes: data.notes?.trim() ? data.notes.trim().slice(0, 500) : null,
        nic: data.nic?.trim() ? data.nic.trim().slice(0, 20) : null,
        repId: data.repId && !isNaN(Number(data.repId)) && Number(data.repId) > 0 ? Number(data.repId) : null,
      },
    });
  }

  /**
   * Update an existing customer profile details and credit configuration
   */
  async updateCustomer(
    id: number,
    data: {
      name?: string;
      phone?: string;
      type?: CustomerType;
      email?: string;
      address?: string;
      city?: string;
      creditLimit?: number;
      outstandingBalance?: number;
      notes?: string;
      nic?: string;
      repId?: number;
    }
  ) {
    const customer = await prisma.customer.findUnique({ where: { id: Number(id) } });
    if (!customer) {
      throw new HttpException(404, 'Customer record not found');
    }

    if (data.phone && data.phone.trim() !== customer.phone) {
      const cleanPhone = data.phone.trim();
      if (!isValidSriLankanPhone(cleanPhone)) {
        throw new HttpException(400, 'Invalid Sri Lankan phone number');
      }

      const duplicate = await prisma.customer.findUnique({
        where: { phone: cleanPhone },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpException(400, `Phone number ${cleanPhone} is already used`);
      }
    }

    // Update එකේදී email validate කිරීම
    let updatedEmail: string | null | undefined = undefined;
    if (data.email !== undefined) {
      if (data.email && data.email.trim()) {
        const val = data.email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          throw new HttpException(400, 'Invalid customer email address format');
        }
        updatedEmail = val;
      } else {
        updatedEmail = null;
      }
    }

    const updatedCreditLimit = data.creditLimit !== undefined
      ? Math.max(0, Number(data.creditLimit) || 0)
      : undefined;

    let updatedOutstandingBalance = data.outstandingBalance !== undefined
      ? Number(data.outstandingBalance) || 0
      : undefined;

    // Financial Safety Guard: prevent accidental zero-overwrites from wiping active invoice debt
    if (updatedOutstandingBalance !== undefined) {
      const activeDebtOrders = await prisma.order.findMany({
        where: { customerId: Number(id), status: { not: 'CANCELLED' } },
        select: { totalAmount: true, paidAmount: true },
      });
      const computedInvoiceDebt = activeDebtOrders.reduce(
        (sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0)),
        0
      );
      if (computedInvoiceDebt > 0 && updatedOutstandingBalance < computedInvoiceDebt) {
        updatedOutstandingBalance = Math.round(computedInvoiceDebt * 100) / 100;
      }
    }

    return prisma.customer.update({
      where: { id: Number(id) },
      data: {
        ...(data.name ? { name: data.name.trim().slice(0, 100) } : {}),
        ...(data.phone ? { phone: data.phone.trim() } : {}),
        ...(data.type ? { type: data.type } : {}),
        email: updatedEmail,
        address: data.address !== undefined ? (data.address ? data.address.trim().slice(0, 255) : null) : undefined,
        city: data.city !== undefined ? (data.city ? data.city.trim().slice(0, 100) : null) : undefined,
        creditLimit: updatedCreditLimit,
        ...(updatedOutstandingBalance !== undefined ? { outstandingBalance: updatedOutstandingBalance } : {}),
        notes: data.notes !== undefined ? (data.notes ? data.notes.trim().slice(0, 500) : null) : undefined,
        nic: data.nic !== undefined ? (data.nic ? data.nic.trim().slice(0, 20) : null) : undefined,
        repId: data.repId !== undefined ? (data.repId && !isNaN(Number(data.repId)) && Number(data.repId) > 0 ? Number(data.repId) : null) : undefined,
      },
    });
  }

  /**
   * Reconcile customer outstanding balances with actual active invoice debts.
   * Updates any customer whose stored outstandingBalance does not match the sum of open invoices (creditDue > 0).
   */
  async reconcileCustomerBalances(customerId?: number) {
    const whereClause = {
      ...(customerId ? { id: Number(customerId) } : {}),
      isActive: true,
    };

    const customers = await prisma.customer.findMany({
      where: whereClause,
      include: {
        orders: {
          where: { status: { not: 'CANCELLED' } },
          select: { totalAmount: true, paidAmount: true },
        },
      },
    });

    const reconciled: Array<{ id: number; name: string; oldBalance: number; newBalance: number }> = [];

    for (const c of customers) {
      const liveDebt = c.orders.reduce(
        (sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0)),
        0
      );
      const roundedDebt = Math.round(liveDebt * 100) / 100;
      const storedDebt = Number(c.outstandingBalance) || 0;

      if (Math.abs(storedDebt - roundedDebt) > 0.01) {
        await prisma.customer.update({
          where: { id: c.id },
          data: { outstandingBalance: roundedDebt },
        });
        reconciled.push({
          id: c.id,
          name: c.name,
          oldBalance: storedDebt,
          newBalance: roundedDebt,
        });
      }
    }

    return {
      success: true,
      totalChecked: customers.length,
      reconciledCount: reconciled.length,
      reconciled,
    };
  }

  /**
   * Delete customer record after verifying zero active debt and relational audit history
   */
  async deleteCustomer(id: number) {
    const customer = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: {
        orders: {
          select: {
            id: true,
            totalAmount: true,
            paidAmount: true,
            status: true,
          },
        },
      },
    });

    if (!customer) {
      throw new HttpException(404, 'Customer record not found');
    }

    // Financial Guard: Check if unpaid credit exists
    const activeDebt = customer.orders.reduce((sum, o) => {
      if (o.status === 'CANCELLED') return sum;
      return sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.paidAmount) || 0));
    }, 0);

    if (activeDebt > 0.01) {
      throw new HttpException(400, `Cannot delete customer with outstanding debt of Rs. ${activeDebt.toFixed(2)}`);
    }

    // Orders තිබේ නම් (Debt = 0 අවස්ථාවේදී) customer deactivate කර list එකෙන් hide කිරීම
    if (customer.orders.length > 0) {
      await prisma.customer.update({
        where: { id: Number(id) },
        data: { isActive: false },
      });
      return { success: true, message: 'Customer archived and hidden from directory.' };
    }

    await prisma.customer.delete({ where: { id: Number(id) } });
    return { success: true, message: 'Customer deleted successfully.' };
  }
}

export const customerService = new CustomerService();