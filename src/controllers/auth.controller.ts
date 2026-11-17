import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { endSession, rotateSession, startSession } from '../session.js';
import { loginBody, registerBody } from '../validation.js';

export async function register(req: Request, res: Response) {
  const user = await authService.register(registerBody.parse(req.body));
  await startSession(res, user);
  res.status(201).json({ user });
}

export async function login(req: Request, res: Response) {
  const user = await authService.login(loginBody.parse(req.body));
  await startSession(res, user);
  res.json({ user });
}

// Called by the client when the access token has expired. Rotates the refresh token.
export async function refresh(req: Request, res: Response) {
  const user = await rotateSession(req, res);
  res.json({ user });
}

export async function logout(req: Request, res: Response) {
  await endSession(req, res);
  res.status(204).end();
}
