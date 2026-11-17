import type { Request, Response } from 'express';
import * as usersService from '../services/users.service.js';
import { getPagination, sendData, sendPage } from '../utils/http.js';
import { createUserBody, updateProfileBody, updateUserBody } from '../validation.js';

export function me(req: Request, res: Response) {
  sendData(res, req.user);
}

export async function updateMe(req: Request, res: Response) {
  sendData(res, await usersService.updateProfile(req.user!, updateProfileBody.parse(req.body)));
}

export async function byInterest(req: Request, res: Response) {
  const pagination = getPagination(req);
  const { items, total } = await usersService.groupByInterest(pagination);
  sendPage(res, items, total, pagination);
}

export async function posts(req: Request<{ id: string }>, res: Response) {
  const pagination = getPagination(req);
  const { user, items, total } = await usersService.postsOfUser(req.params.id, pagination);
  // the author goes in meta so the list keeps the same shape as every other list
  sendPage(res, items, total, pagination, { user });
}

// ---- Admin ----

export async function list(req: Request, res: Response) {
  const pagination = getPagination(req);
  const { items, total } = await usersService.list(pagination);
  sendPage(res, items, total, pagination);
}

export async function create(req: Request, res: Response) {
  sendData(res, await usersService.create(createUserBody.parse(req.body)), 201);
}

export async function get(req: Request<{ id: string }>, res: Response) {
  sendData(res, await usersService.getById(req.params.id));
}

export async function update(req: Request<{ id: string }>, res: Response) {
  sendData(res, await usersService.update(req.params.id, updateUserBody.parse(req.body), req.user!));
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  await usersService.remove(req.params.id, req.user!);
  res.status(204).end();
}
