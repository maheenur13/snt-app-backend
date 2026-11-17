import type { NextFunction, Request, Response } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import { User, type Role, type UserDocument } from '../models/User.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../session.js';
import { HttpError } from '../utils/http.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== 'string' || !token) throw new HttpError(401, 'Authentication required');

  let payload: JwtPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  // Load the user on every request so deleted users and role changes take effect immediately.
  const user = payload.sub ? await User.findById(payload.sub).select('+passwordChangedAt') : null;
  if (!user) throw new HttpError(401, 'Invalid or expired token');

  // A password change logs out every session that was started before it.
  const changedAt = user.passwordChangedAt ? Math.floor(user.passwordChangedAt.getTime() / 1000) : 0;
  if ((payload.iat ?? 0) < changedAt) throw new HttpError(401, 'Invalid or expired token');

  req.user = user;
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role) throw new HttpError(403, 'Forbidden');
    next();
  };
}
