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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token || token.trim().length === 0) {
    res.status(401).json({ error: 'Access denied. Malformed token.' });
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
 * Require one of the specified roles and ensure authenticated context exists
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ error: 'Not authenticated or user context missing.' });
      return;
    }

    const userRole = String(req.user.role).toUpperCase();
    const allowedRoles = roles.map((r) => r.toUpperCase());

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
};

export const getJwtSecret = (): string => env.jwtSecret;