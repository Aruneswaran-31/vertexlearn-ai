import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Flame,
  Gauge,
  GraduationCap,
  PlayCircle,
  Sparkles,
  Target,
  Wand2,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Course, StudyPlan } from '../lib/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Pill,
  ProgressBar,
  Spinner,
  StatCard,
  cn,
} from '../lib/ui';
import { daysUntil, formatDate, timeAgo } from '../lib/format';

type Enrollment = {
  id: string;
  progress_percent: number;
  course_id: string;
  title: string;
  category: string;
  difficulty: string;
  thumbnail_url: string | null;
  instructor_name: string;
  total_lectures: number;
  completed_lectures: number;
  avg_score: number | null;
  next_lecture_id: string | null;
  next_lecture_title: string | null;
};

type EnrollmentsResponse = {
  enrollments: Enrollment[];
  due_assignments: {
    id: string;
    title: string;
    due_date: string;
    course_title: string;
    course_id: string;
    submission_id: string | null;
    grade: number | null;
  }[];
  streak: { current: number; longest: number };
};

type BadgeResponse = {
  badges: { slug: string; name: string; description: string; criteria: string; earned: boolean; earned_at: string | null }[];
  earned_count: number;
};

type Attempt = {
  id: string;
  score: number;
  submitted_at: string;
  title: string;
  course_title: string;
  course_id: string;
};

