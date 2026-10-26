import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { AuthedUser } from './errors.js';

type TokenPayload = {
  sub: string;
  role: AuthedUser['role'];
  email: string;
  name: string;
  avatar?: string | null;
  type: 'access' | 'refresh';
};

const roleRank: Record<AuthedUser['role'], number> = { student: 1, instructor: 2, admin: 3 };

export function signAccessToken(user: AuthedUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.fullName,
    avatar: user.avatarUrl,
    type: 'access',
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.accessTokenTtl as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, env.jwtSecret, {
    expiresIn: `${env.refreshTokenTtlDays}d` as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtSecret) as TokenPayload;
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

/** Attach the authenticated user when a valid access token is present. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    if (payload.type === 'access') {
      req.user = {
        id: payload.sub,
        email: payload.email,
        fullName: payload.name,
        role: payload.role,
        avatarUrl: payload.avatar,
      };
    }
  } catch {
    // Ignore invalid tokens on optional routes.
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (!token) return next(unauthorized());
  try {
    const payload = verifyToken(token);
    if (payload.type !== 'access') return next(unauthorized('Invalid token type'));
    const active = db.prepare('SELECT is_active FROM users WHERE id = ?').get(payload.sub) as
      | { is_active: number }
      | undefined;
    if (!active) return next(unauthorized('Account no longer exists'));
    if (!active.is_active) return next(forbidden('This account has been suspended'));
    req.user = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.name,
      role: payload.role,
      avatarUrl: payload.avatar,
    };
    next();
  } catch {
    next(unauthorized('Session expired, please sign in again'));
  }
}

export function requireRole(...roles: AuthedUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    const allowed = roles.some((role) => roleRank[req.user!.role] >= roleRank[role]);
    if (!allowed) return next(forbidden('This area is restricted'));
    next();
  };
}

export function requireExactRole(...roles: AuthedUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('This area is restricted'));
    next();
  };
}

/** Instructors may only mutate their own courses; admins may touch any course. */
export function assertCourseAccess(
  req: Request,
  course: { instructor_id: string } | undefined,
): void {
  if (!course) throw forbidden('Course not found');
  if (req.user?.role === 'admin') return;
  if (req.user?.role === 'instructor' && course.instructor_id === req.user.id) return;
  throw forbidden('You can only manage your own courses');
}
