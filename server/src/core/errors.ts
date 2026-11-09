import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, 'VALIDATION_ERROR', msg, details);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0] ? `${err.issues[0].path.join('.') || 'input'}: ${err.issues[0].message}` : 'Invalid input',
        fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // body-parser errors (malformed JSON, too large)
  if (err && typeof err === 'object' && 'type' in err && 'status' in err) {
    const e = err as { status: number; message: string };
    res.status(e.status).json({ error: { code: 'BAD_REQUEST', message: e.message } });
    return;
  }
  // MySQL duplicate key → 409
  if (err && typeof err === 'object' && (err as { code?: string }).code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists' } });
    return;
  }
  const cause = (err as { cause?: { code?: string } })?.cause;
  if (cause?.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists' } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
