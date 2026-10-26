import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso, parseJson } from '../db/index.js';
import { ingestLecture } from '../ai/retriever.js';
import { ah } from '../middleware/errors.js';
import { assertCourseAccess, optionalAuth, requireAuth, requireExactRole, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/activity.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';

export const coursesRouter = Router();

const courseSchema = z.object({
  title: z.string().trim().min(4).max(200),
  description: z.string().trim().min(20).max(6000),
  category: z.string().trim().min(2).max(80),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  price: z.coerce.number().min(0).max(10000).optional(),
  thumbnail_url: z.string().trim().url().optional().or(z.literal('')),
  outcomes: z.array(z.string().trim().min(3)).max(10).optional(),
});

const moduleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  order_index: z.coerce.number().int().min(0).optional(),
});

const lectureSchema = z.object({
  title: z.string().trim().min(3).max(200),
  video_url: z.string().trim().optional().or(z.literal('')),
  transcript: z.string().trim().max(200_000).optional().or(z.literal('')),
  duration_seconds: z.coerce.number().int().min(0).max(60 * 60 * 8).optional(),
  order_index: z.coerce.number().int().min(0).optional(),
  resource_urls: z.array(z.string().trim()).max(10).optional(),
});

type CourseRow = {
  id: string;
  instructor_id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: string | null;
  thumbnail_url: string | null;
  price: number;
  status: string;
  outcomes: string | null;
  created_at: string;
};

function courseWithStats(course: CourseRow, userId?: string) {
  const stats = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learners,
        (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id) AS modules,
        (SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lectures,
        (SELECT COALESCE(SUM(l.duration_seconds), 0) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS seconds
       FROM courses c WHERE c.id = ?`,
    )
    .get(course.id) as { learners: number; modules: number; lectures: number; seconds: number };

  const instructor = db
    .prepare('SELECT full_name, avatar_url FROM users WHERE id = ?')
    .get(course.instructor_id) as { full_name: string; avatar_url: string | null } | undefined;

  const enrollment = userId
    ? (db
        .prepare('SELECT id, progress_percent FROM enrollments WHERE user_id = ? AND course_id = ?')
        .get(userId, course.id) as { id: string; progress_percent: number } | undefined)
    : undefined;

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    category: course.category,
    difficulty: course.difficulty,
    thumbnail_url: course.thumbnail_url,
    price: course.price,
    status: course.status,
    outcomes: parseJson<string[]>(course.outcomes, []),
    created_at: course.created_at,
    instructor_id: course.instructor_id,
    instructor_name: instructor?.full_name ?? 'VertexLearn instructor',
    instructor_avatar: instructor?.avatar_url ?? null,
    learners: stats.learners,
    modules: stats.modules,
    lectures: stats.lectures,
    duration_minutes: Math.round(stats.seconds / 60),
    enrolled: Boolean(enrollment),
    progress_percent: enrollment?.progress_percent ?? 0,
  };
}

coursesRouter.get(
  '/courses',
  optionalAuth,
  ah(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 12)));
    const q = String(req.query.q ?? '').trim();
    const category = String(req.query.category ?? '').trim();
    const difficulty = String(req.query.difficulty ?? '').trim();
    const sort = String(req.query.sort ?? 'newest');
    const mine = req.query.mine === 'true';

    const where: string[] = [];
    const params: (string | number)[] = [];

    if (mine) {
      if (!req.user || req.user.role === 'student') throw forbidden('Instructor access required');
      if (req.user.role === 'instructor') {
        where.push('c.instructor_id = ?');
        params.push(req.user.id);
      }
    } else if (req.user?.role === 'admin' && req.query.status) {
      where.push('c.status = ?');
      params.push(String(req.query.status));
    } else {
      where.push("c.status = 'approved'");
    }

    if (q) {
      where.push('(c.title LIKE ? OR c.description LIKE ? OR c.category LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (category) {
      where.push('c.category = ?');
      params.push(category);
    }
    if (difficulty) {
      where.push('c.difficulty = ?');
      params.push(difficulty);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql =
      sort === 'popular'
        ? 'ORDER BY learners DESC, c.created_at DESC'
        : sort === 'title'
          ? 'ORDER BY c.title ASC'
          : 'ORDER BY c.created_at DESC';

    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learners
         FROM courses c ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, (page - 1) * limit) as CourseRow[];

    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM courses c ${whereSql}`)
      .get(...params) as { count: number };

    const categories = db
      .prepare("SELECT DISTINCT category FROM courses WHERE status = 'approved' AND category IS NOT NULL ORDER BY category")
      .all() as { category: string }[];

    res.json({
      courses: rows.map((course) => courseWithStats(course, req.user?.id)),
      pagination: { page, limit, total: total.count, pages: Math.max(1, Math.ceil(total.count / limit)) },
      categories: categories.map((row) => row.category),
    });
  }),
);

