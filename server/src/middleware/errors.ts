import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

export type AuthedUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'student' | 'instructor' | 'admin';
  avatarUrl?: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
    });
    return;
  }

  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `${first?.path.join('.') || 'input'}: ${first?.message ?? 'invalid input'}`,
        field: first?.path.join('.'),
      },
    });
    return;
  }

  console.error('[vertexlearn] unhandled error', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

/** Wrap async handlers so rejected promises reach the error middleware. */
export function ah<T extends (req: any, res: any, next: any) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}
