import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Course } from '../lib/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  Pill,
  ProgressBar,
  Select,
  Spinner,
  StatCard,
  TextArea,
  TextInput,
} from '../lib/ui';
import { timeAgo } from '../lib/format';

type OverviewResponse = {
  courses: {
    id: string;
    title: string;
    status: string;
    category: string;
    difficulty: string;
    learners: number;
    avg_progress: number;
    modules: number;
    lectures: number;
  }[];
  overview: {
    courses: number;
    published: number;
    pending: number;
    learners: number;
    avg_progress: number;
    completions: number;
    ungraded_submissions: number;
  };
  recent_submissions: {
    id: string;
    submitted_at: string;
    grade: number | null;
    student: string;
    assignment: string;
    course: string;
  }[];
};

const initialCourse = {
  title: '',
  description: '',
  category: '',
  difficulty: 'beginner',
  price: '0',
  thumbnail_url: '',
  outcomes: '',
};

export default function InstructorDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialCourse);

  const { data, isLoading, error } = useQuery({
    queryKey: ['instructor-overview'],
    queryFn: () => api.get<OverviewResponse>('/instructor/overview'),
  });

  const createCourse = useMutation({
    mutationFn: () =>
      api.post<{ course: Course }>('/courses', {
        title: form.title,
        description: form.description,
        category: form.category,
        difficulty: form.difficulty,
        price: Number(form.price) || 0,
        thumbnail_url: form.thumbnail_url,
        outcomes: form.outcomes
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    onSuccess: (result) => {
      setOpen(false);
      setForm(initialCourse);
      queryClient.invalidateQueries({ queryKey: ['instructor-overview'] });
      navigate(`/instructor/courses/${result.course.id}`);
    },
  });

  if (isLoading) return <Spinner label="Loading teaching hub" />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title="Teaching hub"
        subtitle="Author courses, draft quizzes from transcripts, grade submissions and spot learners who need help early."
        actions={
          <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" />}>
            New course
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Courses" value={data.overview.courses} hint={`${data.overview.published} published · ${data.overview.pending} in review`} icon={<BookOpen className="h-5 w-5" />} />
        <StatCard label="Learners" value={data.overview.learners} hint="Unique enrollment count" icon={<Users className="h-5 w-5" />} tone="sky" />
        <StatCard label="Avg. progress" value={`${data.overview.avg_progress}%`} hint={`${data.overview.completions} completions`} icon={<TrendingUp className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Ungraded" value={data.overview.ungraded_submissions} hint="Submissions waiting on you" icon={<ClipboardCheck className="h-5 w-5" />} tone="amber" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink-900 dark:text-white">Your courses</h2>
            <Link to="/catalog" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">View catalog →</Link>
          </div>

          {data.courses.length ? (
            <div className="space-y-3">
              {data.courses.map((course) => (
                <Card key={course.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-ink-900 dark:text-white">{course.title}</h3>
                        <Pill
                          tone={course.status === 'approved' ? 'emerald' : course.status === 'pending' ? 'amber' : course.status === 'rejected' ? 'rose' : 'neutral'}
                          className="capitalize"
                        >
                          {course.status}
                        </Pill>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {course.category} · {course.difficulty} · {course.modules} modules · {course.lectures} lectures
                      </p>
                    </div>
                    <Link to={`/instructor/courses/${course.id}`}>
                      <Button size="sm" variant="outline">Manage <ArrowRight className="h-3 w-3" /></Button>
                    </Link>
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <div className="flex-1">
                      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-ink-400">
                        <span>{course.learners} learners</span>
                        <span>{course.avg_progress}% avg progress</span>
                      </div>
                      <ProgressBar value={course.avg_progress} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title="Create your first course"
              message="Add modules and transcripts, then let the AI draft quiz questions from the material for your review."
              action={<Button onClick={() => setOpen(true)}>New course</Button>}
            />
          )}

          <Card className="mt-4 border-brand-200 bg-brand-50/50 p-4 dark:border-brand-500/30 dark:bg-brand-500/5">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 text-brand-500" />
              <div>
                <p className="text-xs font-bold text-ink-900 dark:text-white">AI quiz drafts, your judgement</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                  Every generated question is a draft. Open a course, pick a lecture with a transcript and review the
                  questions before publishing them to learners.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Recent submissions</h2>
              <ClipboardCheck className="h-4 w-4 text-ink-400" />
            </div>
            {data.recent_submissions.length ? (
              <div className="space-y-2.5">
                {data.recent_submissions.map((submission) => (
                  <Link
                    key={submission.id}
                    to={`/assignments/${submission.id}`}
                    className="block rounded-xl border border-ink-100 p-3 hover:border-brand-200 dark:border-ink-800 dark:hover:border-brand-500/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-ink-900 dark:text-white">{submission.assignment}</p>
                      {submission.grade !== null ? <Pill tone="emerald">{submission.grade}/100</Pill> : <Pill tone="amber">Grade</Pill>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">
                      {submission.student} · {submission.course}
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-400">{timeAgo(submission.submitted_at)}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
                No submissions yet.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Early intervention</h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              Each course analytics page flags learners with low progress, weak quiz scores or a week of inactivity —
              before the final assessment. Open a course and check the Analytics tab.
            </p>
            {data.courses[0] && (
              <Link to={`/instructor/courses/${data.courses[0].id}`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:underline dark:text-brand-400">
                <GraduationCap className="h-3.5 w-3.5" /> Open course analytics
              </Link>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a course"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={createCourse.isPending}
              disabled={form.title.length < 4 || form.description.length < 20 || form.category.length < 2}
              onClick={() => createCourse.mutate()}
            >
              Create draft
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Course title">
              <TextInput value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Applied Graph Algorithms" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" hint="At least 20 characters. Learners see this in the catalog.">
              <TextArea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} placeholder="What will learners be able to do?" />
            </Field>
          </div>
          <Field label="Category">
            <TextInput value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Computer Science" />
          </Field>
          <Field label="Difficulty">
            <Select
              value={form.difficulty}
              onChange={(event) => setForm({ ...form, difficulty: event.target.value })}
              options={[
                { value: 'beginner', label: 'Beginner' },
                { value: 'intermediate', label: 'Intermediate' },
                { value: 'advanced', label: 'Advanced' },
              ]}
            />
          </Field>
          <Field label="Price (USD)" hint="Use 0 for a free course.">
            <TextInput type="number" min={0} value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
          </Field>
          <Field label="Thumbnail URL" hint="Optional image URL.">
            <TextInput value={form.thumbnail_url} onChange={(event) => setForm({ ...form, thumbnail_url: event.target.value })} placeholder="https://…" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Learning outcomes" hint="One per line.">
              <TextArea value={form.outcomes} onChange={(event) => setForm({ ...form, outcomes: event.target.value })} rows={3} placeholder={'Analyse graph algorithms\nChoose the right traversal'} />
            </Field>
          </div>
        </div>
        <ErrorBanner error={createCourse.error} />
        <p className="mt-3 rounded-xl bg-ink-50 p-3 text-[11px] text-ink-500 dark:bg-ink-800 dark:text-ink-400">
          New courses enter the admin approval queue before appearing publicly. You can add modules and transcripts
          while it is in review.
        </p>
      </Modal>
    </div>
  );
}