coursesRouter.get(
  '/courses/:id',
  optionalAuth,
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');

    const isOwner = req.user?.role === 'admin' || course.instructor_id === req.user?.id;
    if (course.status !== 'approved' && !isOwner) throw notFound('Course not found');

    const enrollment = req.user
      ? (db
          .prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?')
          .get(req.user.id, course.id) as { id: string; progress_percent: number } | undefined)
      : undefined;

    const modules = db
      .prepare('SELECT * FROM modules WHERE course_id = ? ORDER BY order_index')
      .all(course.id) as { id: string; title: string; order_index: number }[];

    const progressRows = enrollment
      ? (db
          .prepare('SELECT lecture_id, watched_seconds, completed FROM lecture_progress WHERE enrollment_id = ?')
          .all(enrollment.id) as { lecture_id: string; watched_seconds: number; completed: number }[])
      : [];

    const quizzes = db
      .prepare(
        `SELECT q.id, q.title, q.module_id, q.status, q.is_ai_generated,
          (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count
         FROM quizzes q JOIN modules m ON m.id = q.module_id WHERE m.course_id = ?`,
      )
      .all(course.id) as {
      id: string;
      title: string;
      module_id: string;
      question_count: number;
      is_ai_generated: number;
      status: string;
    }[];

    const attemptRows = req.user
      ? (db
          .prepare(
            `SELECT qa.quiz_id, MAX(qa.score) AS best FROM quiz_attempts qa
             JOIN quizzes q ON q.id = qa.quiz_id JOIN modules m ON m.id = q.module_id
             WHERE qa.user_id = ? AND m.course_id = ? GROUP BY qa.quiz_id`,
          )
          .all(req.user.id, course.id) as { quiz_id: string; best: number }[])
      : [];
    const bestByQuiz = new Map(attemptRows.map((row) => [row.quiz_id, row.best]));

    const announcements = db
      .prepare(
        `SELECT a.*, u.full_name AS author FROM announcements a JOIN users u ON u.id = a.posted_by
         WHERE a.course_id = ? ORDER BY a.created_at DESC LIMIT 10`,
      )
      .all(course.id);

    res.json({
      course: courseWithStats(course, req.user?.id),
      can_edit: isOwner,
      enrollment: enrollment ?? null,
      modules: modules.map((module) => {
        const lectures = db
          .prepare('SELECT * FROM lectures WHERE module_id = ? ORDER BY order_index')
          .all(module.id) as {
          id: string;
          title: string;
          video_url: string | null;
          transcript: string | null;
          summary: string | null;
          duration_seconds: number;
          order_index: number;
          resource_urls: string | null;
        }[];
        return {
          id: module.id,
          title: module.title,
          order_index: module.order_index,
          lectures: lectures.map((lecture) => {
            const progress = progressRows.find((row) => row.lecture_id === lecture.id);
            const canSeeTranscript = Boolean(enrollment) || isOwner;
            return {
              id: lecture.id,
              title: lecture.title,
              video_url: lecture.video_url,
              duration_seconds: lecture.duration_seconds,
              order_index: lecture.order_index,
              summary: lecture.summary,
              resource_urls: parseJson<string[]>(lecture.resource_urls, []),
              transcript: canSeeTranscript ? lecture.transcript : undefined,
              completed: Boolean(progress?.completed),
              watched_seconds: progress?.watched_seconds ?? 0,
            };
          }),
          quizzes: quizzes
            .filter((quiz) => quiz.module_id === module.id)
            .map((quiz) => ({
              id: quiz.id,
              title: quiz.title,
              question_count: quiz.question_count,
              is_ai_generated: Boolean(quiz.is_ai_generated),
              best_score: bestByQuiz.get(quiz.id) ?? null,
            })),
        };
      }),
      assignments: (db
        .prepare('SELECT id, title, instructions, due_date FROM assignments WHERE course_id = ? ORDER BY due_date')
        .all(course.id)),
      announcements,
    });
  }),
);

