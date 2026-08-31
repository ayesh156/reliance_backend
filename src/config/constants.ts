/**
 * Global application constants.
 */

export const APP_NAME = 'Reliance Retail & Wholesale POS';
export const APP_VERSION = '1.0.0';

/** All role values used across the app (including REP from schema.prisma). */
export const ROLES = ['ADMIN', 'STAFF', 'CASHIER', 'REP'] as const;
export type Role = (typeof ROLES)[number];
export type UserRole = Role; // ⭐ auth.service.ts සඳහා UserRole alias එක

/** All order status values. */
export const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'CANCELLED',
  'PENDING_RECEIPT',
  'PAYMENT_REVIEW',
  'PAYMENT_VERIFIED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that count as "verified payment" for revenue calculations. */
export const VERIFIED_STATUSES: readonly OrderStatus[] = [
  'PAID',
  'PAYMENT_VERIFIED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
];

/** Statuses that count as "pending" for the dashboard badge. */
export const PENDING_STATUSES: readonly OrderStatus[] = [
  'PENDING',
  'PENDING_RECEIPT',
  'PAYMENT_REVIEW',
  'PROCESSING',
];

/** Low-stock threshold. */
export const LOW_STOCK_THRESHOLD = 5;

/** Default access token expiry (used when env not set). */
export const DEFAULT_TOKEN_EXPIRY = '24h';

/** Max JSON body size. */
export const MAX_JSON_BODY_SIZE = '10mb';

/** Max upload size for product images (bytes). */
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Max number of product images per upload. */
export const MAX_PRODUCT_IMAGES = 20;

/** Socket.IO events used across services. */
export const SOCKET_EVENTS = {
  NEW_ORDER: 'newOrder',
  ORDER_UPDATED: 'orderUpdated',
  ORDER_STATUS_UPDATED: 'orderStatusUpdated',
} as const;