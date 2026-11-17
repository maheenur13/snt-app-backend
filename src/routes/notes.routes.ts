import { Router } from 'express';
import * as notes from '../controllers/notes.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const notesRouter = Router();
notesRouter.use(authenticate);

notesRouter.get('/', notes.listOwn);
notesRouter.post('/', notes.create);
notesRouter.get('/all', requireRole('admin'), notes.listAll);
notesRouter.get('/:id', notes.get);
notesRouter.patch('/:id', notes.update);
notesRouter.delete('/:id', notes.remove);
