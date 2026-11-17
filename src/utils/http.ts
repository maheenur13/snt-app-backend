import type { Request } from 'express';

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

const MAX_LIMIT = 100;
// keeps skip a valid integer for MongoDB; a bigger page number would only ever be empty anyway
const MAX_PAGE = 100_000;

export function getPagination(req: Request): Pagination {
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(String(req.query.page), 10) || 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(String(req.query.limit), 10) || 10));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, { page, limit }: Pagination) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

// Request bodies are untrusted: only accept plain strings so nobody can slip in a query operator like { $gt: '' }.
export function readString(body: unknown, field: string, { required = false } = {}): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  return value;
}

export function readStringArray(body: unknown, field: string): string[] | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new HttpError(400, `${field} must be an array of strings`);
  }
  return value;
}
