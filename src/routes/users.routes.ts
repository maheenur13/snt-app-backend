import { Router } from 'express';
import * as users from '../controllers/users.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const usersRouter = Router();
usersRouter.use(authenticate);

// Any signed-in user. Fixed paths come before /:id so they aren't read as an id.
usersRouter.get('/me', users.me);
usersRouter.patch('/me', users.updateMe);
usersRouter.get('/by-interest', users.byInterest);
usersRouter.get('/:id/posts', users.posts);

// Admin only
const admin = requireRole('admin');
usersRouter.get('/', admin, users.list);
usersRouter.post('/', admin, users.create);
usersRouter.get('/:id', admin, users.get);
usersRouter.patch('/:id', admin, users.update);
usersRouter.delete('/:id', admin, users.remove);
