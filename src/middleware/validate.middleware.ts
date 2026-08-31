import { Request, Response, NextFunction } from 'express';

/**
 * Request validation helpers.
 * Middleware factory that ensures a request body matches a set of required
 * field names before continuing to the controller.
 */
export function validateBody(requiredFields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const missing = requiredFields.filter((f) => req.body?.[f] === undefined || req.body?.[f] === null);
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
      return;
    }
    next();
  };
}