import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso, parseJson } from '../db/index.js';
import {
  answerQuestion,
  buildStudyPlan,
  generateFlashcards,
  generateQuizDraft,
  getMastery,
  localEngineLabel,
  summarizeLecture,
  type ChatMode,
} from '../ai/engine.js';
import { env } from '../env.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { awardBadge, touchStreak } from '../services/activity.js';
import { forbidden, notFound } from '../utils/errors.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  scope: 'user',
  message: 'The AI tutor allows 20 questions per minute. Give me a moment to catch up.',
});

const modeSchema = z.enum(['beginner', 'intermediate', 'advanced']);

type CourseAccess = {
  id: string;
  title: string;
  instructor_id: string;
};

function courseAccess(userId: string, role: string, courseId: string): CourseAccess {
  const course = db.prepare('SELECT id, title, instructor_id, status FROM courses WHERE id = ?').get(courseId) as
    | (CourseAccess & { status: string })
    | undefined;
  if (!course) throw notFound('Course not found');
  if (role === 'admin' || course.instructor_id === userId) return course;
  const enrolled = db
    .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
    .get(userId, courseId);
  if (!enrolled) throw forbidden('Enroll in this course to use its AI tutor');
  if (course.status !== 'approved') throw notFound('Course not found');
  return course;
}

function lectureAccess(userId: string, role: string, lectureId: string) {
  const lecture = db
    .prepare(
      `SELECT l.*, m.course_id, c.title AS course_title, c.instructor_id
       FROM lectures l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
       WHERE l.id = ?`,
    )
    .get(lectureId) as
    | {
        id: string;
        title: string;
        transcript: string | null;
        course_id: string;
        course_title: string;
        instructor_id: string;
      }
    | undefined;
  if (!lecture) throw notFound('Lecture not found');
  courseAccess(userId, role, lecture.course_id);
  return lecture;
}

aiRouter.get('/ai/status', (_req, res) => {
  const chunks = db.prepare('SELECT COUNT(*) AS count FROM document_chunks').get() as { count: number };
  res.json({
    engine: localEngineLabel(),
    model: env.anthropicApiKey ? env.anthropicModel : null,
    retrieval: 'hashed bag-of-words embeddings (512d, cosine)',
    indexed_chunks: chunks.count,
    note: env.anthropicApiKey
      ? 'Claude generates answers; retrieval and citations come from the course index.'
      : 'Running the local grounded engine — answers are extracted from indexed course material with citations. Set ANTHROPIC_API_KEY to upgrade generation to Claude.',
  });
});

/* --------------------------- Chat sessions --------------------------- */

