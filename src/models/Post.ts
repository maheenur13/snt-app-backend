import { Schema, model } from 'mongoose';
import { LIMITS } from './limits.js';

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.title },
    body: { type: String, required: true, maxlength: LIMITS.text },
  },
  { timestamps: true },
);

// Used by the $lookup in the "posts of a user" aggregation: equality on author, then sort by _id desc.
// Also covers deleteMany({ author }) when an admin removes a user.
postSchema.index({ author: 1, _id: -1 });

export const Post = model('Post', postSchema);
