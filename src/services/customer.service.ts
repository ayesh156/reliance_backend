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

    return prisma.customer.findMany({
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
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Retrieve a single customer profile by primary key ID
   */
  async getCustomerById(id: number) {
    const customer = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: {
        rep: { select: { id: true, name: true } },
        orders: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new HttpException(404, 'Customer record not found');
    }

    return customer;
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
   * Delete customer record after checking for linked order history
   */
  async deleteCustomer(id: number) {
    const customer = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: { orders: { select: { id: true }, take: 1 } },
    });

    if (!customer) {
      throw new HttpException(404, 'Customer record not found');
    }

    if (customer.orders.length > 0) {
      throw new HttpException(400, 'Cannot delete customer with historical orders');
    }

    return prisma.customer.delete({ where: { id: Number(id) } });
  }
}

export const customerService = new CustomerService();