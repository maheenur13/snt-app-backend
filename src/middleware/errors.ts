import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError, sendError } from '../utils/http.js';

export function notFound(_req: Request, res: Response) {
  sendError(res, 404, 'Not found');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    sendError(res, err.status, err.message);
    return;
  }
  if (err instanceof ZodError) {
    sendError(res, 400, err.issues.map((issue) => issue.message).join(', '));
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    sendError(
      res,
      400,
      Object.values(err.errors)
        .map((e) => e.message)
        .join(', '),
    );
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    sendError(res, 400, `Invalid ${err.path}`);
    return;
  }
  if ((err as { code?: number }).code === 11000) {
    sendError(res, 409, 'Email is already in use');
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 400, 'Malformed JSON body');
    return;
  }

  // req.log is the request-scoped logger from pino-http, so the error line carries the request id
  req.log.error({ err }, 'Unhandled error');
  sendError(res, 500, 'Internal server error');
}
