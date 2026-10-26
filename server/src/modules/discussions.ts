import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso } from '../db/index.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { forbidden, notFound } from '../utils/errors.js';

export const discussionsRouter = Router();
discussionsRouter.use(requireAuth);

function assertCourseMember(userId: string, role: string, courseId: string): void {
  if (role === 'admin') return;
  const course = db.prepare('SELECT instructor_id FROM courses WHERE id = ?').get(courseId) as
    | { instructor_id: string }
    | undefined;
  if (!course) throw notFound('Course not found');
  if (course.instructor_id === userId) return;
  const enrolled = db
    .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
    .get(userId, courseId);
  if (!enrolled) throw forbidden('Enroll in this course to join its discussion');
}

discussionsRouter.get('/courses/:id/threads', (req, res) => {
  assertCourseMember(req.user!.id, req.user!.role, req.params.id);
  const threads = db
    .prepare(
      `SELECT t.id, t.title, t.created_at, u.full_name AS author,
        (SELECT COUNT(*) FROM discussion_posts p WHERE p.thread_id = t.id) AS replies,
        (SELECT MAX(p.created_at) FROM discussion_posts p WHERE p.thread_id = t.id) AS last_reply
       FROM discussion_threads t JOIN users u ON u.id = t.created_by
       WHERE t.course_id = ? ORDER BY COALESCE(last_reply, t.created_at) DESC`,
    )
    .all(req.params.id);
  res.json({ threads });
});

discussionsRouter.post(
  '/courses/:id/threads',
  ah(async (req, res) => {
    assertCourseMember(req.user!.id, req.user!.role, req.params.id);
    const body = z
      .object({ title: z.string().trim().min(5).max(200), content: z.string().trim().min(5).max(6000) })
      .parse(req.body);
    const threadId = newId();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO discussion_threads (id, course_id, created_by, title, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(threadId, req.params.id, req.user!.id, body.title, nowIso());
      db.prepare(
        'INSERT INTO discussion_posts (id, thread_id, user_id, content, is_flagged, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      ).run(newId(), threadId, req.user!.id, body.content, nowIso());
    })();
    res.status(201).json({ thread: { id: threadId, title: body.title } });
  }),
);

discussionsRouter.get(
  '/threads/:id',
  ah(async (req, res) => {
    const thread = db.prepare('SELECT * FROM discussion_threads WHERE id = ?').get(req.params.id) as
      | { id: string; course_id: string; title: string; created_by: string; created_at: string }
      | undefined;
    if (!thread) throw notFound('Thread not found');
    assertCourseMember(req.user!.id, req.user!.role, thread.course_id);

    const posts = db
      .prepare(
        `SELECT p.id, p.content, p.is_flagged, p.created_at, u.id AS user_id, u.full_name AS author, u.avatar_url,
          (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name IN ('instructor','admin') LIMIT 1) AS staff_role
         FROM discussion_posts p JOIN users u ON u.id = p.user_id
         WHERE p.thread_id = ? ORDER BY p.created_at`,
      )
      .all(thread.id);

    res.json({ thread, posts });
  }),
);

discussionsRouter.post(
  '/threads/:id/posts',
  ah(async (req, res) => {
    const thread = db.prepare('SELECT * FROM discussion_threads WHERE id = ?').get(req.params.id) as
      | { id: string; course_id: string }
      | undefined;
    if (!thread) throw notFound('Thread not found');
    assertCourseMember(req.user!.id, req.user!.role, thread.course_id);

    const { content } = z.object({ content: z.string().trim().min(2).max(6000) }).parse(req.body);
    const id = newId();
    db.prepare(
      'INSERT INTO discussion_posts (id, thread_id, user_id, content, is_flagged, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(id, thread.id, req.user!.id, content, nowIso());

    const owner = db
      .prepare('SELECT instructor_id FROM courses WHERE id = ?')
      .get(thread.course_id) as { instructor_id: string };
    if (owner.instructor_id !== req.user!.id) {
      db.prepare(
        'INSERT INTO notifications (id, user_id, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      ).run(
        newId(),
        owner.instructor_id,
        'New discussion reply',
        `${req.user!.fullName} replied in "${thread.id.slice(0, 8)}…"`,
        `/threads/${thread.id}`,
        nowIso(),
      );
    }

    res.status(201).json({ post: { id, content, created_at: nowIso(), author: req.user!.fullName } });
  }),
);

discussionsRouter.post('/posts/:id/flag', (req, res, next) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const post = db.prepare('SELECT * FROM discussion_posts WHERE id = ?').get(req.params.id) as
    | { id: string; user_id: string }
    | undefined;
  if (!post) return next(notFound('Post not found'));
  if (post.user_id === req.user!.id) return next(forbidden('You cannot report your own post'));
  db.prepare('UPDATE discussion_posts SET is_flagged = 1 WHERE id = ?').run(post.id);
  const admins = db
    .prepare(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'`,
    )
    .all() as { id: string }[];
  for (const admin of admins) {
    db.prepare(
      'INSERT INTO notifications (id, user_id, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).run(
      newId(),
      admin.id,
      'Post reported',
      reason ? `Reason: ${reason}` : 'A discussion post was reported for review.',
      '/admin/moderation',
      nowIso(),
    );
  }
  res.json({ ok: true });
});
