import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.routes.js';
import { notesRouter } from './routes/notes.routes.js';
import { postsRouter } from './routes/posts.routes.js';
import { usersRouter } from './routes/users.routes.js';

export const app = express();
app.set('trust proxy', config.trustProxy);

app.use(
  pinoHttp({
    logger,
    // Only these fields are logged. Headers (cookies, auth) and bodies (passwords) never reach the logs.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    // 5xx are errors, 4xx are client mistakes worth a warning, the rest is normal traffic
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  }),
);
app.use(helmet());
// credentials: true lets the browser send the auth cookie, but only from CLIENT_URL
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/notes', notesRouter);
app.use('/api/posts', postsRouter);
app.use('/api/users', usersRouter);

app.use(notFound);
app.use(errorHandler);
