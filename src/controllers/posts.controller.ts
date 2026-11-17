import type { Request, Response } from 'express';
import * as postsService from '../services/posts.service.js';
import { sendData } from '../utils/http.js';
import { createPostBody } from '../validation.js';

export async function create(req: Request, res: Response) {
  sendData(res, await postsService.create(req.user!._id, createPostBody.parse(req.body)), 201);
}
