import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso } from '../db/index.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { awardBadge, notify, recalcProgress, touchStreak } from '../services/activity.js';
import { renderCertificate } from '../services/certificate.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';

export const enrollmentsRouter = Router();
enrollmentsRouter.use(requireAuth);

function enrollmentFor(userId: string, lectureId: string) {
  return db
    .prepare(
      `SELECT e.*, l.id AS lecture_id, l.title AS lecture_title, l.duration_seconds, m.course_id,
              c.title AS course_title
       FROM lectures l
       JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
       JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?
       WHERE l.id = ?`,
    )
    .get(userId, lectureId) as
    | {
        id: string;
        user_id: string;
        course_id: string;
        course_title: string;
        lecture_id: string;
        lecture_title: string;
        duration_seconds: number;
        progress_percent: number;
      }
    | undefined;
}

enrollmentsRouter.post(
  '/courses/:id/enroll',
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | { id: string; title: string; status: string; instructor_id: string }
      | undefined;
    if (!course || course.status !== 'approved') throw notFound('Course not found');
    if (course.instructor_id === req.user!.id) throw badRequest('You cannot enroll in your own course');

    const existing = db
      .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
      .get(req.user!.id, course.id);
    if (existing) return res.json({ ok: true, already_enrolled: true });

    const id = newId();
    db.prepare(
      'INSERT INTO enrollments (id, user_id, course_id, enrolled_at, progress_percent) VALUES (?, ?, ?, ?, 0)',
    ).run(id, req.user!.id, course.id, nowIso());
    notify(
      req.user!.id,
      `Enrolled in ${course.title}`,
      'Your AI tutor is ready — it answers only from this course’s lectures, with citations.',
      `/courses/${course.id}/learn`,
    );
    touchStreak(req.user!.id);
    res.status(201).json({ ok: true, enrollment_id: id });
  }),
);

