import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';

const tooMany = { success: false, message: 'Too many attempts, please try again later' };

// Failed logins per IP. Successful logins don't count, so a real user isn't locked out by their own use.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooMany,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooMany,
});

// Refreshes happen every 15 minutes per tab, so this only stops a script hammering the endpoint.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooMany,
});

export const authRouter = Router();

authRouter.post('/register', registerLimiter, auth.register);
authRouter.post('/login', loginLimiter, auth.login);
authRouter.post('/refresh', refreshLimiter, auth.refresh);
authRouter.post('/logout', auth.logout);
