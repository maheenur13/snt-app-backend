import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { signToken } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { HttpError, readString } from '../utils/http.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const user = await User.create({
    name: readString(req.body, 'name', { required: true }),
    email: readString(req.body, 'email', { required: true }),
    password: readString(req.body, 'password', { required: true }),
  });
  res.status(201).json({ token: signToken(user), user });
});

authRouter.post('/login', async (req, res) => {
  const email = readString(req.body, 'email', { required: true })!;
  const password = readString(req.body, 'password', { required: true })!;

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  res.json({ token: signToken(user), user });
});
