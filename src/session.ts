// Session handling: a short-lived access token (JWT) plus a long-lived, rotating refresh token.
// Both travel only in httpOnly, SameSite=Strict cookies.
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { RefreshToken } from './models/RefreshToken.js';
import { User, type UserDocument } from './models/User.js';
import { HttpError } from './utils/http.js';

export const ACCESS_COOKIE = 'accessToken';
export const REFRESH_COOKIE = 'refreshToken';

// Two tabs whose access tokens expire together both refresh at once with the same token.
// A reuse this soon after rotation is that race, not theft, so it doesn't revoke everything.
export const REUSE_GRACE_MS = 10_000;

const baseCookie: CookieOptions = {
  httpOnly: true, // page scripts can't read it, so an XSS bug can't steal it
  secure: config.isProduction,
  sameSite: 'strict', // never sent on requests started by another site (CSRF)
};
const accessCookie: CookieOptions = { ...baseCookie, path: '/api' };
// only sent to /api/auth/*, so the long-lived token isn't attached to every API call
const refreshCookie: CookieOptions = { ...baseCookie, path: '/api/auth' };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function verifyAccessToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
}

/** Issues a new access token and a new refresh token for the user. */
export async function startSession(res: Response, user: UserDocument) {
  const accessToken = jwt.sign({ role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: config.accessTokenExpiresIn as jwt.SignOptions['expiresIn'],
  });

  const refreshToken = randomBytes(32).toString('base64url');
  const maxAge = config.refreshTokenDays * 24 * 60 * 60 * 1000;
  await RefreshToken.create({
    user: user._id,
    tokenHash: hash(refreshToken),
    expiresAt: new Date(Date.now() + maxAge),
  });

  res.cookie(ACCESS_COOKIE, accessToken, accessCookie);
  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookie, maxAge });
}

function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, accessCookie);
  res.clearCookie(REFRESH_COOKIE, refreshCookie);
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
}

/** Trades a valid refresh token for a new session. Each refresh token works exactly once. */
export async function rotateSession(req: Request, res: Response): Promise<UserDocument> {
  const token = readRefreshCookie(req);
  const fail = () => {
    clearSessionCookies(res);
    return new HttpError(401, 'Session expired, please log in again');
  };
  if (!token) throw fail();

  const tokenHash = hash(token);
  // Atomic claim: if two requests race with the same token, only one gets it.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  );

  if (!claimed) {
    const used = await RefreshToken.findOne({ tokenHash });
    // An old token coming back means someone else has a copy: end every session of that user.
    if (used?.usedAt && Date.now() - used.usedAt.getTime() > REUSE_GRACE_MS) {
      await RefreshToken.deleteMany({ user: used.user });
    }
    throw fail();
  }

  const user = await User.findById(claimed.user).select('+passwordChangedAt');
  // Sessions started before a password change don't survive it.
  if (!user || (user.passwordChangedAt && claimed.createdAt < user.passwordChangedAt)) {
    await RefreshToken.deleteMany({ user: claimed.user });
    throw fail();
  }

  await startSession(res, user);
  return user;
}

/** Revokes this browser's refresh token and clears both cookies. */
export async function endSession(req: Request, res: Response) {
  const token = readRefreshCookie(req);
  if (token) await RefreshToken.deleteOne({ tokenHash: hash(token) });
  clearSessionCookies(res);
}
