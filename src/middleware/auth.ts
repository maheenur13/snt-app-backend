import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User, type Role, type UserDocument } from '../models/User.js';
import { HttpError } from '../utils/http.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
    }
  }
}

export function signToken(user: UserDocument): string {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');

  let userId: string | undefined;
  try {
    userId = jwt.verify(header.slice(7), config.jwtSecret).sub as string | undefined;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  // Load the user on every request so deleted users and role changes take effect immediately.
  const user = userId ? await User.findById(userId) : null;
  if (!user) throw new HttpError(401, 'Invalid or expired token');

  req.user = user;
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role) throw new HttpError(403, 'Forbidden');
    next();
  };
}
