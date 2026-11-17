import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../utils/http.js';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ message: 'Not found' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      message: Object.values(err.errors)
        .map((e) => e.message)
        .join(', '),
    });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ message: `Invalid ${err.path}` });
    return;
  }
  if ((err as { code?: number }).code === 11000) {
    res.status(409).json({ message: 'Email is already in use' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ message: 'Malformed JSON body' });
    return;
  }

  // req.log is the request-scoped logger from pino-http, so the error line carries the request id
  req.log.error({ err }, 'Unhandled error');
  res.status(500).json({ message: 'Internal server error' });
}
