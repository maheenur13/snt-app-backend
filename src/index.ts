import mongoose from 'mongoose';
import { app } from './app.js';
import { config } from './config.js';
import { ensureDemoAdmin } from './services/demo-admin.service.js';
import { logger } from './logger.js';

// If requests are still running after this long, exit anyway rather than hang the deploy.
const SHUTDOWN_TIMEOUT_MS = 10_000;

await mongoose.connect(config.mongoUri);
logger.info('Connected to MongoDB');

if (config.demoAdmin) {
  const result = await ensureDemoAdmin(config.demoAdmin);
  logger.info(`Demo admin ${config.demoAdmin.email}: ${result}`);
}

const server = app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});

// On SIGTERM or SIGINT (Ctrl+C): stop taking new connections,
// let in-flight requests finish, then close the database connection and exit.
function shutdown(signal: NodeJS.Signals) {
  logger.info(`${signal} received, shutting down`);
  setTimeout(() => {
    logger.error('Requests still running after timeout, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(async (err) => {
    await mongoose.disconnect();
    logger.info('Shutdown complete');
    process.exit(err ? 1 : 0);
  });
  // close() only waits for active requests; idle keep-alive connections would otherwise hold it open
  server.closeIdleConnections();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
