import type { Request, Response } from 'express';
import * as postsService from '../services/posts.service.js';
import { createPostBody } from '../validation.js';

export async function create(req: Request, res: Response) {
  const post = await postsService.create(req.user!._id, createPostBody.parse(req.body));
  res.status(201).json(post);
}
