// Request schemas. Every body and query is parsed here before it reaches a route handler:
// - only declared fields survive (unknown keys like `role` on register are dropped)
// - every field has a fixed type, so objects like { "$gt": "" } can't reach a MongoDB query
// The Mongoose models keep their own rules as a last line of defense at the database level.
import { z } from 'zod';
import { LIMITS, passwordFitsBcrypt } from './models/limits.js';
import { ROLES } from './models/User.js';

const name = z.string().trim().min(1, 'Name is required').max(LIMITS.name, 'Name is too long');
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Email is not valid').max(LIMITS.email, 'Email is too long'));
const password = z
  .string()
  .min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters`)
  .refine(passwordFitsBcrypt, `Password must be at most ${LIMITS.passwordMaxBytes} bytes`);
const role = z.enum(ROLES, 'Invalid role');
// trimmed, lower-cased and de-duplicated so each user appears once per interest group
const interests = z
  .array(z.string().max(LIMITS.interest, `Interests must be at most ${LIMITS.interest} characters`))
  .max(LIMITS.interests, `At most ${LIMITS.interests} interests`)
  .transform((list) => [...new Set(list.map((i) => i.trim().toLowerCase()).filter(Boolean))]);
const title = z.string().trim().min(1, 'Title is required').max(LIMITS.title, 'Title is too long');
const text = z.string().max(LIMITS.text, 'Text is too long');

export const registerBody = z.object({ name, email, password });

// No format rules on login: a wrong email should get the same "invalid email or password" as anything else.
export const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const createNoteBody = z.object({ title, content: text.default('') });
export const updateNoteBody = z.object({ title: title.optional(), content: text.optional() });

export const createPostBody = z.object({ title, body: text.trim().min(1, 'Body is required') });

export const updateProfileBody = z.object({ name: name.optional(), interests: interests.optional() });

export const createUserBody = z.object({
  name,
  email,
  password,
  role: role.default('user'),
  interests: interests.default([]),
});
export const updateUserBody = z.object({
  name: name.optional(),
  email: email.optional(),
  password: password.optional(),
  role: role.optional(),
  interests: interests.optional(),
});

// Bad or out-of-range values fall back to defaults instead of failing the request.
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(10),
});
