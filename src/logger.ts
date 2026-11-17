import { pino } from 'pino';
import { config } from './config.js';

// JSON lines in production (for log collectors), readable output in development.
export const logger = pino({
  level: config.logLevel,
  transport: config.isProduction ? undefined : { target: 'pino-pretty' },
});
