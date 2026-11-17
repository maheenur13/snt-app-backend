import { Router } from 'express';
import { Types } from 'mongoose';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { ROLES, User, type Role } from '../models/User.js';
import { getPagination, HttpError, paginated, readString, readStringArray } from '../utils/http.js';

export const usersRouter = Router();
usersRouter.use(authenticate);

function normalizeInterests(interests: string[]): string[] {
  return [...new Set(interests.map((i) => i.trim().toLowerCase()).filter(Boolean))];
}

function readRole(body: unknown): Role | undefined {
  const role = readString(body, 'role');
  if (role !== undefined && !ROLES.includes(role as Role)) throw new HttpError(400, 'Invalid role');
  return role as Role | undefined;
}

usersRouter.get('/me', (req, res) => {
  res.json(req.user);
});

usersRouter.patch('/me', async (req, res) => {
  const user = req.user!;
  const name = readString(req.body, 'name');
  const interests = readStringArray(req.body, 'interests');
  if (name !== undefined) user.name = name;
  if (interests !== undefined) user.interests = normalizeInterests(interests);
  await user.save();
  res.json(user);
});

// Scenario 1: users grouped by interest, in a single aggregate() call (paged with $facet).
usersRouter.get('/by-interest', async (req, res) => {
  const { page, limit, skip } = getPagination(req);
  const [result] = await User.aggregate<{ items: unknown[]; total: { count: number }[] }>([
    // Range scan on the multikey { interests: 1 } index. Skips users without interests
    // so the pipeline starts with IXSCAN instead of a collection scan.
    { $match: { interests: { $gt: '' } } },
    { $project: { name: 1, interests: 1 } },
    { $unwind: '$interests' },
    {
      $group: {
        _id: '$interests',
        users: { $push: { _id: '$_id', name: '$name' } },
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
  res.json(paginated(result.items, result.total[0]?.count ?? 0, { page, limit, skip }));
});

// Scenario 2: posts of one user via a single pipeline with $lookup.
// $match on _id uses the default index; the $lookup uses { author: 1, _id: -1 } on posts.
usersRouter.get('/:id/posts', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw new HttpError(404, 'User not found');
  const { page, limit, skip } = getPagination(req);

  const [result] = await User.aggregate([
    { $match: { _id: new Types.ObjectId(req.params.id) } },
    { $project: { name: 1 } },
    {
      $lookup: {
        from: Post.collection.name,
        localField: '_id',
        foreignField: 'author',
        as: 'posts',
        pipeline: [
          { $sort: { _id: -1 } },
          {
            $facet: {
              items: [{ $skip: skip }, { $limit: limit }, { $project: { author: 0, __v: 0 } }],
              total: [{ $count: 'count' }],
            },
          },
        ],
      },
    },
    { $unwind: '$posts' },
    {
      $project: {
        name: 1,
        items: '$posts.items',
        total: { $ifNull: [{ $first: '$posts.total.count' }, 0] },
      },
    },
  ]);
  if (!result) throw new HttpError(404, 'User not found');

  res.json({
    user: { _id: result._id, name: result.name },
    ...paginated(result.items, result.total, { page, limit, skip }),
  });
});

// ---- Admin: user management ----

usersRouter.get('/', requireRole('admin'), async (req, res) => {
  const pagination = getPagination(req);
  const [items, total] = await Promise.all([
    User.find().sort({ _id: -1 }).skip(pagination.skip).limit(pagination.limit),
    User.estimatedDocumentCount(),
  ]);
  res.json(paginated(items, total, pagination));
});

usersRouter.post('/', requireRole('admin'), async (req, res) => {
  const user = await User.create({
    name: readString(req.body, 'name', { required: true }),
    email: readString(req.body, 'email', { required: true }),
    password: readString(req.body, 'password', { required: true }),
    role: readRole(req.body) ?? 'user',
    interests: normalizeInterests(readStringArray(req.body, 'interests') ?? []),
  });
  res.status(201).json(user);
});

usersRouter.get('/:id', requireRole('admin'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
});

usersRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  const name = readString(req.body, 'name');
  const email = readString(req.body, 'email');
  const password = readString(req.body, 'password');
  const role = readRole(req.body);
  const interests = readStringArray(req.body, 'interests');

  if (role !== undefined && user._id.equals(req.user!._id) && role !== 'admin') {
    throw new HttpError(400, 'You cannot remove your own admin role');
  }

  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (password !== undefined) user.password = password; // hashed by the pre-save hook
  if (role !== undefined) user.role = role;
  if (interests !== undefined) user.interests = normalizeInterests(interests);
  await user.save();
  res.json(user);
});

usersRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  if (req.user!.id === req.params.id) throw new HttpError(400, 'You cannot delete your own account');

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  await Promise.all([Note.deleteMany({ owner: user._id }), Post.deleteMany({ author: user._id })]);
  res.status(204).end();
});
