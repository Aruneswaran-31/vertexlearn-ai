process.env.DB_PATH = ':memory:';
process.env.SEED_DEMO_DATA = 'false';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

let app: Express;
let studentToken = '';
let instructorToken = '';
let adminToken = '';
let dsaId = '';
let courseDetail: any;
let quicksortLectureId = '';

function authed(method: 'get' | 'post' | 'put', path: string, token: string, body?: unknown) {
  const call = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? call : call.send(body as object);
}

beforeAll(async () => {
  const { seedIfEmpty } = await import('../server/src/db/seed.js');
  const seeded = seedIfEmpty();
  expect(seeded.users).toBeGreaterThan(0);

  const { createApp } = await import('../server/src/app.js');
  app = createApp();

  const login = async (email: string) => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Demo@12345' })
      .expect(200);
    return response.body.access_token as string;
  };

  studentToken = await login('student@vertexlearn.ai');
  instructorToken = await login('instructor@vertexlearn.ai');
  adminToken = await login('admin@vertexlearn.ai');

  const catalog = await request(app).get('/api/v1/courses').expect(200);
  const dsa = catalog.body.courses.find((course: any) => course.title.includes('Data Structures'));
  dsaId = dsa.id;
  const detail = await authed('get', `/api/v1/courses/${dsaId}`, studentToken).expect(200);
  courseDetail = detail.body;
  quicksortLectureId = courseDetail.modules[1].lectures[1].id;
});

describe('auth and RBAC', () => {
  it('exposes a health check and a public catalog of approved courses only', async () => {
    const health = await request(app).get('/api/v1/health').expect(200);
    expect(health.body.status).toBe('ok');

    const catalog = await request(app).get('/api/v1/courses').expect(200);
    expect(catalog.body.courses.length).toBe(3);
    expect(catalog.body.courses.every((course: any) => course.status === 'approved')).toBe(true);
  });

  it('rejects bad credentials without revealing which field was wrong', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'student@vertexlearn.ai', password: 'wrong-password' })
      .expect(401);
    expect(response.body.error.message).toBe('Email or password is incorrect');
  });

  it('requires a token for private endpoints', async () => {
    await request(app).get('/api/v1/enrollments/me').expect(401);
  });

  it('returns the signed-in profile with role and streak', async () => {
    const response = await authed('get', '/api/v1/auth/me', studentToken).expect(200);
    expect(response.body.user.role).toBe('student');
    expect(response.body.user.email).toBe('student@vertexlearn.ai');
    expect(response.body.user.streak.current).toBeGreaterThan(0);
  });

  it('blocks students from admin endpoints', async () => {
    await authed('get', '/api/v1/admin/analytics/overview', studentToken).expect(403);
  });

  it('does not expose correct answers to students before an attempt', async () => {
    const quizId = courseDetail.modules[1].quizzes[0].id;
    const studentView = await authed('get', `/api/v1/quizzes/${quizId}`, studentToken).expect(200);
    const instructorView = await authed('get', `/api/v1/quizzes/${quizId}`, instructorToken).expect(200);
    expect(studentView.body.questions[0].options[0].is_correct).toBeUndefined();
    expect(typeof instructorView.body.questions[0].options[0].is_correct).toBe('boolean');
  });
});

describe('enrollment and progress', () => {
  it('reports seeded enrollments with progress and upcoming work', async () => {
    const response = await authed('get', '/api/v1/enrollments/me', studentToken).expect(200);
    const dsa = response.body.enrollments.find((item: any) => item.course_id === dsaId);
    expect(dsa.progress_percent).toBe(50);
    expect(dsa.next_lecture_title).toBeTruthy();
    expect(response.body.due_assignments.length).toBeGreaterThan(0);
  });

  it('is idempotent when a student enrolls twice', async () => {
    const response = await authed('post', `/api/v1/courses/${dsaId}/enroll`, studentToken).expect(200);
    expect(response.body.already_enrolled).toBe(true);
  });

  it('updates lecture progress and recomputes course percentage', async () => {
    const nextLecture = courseDetail.modules[2].lectures[1];
    const response = await authed('post', `/api/v1/lectures/${nextLecture.id}/progress`, studentToken, {
      watched_seconds: 900,
      completed: true,
    }).expect(200);
    expect(response.body.completed).toBe(true);
    expect(response.body.progress_percent).toBeGreaterThan(50);
  });

  it('stores timestamped notes and bookmarks', async () => {
    const note = await authed('post', `/api/v1/lectures/${quicksortLectureId}/notes`, studentToken, {
      content: 'Pivot choice determines worst case',
      timestamp_seconds: 240,
    }).expect(201);
    expect(note.body.note.timestamp_seconds).toBe(240);

    await authed('post', `/api/v1/lectures/${quicksortLectureId}/bookmarks`, studentToken, {
      timestamp_seconds: 842,
      label: 'Worst case explanation',
    }).expect(201);

    const list = await authed('get', `/api/v1/lectures/${quicksortLectureId}/notes`, studentToken).expect(200);
    expect(list.body.notes.length).toBeGreaterThan(0);
    expect(list.body.bookmarks.some((bookmark: any) => bookmark.timestamp_seconds === 842)).toBe(true);
  });
});

