import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import type { AuthPayload } from '../types/common.types.ts';

/**
 * Verify JWT token from the Authorization header (Bearer <token>).
 * On success, attaches the decoded payload to `req.user`.
 */
/**
 * Verify JWT token from Authorization header enforcing strict HS256 algorithm verification
 */
export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
    token = req.query.token.trim();
  }

  if (!token || token.trim().length === 0) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    // Prevent algorithm manipulation attacks by explicitly pinning HS256
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as AuthPayload;
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
};

/**
 * Require one of the specified roles.
 * Must be used AFTER verifyToken so `req.user` is populated.
 */
/**
 * Require one of the specified roles and ensure authenticated context exists.
 * If 'ADMIN' is among the required roles, 'SUPER_ADMIN' is implicitly granted universal access.
 */
export const requireRole = (...roles: (string | string[])[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ error: 'Not authenticated or user context missing.' });
      return;
    }

    const userRole = String(req.user.role).toUpperCase();
    const allowedRoles = roles.flat().map((r) => String(r).toUpperCase());

    // If 'ADMIN' is in the allowed roles, implicitly grant access to 'SUPER_ADMIN' as well
    if (allowedRoles.includes('ADMIN') && !allowedRoles.includes('SUPER_ADMIN')) {
      allowedRoles.push('SUPER_ADMIN');
    }

    // Super Administrators automatically inherit full system access across all admin roles
    if (userRole === 'SUPER_ADMIN' || allowedRoles.includes(userRole)) {
      return next();
    }

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({ error: `Access denied. Required role: ${allowedRoles.join(' or ')}` });
      return;
    }
    next();
  };
};

/**
 * Require a specific module permission.
 * Super Administrators and Administrators automatically bypass all permission checks (have full access).
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ error: 'Not authenticated or user context missing.' });
      return;
    }

    // Super Administrators and Administrators automatically bypass all permission checks
    const userRole = String(req.user.role).toUpperCase();
    if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
      return next();
    }

    const permissions: string[] = Array.isArray(req.user.permissions)
      ? req.user.permissions
      : [];

    if (!permissions.includes(permission)) {
      res.status(403).json({ error: `Access denied. Missing required permission: ${permission}` });
      return;
    }
    next();
  };
};

export const getJwtSecret = (): string => env.jwtSecret;