// All environment variables are read and validated here, once, at startup.
// A missing or malformed value stops the server with a message naming the variable,
// instead of surfacing later as a confusing runtime error.
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGO_URI: z.string().min(1, 'is required'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // access tokens are short-lived; the refresh token keeps the user signed in
  ACCESS_TOKEN_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'must be a number plus s, m, h or d, like 15m')
    .default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).default(7),
  // the frontend origin allowed to call the API from the browser
  CLIENT_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

export function parseEnv(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')} ${issue.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  const vars = result.data;
  return {
    isProduction: vars.NODE_ENV === 'production',
    port: vars.PORT,
    mongoUri: vars.MONGO_URI,
    jwtSecret: vars.JWT_SECRET,
    accessTokenExpiresIn: vars.ACCESS_TOKEN_EXPIRES_IN,
    refreshTokenDays: vars.REFRESH_TOKEN_DAYS,
    clientUrl: vars.CLIENT_URL,
    logLevel: vars.LOG_LEVEL,
  };
}

export const config = parseEnv(process.env);
