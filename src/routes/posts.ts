import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { Post } from '../models/Post.js';
import { createPostBody } from '../validation.js';

export const postsRouter = Router();
postsRouter.use(authenticate);

// Reading posts goes through GET /api/users/:id/posts (the $lookup aggregation).
postsRouter.post('/', async (req, res) => {
  const post = await Post.create({ ...createPostBody.parse(req.body), author: req.user!._id });
  res.status(201).json(post);
});
