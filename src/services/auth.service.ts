import bcrypt from 'bcryptjs';
import type { z } from 'zod';
import { User } from '../models/User.js';
import { HttpError } from '../utils/http.js';
import type { loginBody, registerBody } from '../validation.js';

// Compared against when the email doesn't exist, so a wrong email takes as long as a wrong password
// and response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

export function register(data: z.infer<typeof registerBody>) {
  return User.create(data);
}

export async function login({ email, password }: z.infer<typeof loginBody>) {
  const user = await User.findOne({ email }).select('+password');
  const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !valid) throw new HttpError(401, 'Invalid email or password');
  return user;
}
