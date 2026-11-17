import type { Types } from 'mongoose';
import type { z } from 'zod';
import { Note } from '../models/Note.js';
import type { UserDocument } from '../models/User.js';
import { HttpError, type Pagination } from '../utils/http.js';
import type { createNoteBody, updateNoteBody } from '../validation.js';

// Own notes, newest first. Uses { owner: 1, _id: -1 }.
export async function listOwn(owner: Types.ObjectId, { skip, limit }: Pagination) {
  const [items, total] = await Promise.all([
    Note.find({ owner }).sort({ _id: -1 }).skip(skip).limit(limit),
    Note.countDocuments({ owner }),
  ]);
  return { items, total };
}

// Everyone's notes (admin). Sorted by _id, so the default _id index is enough.
export async function listAll({ skip, limit }: Pagination) {
  const [items, total] = await Promise.all([
    Note.find().sort({ _id: -1 }).skip(skip).limit(limit).populate('owner', 'name email'),
    Note.estimatedDocumentCount(),
  ]);
  return { items, total };
}

export function create(owner: Types.ObjectId, data: z.infer<typeof createNoteBody>) {
  return Note.create({ ...data, owner });
}

/** The owner and admins can read a note; anyone else gets the same 404 as for a missing note. */
export async function getReadable(id: string, user: UserDocument) {
  const note = await Note.findById(id);
  if (!note || !(note.owner.equals(user._id) || user.role === 'admin')) throw new HttpError(404, 'Note not found');
  return note;
}

/** Only the owner can change a note, including admins on other people's notes. */
export async function update(id: string, owner: Types.ObjectId, changes: z.infer<typeof updateNoteBody>) {
  const note = await Note.findOne({ _id: id, owner });
  if (!note) throw new HttpError(404, 'Note not found');
  note.set(changes);
  return note.save();
}

export async function remove(id: string, owner: Types.ObjectId) {
  const note = await Note.findOneAndDelete({ _id: id, owner });
  if (!note) throw new HttpError(404, 'Note not found');
}
