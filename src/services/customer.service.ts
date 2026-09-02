import { prisma } from '../lib/prisma';
import { CustomerType } from '@prisma/client';
import { HttpException } from '../middleware/error.middleware';
import { isValidSriLankanPhone, isValidSriLankanNIC } from '../utils/validators';

export class CustomerService {
  /**
   * Fetch all customers with optional search keyword and customer type filtering
   */
  async getCustomers(query?: string, type?: CustomerType) {
    return prisma.customer.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query } },
                { phone: { contains: query } },
                { nic: { contains: query } },
              ],
            }
          : {}),
      },
      include: {
        rep: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
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
    });

    if (existing) {
      throw new HttpException(400, `A customer with phone ${cleanPhone} already exists`);
    }

    return prisma.customer.create({
      data: {
        name: data.name.trim(),
        phone: cleanPhone,
        type: data.type || CustomerType.RETAIL,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        city: data.city?.trim() || null,
        creditLimit: Number(data.creditLimit) || 0,
        notes: data.notes?.trim() || null,
        nic: data.nic?.trim() || null,
        repId: data.repId ? Number(data.repId) : null,
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
      const duplicate = await prisma.customer.findUnique({
        where: { phone: data.phone.trim() },
      });
      if (duplicate) {
        throw new HttpException(400, `Phone number ${data.phone.trim()} is already used`);
      }
    }

    return prisma.customer.update({
      where: { id: Number(id) },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.phone ? { phone: data.phone.trim() } : {}),
        ...(data.type ? { type: data.type } : {}),
        email: data.email !== undefined ? (data.email ? data.email.trim() : null) : undefined,
        address: data.address !== undefined ? (data.address ? data.address.trim() : null) : undefined,
        city: data.city !== undefined ? (data.city ? data.city.trim() : null) : undefined,
        creditLimit: data.creditLimit !== undefined ? Number(data.creditLimit) : undefined,
        notes: data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined,
        nic: data.nic !== undefined ? (data.nic ? data.nic.trim() : null) : undefined,
        repId: data.repId !== undefined ? (data.repId ? Number(data.repId) : null) : undefined,
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