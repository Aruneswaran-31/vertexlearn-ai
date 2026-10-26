import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, newId, nowIso } from '../db/index.js';
import { env } from '../env.js';
import { ah } from '../middleware/errors.js';
import type { AuthedUser } from '../middleware/errors.js';
import { requireAuth, signAccessToken, signRefreshToken, verifyToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { notify, touchStreak } from '../services/activity.js';
import { badRequest, conflict, unauthorized } from '../utils/errors.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  scope: 'ip',
  message: 'Too many authentication attempts. Try again in a minute.',
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'must be at least 2 characters').max(150),
  email: z.string().trim().toLowerCase().email('must be a valid email address'),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
  role: z.enum(['student', 'instructor']).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

type UserRow = {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  avatar_url: string | null;
  headline: string | null;
  is_active: number;
  created_at: string;
};

function roleOf(userId: string): AuthedUser['role'] {
  const rows = db
    .prepare(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    )
    .all(userId) as { name: string }[];
  const names = rows.map((r) => r.name);
  if (names.includes('admin')) return 'admin';
  if (names.includes('instructor')) return 'instructor';
  return 'student';
}

export function publicUser(user: UserRow) {
  const role = roleOf(user.id);
  const streak = db
    .prepare('SELECT current_streak, longest_streak FROM streaks WHERE user_id = ?')
    .get(user.id) as { current_streak: number; longest_streak: number } | undefined;
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    avatar_url: user.avatar_url,
    headline: user.headline,
    role,
    is_active: Boolean(user.is_active),
    created_at: user.created_at,
    streak: { current: streak?.current_streak ?? 0, longest: streak?.longest_streak ?? 0 },
  };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueSession(user: UserRow) {
  const authed: AuthedUser = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: roleOf(user.id),
    avatarUrl: user.avatar_url,
  };
  const accessToken = signAccessToken(authed);
  const refreshToken = signRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000).toISOString();
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)',
  ).run(newId(), user.id, hashToken(refreshToken), expiresAt, nowIso());
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 60 * 30,
    user: publicUser(user),
  };
}

authRouter.post(
  '/register',
  authLimiter,
  ah(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (existing) throw conflict('An account with this email already exists', 'email');

    const userId = newId();
    const passwordHash = await bcrypt.hash(body.password, 10);
    const role = body.role ?? 'student';
    db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, full_name, email, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      ).run(userId, body.fullName, body.email, passwordHash, nowIso(), nowIso());
      const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number };
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleRow.id);
      db.prepare('INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date) VALUES (?, 0, 0, NULL)').run(userId);
    })();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    notify(
      userId,
      'Welcome to VertexLearn AI 👋',
      role === 'instructor'
        ? 'Create your first course and let the AI assistant draft quizzes from your lecture transcripts.'
        : 'Browse the catalog, enroll in a course and meet your AI tutor. It only answers from course material.',
      role === 'instructor' ? '/instructor' : '/catalog',
    );
    touchStreak(userId);

    res.status(201).json(issueSession(user));
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as
      | UserRow
      | undefined;
    if (!user) throw unauthorized('Email or password is incorrect');
    if (!user.is_active) throw unauthorized('This account has been suspended');
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) throw unauthorized('Email or password is incorrect');
    touchStreak(user.id);
    res.json(issueSession(user));
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const token = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
    if (!token) throw badRequest('refresh_token is required', 'refresh_token');
    let payload: { sub: string; type: string };
    try {
      payload = verifyToken(token);
    } catch {
      throw unauthorized('Refresh token is invalid or expired');
    }
    if (payload.type !== 'refresh') throw unauthorized('Invalid token type');

    const stored = db
      .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0')
      .get(hashToken(token)) as { id: string; expires_at: string } | undefined;
    if (!stored || stored.expires_at < nowIso()) throw unauthorized('Refresh token is no longer valid');

    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(stored.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined;
    if (!user || !user.is_active) throw unauthorized('Account unavailable');
    res.json(issueSession(user));
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    const token = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
    if (token) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(hashToken(token));
    }
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
  res.json({ user: publicUser(user) });
});
