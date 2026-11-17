import { Router } from 'express';
import { Types } from 'mongoose';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { getPagination, HttpError, paginated } from '../utils/http.js';
import { createUserBody, updateProfileBody, updateUserBody } from '../validation.js';

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get('/me', (req, res) => {
  res.json(req.user);
});

usersRouter.patch('/me', async (req, res) => {
  const user = req.user!;
  user.set(updateProfileBody.parse(req.body));
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
  const user = await User.create(createUserBody.parse(req.body));
  res.status(201).json(user);
});

usersRouter.get('/:id', requireRole('admin'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
});

usersRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  const changes = updateUserBody.parse(req.body);
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  if (changes.role && changes.role !== 'admin' && user._id.equals(req.user!._id)) {
    throw new HttpError(400, 'You cannot remove your own admin role');
  }

  user.set(changes); // a new password is hashed by the pre-save hook
  await user.save();
  res.json(user);
});

usersRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  if (req.user!.id === req.params.id) throw new HttpError(400, 'You cannot delete your own account');

  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  // Content first, user last: if anything fails halfway, retrying the request finishes the cleanup.
  await Promise.all([
    Note.deleteMany({ owner: user._id }),
    Post.deleteMany({ author: user._id }),
    RefreshToken.deleteMany({ user: user._id }),
  ]);
  await user.deleteOne();
  res.status(204).end();
});
