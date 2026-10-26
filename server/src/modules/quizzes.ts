import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso } from '../db/index.js';
import { updateMasteryFromAttempt } from '../ai/engine.js';
import { tokenize } from '../ai/embeddings.js';
import { ah } from '../middleware/errors.js';
import { assertCourseAccess, requireAuth, requireRole } from '../middleware/auth.js';
import { awardBadge, notify, touchStreak } from '../services/activity.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';

export const quizzesRouter = Router();
quizzesRouter.use(requireAuth);

const optionSchema = z.object({
  option_text: z.string().trim().min(1).max(500),
  is_correct: z.boolean().default(false),
});

const questionSchema = z.object({
  question_text: z.string().trim().min(5).max(2000),
  question_type: z.enum(['mcq', 'multi_select', 'short_answer']).default('mcq'),
  explanation: z.string().trim().max(2000).optional(),
  expected_answer: z.string().trim().max(500).optional(),
  topic: z.string().trim().max(80).optional(),
  options: z.array(optionSchema).max(8).default([]),
});

const quizSchema = z.object({
  module_id: z.string().min(1),
  title: z.string().trim().min(4).max(200),
  is_ai_generated: z.boolean().optional(),
  generated_from_lecture_id: z.string().optional(),
  questions: z.array(questionSchema).min(1).max(30),
});

type QuizRow = {
  id: string;
  module_id: string;
  title: string;
  is_ai_generated: number;
  status: string;
  course_id: string;
  instructor_id: string;
};

function quizContext(quizId: string): QuizRow | undefined {
  return db
    .prepare(
      `SELECT q.*, m.course_id, c.instructor_id FROM quizzes q
       JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id WHERE q.id = ?`,
    )
    .get(quizId) as QuizRow | undefined;
}

