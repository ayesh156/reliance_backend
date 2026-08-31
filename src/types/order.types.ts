/**
 * Order-related DTO types used by controllers and services.
 */

/** Item payload when creating / updating an order. */
export interface OrderItemInput {
  variantId: number;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

/** Body for POST /api/orders. */
export interface CreateOrderInput {
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  items: OrderItemInput[];
  paymentMethod?: string;
  paidAmount?: number;
  discount?: number;
  subtotal?: number;
  dueDate?: string | Date | null;
}

/** Body for PATCH /api/orders/:id. */
export interface UpdateOrderInput {
  status?: string;
  paidAmount?: number;
  customerName?: string;
  customerPhone?: string;
  paymentMethod?: string;
  dueDate?: string | Date | null;
}

/** Body for PATCH /api/orders/:id/status. */
export interface UpdateOrderStatusInput {
  status: string;
}

/** Real-time payload emitted on order status changes. */
export interface OrderStatusSocketPayload {
  orderId: number;
  status: string;
}