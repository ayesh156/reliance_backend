import type { Request, Response } from 'express';
import authService from '../services/auth.service';
import { sendErrorFrom } from '../utils/response';

export class AuthController {
  /** POST /api/auth/login — Login with email/password and strict payload validation */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
        res.status(400).json({ error: 'Valid email and password strings are required' });
        return;
      }
      const result = await authService.login(email, password);
      res.json(result);
    } catch (error) {
      console.error('[AuthController] Login error:', error);
      sendErrorFrom(res, error, 'Login failed');
    }
  }

  /** GET /api/auth/me — Current user profile */
  async getMe(req: Request, res: Response): Promise<void> {
    try {
      const user = await authService.getMe(req.user!.userId);
      res.json(user);
    } catch (error) {
      console.error('[AuthController] Me error:', error);
      sendErrorFrom(res, error, 'Failed to fetch user');
    }
  }

  /** GET /api/auth/users — List staff (admin only) */
  async listUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await authService.listUsers();
      res.json(users);
    } catch (error) {
      console.error('[AuthController] List users error:', error);
      sendErrorFrom(res, error, 'Failed to fetch users');
    }
  }

  /** POST /api/auth/users — Create staff (admin only) */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const user = await authService.createUser(req.body);
      res.status(201).json(user);
    } catch (error) {
      console.error('[AuthController] Create user error:', error);
      sendErrorFrom(res, error, 'Failed to create user');
    }
  }

  /** PATCH /api/auth/users/:id — Update staff with param sanitization and self-lockout check */
  async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Valid positive integer target user ID is required' });
        return;
      }
      const currentAdminId = req.user?.userId;
      const user = await authService.updateUser(id, req.body, currentAdminId);
      res.json(user);
    } catch (error) {
      console.error('[AuthController] Update user error:', error);
      sendErrorFrom(res, error, 'Failed to update user');
    }
  }
}

export default new AuthController();