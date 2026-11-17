import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Note } from '../models/Note.js';
import { getPagination, HttpError, paginated, readString } from '../utils/http.js';

export const notesRouter = Router();
notesRouter.use(authenticate);

// Own notes, newest first. Uses { owner: 1, _id: -1 }.
notesRouter.get('/', async (req, res) => {
  const pagination = getPagination(req);
  const filter = { owner: req.user!._id };
  const [items, total] = await Promise.all([
    Note.find(filter).sort({ _id: -1 }).skip(pagination.skip).limit(pagination.limit),
    Note.countDocuments(filter),
  ]);
  res.json(paginated(items, total, pagination));
});

// Everyone's notes (admin). Sorted by _id, so the default _id index is enough.
notesRouter.get('/all', requireRole('admin'), async (req, res) => {
  const pagination = getPagination(req);
  const [items, total] = await Promise.all([
    Note.find().sort({ _id: -1 }).skip(pagination.skip).limit(pagination.limit).populate('owner', 'name email'),
    Note.estimatedDocumentCount(),
  ]);
  res.json(paginated(items, total, pagination));
});

notesRouter.post('/', async (req, res) => {
  const note = await Note.create({
    owner: req.user!._id,
    title: readString(req.body, 'title', { required: true }),
    content: readString(req.body, 'content'),
  });
  res.status(201).json(note);
});

notesRouter.get('/:id', async (req, res) => {
  const note = await Note.findById(req.params.id);
  const canRead = note && (note.owner.equals(req.user!._id) || req.user!.role === 'admin');
  if (!canRead) throw new HttpError(404, 'Note not found');
  res.json(note);
});

notesRouter.patch('/:id', async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, owner: req.user!._id });
  if (!note) throw new HttpError(404, 'Note not found');

  const title = readString(req.body, 'title');
  if (title !== undefined) note.title = title;
  // content may be cleared, so an empty string is a valid update here
  if (req.body?.content !== undefined) note.content = readString(req.body, 'content') ?? '';
  await note.save();
  res.json(note);
});

notesRouter.delete('/:id', async (req, res) => {
  const note = await Note.findOneAndDelete({ _id: req.params.id, owner: req.user!._id });
  if (!note) throw new HttpError(404, 'Note not found');
  res.status(204).end();
});