coursesRouter.post(
  '/courses',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const body = courseSchema.parse(req.body);
    const id = newId();
    const status = req.user!.role === 'admin' ? 'approved' : 'pending';
    db.prepare(
      `INSERT INTO courses (id, instructor_id, title, description, category, difficulty, thumbnail_url, price, status, outcomes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.title,
      body.description,
      body.category,
      body.difficulty,
      body.thumbnail_url || null,
      body.price ?? 0,
      status,
      JSON.stringify(body.outcomes ?? []),
      nowIso(),
    );

    if (status === 'pending') {
      const admins = db
        .prepare(
          `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'`,
        )
        .all() as { id: string }[];
      for (const admin of admins) {
        notify(admin.id, 'Course awaiting approval', `${req.user!.fullName} submitted "${body.title}".`, '/admin/approvals');
      }
      notify(
        req.user!.id,
        'Course submitted for review',
        `"${body.title}" is queued for admin approval. You can keep adding modules and lectures while it is reviewed.`,
        '/instructor',
      );
    }
    audit(req.user!.id, 'course.create', 'course', id, { title: body.title });

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow;
    res.status(201).json({ course: courseWithStats(course, req.user!.id) });
  }),
);

coursesRouter.put(
  '/courses/:id',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');
    assertCourseAccess(req, course);
    const body = courseSchema.partial().parse(req.body);

    db.prepare(
      `UPDATE courses SET title = ?, description = ?, category = ?, difficulty = ?, thumbnail_url = ?, price = ?, outcomes = ? WHERE id = ?`,
    ).run(
      body.title ?? course.title,
      body.description ?? course.description,
      body.category ?? course.category,
      body.difficulty ?? course.difficulty,
      body.thumbnail_url ?? course.thumbnail_url,
      body.price ?? course.price,
      body.outcomes ? JSON.stringify(body.outcomes) : course.outcomes,
      course.id,
    );
    const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(course.id) as CourseRow;
    res.json({ course: courseWithStats(updated, req.user!.id) });
  }),
);

coursesRouter.post(
  '/courses/:id/modules',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');
    assertCourseAccess(req, course);
    const body = moduleSchema.parse(req.body);
    const nextOrder =
      body.order_index ??
      ((db.prepare('SELECT COALESCE(MAX(order_index), -1) AS max FROM modules WHERE course_id = ?').get(course.id) as {
        max: number;
      }).max +
        1);
    const id = newId();
    db.prepare('INSERT INTO modules (id, course_id, title, order_index) VALUES (?, ?, ?, ?)').run(
      id,
      course.id,
      body.title,
      nextOrder,
    );
    res.status(201).json({ module: { id, title: body.title, order_index: nextOrder, course_id: course.id } });
  }),
);

