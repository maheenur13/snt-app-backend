import type { CookieOptions, NextFunction, Request, Response } from 'express';
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

export const TOKEN_COOKIE = 'token';

// httpOnly: page scripts can't read the token, so an XSS bug can't steal it.
// sameSite strict: the browser never sends it on requests started by another site (CSRF).
export const tokenCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'strict',
  path: '/api',
};

export function setTokenCookie(res: Response, user: UserDocument) {
  const token = jwt.sign({ role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
  res.cookie(TOKEN_COOKIE, token, tokenCookieOptions);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[TOKEN_COOKIE];
  if (typeof token !== 'string' || !token) throw new HttpError(401, 'Authentication required');

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
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
