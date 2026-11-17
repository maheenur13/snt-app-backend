import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { Post } from '../models/Post.js';
import { readString } from '../utils/http.js';

export const postsRouter = Router();
postsRouter.use(authenticate);

// Reading posts goes through GET /api/users/:id/posts (the $lookup aggregation).
postsRouter.post('/', async (req, res) => {
  const post = await Post.create({
    author: req.user!._id,
    title: readString(req.body, 'title', { required: true }),
    body: readString(req.body, 'body', { required: true }),
  });
  res.status(201).json(post);
});
