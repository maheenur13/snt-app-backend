import { Router } from 'express';
import * as posts from '../controllers/posts.controller.js';
import { authenticate } from '../middleware/auth.js';

export const postsRouter = Router();
postsRouter.use(authenticate);

// Reading posts goes through GET /api/users/:id/posts (the $lookup aggregation).
postsRouter.post('/', posts.create);
