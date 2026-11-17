// Field limits, shared by the Zod request schemas (src/validation.ts) and the Mongoose models,
// so the two layers can't drift apart.
export const LIMITS = {
  name: 100,
  email: 254,
  passwordMin: 8,
  // bcrypt only uses the first 72 bytes of a password; anything longer would be silently ignored
  passwordMaxBytes: 72,
  title: 200,
  text: 20_000,
  interest: 50,
  interests: 20,
} as const;

export const passwordFitsBcrypt = (password: string) => Buffer.byteLength(password) <= LIMITS.passwordMaxBytes;
