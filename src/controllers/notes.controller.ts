import type { Request, Response } from 'express';
import * as notesService from '../services/notes.service.js';
import { getPagination, paginated } from '../utils/http.js';
import { createNoteBody, updateNoteBody } from '../validation.js';

export async function listOwn(req: Request, res: Response) {
  const pagination = getPagination(req);
  const { items, total } = await notesService.listOwn(req.user!._id, pagination);
  res.json(paginated(items, total, pagination));
}

export async function listAll(req: Request, res: Response) {
  const pagination = getPagination(req);
  const { items, total } = await notesService.listAll(pagination);
  res.json(paginated(items, total, pagination));
}

export async function create(req: Request, res: Response) {
  const note = await notesService.create(req.user!._id, createNoteBody.parse(req.body));
  res.status(201).json(note);
}

export async function get(req: Request<{ id: string }>, res: Response) {
  res.json(await notesService.getReadable(req.params.id, req.user!));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  res.json(await notesService.update(req.params.id, req.user!._id, updateNoteBody.parse(req.body)));
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  await notesService.remove(req.params.id, req.user!._id);
  res.status(204).end();
}
