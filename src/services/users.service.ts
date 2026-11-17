import { Types } from 'mongoose';
import type { z } from 'zod';
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User, type UserDocument } from '../models/User.js';
import { HttpError, type Pagination } from '../utils/http.js';
import type { createUserBody, updateProfileBody, updateUserBody } from '../validation.js';

export function updateProfile(user: UserDocument, changes: z.infer<typeof updateProfileBody>) {
  user.set(changes);
  return user.save();
}

interface InterestGroup {
  interest: string;
  count: number;
  users: { _id: Types.ObjectId; name: string }[];
}

// Scenario 1: users grouped by interest, in a single aggregate() call (paged with $facet).
export async function groupByInterest({ skip, limit }: Pagination) {
  const [result] = await User.aggregate<{ items: InterestGroup[]; total: { count: number }[] }>([
    // Range scan on the multikey { interests: 1 } index. Skips users without interests
    // so the pipeline starts with IXSCAN instead of a collection scan.
    { $match: { interests: { $gt: '' } } },
    { $project: { name: 1, interests: 1 } },
    { $unwind: '$interests' },
    {
      $group: {
        _id: '$interests',
        // capped so a popular interest can't grow past the 16 MB document limit; count stays exact
        users: { $firstN: { n: 20, input: { _id: '$_id', name: '$name' } } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }, { $project: { _id: 0, interest: '$_id', count: 1, users: 1 } }],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  return { items: result.items, total: result.total[0]?.count ?? 0 };
}

// Scenario 2: posts of one user via a single pipeline with $lookup.
// $match on _id uses the default index; both lookups use { author: 1, _id: -1 } on posts.
export async function postsOfUser(id: string, { skip, limit }: Pagination) {
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'User not found');

  const [result] = await User.aggregate([
    { $match: { _id: new Types.ObjectId(id) } },
    { $project: { name: 1 } },
    {
      $lookup: {
        from: Post.collection.name,
        localField: '_id',
        foreignField: 'author',
        as: 'items',
        // only the requested page is fetched from disk
        pipeline: [{ $sort: { _id: -1 } }, { $skip: skip }, { $limit: limit }, { $project: { author: 0, __v: 0 } }],
      },
    },
    {
      $lookup: {
        from: Post.collection.name,
        localField: '_id',
        foreignField: 'author',
        as: 'total',
        // projecting only _id lets the index answer the count without reading the posts
        pipeline: [{ $project: { _id: 1 } }, { $count: 'count' }],
      },
    },
    { $project: { name: 1, items: 1, total: { $ifNull: [{ $first: '$total.count' }, 0] } } },
  ]);
  if (!result) throw new HttpError(404, 'User not found');

  return { user: { _id: result._id, name: result.name }, items: result.items, total: result.total as number };
}

// ---- Admin: user management ----

// Sorted by _id, so the default _id index is enough.
export async function list({ skip, limit }: Pagination) {
  const [items, total] = await Promise.all([
    User.find().sort({ _id: -1 }).skip(skip).limit(limit),
    User.estimatedDocumentCount(),
  ]);
  return { items, total };
}

export function create(data: z.infer<typeof createUserBody>) {
  return User.create(data);
}

export async function getById(id: string) {
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}

export async function update(id: string, changes: z.infer<typeof updateUserBody>, actingAdmin: UserDocument) {
  const user = await getById(id);
  // keeps at least one admin around: you can't demote yourself
  if (changes.role && changes.role !== 'admin' && user._id.equals(actingAdmin._id)) {
    throw new HttpError(400, 'You cannot remove your own admin role');
  }
  user.set(changes); // a new password is hashed by the pre-save hook
  return user.save();
}

export async function remove(id: string, actingAdmin: UserDocument) {
  if (actingAdmin.id === id) throw new HttpError(400, 'You cannot delete your own account');
  const user = await getById(id);

  // Content first, user last: if anything fails halfway, retrying the request finishes the cleanup.
  await Promise.all([
    Note.deleteMany({ owner: user._id }),
    Post.deleteMany({ author: user._id }),
    RefreshToken.deleteMany({ user: user._id }),
  ]);
  await user.deleteOne();
}