export default function StudentDashboard() {
  const queryClient = useQueryClient();
  const [planCourseId, setPlanCourseId] = useState<string>('');

  const enrollmentsQuery = useQuery({
    queryKey: ['enrollments-me'],
    queryFn: () => api.get<EnrollmentsResponse>('/enrollments/me'),
  });
  const recommendationsQuery = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => api.get<{ recommendations: (Pick<Course, 'id' | 'title' | 'category'> & { reason: string })[] }>('/recommendations/me'),
  });
  const badgesQuery = useQuery({
    queryKey: ['badges'],
    queryFn: () => api.get<BadgeResponse>('/users/me/badges'),
  });
  const attemptsQuery = useQuery({
    queryKey: ['my-attempts'],
    queryFn: () => api.get<{ attempts: Attempt[] }>('/quiz-attempts/me'),
  });

  const enrollments = enrollmentsQuery.data?.enrollments ?? [];
  const activeCourse = planCourseId || enrollments[0]?.course_id || '';

  useEffect(() => {
    if (!planCourseId && enrollments[0]) setPlanCourseId(enrollments[0].course_id);
  }, [enrollments, planCourseId]);

  const planQuery = useQuery({
    queryKey: ['study-plan', activeCourse],
    queryFn: () => api.get<{ plan: StudyPlan | null; generated_at: string | null }>(`/ai/study-plan/${activeCourse}`),
    enabled: Boolean(activeCourse),
  });

  const generatePlan = useMutation({
    mutationFn: () => api.post<{ plan: StudyPlan }>('/ai/study-plan', { course_id: activeCourse }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-plan', activeCourse] });
      queryClient.invalidateQueries({ queryKey: ['enrollments-me'] });
    },
  });

  if (enrollmentsQuery.isLoading) return <Spinner label="Loading your dashboard" />;
  if (enrollmentsQuery.error) return <ErrorBanner error={enrollmentsQuery.error} />;

  const data = enrollmentsQuery.data!;
  const averageProgress = enrollments.length
    ? Math.round(enrollments.reduce((sum, item) => sum + item.progress_percent, 0) / enrollments.length)
    : 0;
  const scored = enrollments.filter((item) => item.avg_score !== null);
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + (item.avg_score ?? 0), 0) / scored.length)
    : null;
  const earnedBadges = badgesQuery.data?.badges.filter((badge) => badge.earned) ?? [];
  const plan = planQuery.data?.plan ?? null;
  const activeEnrollment = enrollments.find((item) => item.course_id === activeCourse);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 p-6 text-white sm:p-8">
        <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide backdrop-blur">
              <Sparkles className="h-3 w-3" /> Personalised workspace
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Keep the streak alive</h1>
            <p className="mt-2 max-w-xl text-sm text-white/80">
              {enrollments.length
                ? `You are ${averageProgress}% through your enrolled courses. Your weakest topic is already queued in the study plan below.`
                : 'Enroll in your first course to unlock the AI tutor, quizzes and a personalised plan.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to={activeEnrollment?.next_lecture_id ? `/courses/${activeCourse}/learn` : '/catalog'}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-4 text-xs font-bold text-brand-700 hover:bg-brand-50"
              >
                <PlayCircle className="h-4 w-4" />
                {activeEnrollment?.next_lecture_id ? 'Resume learning' : 'Browse courses'}
              </Link>
              <Link
                to="/achievements"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-4 text-xs font-bold text-white backdrop-blur hover:bg-white/20"
              >
                <Award className="h-4 w-4" /> Achievements
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-white/15">
              <Flame className="h-7 w-7 text-amber-300" />
            </div>
            <div>
              <p className="text-2xl font-extrabold">{data.streak.current} days</p>
              <p className="text-[11px] text-white/70">Current streak · best {data.streak.longest}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active courses" value={enrollments.length} hint="Enrolled and in progress" icon={<BookOpen className="h-5 w-5" />} />
        <StatCard label="Average progress" value={`${averageProgress}%`} hint="Across all enrollments" icon={<Gauge className="h-5 w-5" />} tone="sky" />
        <StatCard
          label="Quiz average"
          value={averageScore !== null ? `${averageScore}%` : '—'}
          hint={scored.length ? `Best-in-class threshold 80%` : 'Take a quiz to unlock'}
          icon={<Target className="h-5 w-5" />}
          tone="emerald"
        />
        <StatCard label="Badges earned" value={badgesQuery.data?.earned_count ?? 0} hint="Milestones unlocked" icon={<Award className="h-5 w-5" />} tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Continue learning</h2>
              <Link to="/catalog" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Browse catalog →
              </Link>
            </div>
            {enrollments.length ? (
              <div className="space-y-3">
                {enrollments.map((enrollment) => (
                  <Card key={enrollment.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <div className="h-20 w-full shrink-0 overflow-hidden rounded-xl bg-ink-100 sm:w-32 dark:bg-ink-800">
                      {enrollment.thumbnail_url && (
                        <img src={enrollment.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-ink-900 dark:text-white">{enrollment.title}</h3>
                        {enrollment.progress_percent >= 100 && <Pill tone="emerald">Completed</Pill>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {enrollment.completed_lectures}/{enrollment.total_lectures} lectures · {enrollment.instructor_name}
                        {enrollment.avg_score !== null && ` · quiz avg ${Math.round(enrollment.avg_score)}%`}
                      </p>
                      <div className="mt-2">
                        <ProgressBar value={enrollment.progress_percent} showLabel />
                      </div>
                      {enrollment.next_lecture_title && (
                        <p className="mt-1.5 truncate text-[11px] text-ink-400">
                          Next: {enrollment.next_lecture_title}
                        </p>
                      )}
                    </div>
                    <Link
                      to={`/courses/${enrollment.course_id}/learn`}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-xl bg-brand-600 px-4 text-xs font-bold text-white hover:bg-brand-700 sm:self-center"
                    >
                      {enrollment.progress_percent > 0 ? 'Continue' : 'Start'} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen className="h-6 w-6" />}
                title="No enrollments yet"
                message="Pick a course from the catalog. The tutor, quizzes and study plan unlock as soon as you enroll."
                action={<Link to="/catalog"><Button>Browse the catalog</Button></Link>}
              />
            )}
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <Wand2 className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-ink-900 dark:text-white">Your study plan</h2>
                  <p className="text-xs text-ink-500 dark:text-ink-400">Generated from quiz mastery and current progress</p>
                </div>
              </div>
              {enrollments.length > 1 && (
                <select
                  value={activeCourse}
                  onChange={(event) => setPlanCourseId(event.target.value)}
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                  aria-label="Choose course for study plan"
                >
                  {enrollments.map((enrollment) => (
                    <option key={enrollment.course_id} value={enrollment.course_id}>
                      {enrollment.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {planQuery.isLoading ? (
              <Spinner label="Loading plan" />
            ) : plan ? (
              <div className="mt-4">
                <p className="text-sm text-ink-600 dark:text-ink-300">{plan.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {plan.weak_topics.map((topic) => (
                    <Pill key={topic.topic} tone={topic.score < 50 ? 'rose' : 'amber'}>
                      {topic.topic} · {Math.round(topic.score)}%
                    </Pill>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {plan.weeks.map((week) => (
                    <div key={week.week} className="rounded-xl border border-ink-100 bg-ink-50/50 p-3 dark:border-ink-800 dark:bg-ink-800/40">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Week {week.week}</p>
                      <p className="mt-0.5 text-xs font-bold text-ink-800 dark:text-ink-100">{week.focus}</p>
                      <ul className="mt-2 space-y-1.5">
                        {week.tasks.map((task) => (
                          <li key={task} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-ink-300 dark:text-ink-600" />
                            {task}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-ink-400">
                    {planQuery.data?.generated_at ? `Generated ${timeAgo(planQuery.data.generated_at)}` : ''}
                  </p>
                  <Button size="sm" variant="outline" loading={generatePlan.isPending} onClick={() => generatePlan.mutate()}>
                    Regenerate plan
                  </Button>
                </div>
                <ErrorBanner error={generatePlan.error} />
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-ink-200 p-5 text-center dark:border-ink-700">
                <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">No plan for this course yet</p>
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                  The planner uses your quiz mastery and progress to build a four-week schedule.
                </p>
                <Button className="mt-3" size="sm" loading={generatePlan.isPending} onClick={() => generatePlan.mutate()} disabled={!activeCourse}>
                  <Sparkles className="h-3.5 w-3.5" /> Generate my plan
                </Button>
                <ErrorBanner error={generatePlan.error} />
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Due soon</h2>
              <CalendarClock className="h-4 w-4 text-ink-400" />
            </div>
            {data.due_assignments.length ? (
              <div className="space-y-3">
                {data.due_assignments.map((assignment) => {
                  const days = daysUntil(assignment.due_date);
                  return (
                    <Link
                      key={assignment.id}
                      to={`/assignments/${assignment.id}`}
                      className="block rounded-xl border border-ink-100 p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/40 dark:border-ink-800 dark:hover:border-brand-500/30 dark:hover:bg-brand-500/5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-bold text-ink-900 dark:text-white">{assignment.title}</p>
                        {assignment.grade !== null ? (
                          <Pill tone="emerald">{assignment.grade}/100</Pill>
                        ) : assignment.submission_id ? (
                          <Pill tone="sky">Submitted</Pill>
                        ) : (
                          <Pill tone={days !== null && days < 0 ? 'rose' : days !== null && days <= 2 ? 'amber' : 'neutral'}>
                            {days !== null && days < 0 ? 'Overdue' : days === 0 ? 'Today' : `${days}d left`}
                          </Pill>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">{assignment.course_title}</p>
                      <p className="mt-1 text-[10px] text-ink-400">Due {formatDate(assignment.due_date)}</p>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
                Nothing due. Use the time to get ahead in a module.
              </p>
            )}
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Recent quiz results</h2>
              <Target className="h-4 w-4 text-ink-400" />
            </div>
            {attemptsQuery.data?.attempts.length ? (
              <div className="space-y-2.5">
                {attemptsQuery.data.attempts.slice(0, 4).map((attempt) => (
                  <div key={attempt.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink-800 dark:text-ink-100">{attempt.title}</p>
                      <p className="text-[10px] text-ink-400">{attempt.course_title} · {timeAgo(attempt.submitted_at)}</p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-lg px-2 py-1 text-xs font-bold',
                        attempt.score >= 80
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : attempt.score >= 50
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
                      )}
                    >
                      {Math.round(attempt.score)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
                No attempts yet — quizzes appear inside each module.
              </p>
            )}
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Recommended next</h2>
              <GraduationCap className="h-4 w-4 text-ink-400" />
            </div>
            {recommendationsQuery.data?.recommendations.length ? (
              <div className="space-y-3">
                {recommendationsQuery.data.recommendations.map((course) => (
                  <Link key={course.id} to={`/courses/${course.id}`} className="block rounded-xl border border-ink-100 p-3 hover:border-brand-200 dark:border-ink-800 dark:hover:border-brand-500/30">
                    <p className="text-xs font-bold text-ink-900 dark:text-white">{course.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">{course.reason}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-500 dark:text-ink-400">Recommendations appear once you enroll in a course.</p>
            )}
          </section>

          {earnedBadges.length > 0 && (
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-ink-900 dark:text-white">Latest badges</h2>
                <Link to="/achievements" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400">View all</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {earnedBadges.slice(0, 3).map((badge) => (
                  <div key={badge.slug} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <Award className="h-4 w-4 text-amber-500" />
                    <span className="text-[11px] font-bold text-amber-800 dark:text-amber-200">{badge.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
