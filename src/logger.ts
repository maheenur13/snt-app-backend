import { pino } from 'pino';
import { config } from './config.js';

// JSON lines in production (for log collectors), readable output in development.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: config.isProduction ? undefined : { target: 'pino-pretty' },
});