quizzesRouter.post(
  '/quizzes',
  requireRole('instructor'),
  ah(async (req, res) => {
    const body = quizSchema.parse(req.body);
    const module_ = db
      .prepare('SELECT m.*, c.instructor_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = ?')
      .get(body.module_id) as { id: string; instructor_id: string } | undefined;
    if (!module_) throw notFound('Module not found');
    assertCourseAccess(req, { instructor_id: module_.instructor_id });

    for (const question of body.questions) {
      if (['mcq', 'multi_select'].includes(question.question_type)) {
        if (question.options.length < 2) throw badRequest('Objective questions need at least two options');
        if (!question.options.some((option) => option.is_correct)) {
          throw badRequest('Mark at least one correct option');
        }
        if (question.question_type === 'mcq' && question.options.filter((option) => option.is_correct).length !== 1) {
          throw badRequest('Single-choice questions need exactly one correct option');
        }
      }
      if (question.question_type === 'short_answer' && !question.expected_answer) {
        throw badRequest('Short-answer questions need an expected answer for auto-grading');
      }
    }

    const quizId = newId();
    const counter = db.prepare('SELECT COUNT(*) AS count FROM quizzes WHERE module_id = ?').get(module_.id) as {
      count: number;
    };

    db.transaction(() => {
      db.prepare(
        'INSERT INTO quizzes (id, module_id, title, is_ai_generated, generated_from_lecture_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        quizId,
        module_.id,
        body.title,
        body.is_ai_generated ? 1 : 0,
        body.generated_from_lecture_id ?? null,
        'published',
        nowIso(),
      );
      body.questions.forEach((question, index) => {
        const questionId = newId();
        db.prepare(
          `INSERT INTO quiz_questions (id, quiz_id, question_text, question_type, explanation, expected_answer, topic, order_index)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          questionId,
          quizId,
          question.question_text,
          question.question_type,
          question.explanation ?? null,
          question.expected_answer ?? null,
          question.topic ?? 'General',
          index,
        );
        if (question.options.length) {
          const insertOption = db.prepare(
            'INSERT INTO quiz_options (id, question_id, option_text, is_correct) VALUES (?, ?, ?, ?)',
          );
          for (const option of question.options) {
            insertOption.run(newId(), questionId, option.option_text, option.is_correct ? 1 : 0);
          }
        }
      });
    })();

    const enrolled = db
      .prepare('SELECT user_id FROM enrollments WHERE course_id = ?')
      .all(quizContext(quizId)!.course_id) as { user_id: string }[];
    for (const student of enrolled) {
      notify(student.user_id, `New quiz: ${body.title}`, 'A new quiz is available in your course.', `/quizzes/${quizId}`);
    }

    res.status(201).json({ quiz: { id: quizId, title: body.title, question_count: body.questions.length, ...counter } });
  }),
);

quizzesRouter.get(
  '/quizzes/:id',
  ah(async (req, res) => {
    const quiz = quizContext(req.params.id);
    if (!quiz) throw notFound('Quiz not found');
    const isStaff = req.user!.role === 'admin' || quiz.instructor_id === req.user!.id;

    if (!isStaff) {
      const enrolled = db
        .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
        .get(req.user!.id, quiz.course_id);
      if (!enrolled) throw forbidden('Enroll in this course to take its quizzes');
    }

    const questions = db
      .prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index')
      .all(quiz.id) as {
      id: string;
      question_text: string;
      question_type: string;
      explanation: string | null;
      expected_answer: string | null;
      topic: string | null;
      order_index: number;
    }[];

    const attempts = db
      .prepare(
        'SELECT id, score, started_at, submitted_at FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? ORDER BY started_at DESC',
      )
      .all(quiz.id, req.user!.id) as { id: string; score: number | null; started_at: string; submitted_at: string | null }[];

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        module_id: quiz.module_id,
        is_ai_generated: Boolean(quiz.is_ai_generated),
        course_id: quiz.course_id,
      },
      questions: questions.map((question) => ({
        id: question.id,
        question_text: question.question_text,
        question_type: question.question_type,
        topic: question.topic,
        explanation: isStaff || question.question_type === 'short_answer' ? question.explanation : undefined,
        expected_answer: isStaff ? question.expected_answer : undefined,
        options: (
          db
            .prepare('SELECT id, option_text, is_correct FROM quiz_options WHERE question_id = ?')
            .all(question.id) as { id: string; option_text: string; is_correct: number }[]
        ).map((option) => ({
          id: option.id,
          option_text: option.option_text,
          ...(isStaff ? { is_correct: Boolean(option.is_correct) } : {}),
        })),
      })),
      attempts,
      best_score: attempts.reduce((best, attempt) => Math.max(best, attempt.score ?? 0), 0),
      can_edit: isStaff,
    });
  }),
);

quizzesRouter.post(
  '/quizzes/:id/attempt',
  ah(async (req, res) => {
    const quiz = quizContext(req.params.id);
    if (!quiz) throw notFound('Quiz not found');
    const enrolled = db
      .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
      .get(req.user!.id, quiz.course_id);
    if (!enrolled) throw forbidden('Enroll in this course to take its quizzes');

    const attemptId = newId();
    db.prepare('INSERT INTO quiz_attempts (id, quiz_id, user_id, started_at) VALUES (?, ?, ?, ?)').run(
      attemptId,
      quiz.id,
      req.user!.id,
      nowIso(),
    );
    touchStreak(req.user!.id);
    res.status(201).json({ attempt_id: attemptId });
  }),
);

quizzesRouter.post(
  '/attempts/:id/submit',
  ah(async (req, res) => {
    const body = z
      .object({
        answers: z
          .array(
            z.object({
              question_id: z.string().min(1),
              selected_option_ids: z.array(z.string()).default([]),
              text_answer: z.string().max(5000).optional(),
            }),
          )
          .max(60),
      })
      .parse(req.body);

    const attempt = db
      .prepare('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id) as
      | { id: string; quiz_id: string; submitted_at: string | null }
      | undefined;
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.submitted_at) throw badRequest('This attempt has already been submitted');

    const questions = db
      .prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index')
      .all(attempt.quiz_id) as {
      id: string;
      question_text: string;
      question_type: string;
      explanation: string | null;
      expected_answer: string | null;
      topic: string | null;
    }[];
    if (!questions.length) throw badRequest('This quiz has no questions yet');

    type Review = {
      question_id: string;
      question_text: string;
      question_type: string;
      topic: string | null;
      explanation: string | null;
      correct_options: string[];
      selected_options: string[];
      is_correct: boolean | null;
      feedback: string;
      expected_answer?: string | null;
    };

    const reviews: Review[] = [];
    let graded = 0;
    let earned = 0;

    for (const question of questions) {
      const submitted = body.answers.find((answer) => answer.question_id === question.id);
      const options = db
        .prepare('SELECT id, option_text, is_correct FROM quiz_options WHERE question_id = ?')
        .all(question.id) as { id: string; option_text: string; is_correct: number }[];
      const correctIds = options.filter((option) => option.is_correct).map((option) => option.id);
      const selected = (submitted?.selected_option_ids ?? []).filter((id) => options.some((option) => option.id === id));

      let isCorrect: boolean | null = null;
      let feedback = 'No answer submitted.';
      let scoreFraction = 0;

      if (question.question_type === 'short_answer') {
        const expected = (question.expected_answer ?? '').trim();
        const given = (submitted?.text_answer ?? '').trim();
        if (!given) {
          isCorrect = false;
          feedback = 'No answer submitted.';
          graded += 1;
        } else if (!expected) {
          isCorrect = null;
          feedback = 'Saved for instructor review.';
        } else {
          const expectedTokens = new Set(tokenize(expected));
          const givenTokens = new Set(tokenize(given));
          let hits = 0;
          for (const token of expectedTokens) if (givenTokens.has(token)) hits += 1;
          const overlap = expectedTokens.size ? hits / expectedTokens.size : 0;
          isCorrect = overlap >= 0.6;
          scoreFraction = isCorrect ? 1 : overlap * 0.5;
          graded += 1;
          feedback = isCorrect
            ? 'Correct — your answer covers the expected concepts.'
            : `Not quite. Expected ideas: ${expected.slice(0, 180)}`;
        }
      } else if (question.question_type === 'multi_select') {
        const selectedCorrect = selected.filter((id) => correctIds.includes(id)).length;
        const selectedWrong = selected.length - selectedCorrect;
        const missing = correctIds.length - selectedCorrect;
        scoreFraction = correctIds.length
          ? Math.max(0, (selectedCorrect - selectedWrong) / correctIds.length)
          : 0;
        isCorrect = missing === 0 && selectedWrong === 0;
        graded += 1;
        feedback = isCorrect
          ? 'Correct — all right options selected.'
          : [
              missing ? `${missing} correct option(s) missed.` : '',
              selectedWrong ? `${selectedWrong} incorrect option(s) selected.` : '',
            ]
              .filter(Boolean)
              .join(' ') || 'Review the lecture clip for this topic.';
      } else {
        isCorrect = selected.length === 1 && correctIds[0] === selected[0];
        scoreFraction = isCorrect ? 1 : 0;
        graded += 1;
        feedback = isCorrect
          ? 'Correct.'
          : selected.length
            ? `Incorrect. The correct answer is "${options.find((option) => option.is_correct)?.option_text ?? ''}".`
            : 'No answer submitted.';
      }

      if (isCorrect) earned += 1;
      else if (isCorrect === null) earned += 0;
      else earned += scoreFraction;

      db.prepare(
        'INSERT INTO quiz_answers (id, attempt_id, question_id, selected_option_ids, text_answer, is_correct, feedback) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        newId(),
        attempt.id,
        question.id,
        JSON.stringify(selected),
        submitted?.text_answer ?? null,
        isCorrect === null ? null : isCorrect ? 1 : 0,
        feedback,
      );

      reviews.push({
        question_id: question.id,
        question_text: question.question_text,
        question_type: question.question_type,
        topic: question.topic,
        explanation: question.explanation,
        correct_options: correctIds,
        selected_options: selected,
        is_correct: isCorrect,
        feedback,
        expected_answer: question.expected_answer,
      });
    }

    const score = graded ? Math.round((earned / graded) * 1000) / 10 : 0;
    db.prepare('UPDATE quiz_attempts SET score = ?, submitted_at = ? WHERE id = ?').run(
      score,
      nowIso(),
      attempt.id,
    );
    updateMasteryFromAttempt(attempt.id);

    if (score >= 100) awardBadge(req.user!.id, 'perfect_quiz');
    if (score < 50) {
      notify(
        req.user!.id,
        'A topic needs another pass',
        `You scored ${score}% on this quiz. Your study plan has been updated with the weak topics.`,
        '/dashboard',
      );
    }

    res.json({
      attempt: { id: attempt.id, score, graded_questions: graded, total_questions: questions.length },
      review: reviews.map((review) => ({
        ...review,
        correct_option_texts: (
          db
            .prepare('SELECT option_text FROM quiz_options WHERE question_id = ? AND is_correct = 1')
            .all(review.question_id) as { option_text: string }[]
        ).map((row) => row.option_text),
      })),
    });
  }),
);

quizzesRouter.get(
  '/attempts/:id',
  ah(async (req, res) => {
    const attempt = db
      .prepare(
        `SELECT qa.*, q.title FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
         WHERE qa.id = ? AND (qa.user_id = ? OR ? = 'admin')`,
      )
      .get(req.params.id, req.user!.id, req.user!.role) as
      | { id: string; quiz_id: string; score: number | null; submitted_at: string | null; title: string }
      | undefined;
    if (!attempt) throw notFound('Attempt not found');

    const answers = db
      .prepare(
        `SELECT qa.id, qa.is_correct, qa.feedback, qa.selected_option_ids, qa.text_answer,
          qq.question_text, qq.question_type, qq.explanation, qq.topic,
          (SELECT GROUP_CONCAT(o.option_text, ' | ') FROM quiz_options o WHERE o.question_id = qq.id AND o.is_correct = 1) AS correct_options
         FROM quiz_answers qa JOIN quiz_questions qq ON qq.id = qa.question_id
         WHERE qa.attempt_id = ? ORDER BY qq.order_index`,
      )
      .all(attempt.id);

    res.json({ attempt, answers });
  }),
);

quizzesRouter.get('/quiz-attempts/me', (req, res) => {
  const attempts = db
    .prepare(
      `SELECT qa.id, qa.score, qa.submitted_at, q.title, c.title AS course_title, c.id AS course_id
       FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
       JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
       WHERE qa.user_id = ? AND qa.submitted_at IS NOT NULL
       ORDER BY qa.submitted_at DESC LIMIT 20`,
    )
    .all(req.user!.id);
  res.json({ attempts });
});
