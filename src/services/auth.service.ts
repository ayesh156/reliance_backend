import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.ts';
import { env } from '../config/env.ts';
import { ROLES, type UserRole } from '../config/constants.ts';
import { HttpException } from '../middleware/error.middleware.ts';

/** Minimal user selection used for auth responses. */
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  permissions: true,
  active: true,
  createdAt: true,
} as const;

/** Default permissions strictly granted to Staff if unconfigured or empty */
export const DEFAULT_STAFF_PERMISSIONS: string[] = ['production', 'line', 'wash', 'materials'];

/** Full system module permissions for Administrators */
export const ALL_ADMIN_PERMISSIONS: string[] = [
  'pos',
  'invoices',
  'orders',
  'products',
  'customers',
  'materials',
  'production',
  'line',
  'wash',
  'reports',
  'settings',
];

/**
 * Resolves permissions dynamically based on role and stored permissions.
 * - Administrators have full access (all permissions).
 * - If role is STAFF and permissions is null/empty/not set, inject default: ['production', 'line', 'wash', 'materials'].
 */
export function resolveUserPermissions(role: string, permissions: unknown): string[] {
  const normRole = String(role).toUpperCase();
  if (normRole === 'ADMIN') {
    return ALL_ADMIN_PERMISSIONS;
  }
  let parsedPermissions: any = permissions;
  if (typeof permissions === 'string' && permissions.trim().length > 0) {
    try {
      parsedPermissions = JSON.parse(permissions);
    } catch {
      parsedPermissions = [];
    }
  }

  if (normRole === 'STAFF') {
    if (!parsedPermissions || !Array.isArray(parsedPermissions) || parsedPermissions.length === 0) {
      return [...DEFAULT_STAFF_PERMISSIONS];
    }
    return parsedPermissions.map(String);
  }
  return Array.isArray(parsedPermissions) ? parsedPermissions.map(String) : [];
}

/** Password policy regex: min 8 chars, at least 1 letter and 1 number */
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;

export class AuthService {
  /**
   * Verify email/password and return a JWT + sanitized user.
   */
  async login(emailRaw: string, passwordRaw: string) {
    const email = emailRaw?.trim().toLowerCase();
    const password = passwordRaw?.trim();

    if (!email || !password) {
      throw new HttpException(400, 'Email and password are required');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Timing attack protection: constant-time comparison simulation
      await bcrypt.compare(password, '$2a$12$e8uq4f1oZg0r6/b1h1VqneG9qK9VbOwhK9sK.M5O/tV0U5hN4x0zO');
      throw new HttpException(401, 'Invalid email or password');
    }

    if (!user.active) {
      throw new HttpException(403, 'Account has been deactivated. Contact Administrator.');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new HttpException(401, 'Invalid email or password');
    }

    const resolvedPermissions = resolveUserPermissions(user.role, user.permissions);

    if (user.role === 'STAFF' && (!user.permissions || (typeof user.permissions === 'string' && user.permissions.trim() === ''))) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { permissions: JSON.stringify(DEFAULT_STAFF_PERMISSIONS) },
        });
      } catch (err) {
        console.warn('[AuthService] Could not persist default staff permissions on login:', err);
      }
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, name: user.name, permissions: resolvedPermissions },
      env.jwtSecret,
      { expiresIn: env.accessTokenExpiry as jwt.SignOptions['expiresIn'], algorithm: 'HS256' }
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: resolvedPermissions,
      },
    };
  }

  /**
   * Fetch current user profile ensuring account remains active
   */
  async getMe(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) {
      throw new HttpException(404, 'User not found');
    }
    if (!user.active) {
      throw new HttpException(403, 'Account has been deactivated. Access revoked.');
    }
    return {
      ...user,
      permissions: resolveUserPermissions(user.role, user.permissions),
    };
  }

  /**
   * List staff users with pagination safeguard and dynamic resolved permissions
   */
  async listUsers() {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: userSelect,
      take: 100,
    });
    return users.map((u) => ({
      ...u,
      permissions: resolveUserPermissions(u.role, u.permissions),
    }));
  }

  /**
   * Create a new staff user (admin only).
   */
  async createUser(data: { name: string; email: string; password: string; role: string; permissions?: string[] }) {
    const name = data.name?.trim();
    const email = data.email?.trim().toLowerCase();
    const password = data.password?.trim();
    const role = data.role?.trim().toUpperCase() as UserRole;

    if (!name || !email || !password || !role) {
      throw new HttpException(400, 'Name, email, password, and role are required');
    }

    if (!ROLES.includes(role)) {
      throw new HttpException(400, `Invalid role. Must be one of: ${ROLES.join(', ')}`);
    }

    // RFC Standard email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new HttpException(400, 'Invalid email format provided');
    }

    if (!PASSWORD_REGEX.test(password)) {
      throw new HttpException(
        400,
        'Password must be at least 8 characters long and contain both letters and numbers'
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpException(409, 'A user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    let permissionsToSave: string | null = null;
    if (Array.isArray(data.permissions) && data.permissions.length > 0) {
      permissionsToSave = JSON.stringify(data.permissions);
    } else if (typeof data.permissions === 'string' && (data.permissions as string).trim().length > 0) {
      permissionsToSave = data.permissions;
    } else if (role && role.toUpperCase() === 'STAFF') {
      permissionsToSave = JSON.stringify(DEFAULT_STAFF_PERMISSIONS);
    }

    const created = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role as never,
        permissions: permissionsToSave,
      },
      select: userSelect,
    });

    return {
      ...created,
      permissions: resolveUserPermissions(created.role, created.permissions),
    };
  }

  /**
   * Update role / active / password / permissions of a staff user with self-lockout guards and target verification
   */
  async updateUser(
    id: number,
    data: { role?: string; active?: boolean; password?: string; name?: string; permissions?: string[] },
    currentAdminId?: number
  ) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException(404, 'Target user does not exist');
    }

    // Prevent executing administrator from locking out or demoting themselves
    if (currentAdminId && currentAdminId === id) {
      if (data.active === false) {
        throw new HttpException(400, 'You cannot deactivate your own administrative account');
      }
      if (data.role && data.role !== 'ADMIN') {
        throw new HttpException(400, 'You cannot revoke your own administrator role');
      }
    }

    const updateData: Record<string, unknown> = {};

    if (data.role !== undefined) {
      const role = data.role.trim().toUpperCase() as UserRole;
      if (!ROLES.includes(role)) {
        throw new HttpException(400, `Invalid role. Must be one of: ${ROLES.join(', ')}`);
      }
      updateData.role = role;
    }

    if (data.active !== undefined) {
      updateData.active = Boolean(data.active);
    }

    if (data.name !== undefined && data.name.trim()) {
      updateData.name = data.name.trim();
    }

    if (data.permissions !== undefined) {
      updateData.permissions = Array.isArray(data.permissions)
        ? JSON.stringify(data.permissions)
        : (typeof data.permissions === 'string' ? data.permissions : null);
    }

    if (data.password !== undefined && data.password.trim().length > 0) {
      const password = data.password.trim();
      if (!PASSWORD_REGEX.test(password)) {
        throw new HttpException(
          400,
          'Password must be at least 8 characters long and contain both letters and numbers'
        );
      }
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });

    return {
      ...updated,
      permissions: resolveUserPermissions(updated.role, updated.permissions),
    };
  }
}

export default new AuthService();