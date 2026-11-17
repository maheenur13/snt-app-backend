function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

export const config = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGO_URI'),
  jwtSecret,
  // access tokens are short-lived; the refresh token keeps the user signed in
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS ?? 7),
  // the frontend origin allowed to call the API from the browser
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
};
