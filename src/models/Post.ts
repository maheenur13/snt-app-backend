import { Schema, model } from 'mongoose';

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 20000 },
  },
  { timestamps: true },
);

// Used by the $lookup in the "posts of a user" aggregation: equality on author, then sort by _id desc.
// Also covers deleteMany({ author }) when an admin removes a user.
postSchema.index({ author: 1, _id: -1 });

export const Post = model('Post', postSchema);
