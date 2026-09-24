import { prisma } from '../lib/prisma.ts';
import { CustomerType } from '@prisma/client';
import { HttpException } from '../middleware/error.middleware.ts';
import { isValidSriLankanPhone, isValidSriLankanNIC } from '../utils/validators.ts';

export class CustomerService {
  /**
   * Fetch customers with connection pool protection, explicit projection, and query limits
   */
  async getCustomers(query?: string, type?: CustomerType) {
    const cleanQuery = query ? query.trim().slice(0, 100) : undefined;

    // Fetch customers with active non-cancelled order balances
    const customers = await prisma.customer.findMany({
      where: {
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
        notes: true,
        nic: true,
        repId: true,
        createdAt: true,
        updatedAt: true,
        rep: {
          select: { id: true, name: true },
        },
        // Fetch active non-cancelled order balances to eliminate financial drift
        orders: {
          where: {
            status: { not: 'CANCELLED' },
          },
          select: {
            totalAmount: true,
            paidAmount: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Compute live aggregated outstanding debt per customer
    return customers.map((c) => {
      const liveDueAmount = c.orders.reduce((sum, order) => {
        const total = Number(order.totalAmount) || 0;
        const paid = Number(order.paidAmount) || 0;
        return sum + Math.max(0, total - paid);
      }, 0);

      const { orders, ...safeCustomer } = c;
      return {
        ...safeCustomer,
        outstandingBalance: Math.round(liveDueAmount * 100) / 100,
      };
    });
  }

  /**
   * Retrieve a single customer profile by primary key ID with live aggregated debt
   */
  async getCustomerById(id: number) {
    const customer = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: {
        rep: { select: { id: true, name: true } },
        orders: {
          take: 10,
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

    // Dynamic debt calculation from non-cancelled orders
    const liveDueAmount = customer.orders.reduce((sum, order) => {
      if (order.status === 'CANCELLED') return sum;
      const total = Number(order.totalAmount) || 0;
      const paid = Number(order.paidAmount) || 0;
      return sum + Math.max(0, total - paid);
    }, 0);

    return {
      ...customer,
      outstandingBalance: Math.round(liveDueAmount * 100) / 100,
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

    // Negative credit limit වැළැක්වීම සහ strings sanitize කිරීම
    const sanitizedCreditLimit = Math.max(0, Number(data.creditLimit) || 0);

    return prisma.customer.create({
      data: {
        name: data.name.trim().slice(0, 100),
        phone: cleanPhone,
        type: data.type || CustomerType.RETAIL,
        email: cleanEmail,
        address: data.address?.trim() ? data.address.trim().slice(0, 255) : null,
        city: data.city?.trim() ? data.city.trim().slice(0, 100) : null,
        creditLimit: sanitizedCreditLimit,
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

    // Credit limit එක negative වීම වැළැක්වීම
    const updatedCreditLimit = data.creditLimit !== undefined
      ? Math.max(0, Number(data.creditLimit) || 0)
      : undefined;

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
        notes: data.notes !== undefined ? (data.notes ? data.notes.trim().slice(0, 500) : null) : undefined,
        nic: data.nic !== undefined ? (data.nic ? data.nic.trim().slice(0, 20) : null) : undefined,
        repId: data.repId !== undefined ? (data.repId && !isNaN(Number(data.repId)) && Number(data.repId) > 0 ? Number(data.repId) : null) : undefined,
      },
    });
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

    if (customer.orders.length > 0) {
      throw new HttpException(400, 'Cannot delete customer with historical orders (Financial Audit Trail Protection)');
    }

    return prisma.customer.delete({ where: { id: Number(id) } });
  }
}

export const customerService = new CustomerService();