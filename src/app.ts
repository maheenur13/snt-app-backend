import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { notesRouter } from './routes/notes.js';
import { postsRouter } from './routes/posts.js';
import { usersRouter } from './routes/users.js';

export const app = express();

app.use(cors({ origin: config.clientUrl }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRouter);
app.use('/api/notes', notesRouter);
app.use('/api/posts', postsRouter);
app.use('/api/users', usersRouter);

app.use(notFound);
app.use(errorHandler);
