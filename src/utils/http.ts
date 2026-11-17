import type { Request, Response } from 'express';
import { paginationQuery } from '../validation.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export function getPagination(req: Request): Pagination {
  const { page, limit } = paginationQuery.parse(req.query);
  return { page, limit, skip: (page - 1) * limit };
}

// Every response uses one envelope: { success, data, meta? } on success, { success: false, message } on error.
export function sendData(res: Response, data: unknown, status = 200) {
  res.status(status).json({ success: true, data });
}

export function sendPage<T>(
  res: Response,
  items: T[],
  total: number,
  { page, limit }: Pagination,
  extra?: Record<string, unknown>,
) {
  res.json({
    success: true,
    data: items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit), ...extra },
  });
}

export function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, message });
}