coursesRouter.post(
  '/modules/:id/lectures',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const module_ = db
      .prepare('SELECT m.*, c.instructor_id, c.id AS course_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = ?')
      .get(req.params.id) as
      | { id: string; course_id: string; instructor_id: string; title: string }
      | undefined;
    if (!module_) throw notFound('Module not found');
    assertCourseAccess(req, { instructor_id: module_.instructor_id });
    const body = lectureSchema.parse(req.body);

    const nextOrder =
      body.order_index ??
      ((db.prepare('SELECT COALESCE(MAX(order_index), -1) AS max FROM lectures WHERE module_id = ?').get(module_.id) as {
        max: number;
      }).max +
        1);
    const words = (body.transcript ?? '').split(/\s+/).filter(Boolean).length;
    const duration = body.duration_seconds ?? Math.max(60, Math.round((words / 150) * 60));
    const id = newId();

    db.prepare(
      `INSERT INTO lectures (id, module_id, title, video_url, transcript, duration_seconds, order_index, resource_urls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      module_.id,
      body.title,
      body.video_url || null,
      body.transcript || null,
      duration,
      nextOrder,
      JSON.stringify(body.resource_urls ?? []),
    );
    const chunks = body.transcript ? ingestLecture(id) : 0;
    res.status(201).json({ lecture: { id, title: body.title, chunks_indexed: chunks } });
  }),
);

coursesRouter.put(
  '/lectures/:id',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const lecture = db
      .prepare(
        `SELECT l.*, c.instructor_id FROM lectures l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE l.id = ?`,
      )
      .get(req.params.id) as
      | { id: string; title: string; video_url: string | null; transcript: string | null; duration_seconds: number; resource_urls: string | null; instructor_id: string }
      | undefined;
    if (!lecture) throw notFound('Lecture not found');
    assertCourseAccess(req, { instructor_id: lecture.instructor_id });
    const body = lectureSchema.partial().parse(req.body);

    db.prepare(
      'UPDATE lectures SET title = ?, video_url = ?, transcript = ?, duration_seconds = ?, resource_urls = ? WHERE id = ?',
    ).run(
      body.title ?? lecture.title,
      body.video_url ?? lecture.video_url,
      body.transcript ?? lecture.transcript,
      body.duration_seconds ?? lecture.duration_seconds,
      body.resource_urls ? JSON.stringify(body.resource_urls) : lecture.resource_urls,
      lecture.id,
    );
    const chunks = body.transcript ? ingestLecture(lecture.id) : 0;
    res.json({ ok: true, chunks_indexed: chunks });
  }),
);

coursesRouter.post(
  '/courses/:id/approve',
  requireAuth,
  requireExactRole('admin'),
  ah(async (req, res) => {
    const body = z
      .object({ decision: z.enum(['approved', 'rejected']), comment: z.string().max(1000).optional() })
      .parse(req.body);
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');

    db.prepare('UPDATE courses SET status = ? WHERE id = ?').run(body.decision, course.id);
    db.prepare(
      'INSERT INTO course_approvals (id, course_id, reviewed_by, decision, comment, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(newId(), course.id, req.user!.id, body.decision, body.comment ?? null, nowIso());
    notify(
      course.instructor_id,
      body.decision === 'approved' ? 'Course approved 🎉' : 'Course needs changes',
      body.decision === 'approved'
        ? `"${course.title}" is now live in the catalog.`
        : `"${course.title}" was not approved. ${body.comment ?? ''}`,
      '/instructor',
    );
    audit(req.user!.id, `course.${body.decision}`, 'course', course.id, { comment: body.comment });
    res.json({ ok: true, status: body.decision });
  }),
);

coursesRouter.get(
  '/courses/:id/analytics',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');
    assertCourseAccess(req, course);

    const totals = db
      .prepare(
        `SELECT COUNT(*) AS learners, COALESCE(AVG(progress_percent), 0) AS avg_progress,
          COALESCE(SUM(CASE WHEN progress_percent >= 100 THEN 1 ELSE 0 END), 0) AS completions
         FROM enrollments WHERE course_id = ?`,
      )
      .get(course.id) as { learners: number; avg_progress: number; completions: number };

    const quizStats = db
      .prepare(
        `SELECT COALESCE(AVG(qa.score), 0) AS avg_score, COUNT(qa.id) AS attempts
         FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
         JOIN modules m ON m.id = q.module_id
         WHERE m.course_id = ? AND qa.submitted_at IS NOT NULL`,
      )
      .get(course.id) as { avg_score: number; attempts: number };

    const lectures = db
      .prepare(
        `SELECT l.id, l.title, m.title AS module_title, l.duration_seconds,
          (SELECT COUNT(*) FROM lecture_progress lp WHERE lp.lecture_id = l.id AND lp.completed = 1) AS completed,
          (SELECT COALESCE(AVG(lp.watched_seconds), 0) FROM lecture_progress lp WHERE lp.lecture_id = l.id) AS avg_watched
         FROM lectures l JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = ? ORDER BY m.order_index, l.order_index`,
      )
      .all(course.id) as {
      id: string;
      title: string;
      module_title: string;
      duration_seconds: number;
      completed: number;
      avg_watched: number;
    }[];

    const quizzes = db
      .prepare(
        `SELECT q.id, q.title, COUNT(qa.id) AS attempts, COALESCE(AVG(qa.score), 0) AS avg_score,
          COALESCE(MAX(qa.score), 0) AS best_score
         FROM quizzes q JOIN modules m ON m.id = q.module_id
         LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.submitted_at IS NOT NULL
         WHERE m.course_id = ? GROUP BY q.id ORDER BY q.title`,
      )
      .all(course.id) as { id: string; title: string; attempts: number; avg_score: number; best_score: number }[];

    const roster = db
      .prepare(
        `SELECT u.id, u.full_name, u.email, e.progress_percent, e.enrolled_at,
          (SELECT MAX(lp.last_watched_at) FROM lecture_progress lp WHERE lp.enrollment_id = e.id) AS last_active,
          (SELECT AVG(qa.score) FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
            JOIN modules m ON m.id = q.module_id WHERE m.course_id = e.course_id AND qa.user_id = u.id AND qa.submitted_at IS NOT NULL) AS avg_score
         FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ?`,
      )
      .all(course.id) as {
      id: string;
      full_name: string;
      email: string;
      progress_percent: number;
      enrolled_at: string;
      last_active: string | null;
      avg_score: number | null;
    }[];

    const now = Date.now();
    const atRisk = roster
      .map((student) => {
        const daysInactive = student.last_active
          ? Math.floor((now - new Date(student.last_active).getTime()) / 86_400_000)
          : Math.floor((now - new Date(student.enrolled_at).getTime()) / 86_400_000);
        return {
          ...student,
          days_inactive: daysInactive,
          risk_reasons: [
            student.progress_percent < 30 ? 'Progress below 30%' : null,
            student.avg_score !== null && student.avg_score < 50 ? 'Average quiz score below 50%' : null,
            daysInactive >= 7 ? `No activity for ${daysInactive} days` : null,
          ].filter(Boolean) as string[],
        };
      })
      .filter((student) => student.risk_reasons.length > 0)
      .sort((a, b) => b.risk_reasons.length - a.risk_reasons.length);

    const mastery = db
      .prepare(
        `SELECT topic, COALESCE(AVG(score), 0) AS score FROM topic_mastery
         WHERE course_id = ? GROUP BY topic ORDER BY score ASC`,
      )
      .all(course.id) as { topic: string; score: number }[];

    res.json({
      course: { id: course.id, title: course.title, status: course.status },
      overview: {
        learners: totals.learners,
        avg_progress: Math.round(totals.avg_progress * 10) / 10,
        completions: totals.completions,
        completion_rate: totals.learners ? Math.round((totals.completions / totals.learners) * 1000) / 10 : 0,
        avg_quiz_score: Math.round(quizStats.avg_score * 10) / 10,
        quiz_attempts: quizStats.attempts,
      },
      lectures: lectures.map((lecture) => ({
        ...lecture,
        avg_watched: Math.round(lecture.avg_watched),
        dropoff: totals.learners ? Math.round(((totals.learners - lecture.completed) / totals.learners) * 1000) / 10 : 0,
      })),
      quizzes,
      at_risk_students: atRisk,
      topic_mastery: mastery,
    });
  }),
);

coursesRouter.get(
  '/courses/:id/roster',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');
    assertCourseAccess(req, course);
    const roster = db
      .prepare(
        `SELECT u.id, u.full_name, u.email, e.progress_percent, e.enrolled_at
         FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ? ORDER BY e.progress_percent DESC`,
      )
      .all(course.id);
    res.json({ roster });
  }),
);

coursesRouter.post(
  '/courses/:id/announcements',
  requireAuth,
  requireRole('instructor'),
  ah(async (req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as
      | CourseRow
      | undefined;
    if (!course) throw notFound('Course not found');
    assertCourseAccess(req, course);
    const { content } = z.object({ content: z.string().trim().min(5).max(2000) }).parse(req.body);
    const id = newId();
    db.prepare('INSERT INTO announcements (id, course_id, posted_by, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      course.id,
      req.user!.id,
      content,
      nowIso(),
    );
    const students = db
      .prepare('SELECT user_id FROM enrollments WHERE course_id = ?')
      .all(course.id) as { user_id: string }[];
    for (const student of students) {
      notify(student.user_id, `New announcement in ${course.title}`, content.slice(0, 200), `/courses/${course.id}`);
    }
    res.status(201).json({ announcement: { id, content, created_at: nowIso() } });
  }),
);

coursesRouter.get(
  '/courses/:id/leaderboard',
  requireAuth,
  ah(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.full_name, u.avatar_url,
          MAX(e.progress_percent) AS progress,
          COALESCE(AVG(qa.score), 0) AS avg_score,
          COUNT(qa.id) AS attempts
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN quiz_attempts qa ON qa.user_id = u.id AND qa.submitted_at IS NOT NULL
            AND qa.quiz_id IN (SELECT q.id FROM quizzes q JOIN modules m ON m.id = q.module_id WHERE m.course_id = e.course_id)
         WHERE e.course_id = ?
         GROUP BY u.id
         ORDER BY avg_score DESC, progress DESC
         LIMIT 20`,
      )
      .all(req.params.id) as {
      id: string;
      full_name: string;
      avatar_url: string | null;
      progress: number;
      avg_score: number;
      attempts: number;
    }[];

    res.json({
      leaderboard: rows.map((row, index) => ({
        rank: index + 1,
        ...row,
        avg_score: Math.round(row.avg_score * 10) / 10,
      })),
    });
  }),
);

/** Parse YouTube/Vimeo links into embeddable URLs for the player. */
coursesRouter.get('/courses/:id/next-lecture', requireAuth, (req, res) => {
  const next = db
    .prepare(
      `SELECT l.id, l.title, m.title AS module_title FROM lectures l
       JOIN modules m ON m.id = l.module_id
       LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id
       LEFT JOIN enrollments e ON e.id = lp.enrollment_id AND e.user_id = ?
       WHERE m.course_id = ? AND COALESCE(lp.completed, 0) = 0
       ORDER BY m.order_index, l.order_index LIMIT 1`,
    )
    .get(req.user!.id, req.params.id);
  if (!next) throw badRequest('No lecture available');
  res.json({ lecture: next });
});