describe('AI tutor grounding', () => {
  it('answers a course question with a citation and no outside knowledge', async () => {
    const session = await authed('post', '/api/v1/ai/chat/sessions', studentToken, {
      course_id: dsaId,
      mode: 'intermediate',
    }).expect(200);

    const response = await authed(
      'post',
      `/api/v1/ai/chat/sessions/${session.body.session.id}/messages`,
      studentToken,
      { message: 'Why does quicksort degrade to O(n^2) on sorted input?' },
    ).expect(200);

    expect(response.body.grounded).toBe(true);
    expect(response.body.message.sources.length).toBeGreaterThan(0);
    expect(response.body.message.sources[0].lecture_title).toContain('Quicksort');
    expect(response.body.message.content.toLowerCase()).toContain('sorted');
    expect(response.body.message.content).toMatch(/\[\d\]/);
  });

  it('refuses to answer when the course material does not cover the question', async () => {
    const session = await authed('post', '/api/v1/ai/chat/sessions', studentToken, {
      course_id: dsaId,
      mode: 'beginner',
    }).expect(200);

    const response = await authed(
      'post',
      `/api/v1/ai/chat/sessions/${session.body.session.id}/messages`,
      studentToken,
      { message: 'How do I bake sourdough bread at home?' },
    ).expect(200);

    expect(response.body.grounded).toBe(false);
    expect(response.body.message.sources).toEqual([]);
    expect(response.body.message.content).toContain("couldn't find that");
  });

  it('generates a lecture summary and module flashcards from transcripts', async () => {
    const summary = await authed('post', `/api/v1/ai/lectures/${quicksortLectureId}/summarize`, studentToken).expect(200);
    expect(summary.body.summary.length).toBeGreaterThan(100);

    const moduleId = courseDetail.modules[1].id;
    const cards = await authed('post', `/api/v1/ai/modules/${moduleId}/flashcards`, studentToken, { count: 5 }).expect(200);
    expect(cards.body.flashcards.length).toBeGreaterThan(0);
    expect(cards.body.flashcards[0].question).toMatch(/\?$/);
  });

  it('builds a four-week study plan from mastery data', async () => {
    const response = await authed('post', '/api/v1/ai/study-plan', studentToken, { course_id: dsaId }).expect(200);
    expect(response.body.plan.weeks).toHaveLength(4);
    expect(response.body.plan.summary.length).toBeGreaterThan(20);
    expect(Array.isArray(response.body.mastery)).toBe(true);
  });

  it('only lets the owning instructor draft a quiz from a lecture', async () => {
    await authed('post', `/api/v1/ai/lectures/${quicksortLectureId}/generate-quiz`, studentToken, { count: 4 }).expect(403);

    const draft = await authed(
      'post',
      `/api/v1/ai/lectures/${quicksortLectureId}/generate-quiz`,
      instructorToken,
      { count: 4 },
    ).expect(200);
    expect(draft.body.questions.length).toBeGreaterThan(0);
    for (const question of draft.body.questions) {
      expect(question.options).toHaveLength(4);
      expect(question.options.filter((option: any) => option.is_correct)).toHaveLength(1);
    }
  });
});

describe('quiz auto-grading and mastery', () => {
  it('grades a perfect attempt and updates topic mastery', async () => {
    const quizId = courseDetail.modules[1].quizzes[0].id;
    const instructorView = await authed('get', `/api/v1/quizzes/${quizId}`, instructorToken).expect(200);

    const attempt = await authed('post', `/api/v1/quizzes/${quizId}/attempt`, studentToken).expect(201);
    const answers = instructorView.body.questions.map((question: any) => ({
      question_id: question.id,
      selected_option_ids: question.options.filter((option: any) => option.is_correct).map((option: any) => option.id),
    }));

    const result = await authed('post', `/api/v1/attempts/${attempt.body.attempt_id}/submit`, studentToken, {
      answers,
    }).expect(200);

    expect(result.body.attempt.score).toBe(100);
    expect(result.body.review.every((item: any) => item.is_correct === true)).toBe(true);

    const plan = await authed('get', `/api/v1/ai/study-plan/${dsaId}`, studentToken).expect(200);
    const quicksort = plan.body.mastery.find((entry: any) => entry.topic === 'Quicksort');
    expect(quicksort.score).toBeGreaterThan(50);
  });

  it('rejects a second submission for the same attempt', async () => {
    const quizId = courseDetail.modules[2].quizzes[0].id;
    const attempt = await authed('post', `/api/v1/quizzes/${quizId}/attempt`, studentToken).expect(201);
    await authed('post', `/api/v1/attempts/${attempt.body.attempt_id}/submit`, studentToken, { answers: [] }).expect(200);
    await authed('post', `/api/v1/attempts/${attempt.body.attempt_id}/submit`, studentToken, { answers: [] }).expect(400);
  });

  it('validates quiz authoring payloads', async () => {
    const moduleId = courseDetail.modules[0].id;
    const response = await authed('post', '/api/v1/quizzes', instructorToken, {
      module_id: moduleId,
      title: 'Invalid quiz',
      questions: [
        {
          question_text: 'Which option is right?',
          question_type: 'mcq',
          options: [
            { option_text: 'A', is_correct: false },
            { option_text: 'B', is_correct: false },
          ],
        },
      ],
    });
    expect(response.status).toBe(400);
  });
});

