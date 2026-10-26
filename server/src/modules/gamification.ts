import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../db/index.js';
import { refreshRecommendations } from '../ai/engine.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';
import { notFound } from '../utils/errors.js';

export const gamificationRouter = Router();
gamificationRouter.use(requireAuth);

gamificationRouter.get('/users/me/badges', (req, res) => {
  const badges = db
    .prepare(
      `SELECT b.slug, b.name, b.description, b.icon, b.criteria, ub.earned_at
       FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
       ORDER BY (ub.earned_at IS NULL), ub.earned_at`,
    )
    .all(req.user!.id) as {
    slug: string;
    name: string;
    description: string;
    icon: string;
    criteria: string;
    earned_at: string | null;
  }[];

  res.json({
    badges: badges.map((badge) => ({ ...badge, earned: Boolean(badge.earned_at) })),
    earned_count: badges.filter((badge) => badge.earned_at).length,
  });
});

gamificationRouter.get('/users/me/streak', (req, res) => {
  const streak = db
    .prepare('SELECT * FROM streaks WHERE user_id = ?')
    .get(req.user!.id) as
    | { current_streak: number; longest_streak: number; last_active_date: string | null }
    | undefined;

  const activity = db
    .prepare(
      `SELECT date(last_watched_at) AS day, COUNT(*) AS lectures
       FROM lecture_progress WHERE enrollment_id IN (SELECT id FROM enrollments WHERE user_id = ?)
         AND last_watched_at >= date('now', '-13 days')
       GROUP BY date(last_watched_at)`,
    )
    .all(req.user!.id) as { day: string; lectures: number }[];

  res.json({
    current: streak?.current_streak ?? 0,
    longest: streak?.longest_streak ?? 0,
    last_active_date: streak?.last_active_date ?? null,
    activity,
  });
});

gamificationRouter.get(
  '/recommendations/me',
  ah(async (req, res) => {
    const recommendations = refreshRecommendations(req.user!.id);
    res.json({ recommendations });
  }),
);

gamificationRouter.put('/users/me', (req, res) => {
  const body = z
    .object({
      full_name: z.string().trim().min(2).max(150).optional(),
      headline: z.string().trim().max(160).optional(),
      avatar_url: z.string().trim().url().max(500).optional().or(z.literal('')),
    })
    .parse(req.body);

  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as {
    full_name: string;
    headline: string | null;
    avatar_url: string | null;
  };

  db.prepare('UPDATE users SET full_name = ?, headline = ?, avatar_url = ?, updated_at = ? WHERE id = ?').run(
    body.full_name ?? current.full_name,
    body.headline ?? current.headline,
    body.avatar_url === '' ? null : (body.avatar_url ?? current.avatar_url),
    nowIso(),
    req.user!.id,
  );

  res.json({ ok: true });
});

gamificationRouter.get('/notifications', (req, res) => {
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
    .all(req.user!.id);
  const unread = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user!.id) as { count: number };
  res.json({ notifications, unread: unread.count });
});

gamificationRouter.put('/notifications/:id/read', (req, res, next) => {
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id) as
    | { id: string; user_id: string }
    | undefined;
  if (!notification) return next(notFound('Notification not found'));
  if (notification.user_id !== req.user!.id) return next(notFound('Notification not found'));
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notification.id);
  res.json({ ok: true });
});

gamificationRouter.put('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

/** Aggregated view used by the instructor landing page. */
gamificationRouter.get('/instructor/overview', requireRole('instructor'), (req, res) => {
  const scope = req.user!.role === 'admin' ? '' : 'WHERE c.instructor_id = ?';
  const params = req.user!.role === 'admin' ? [] : [req.user!.id];

  const courses = db
    .prepare(
      `SELECT c.id, c.title, c.status, c.category, c.difficulty,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learners,
        (SELECT COALESCE(AVG(e.progress_percent), 0) FROM enrollments e WHERE e.course_id = c.id) AS avg_progress,
        (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id) AS modules,
        (SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lectures
       FROM courses c ${scope} ORDER BY c.created_at DESC`,
    )
    .all(...params) as {
    id: string;
    title: string;
    status: string;
    category: string;
    difficulty: string;
    learners: number;
    avg_progress: number;
    modules: number;
    lectures: number;
  }[];

  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT e.user_id) AS learners,
        COALESCE(AVG(e.progress_percent), 0) AS avg_progress,
        COALESCE(SUM(CASE WHEN e.progress_percent >= 100 THEN 1 ELSE 0 END), 0) AS completions
       FROM enrollments e JOIN courses c ON c.id = e.course_id ${scope}`,
    )
    .get(...params) as { learners: number; avg_progress: number; completions: number };

  const ungraded = db
    .prepare(
      `SELECT COUNT(*) AS count FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id
       WHERE s.grade IS NULL ${req.user!.role === 'admin' ? '' : 'AND c.instructor_id = ?'}`,
    )
    .get(...params) as { count: number };

  const recentSubmissions = db
    .prepare(
      `SELECT s.id, s.submitted_at, s.grade, u.full_name AS student, a.title AS assignment,
        c.title AS course
       FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = s.user_id
       ${req.user!.role === 'admin' ? '' : 'WHERE c.instructor_id = ?'}
       ORDER BY s.submitted_at DESC LIMIT 6`,
    )
    .all(...params);

  res.json({
    courses: courses.map((course) => ({
      ...course,
      avg_progress: Math.round(course.avg_progress * 10) / 10,
    })),
    overview: {
      courses: courses.length,
      published: courses.filter((course) => course.status === 'approved').length,
      pending: courses.filter((course) => course.status === 'pending').length,
      learners: totals.learners,
      avg_progress: Math.round(totals.avg_progress * 10) / 10,
      completions: totals.completions,
      ungraded_submissions: ungraded.count,
    },
    recent_submissions: recentSubmissions,
  });
});