enrollmentsRouter.get(
  '/enrollments/me',
  ah(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT e.id, e.progress_percent, e.enrolled_at, e.completed_at,
          c.id AS course_id, c.title, c.category, c.difficulty, c.thumbnail_url,
          u.full_name AS instructor_name,
          (SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS total_lectures,
          (SELECT COUNT(*) FROM lecture_progress lp JOIN lectures l ON l.id = lp.lecture_id
             JOIN modules m ON m.id = l.module_id WHERE lp.enrollment_id = e.id AND lp.completed = 1) AS completed_lectures,
          (SELECT AVG(qa.score) FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
             JOIN modules m ON m.id = q.module_id WHERE m.course_id = c.id AND qa.user_id = e.user_id AND qa.submitted_at IS NOT NULL) AS avg_score,
          (SELECT l.id FROM lectures l JOIN modules m ON m.id = l.module_id
             LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = e.id
             WHERE m.course_id = c.id AND COALESCE(lp.completed, 0) = 0
             ORDER BY m.order_index, l.order_index LIMIT 1) AS next_lecture_id,
          (SELECT l.title FROM lectures l JOIN modules m ON m.id = l.module_id
             LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = e.id
             WHERE m.course_id = c.id AND COALESCE(lp.completed, 0) = 0
             ORDER BY m.order_index, l.order_index LIMIT 1) AS next_lecture_title
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN users u ON u.id = c.instructor_id
         WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`,
      )
      .all(req.user!.id) as Record<string, unknown>[];

    const dueAssignments = db
      .prepare(
        `SELECT a.id, a.title, a.due_date, c.title AS course_title, c.id AS course_id,
          (SELECT id FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.user_id = ?) AS submission_id,
          (SELECT grade FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.user_id = ?) AS grade
         FROM assignments a
         JOIN enrollments e ON e.course_id = a.course_id AND e.user_id = ?
         JOIN courses c ON c.id = a.course_id
         WHERE e.user_id = ? ORDER BY a.due_date ASC LIMIT 8`,
      )
      .all(req.user!.id, req.user!.id, req.user!.id, req.user!.id);

    const streak = db
      .prepare('SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = ?')
      .get(req.user!.id) as
      | { current_streak: number; longest_streak: number; last_active_date: string | null }
      | undefined;

    res.json({
      enrollments: rows,
      due_assignments: dueAssignments,
      streak: {
        current: streak?.current_streak ?? 0,
        longest: streak?.longest_streak ?? 0,
        last_active_date: streak?.last_active_date ?? null,
      },
    });
  }),
);

enrollmentsRouter.post(
  '/lectures/:id/progress',
  ah(async (req, res) => {
    const body = z
      .object({
        watched_seconds: z.coerce.number().int().min(0).optional(),
        completed: z.boolean().optional(),
      })
      .parse(req.body);
    const context = enrollmentFor(req.user!.id, req.params.id);
    if (!context) throw forbidden('Enroll in this course to track progress');

    const existing = db
      .prepare('SELECT * FROM lecture_progress WHERE enrollment_id = ? AND lecture_id = ?')
      .get(context.id, context.lecture_id) as
      | { id: string; watched_seconds: number; completed: number }
      | undefined;

    const watched = Math.min(
      context.duration_seconds || 86_400,
      Math.max(existing?.watched_seconds ?? 0, body.watched_seconds ?? 0),
    );
    const completed = body.completed ?? Boolean(existing?.completed) ?? false;

    if (existing) {
      db.prepare(
        'UPDATE lecture_progress SET watched_seconds = ?, completed = ?, last_watched_at = ? WHERE id = ?',
      ).run(watched, completed ? 1 : 0, nowIso(), existing.id);
    } else {
      db.prepare(
        'INSERT INTO lecture_progress (id, enrollment_id, lecture_id, watched_seconds, completed, last_watched_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(newId(), context.id, context.lecture_id, watched, completed ? 1 : 0, nowIso());
    }

    touchStreak(req.user!.id);
    if (completed) awardBadge(req.user!.id, 'first_steps');
    const progress = recalcProgress(context.id);

    res.json({ progress_percent: progress, watched_seconds: watched, completed });
  }),
);

/* ----------------------------- Notes ----------------------------- */

enrollmentsRouter.get(
  '/lectures/:id/notes',
  ah(async (req, res) => {
    const notes = db
      .prepare('SELECT * FROM notes WHERE user_id = ? AND lecture_id = ? ORDER BY timestamp_seconds')
      .all(req.user!.id, req.params.id);
    const bookmarks = db
      .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND lecture_id = ? ORDER BY timestamp_seconds')
      .all(req.user!.id, req.params.id);
    res.json({ notes, bookmarks });
  }),
);

enrollmentsRouter.post(
  '/lectures/:id/notes',
  ah(async (req, res) => {
    const body = z
      .object({ content: z.string().trim().min(1).max(4000), timestamp_seconds: z.coerce.number().int().min(0).default(0) })
      .parse(req.body);
    const context = enrollmentFor(req.user!.id, req.params.id);
    if (!context) throw forbidden('Enroll in this course to take notes');
    const id = newId();
    db.prepare('INSERT INTO notes (id, user_id, lecture_id, timestamp_seconds, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      req.user!.id,
      req.params.id,
      body.timestamp_seconds,
      body.content,
      nowIso(),
    );
    res.status(201).json({ note: { id, content: body.content, timestamp_seconds: body.timestamp_seconds, created_at: nowIso() } });
  }),
);

enrollmentsRouter.delete('/notes/:id', (req, res, next) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as
    | { id: string; user_id: string }
    | undefined;
  if (!note) return next(notFound('Note not found'));
  if (note.user_id !== req.user!.id) return next(forbidden());
  db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
  res.json({ ok: true });
});

enrollmentsRouter.post(
  '/lectures/:id/bookmarks',
  ah(async (req, res) => {
    const body = z
      .object({ timestamp_seconds: z.coerce.number().int().min(0).default(0), label: z.string().trim().max(160).optional() })
      .parse(req.body);
    const context = enrollmentFor(req.user!.id, req.params.id);
    if (!context) throw forbidden('Enroll in this course to add bookmarks');
    const id = newId();
    db.prepare('INSERT INTO bookmarks (id, user_id, lecture_id, timestamp_seconds, label, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      req.user!.id,
      req.params.id,
      body.timestamp_seconds,
      body.label ?? null,
      nowIso(),
    );
    res.status(201).json({ bookmark: { id, timestamp_seconds: body.timestamp_seconds, label: body.label ?? null } });
  }),
);

enrollmentsRouter.delete('/bookmarks/:id', (req, res, next) => {
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(req.params.id) as
    | { id: string; user_id: string }
    | undefined;
  if (!bookmark) return next(notFound('Bookmark not found'));
  if (bookmark.user_id !== req.user!.id) return next(forbidden());
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmark.id);
  res.json({ ok: true });
});

/* -------------------------- Certificates -------------------------- */

enrollmentsRouter.get('/certificates/me', (req, res) => {
  const certificates = db
    .prepare(
      `SELECT ct.id, ct.issued_at, ct.certificate_url, c.title AS course_title, c.id AS course_id,
        u.full_name AS instructor_name
       FROM certificates ct JOIN courses c ON c.id = ct.course_id
       JOIN users u ON u.id = c.instructor_id WHERE ct.user_id = ? ORDER BY ct.issued_at DESC`,
    )
    .all(req.user!.id);
  res.json({ certificates });
});

enrollmentsRouter.get(
  '/certificates/:id/download',
  ah(async (req, res) => {
    const certificate = db
      .prepare(
        `SELECT ct.*, u.full_name AS student_name, c.title AS course_title, i.full_name AS instructor_name
         FROM certificates ct JOIN users u ON u.id = ct.user_id
         JOIN courses c ON c.id = ct.course_id
         JOIN users i ON i.id = c.instructor_id
         WHERE ct.id = ?`,
      )
      .get(req.params.id) as
      | {
          id: string;
          user_id: string;
          student_name: string;
          course_title: string;
          instructor_name: string;
          issued_at: string;
        }
      | undefined;
    if (!certificate) throw notFound('Certificate not found');
    if (certificate.user_id !== req.user!.id && req.user!.role !== 'admin') {
      throw forbidden('This certificate belongs to another learner');
    }

    const pdf = await renderCertificate({
      studentName: certificate.student_name,
      courseTitle: certificate.course_title,
      instructorName: certificate.instructor_name,
      issuedAt: certificate.issued_at,
      certificateId: certificate.id,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="VertexLearn-Certificate-${certificate.course_title.replace(/[^a-z0-9]+/gi, '-')}.pdf"`,
    );
    res.send(Buffer.from(pdf));
  }),
);
