import type { Request } from 'express';
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

export function paginated<T>(items: T[], total: number, { page, limit }: Pagination) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}
