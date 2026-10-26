import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { Card, EmptyState, ErrorBanner, PageHeader, Pill, Spinner, StatCard } from '../lib/ui';
import { daysUntil, formatDate } from '../lib/format';

type Assignment = {
  id: string;
  title: string;
  due_date: string;
  course_title: string;
  course_id: string;
  submission_id: string | null;
  grade: number | null;
};

export default function AssignmentsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollments-me'],
    queryFn: () =>
      api.get<{
        enrollments: unknown[];
        due_assignments: Assignment[];
      }>('/enrollments/me'),
  });

  if (isLoading) return <Spinner label="Loading assignments" />;
  if (error) return <ErrorBanner error={error} />;

  const assignments = data?.due_assignments ?? [];
  const graded = assignments.filter((assignment) => assignment.grade !== null);
  const submitted = assignments.filter((assignment) => assignment.submission_id && assignment.grade === null);
  const pending = assignments.filter((assignment) => !assignment.submission_id);
  const averageGrade = graded.length
    ? Math.round(graded.reduce((sum, assignment) => sum + (assignment.grade ?? 0), 0) / graded.length)
    : null;

  return (
    <div>
      <PageHeader
        title="Assignments"
        subtitle="Everything due across your enrolled courses. Submissions are timestamped, and graded work comes with instructor feedback."
        actions={
          <Link to="/catalog">
            <span className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Find another course →</span>
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="To do" value={pending.length} hint="No submission yet" icon={<ClipboardList className="h-5 w-5" />} tone="amber" />
        <StatCard label="Submitted" value={submitted.length} hint="Awaiting a grade" icon={<FileText className="h-5 w-5" />} tone="sky" />
        <StatCard
          label="Average grade"
          value={averageGrade !== null ? `${averageGrade}/100` : '—'}
          hint={graded.length ? `${graded.length} graded` : 'Nothing graded yet'}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="emerald"
        />
      </div>

      {assignments.length ? (
        <div className="space-y-3">
          {assignments.map((assignment) => {
            const days = daysUntil(assignment.due_date);
            return (
              <Card key={assignment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-ink-900 dark:text-white">{assignment.title}</h3>
                    {assignment.grade !== null ? (
                      <Pill tone="emerald">Graded · {assignment.grade}/100</Pill>
                    ) : assignment.submission_id ? (
                      <Pill tone="sky">Submitted</Pill>
                    ) : (
                      <Pill tone="amber">Not started</Pill>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{assignment.course_title}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-400">
                    <CalendarClock className="h-3 w-3" />
                    Due {formatDate(assignment.due_date)}
                    {days !== null && (
                      <span className={days < 0 ? 'font-semibold text-rose-500' : days <= 2 ? 'font-semibold text-amber-500' : ''}>
                        · {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `${days}d left`}
                      </span>
                    )}
                  </p>
                </div>
                <Link
                  to={`/assignments/${assignment.id}`}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-xl border border-ink-200 px-4 text-xs font-bold text-ink-700 hover:bg-ink-50 sm:self-center dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  {assignment.grade !== null ? 'View feedback' : assignment.submission_id ? 'View submission' : 'Start assignment'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="No assignments"
          message="Assignments appear here when an instructor publishes one in a course you are enrolled in."
          action={<Link to="/catalog"><span className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">Browse courses</span></Link>}
        />
      )}
    </div>
  );
}
