import type { Types } from 'mongoose';
import type { z } from 'zod';
import { Post } from '../models/Post.js';
import type { createPostBody } from '../validation.js';

// Reading posts is in users.service (postsOfUser), because it's the $lookup aggregation on users.
export function create(author: Types.ObjectId, data: z.infer<typeof createPostBody>) {
  return Post.create({ ...data, author });
}
