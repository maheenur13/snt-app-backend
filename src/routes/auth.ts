import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { User } from '../models/User.js';
import { endSession, rotateSession, startSession } from '../session.js';
import { HttpError } from '../utils/http.js';
import { loginBody, registerBody } from '../validation.js';

export const authRouter = Router();

const tooMany = { message: 'Too many attempts, please try again later' };

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

// Compared against when the email doesn't exist, so a wrong email takes as long as a wrong password
// and response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

authRouter.post('/register', registerLimiter, async (req, res) => {
  const user = await User.create(registerBody.parse(req.body));
  await startSession(res, user);
  res.status(201).json({ user });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);

  const user = await User.findOne({ email }).select('+password');
  const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !valid) throw new HttpError(401, 'Invalid email or password');

  await startSession(res, user);
  res.json({ user });
});

// Called by the client when the access token has expired. Rotates the refresh token.
authRouter.post('/refresh', refreshLimiter, async (req, res) => {
  const user = await rotateSession(req, res);
  res.json({ user });
});

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});