describe('gamification, certificates and instructor analytics', () => {
  it('issues a downloadable PDF certificate for a completed course', async () => {
    const certificates = await authed('get', '/api/v1/certificates/me', studentToken).expect(200);
    expect(certificates.body.certificates.length).toBe(1);

    const pdf = await request(app)
      .get(certificates.body.certificates[0].certificate_url)
      .set('Authorization', `Bearer ${studentToken}`)
      .buffer(true)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1000);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns badges, streak activity and recommendations', async () => {
    const badges = await authed('get', '/api/v1/users/me/badges', studentToken).expect(200);
    expect(badges.body.badges.length).toBeGreaterThanOrEqual(5);
    expect(badges.body.earned_count).toBeGreaterThan(0);

    const streak = await authed('get', '/api/v1/users/me/streak', studentToken).expect(200);
    expect(streak.body.current).toBeGreaterThan(0);

    const recommendations = await authed('get', '/api/v1/recommendations/me', studentToken).expect(200);
    expect(Array.isArray(recommendations.body.recommendations)).toBe(true);
  });

  it('surfaces at-risk learners and per-lecture drop-off to the instructor', async () => {
    const analytics = await authed('get', `/api/v1/courses/${dsaId}/analytics`, instructorToken).expect(200);
    expect(analytics.body.overview.learners).toBeGreaterThan(0);
    expect(analytics.body.lectures.length).toBe(6);
    expect(analytics.body.at_risk_students.length).toBeGreaterThan(0);
  });

  it('stops a student from reading another course analytics page', async () => {
    await authed('get', `/api/v1/courses/${dsaId}/analytics`, studentToken).expect(403);
  });
});

describe('discussions and moderation', () => {
  it('lets enrolled learners open a thread and report a post', async () => {
    const threads = await authed('get', `/api/v1/courses/${dsaId}/threads`, studentToken).expect(200);
    let instructorPost: any;
    for (const seededThread of threads.body.threads) {
      const thread = await authed('get', `/api/v1/threads/${seededThread.id}`, studentToken).expect(200);
      instructorPost = thread.body.posts.find((post: any) => post.staff_role === 'instructor');
      if (instructorPost) break;
    }
    expect(instructorPost).toBeTruthy();

    await authed('post', `/api/v1/posts/${instructorPost.id}/flag`, studentToken, { reason: 'Test report' }).expect(200);

    const flagged = await authed('get', '/api/v1/admin/moderation/flagged-posts', adminToken).expect(200);
    expect(flagged.body.posts.length).toBeGreaterThan(0);

    const created = await authed('post', `/api/v1/courses/${dsaId}/threads`, studentToken, {
      title: 'Test thread from the suite',
      content: 'Does the tutor cite timestamps for every answer?',
    }).expect(201);
    expect(created.body.thread.id).toBeTruthy();
  });
});

describe('admin governance', () => {
  it('approves a pending course and makes it publicly visible', async () => {
    const pending = await authed('get', '/api/v1/admin/courses/pending', adminToken).expect(200);
    const course = pending.body.courses[0];
    expect(course).toBeTruthy();

    await authed('post', `/api/v1/courses/${course.id}/approve`, adminToken, {
      decision: 'approved',
      comment: 'Approved in the integration test',
    }).expect(200);

    const catalog = await request(app).get('/api/v1/courses').expect(200);
    expect(catalog.body.courses.length).toBe(4);
  });

  it('lists users and updates a role', async () => {
    const users = await authed('get', '/api/v1/admin/users?q=vikram', adminToken).expect(200);
    expect(users.body.users.length).toBe(1);
    const target = users.body.users[0];

    await authed('put', `/api/v1/admin/users/${target.id}/role`, adminToken, { role: 'instructor' }).expect(200);
    const updated = await authed('get', '/api/v1/admin/users?q=vikram', adminToken).expect(200);
    expect(updated.body.users[0].role).toBe('instructor');
  });
});
