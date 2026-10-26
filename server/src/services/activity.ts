import { db, newId, nowIso, todayIso } from '../db/index.js';

export function notify(userId: string, title: string, body: string, link?: string): void {
  db.prepare(
    'INSERT INTO notifications (id, user_id, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
  ).run(newId(), userId, title, body, link ?? null, nowIso());
}

export const BADGES = {
  first_steps: {
    name: 'First Steps',
    description: 'Completed your first lecture.',
    icon: 'footprints',
    criteria: 'Complete one lecture',
  },
  course_complete: {
    name: 'Course Finisher',
    description: 'Completed an entire course.',
    icon: 'award',
    criteria: 'Reach 100% progress in a course',
  },
  week_streak: {
    name: 'Seven-Day Streak',
    description: 'Studied seven days in a row.',
    icon: 'flame',
    criteria: 'Maintain a 7-day learning streak',
  },
  perfect_quiz: {
    name: 'Perfect Score',
    description: 'Aced a quiz without missing a question.',
    icon: 'target',
    criteria: 'Score 100% on any quiz',
  },
  curious_mind: {
    name: 'Curious Mind',
    description: 'Asked the AI tutor ten questions.',
    icon: 'sparkles',
    criteria: 'Send 10 AI tutor messages',
  },
} as const;

export type BadgeSlug = keyof typeof BADGES;

export function ensureBadgeCatalog(): void {
  const insert = db.prepare(
    'INSERT INTO badges (slug, name, description, icon, criteria) VALUES (?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name, description = excluded.description, icon = excluded.icon, criteria = excluded.criteria',
  );
  for (const [slug, badge] of Object.entries(BADGES)) {
    insert.run(slug, badge.name, badge.description, badge.icon, badge.criteria);
  }
}

export function awardBadge(userId: string, slug: BadgeSlug): boolean {
  const badge = db.prepare('SELECT id, name, description FROM badges WHERE slug = ?').get(slug) as
    | { id: number; name: string; description: string }
    | undefined;
  if (!badge) return false;
  const existing = db
    .prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?')
    .get(userId, badge.id);
  if (existing) return false;
  db.prepare('INSERT INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)').run(
    userId,
    badge.id,
    nowIso(),
  );
  notify(userId, `Badge unlocked: ${badge.name}`, badge.description, '/achievements');
  return true;
}

/** Record daily activity and keep streak counters in sync. */
export function touchStreak(userId: string): { current: number; longest: number } {
  const today = todayIso();
  const row = db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(userId) as
    | { current_streak: number; longest_streak: number; last_active_date: string | null }
    | undefined;

  if (!row) {
    db.prepare(
      'INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date) VALUES (?, 1, 1, ?)',
    ).run(userId, today);
    return { current: 1, longest: 1 };
  }

  if (row.last_active_date === today) {
    return { current: row.current_streak, longest: row.longest_streak };
  }

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const current = row.last_active_date === yesterday ? row.current_streak + 1 : 1;
  const longest = Math.max(current, row.longest_streak);
  db.prepare(
    'UPDATE streaks SET current_streak = ?, longest_streak = ?, last_active_date = ? WHERE user_id = ?',
  ).run(current, longest, today, userId);
  if (current >= 7) awardBadge(userId, 'week_streak');
  return { current, longest };
}

export function issueCertificateIfComplete(enrollmentId: string): boolean {
  const enrollment = db
    .prepare('SELECT * FROM enrollments WHERE id = ?')
    .get(enrollmentId) as
    | { id: string; user_id: string; course_id: string; progress_percent: number; completed_at: string | null }
    | undefined;
  if (!enrollment || enrollment.progress_percent < 100) return false;

  const existing = db
    .prepare('SELECT id FROM certificates WHERE user_id = ? AND course_id = ?')
    .get(enrollment.user_id, enrollment.course_id) as { id: string } | undefined;
  if (existing) return false;

  const certId = newId('cert');
  const url = `/api/v1/certificates/${certId}/download`;
  db.prepare(
    'INSERT INTO certificates (id, user_id, course_id, certificate_url, issued_at) VALUES (?, ?, ?, ?, ?)',
  ).run(certId, enrollment.user_id, enrollment.course_id, url, nowIso());
  db.prepare('UPDATE enrollments SET completed_at = ? WHERE id = ?').run(nowIso(), enrollmentId);

  const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(enrollment.course_id) as
    | { title: string }
    | undefined;
  notify(
    enrollment.user_id,
    'Certificate issued 🎓',
    `You completed ${course?.title ?? 'your course'}. Your certificate is ready to download.`,
    '/achievements',
  );
  awardBadge(enrollment.user_id, 'course_complete');
  return true;
}

/** Recompute progress from completed lectures and issue certificates at 100%. */
export function recalcProgress(enrollmentId: string): number {
  const enrollment = db
    .prepare('SELECT * FROM enrollments WHERE id = ?')
    .get(enrollmentId) as { id: string; course_id: string } | undefined;
  if (!enrollment) return 0;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total FROM lectures l
       JOIN modules m ON m.id = l.module_id
       WHERE m.course_id = ?`,
    )
    .get(enrollment.course_id) as { total: number };

  if (!totals.total) return 0;

  const completed = db
    .prepare(
      `SELECT COUNT(*) AS done FROM lecture_progress lp
       JOIN lectures l ON l.id = lp.lecture_id
       JOIN modules m ON m.id = l.module_id
       WHERE lp.enrollment_id = ? AND lp.completed = 1`,
    )
    .get(enrollmentId) as { done: number };

  const percent = Math.round((completed.done / totals.total) * 10000) / 100;
  db.prepare('UPDATE enrollments SET progress_percent = ? WHERE id = ?').run(percent, enrollmentId);
  if (percent >= 100) issueCertificateIfComplete(enrollmentId);
  return percent;
}

export function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(newId(), actorId, action, entity, entityId, metadata ? JSON.stringify(metadata) : null, nowIso());
}
