import mongoose from 'mongoose';
import { app } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

await mongoose.connect(config.mongoUri);
logger.info('Connected to MongoDB');

app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});