aiRouter.post(
  '/ai/chat/sessions',
  ah(async (req, res) => {
    const body = z
      .object({ course_id: z.string().min(1), mode: modeSchema.default('intermediate') })
      .parse(req.body);
    const course = courseAccess(req.user!.id, req.user!.role, body.course_id);

    const existing = db
      .prepare('SELECT * FROM ai_chat_sessions WHERE user_id = ? AND course_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.user!.id, course.id) as
      | { id: string; mode: string; created_at: string }
      | undefined;

    if (existing) {
      db.prepare('UPDATE ai_chat_sessions SET mode = ? WHERE id = ?').run(body.mode, existing.id);
      const messages = db
        .prepare('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at')
        .all(existing.id);
      return res.json({
        session: {
          ...existing,
          mode: body.mode,
          course_id: course.id,
          course_title: course.title,
          messages: messages.map((message) => ({
            ...(message as Record<string, unknown>),
            source_lecture_ids: parseJson<string[]>((message as { source_lecture_ids: string | null }).source_lecture_ids, []),
          })),
        },
      });
    }

    const id = newId();
    db.prepare('INSERT INTO ai_chat_sessions (id, user_id, course_id, mode, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      req.user!.id,
      course.id,
      body.mode,
      nowIso(),
    );
    res.status(201).json({
      session: {
        id,
        user_id: req.user!.id,
        course_id: course.id,
        course_title: course.title,
        mode: body.mode,
        created_at: nowIso(),
        messages: [],
      },
    });
  }),
);

aiRouter.get('/ai/chat/sessions', (req, res) => {
  const courseId = String(req.query.course_id ?? '');
  const sessions = db
    .prepare(
      `SELECT s.*, c.title AS course_title,
        (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id) AS message_count
       FROM ai_chat_sessions s JOIN courses c ON c.id = s.course_id
       WHERE s.user_id = ? ${courseId ? 'AND s.course_id = ?' : ''}
       ORDER BY s.created_at DESC`,
    )
    .all(...(courseId ? [req.user!.id, courseId] : [req.user!.id]));
  res.json({ sessions });
});

aiRouter.put('/ai/chat/sessions/:id/mode', (req, res, next) => {
  const { mode } = z.object({ mode: modeSchema }).parse(req.body);
  const session = db.prepare('SELECT * FROM ai_chat_sessions WHERE id = ? AND user_id = ?').get(
    req.params.id,
    req.user!.id,
  );
  if (!session) return next(notFound('Chat session not found'));
  db.prepare('UPDATE ai_chat_sessions SET mode = ? WHERE id = ?').run(mode, req.params.id);
  res.json({ ok: true, mode });
});

aiRouter.post(
  '/ai/chat/sessions/:id/messages',
  chatLimiter,
  ah(async (req, res) => {
    const { message } = z.object({ message: z.string().trim().min(2).max(2000) }).parse(req.body);
    const session = db
      .prepare('SELECT s.*, c.title AS course_title FROM ai_chat_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = ? AND s.user_id = ?')
      .get(req.params.id, req.user!.id) as
      | { id: string; course_id: string; mode: ChatMode; course_title: string }
      | undefined;
    if (!session) throw notFound('Chat session not found');
    courseAccess(req.user!.id, req.user!.role, session.course_id);

    const history = db
      .prepare('SELECT sender, content FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6')
      .all(session.id) as { sender: string; content: string }[];

    db.prepare(
      'INSERT INTO ai_chat_messages (id, session_id, sender, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(newId(), session.id, 'user', message, nowIso());

    const result = await answerQuestion({
      userId: req.user!.id,
      courseId: session.course_id,
      question: message,
      mode: session.mode,
      history: history.reverse(),
    });

    const messageId = newId();
    db.prepare(
      'INSERT INTO ai_chat_messages (id, session_id, sender, content, source_lecture_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      messageId,
      session.id,
      'ai',
      result.reply,
      JSON.stringify(result.sources.map((source) => source.lecture_id)),
      nowIso(),
    );

    touchStreak(req.user!.id);
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM ai_chat_messages WHERE session_id IN (SELECT id FROM ai_chat_sessions WHERE user_id = ?) AND sender = 'user'")
      .get(req.user!.id) as { count: number };
    if (count.count >= 10) awardBadge(req.user!.id, 'curious_mind');

    res.json({
      message: {
        id: messageId,
        sender: 'ai',
        content: result.reply,
        sources: result.sources,
        created_at: nowIso(),
      },
      mode: session.mode,
      engine: result.engine,
      grounded: result.grounded,
    });
  }),
);

/* --------------------------- AI generation --------------------------- */

aiRouter.post(
  '/ai/lectures/:id/summarize',
  ah(async (req, res) => {
    const lecture = lectureAccess(req.user!.id, req.user!.role, req.params.id);
    const result = await summarizeLecture(lecture.id);
    res.json({ lecture_id: lecture.id, lecture_title: lecture.title, ...result });
  }),
);

aiRouter.post(
  '/ai/lectures/:id/generate-quiz',
  ah(async (req, res) => {
    const lecture = lectureAccess(req.user!.id, req.user!.role, req.params.id);
    if (req.user!.role !== 'admin' && lecture.instructor_id !== req.user!.id) {
      throw forbidden('Only the course instructor can generate quiz drafts');
    }
    const { count } = z.object({ count: z.coerce.number().int().min(3).max(10).default(6) }).parse(req.body ?? {});
    const result = await generateQuizDraft(lecture.id, count);
    if (!result.questions.length) {
      throw forbidden('This lecture needs a longer transcript before a quiz can be drafted');
    }
    res.json({
      lecture: { id: lecture.id, title: lecture.title },
      questions: result.questions,
      engine: result.engine,
      note: 'Draft only — review each question and publish it from the module builder.',
    });
  }),
);

aiRouter.get('/ai/modules/:id/flashcards', (req, res, next) => {
  const module_ = db
    .prepare('SELECT m.*, c.id AS course_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = ?')
    .get(req.params.id) as { id: string; course_id: string; title: string } | undefined;
  if (!module_) return next(notFound('Module not found'));
  try {
    courseAccess(req.user!.id, req.user!.role, module_.course_id);
  } catch (error) {
    return next(error);
  }
  const cards = db.prepare('SELECT id, question, answer FROM flashcards WHERE module_id = ?').all(module_.id);
  res.json({ module: { id: module_.id, title: module_.title }, flashcards: cards });
});

aiRouter.post(
  '/ai/modules/:id/flashcards',
  chatLimiter,
  ah(async (req, res) => {
    const module_ = db
      .prepare('SELECT m.*, c.id AS course_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = ?')
      .get(req.params.id) as { id: string; course_id: string; title: string } | undefined;
    if (!module_) throw notFound('Module not found');
    courseAccess(req.user!.id, req.user!.role, module_.course_id);
    const { count } = z.object({ count: z.coerce.number().int().min(3).max(15).default(8) }).parse(req.body ?? {});
    const result = await generateFlashcards(module_.id, count);
    res.json({ module: { id: module_.id, title: module_.title }, flashcards: result.cards, engine: result.engine });
  }),
);

aiRouter.post(
  '/ai/study-plan',
  ah(async (req, res) => {
    const { course_id } = z.object({ course_id: z.string().min(1) }).parse(req.body);
    courseAccess(req.user!.id, req.user!.role, course_id);
    const result = await buildStudyPlan(req.user!.id, course_id);
    res.json({ ...result, mastery: getMastery(req.user!.id, course_id) });
  }),
);

aiRouter.get('/ai/study-plan/:courseId', (req, res) => {
  const plan = db
    .prepare(
      'SELECT plan_json, generated_at FROM study_plans WHERE user_id = ? AND course_id = ? ORDER BY generated_at DESC LIMIT 1',
    )
    .get(req.user!.id, req.params.courseId) as { plan_json: string; generated_at: string } | undefined;
  res.json({
    plan: plan ? parseJson(plan.plan_json, null) : null,
    generated_at: plan?.generated_at ?? null,
    mastery: getMastery(req.user!.id, req.params.courseId),
  });
});
