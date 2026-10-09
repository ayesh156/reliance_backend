import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.ts';
import { sendError, sendErrorFrom } from '../utils/response.ts';
import { ROLES, type UserRole } from '../config/constants.ts';

export class UserController {
  /**
   * Direct Admin User Credential Management (Email & Password Overrides)
   *
   * @route PUT /api/users/:id/admin-override
   * @description Allows an authenticated Administrator to directly override a user's credentials
   *              (email, name, role, active status, and password) without requiring existing passwords
   *              or email reset flows.
   * @access Protected strictly by RBAC: verifyToken + requireRole('ADMIN')
   * @security Safeguards:
   *   - Enforces minimum password length (minimum 6-8 characters) and securely hashes with bcrypt (salt rounds: 10).
   *   - Enforces unique email verification across the User repository.
   *   - Self-lockout prevention: Prevents active administrators from revoking their own admin role
   *     or deactivating themselves unless another active admin exists.
   *   - Audit logging: Logs administrator identity, target user ID, and modified credential attributes.
   */
  async adminOverride(req: Request, res: Response): Promise<void> {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const targetUserId = parseInt(String(rawId), 10);
      if (!targetUserId || isNaN(targetUserId) || targetUserId <= 0) {
        sendError(res, 'Valid positive integer user ID is required', 400);
        return;
      }

      const { name, email, role, password, active } = req.body;
      const currentAdminId = req.user?.userId;

      // 1. Verify existence of target user
      const existingUser = await prisma.user.findUnique({
        where: { id: targetUserId },
      });
      if (!existingUser) {
        sendError(res, 'Target user account not found', 404);
        return;
      }

      // 2. Self-lockout & demotion defense
      if (currentAdminId && currentAdminId === targetUserId) {
        if (active === false) {
          const otherAdminCount = await prisma.user.count({
            where: {
              role: 'ADMIN',
              active: true,
              NOT: { id: targetUserId },
            },
          });
          if (otherAdminCount === 0) {
            sendError(res, 'Cannot deactivate your own account as you are the only active System Administrator.', 400);
            return;
          }
        }

        if (role && role !== 'ADMIN') {
          const otherAdminCount = await prisma.user.count({
            where: {
              role: 'ADMIN',
              active: true,
              NOT: { id: targetUserId },
            },
          });
          if (otherAdminCount === 0) {
            sendError(res, 'Cannot demote your own administrative role as you are the only active System Administrator.', 400);
            return;
          }
        }
      }

      const updateData: Record<string, unknown> = {};

      // 3. Name sanitization
      if (name !== undefined) {
        const cleanName = String(name).trim();
        if (!cleanName) {
          sendError(res, 'Full name cannot be empty', 400);
          return;
        }
        updateData.name = cleanName;
      }

      // 4. Email uniqueness validation
      if (email !== undefined) {
        const cleanEmail = String(email).trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
          sendError(res, 'Valid email address is required', 400);
          return;
        }

        if (cleanEmail !== existingUser.email?.toLowerCase()) {
          const duplicate = await prisma.user.findFirst({
            where: {
              email: cleanEmail,
              NOT: { id: targetUserId },
            },
          });
          if (duplicate) {
            sendError(res, `The email '${cleanEmail}' is already assigned to another user account.`, 409);
            return;
          }
        }
        updateData.email = cleanEmail;
      }

      // 5. Role validation
      if (role !== undefined) {
        const cleanRole = String(role).trim().toUpperCase() as UserRole;
        if (!ROLES.includes(cleanRole)) {
          sendError(res, `Invalid role. Must be one of: ${ROLES.join(', ')}`, 400);
          return;
        }
        updateData.role = cleanRole;
      }

      // 6. Active status
      if (active !== undefined) {
        updateData.active = Boolean(active);
      }

      // 7. Password override with bcrypt (salt rounds: 10)
      if (password !== undefined && String(password).trim().length > 0) {
        const cleanPassword = String(password).trim();
        if (cleanPassword.length < 6) {
          sendError(res, 'New password must be at least 6 characters in length', 400);
          return;
        }
        // Bcrypt hashing with salt rounds: 10 per specification
        const hashedPassword = await bcrypt.hash(cleanPassword, 10);
        updateData.password = hashedPassword;
      }

      // 8. Commit updates to database
      const updatedUser = await prisma.user.update({
        where: { id: targetUserId },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Audit tracking log
      console.log(
        `[AUDIT] Admin #${currentAdminId || 'UNKNOWN'} directly overridden credentials for User #${targetUserId} (${updatedUser.email}). Modified fields: ${Object.keys(updateData).join(', ')}`
      );

      res.status(200).json({
        success: true,
        message: `Credentials updated successfully for ${updatedUser.name}`,
        user: updatedUser,
      });
    } catch (error) {
      console.error('[UserController] adminOverride error:', error);
      sendErrorFrom(res, error, 'Failed to override user credentials');
    }
  }
}

export const userController = new UserController();
export default userController;
