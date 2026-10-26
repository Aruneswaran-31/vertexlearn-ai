import type { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window in-memory rate limiter. The PRD specifies Redis for a multi-node
 * deployment; this single-node implementation keeps the same limits and headers.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  scope: 'ip' | 'user';
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const identity =
      options.scope === 'user' && req.user ? `u:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const key = `${req.method}:${req.baseUrl}${req.path}:${identity}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    const current = !bucket || bucket.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : bucket;

    current.count += 1;
    buckets.set(key, current);

    const remaining = Math.max(0, options.max - current.count);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

    if (current.count > options.max) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: options.message ?? 'Too many requests. Please slow down and try again shortly.',
        },
      });
      return;
    }

    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    next();
  };
}
