import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { notesRouter } from './routes/notes.js';
import { postsRouter } from './routes/posts.js';
import { usersRouter } from './routes/users.js';

export const app = express();

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
