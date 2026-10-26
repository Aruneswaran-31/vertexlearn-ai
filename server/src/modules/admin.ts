import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../db/index.js';
import { ah } from '../middleware/errors.js';
import { requireExactRole, requireAuth } from '../middleware/auth.js';
import { audit, notify } from '../services/activity.js';
import { badRequest, notFound } from '../utils/errors.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireExactRole('admin'));

adminRouter.get('/admin/users', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const role = String(req.query.role ?? '').trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (role) {
    where.push(
      `EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = ?)`,
    );
    params.push(role);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const users = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.is_active, u.created_at,
        (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id ORDER BY CASE r.name WHEN 'admin' THEN 3 WHEN 'instructor' THEN 2 ELSE 1 END DESC LIMIT 1) AS role,
        (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.id) AS enrollments,
        (SELECT COUNT(*) FROM courses c WHERE c.instructor_id = u.id) AS courses
       FROM users u ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, (page - 1) * limit);

  const total = db.prepare(`SELECT COUNT(*) AS count FROM users u ${whereSql}`).get(...params) as { count: number };
  res.json({ users, pagination: { page, limit, total: total.count, pages: Math.max(1, Math.ceil(total.count / limit)) } });
});

adminRouter.put('/admin/users/:id/role', (req, res, next) => {
  try {
    const { role } = z.object({ role: z.enum(['student', 'instructor', 'admin']) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; full_name: string }
      | undefined;
    if (!user) throw notFound('User not found');
    if (user.id === req.user!.id && role !== 'admin') throw badRequest('You cannot remove your own admin role');

    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number };
    db.transaction(() => {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(user.id);
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(user.id, roleRow.id);
    })();
    notify(user.id, 'Your role was updated', `An administrator changed your role to ${role}.`, '/dashboard');
    audit(req.user!.id, 'user.role', 'user', user.id, { role });
    res.json({ ok: true, role });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/admin/users/:id/suspend', (req, res, next) => {
  try {
    const { is_active } = z.object({ is_active: z.boolean() }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; full_name: string }
      | undefined;
    if (!user) throw notFound('User not found');
    if (user.id === req.user!.id) throw badRequest('You cannot suspend your own account');
    db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(
      is_active ? 1 : 0,
      nowIso(),
      user.id,
    );
    if (is_active) notify(user.id, 'Account reinstated', 'Your account access has been restored.', '/dashboard');
    audit(req.user!.id, is_active ? 'user.reactivate' : 'user.suspend', 'user', user.id);
    res.json({ ok: true, is_active });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/admin/courses/pending', (_req, res) => {
  const courses = db
    .prepare(
      `SELECT c.*, u.full_name AS instructor_name, u.email AS instructor_email,
        (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id) AS modules,
        (SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lectures
       FROM courses c JOIN users u ON u.id = c.instructor_id
       WHERE c.status = 'pending' ORDER BY c.created_at ASC`,
    )
    .all();
  const history = db
    .prepare(
      `SELECT ca.*, c.title, u.full_name AS reviewer FROM course_approvals ca
       JOIN courses c ON c.id = ca.course_id LEFT JOIN users u ON u.id = ca.reviewed_by
       ORDER BY ca.reviewed_at DESC LIMIT 10`,
    )
    .all();
  res.json({ courses, recent_decisions: history });
});

adminRouter.get(
  '/admin/analytics/overview',
  ah(async (req, res) => {
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const students = db
      .prepare(
        `SELECT COUNT(DISTINCT ur.user_id) AS count FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'student'`,
      )
      .get() as { count: number };
    const instructors = db
      .prepare(
        `SELECT COUNT(DISTINCT ur.user_id) AS count FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'instructor'`,
      )
      .get() as { count: number };
    const courses = db
      .prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending FROM courses`)
      .get() as { total: number; approved: number; pending: number };
    const enrollments = db.prepare('SELECT COUNT(*) AS count FROM enrollments').get() as { count: number };
    const completion = db
      .prepare(
        `SELECT COALESCE(AVG(progress_percent), 0) AS avg_progress,
          SUM(CASE WHEN progress_percent >= 100 THEN 1 ELSE 0 END) AS completed FROM enrollments`,
      )
      .get() as { avg_progress: number; completed: number };
    const revenue = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'success'")
      .get() as { total: number };
    const dau = db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS count FROM (
          SELECT s.user_id FROM ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id
            WHERE m.created_at >= datetime('now', '-1 day')
          UNION SELECT u.id FROM users u WHERE u.updated_at >= datetime('now', '-1 day')
          UNION SELECT e.user_id FROM lecture_progress lp JOIN enrollments e ON e.id = lp.enrollment_id
            WHERE lp.last_watched_at >= datetime('now', '-1 day')
        )`,
      )
      .get() as { count: number };

    const enrollmentsByDay = db
      .prepare(
        `SELECT date(enrolled_at) AS day, COUNT(*) AS count FROM enrollments
         WHERE enrolled_at >= date('now', '-13 days') GROUP BY date(enrolled_at) ORDER BY day`,
      )
      .all() as { day: string; count: number }[];

    const topCourses = db
      .prepare(
        `SELECT c.title, c.category, COUNT(e.id) AS learners,
          COALESCE(AVG(e.progress_percent), 0) AS avg_progress
         FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id
         WHERE c.status = 'approved' GROUP BY c.id ORDER BY learners DESC LIMIT 5`,
      )
      .all() as { title: string; category: string; learners: number; avg_progress: number }[];

    const aiMessages = db
      .prepare("SELECT COUNT(*) AS count FROM ai_chat_messages WHERE sender = 'user'")
      .get() as { count: number };
    const quizAttempts = db
      .prepare('SELECT COUNT(*) AS count, COALESCE(AVG(score), 0) AS avg FROM quiz_attempts WHERE submitted_at IS NOT NULL')
      .get() as { count: number; avg: number };

    res.json({
      users: {
        total: users.count,
        students: students.count,
        instructors: instructors.count,
        new_7d: (db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get() as { count: number }).count,
        dau: dau.count,
      },
      courses,
      enrollments: {
        total: enrollments.count,
        avg_progress: Math.round(completion.avg_progress * 10) / 10,
        completed: completion.completed,
        completion_rate: enrollments.count ? Math.round((completion.completed / enrollments.count) * 1000) / 10 : 0,
      },
      ai: { tutor_messages: aiMessages.count },
      quizzes: { attempts: quizAttempts.count, avg_score: Math.round(quizAttempts.avg * 10) / 10 },
      revenue: { total: Math.round(revenue.total * 100) / 100, currency: 'USD' },
      enrollments_by_day: enrollmentsByDay,
      top_courses: topCourses.map((course) => ({ ...course, avg_progress: Math.round(course.avg_progress * 10) / 10 })),
      audit_logs: db
        .prepare(
          `SELECT al.*, u.full_name AS actor FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
           ORDER BY al.created_at DESC LIMIT 15`,
        )
        .all(),
    });
  }),
);

adminRouter.get('/admin/moderation/flagged-posts', (_req, res) => {
  const posts = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, t.title AS thread_title, t.id AS thread_id, c.title AS course_title,
        u.full_name AS author, u.email AS author_email
       FROM discussion_posts p JOIN discussion_threads t ON t.id = p.thread_id
       JOIN courses c ON c.id = t.course_id JOIN users u ON u.id = p.user_id
       WHERE p.is_flagged = 1 ORDER BY p.created_at DESC`,
    )
    .all();
  res.json({ posts });
});

adminRouter.put('/admin/moderation/posts/:id', (req, res, next) => {
  try {
    const { action } = z.object({ action: z.enum(['dismiss', 'remove']) }).parse(req.body);
    const post = db.prepare('SELECT * FROM discussion_posts WHERE id = ?').get(req.params.id) as
      | { id: string }
      | undefined;
    if (!post) throw notFound('Post not found');
    if (action === 'remove') {
      db.prepare('DELETE FROM discussion_posts WHERE id = ?').run(post.id);
    } else {
      db.prepare('UPDATE discussion_posts SET is_flagged = 0 WHERE id = ?').run(post.id);
    }
    audit(req.user!.id, `moderation.${action}`, 'discussion_post', post.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
