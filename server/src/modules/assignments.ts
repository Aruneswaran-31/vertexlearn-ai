import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso, parseJson } from '../db/index.js';
import { ah } from '../middleware/errors.js';
import { assertCourseAccess, requireAuth, requireRole } from '../middleware/auth.js';
import { notify, touchStreak } from '../services/activity.js';
import { forbidden, notFound } from '../utils/errors.js';

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

const assignmentSchema = z.object({
  course_id: z.string().min(1),
  title: z.string().trim().min(4).max(200),
  instructions: z.string().trim().min(10).max(8000),
  rubric: z
    .array(z.object({ criterion: z.string().trim().min(2), points: z.coerce.number().min(0) }))
    .max(12)
    .optional(),
  due_date: z.string().min(4),
});

assignmentsRouter.post(
  '/assignments',
  requireRole('instructor'),
  ah(async (req, res) => {
    const body = assignmentSchema.parse(req.body);
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(body.course_id) as
      | { id: string; instructor_id: string; title: string }
      | undefined;
    if (!course) throw notFound('Course not found');
    assertCourseAccess(req, course);

    const id = newId();
    db.prepare(
      'INSERT INTO assignments (id, course_id, title, instructions, rubric, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      course.id,
      body.title,
      body.instructions,
      JSON.stringify(body.rubric ?? []),
      body.due_date,
      nowIso(),
    );

    const students = db
      .prepare('SELECT user_id FROM enrollments WHERE course_id = ?')
      .all(course.id) as { user_id: string }[];
    for (const student of students) {
      notify(
        student.user_id,
        `New assignment: ${body.title}`,
        `${course.title} • due ${new Date(body.due_date).toLocaleDateString()}`,
        `/assignments/${id}`,
      );
    }
    res.status(201).json({ assignment: { id, ...body } });
  }),
);

function assignmentContext(assignmentId: string) {
  return db
    .prepare(
      `SELECT a.*, c.title AS course_title, c.instructor_id
       FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = ?`,
    )
    .get(assignmentId) as
    | {
        id: string;
        course_id: string;
        title: string;
        instructions: string;
        rubric: string | null;
        due_date: string;
        course_title: string;
        instructor_id: string;
      }
    | undefined;
}

assignmentsRouter.get(
  '/assignments/:id',
  ah(async (req, res) => {
    const assignment = assignmentContext(req.params.id);
    if (!assignment) throw notFound('Assignment not found');
    const enrolled = db
      .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
      .get(req.user!.id, assignment.course_id);
    if (!enrolled && req.user!.role === 'student') throw forbidden('Enroll in this course to view assignments');

    const submission = db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?')
      .get(assignment.id, req.user!.id);

    res.json({
      assignment: { ...assignment, rubric: parseJson(assignment.rubric, []) },
      submission: submission ?? null,
    });
  }),
);

assignmentsRouter.post(
  '/assignments/:id/submit',
  ah(async (req, res) => {
    const body = z
      .object({
        file_url: z.string().trim().max(600).optional(),
        content: z.string().trim().max(20000).optional(),
      })
      .parse(req.body);
    const assignment = assignmentContext(req.params.id);
    if (!assignment) throw notFound('Assignment not found');
    const enrolled = db
      .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
      .get(req.user!.id, assignment.course_id);
    if (!enrolled) throw forbidden('Enroll in this course to submit');
    if (!body.file_url && !body.content) throw forbidden('Attach a file link or written answer');

    const late = new Date(assignment.due_date).getTime() < Date.now();
    const existing = db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?')
      .get(assignment.id, req.user!.id) as { id: string; grade: number | null } | undefined;

    if (existing && existing.grade !== null) {
      throw forbidden('This submission has already been graded and cannot be replaced');
    }

    if (existing) {
      db.prepare(
        'UPDATE assignment_submissions SET file_url = ?, content = ?, submitted_at = ? WHERE id = ?',
      ).run(body.file_url ?? null, body.content ?? null, nowIso(), existing.id);
    } else {
      db.prepare(
        'INSERT INTO assignment_submissions (id, assignment_id, user_id, file_url, content, submitted_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(newId(), assignment.id, req.user!.id, body.file_url ?? null, body.content ?? null, nowIso());
    }

    touchStreak(req.user!.id);
    notify(
      assignment.instructor_id,
      `New submission: ${assignment.title}`,
      `${req.user!.fullName} submitted${late ? ' late' : ''}.`,
      `/instructor/assignments/${assignment.id}`,
    );

    res.status(201).json({ ok: true, late });
  }),
);

assignmentsRouter.get(
  '/assignments/:id/submissions',
  requireRole('instructor'),
  ah(async (req, res) => {
    const assignment = assignmentContext(req.params.id);
    if (!assignment) throw notFound('Assignment not found');
    assertCourseAccess(req, { instructor_id: assignment.instructor_id });

    const submissions = db
      .prepare(
        `SELECT s.*, u.full_name, u.email FROM assignment_submissions s
         JOIN users u ON u.id = s.user_id WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC`,
      )
      .all(assignment.id);
    res.json({ assignment: { ...assignment, rubric: parseJson(assignment.rubric, []) }, submissions });
  }),
);

assignmentsRouter.put(
  '/submissions/:id/grade',
  requireRole('instructor'),
  ah(async (req, res) => {
    const body = z
      .object({ grade: z.coerce.number().min(0).max(100), feedback: z.string().trim().max(4000).optional() })
      .parse(req.body);
    const submission = db
      .prepare(
        `SELECT s.*, a.title, a.course_id, c.instructor_id
         FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
         JOIN courses c ON c.id = a.course_id WHERE s.id = ?`,
      )
      .get(req.params.id) as
      | { id: string; user_id: string; title: string; course_id: string; instructor_id: string }
      | undefined;
    if (!submission) throw notFound('Submission not found');
    assertCourseAccess(req, { instructor_id: submission.instructor_id });

    db.prepare('UPDATE assignment_submissions SET grade = ?, feedback = ? WHERE id = ?').run(
      body.grade,
      body.feedback ?? null,
      submission.id,
    );
    notify(
      submission.user_id,
      `Graded: ${submission.title}`,
      `You scored ${body.grade}/100.${body.feedback ? ` Feedback: ${body.feedback.slice(0, 160)}` : ''}`,
      `/assignments/${submission.id}`,
    );
    res.json({ ok: true });
  }),
);

assignmentsRouter.get(
  '/instructor/assignments',
  requireRole('instructor'),
  ah(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT a.*, c.title AS course_title,
          (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id) AS submissions,
          (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.grade IS NULL) AS ungraded
         FROM assignments a JOIN courses c ON c.id = a.course_id
         WHERE c.instructor_id = ? OR ? = 'admin'
         ORDER BY a.due_date DESC`,
      )
      .all(req.user!.id, req.user!.role);
    res.json({ assignments: rows });
  }),
);
