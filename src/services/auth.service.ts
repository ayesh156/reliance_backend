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
  active: true,
  createdAt: true,
} as const;

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

    const token = jwt.sign(
      { userId: user.id, role: user.role, name: user.name },
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
    return user;
  }

/**
   * List staff users with pagination safeguard
   */
  async listUsers() {
    return prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: userSelect,
      take: 100,
    });
  }

  /**
   * Create a new staff user (admin only).
   */
  async createUser(data: { name: string; email: string; password: string; role: string }) {
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

    return prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role as never,
      },
      select: userSelect,
    });
  }

  /**
   * Update role / active / password of a staff user with self-lockout guards and target verification
   */
  async updateUser(
    id: number,
    data: { role?: string; active?: boolean; password?: string; name?: string },
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

    return prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });
  }
}

export default new AuthService();