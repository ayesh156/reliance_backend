import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';
import { OrderSource, OrderStatus } from '@prisma/client';

export class OrderService {
  /**
   * Create POS Order with transactional atomic stock deduction
   */
  async createPosOrder(data: {
    userId: number;
    source: OrderSource; // POS_RETAIL or POS_WHOLESALE
    customerId?: number;
    customerName?: string;
    customerPhone?: string;
    items: {
      variantId: number;
      quantity: number;
      unitPrice: number;
      discount?: number;
      price: number;
    }[];
    subtotal: number;
    discount?: number;
    totalAmount: number;
    paidAmount?: number;
    paymentMethod: string; // CASH, CARD, CREDIT, CHEQUE
    notes?: string;
  }) {
    if (!data.items || data.items.length === 0) {
      throw new HttpException(400, 'Order must contain at least one item');
    }

    return prisma.$transaction(async (tx) => {
      // 1. Verify and reduce variant inventory stock
      for (const item of data.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          throw new HttpException(404, `Product variant #${item.variantId} not found`);
        }

        if (variant.stock < item.quantity) {
          throw new HttpException(
            400,
            `Insufficient stock for "${variant.product.name}" (${variant.size}/${variant.color}). Available: ${variant.stock}`
          );
        }

        // Deduct inventory stock
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const paid = Number(data.paidAmount) || 0;
      const total = Number(data.totalAmount) || 0;
      const isFullPaid = paid >= total;

      // 2. Create parent order entry
      const order = await tx.order.create({
        data: {
          source: data.source || OrderSource.POS_RETAIL,
          userId: data.userId,
          customerId: data.customerId ? Number(data.customerId) : null,
          customerName: data.customerName || 'Walk-in Customer',
          customerPhone: data.customerPhone || null,
          subtotal: Number(data.subtotal) || total,
          discount: Number(data.discount) || 0,
          totalAmount: total,
          paidAmount: paid,
          status: isFullPaid ? OrderStatus.PAID : OrderStatus.PROCESSING,
          paymentMethod: data.paymentMethod || 'CASH',
          notes: data.notes || null,
          items: {
            create: data.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              discount: i.discount || 0,
              price: i.price,
            })),
          },
          payments:
            paid > 0
              ? {
                  create: [
                    {
                      amount: paid,
                      method: data.paymentMethod || 'CASH',
                    },
                  ],
                }
              : undefined,
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { name: true } },
                },
              },
            },
          },
          customer: true,
          user: { select: { id: true, name: true } },
        },
      });

      // 3. Update customer outstanding balance if credit was used
      if (data.customerId && total > paid) {
        const creditDue = total - paid;
        await tx.customer.update({
          where: { id: Number(data.customerId) },
          data: { outstandingBalance: { increment: creditDue } },
        });
      }

      return order;
    });
  }

  /**
   * Retrieve active catalog variants formatted for POS searching and scanning
   */
  async getPosCatalog() {
    return prisma.productVariant.findMany({
      include: {
        product: {
          select: {
            id: true,
            name: true,
            searchKey: true,
            category: { select: { name: true } },
            images: { take: 1, orderBy: { order: 'asc' }, select: { imageUrl: true } },
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });
  }
}

export const orderService = new OrderService();