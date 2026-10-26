import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  Link2,
  MessageSquare,
  Send,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Pill,
  RichText,
  Spinner,
  TextArea,
  TextInput,
} from '../lib/ui';
import { daysUntil, formatDate, timeAgo } from '../lib/format';

type Assignment = {
  id: string;
  course_id: string;
  title: string;
  instructions: string;
  rubric: { criterion: string; points: number }[];
  due_date: string;
  course_title: string;
};

type Submission = {
  id: string;
  file_url: string | null;
  content: string | null;
  submitted_at: string;
  grade: number | null;
  feedback: string | null;
};

export default function AssignmentDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isStaff = user?.role !== 'student';
  const [content, setContent] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [grades, setGrades] = useState<Record<string, { grade: string; feedback: string }>>({});

  const detailQuery = useQuery({
    queryKey: ['assignment', id],
    queryFn: () => api.get<{ assignment: Assignment; submission: Submission | null }>(`/assignments/${id}`),
    enabled: Boolean(id),
  });

  const submissionsQuery = useQuery({
    queryKey: ['assignment-submissions', id],
    queryFn: () =>
      api.get<{
        assignment: Assignment;
        submissions: (Submission & { full_name: string; email: string })[];
      }>(`/assignments/${id}/submissions`),
    enabled: isStaff && Boolean(id),
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/assignments/${id}/submit`, { content: content || undefined, file_url: fileUrl || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignment', id] });
      queryClient.invalidateQueries({ queryKey: ['enrollments-me'] });
    },
  });

  const grade = useMutation({
    mutationFn: ({ submissionId, score, feedback }: { submissionId: string; score: number; feedback: string }) =>
      api.put(`/submissions/${submissionId}/grade`, { grade: score, feedback }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignment-submissions', id] });
      queryClient.invalidateQueries({ queryKey: ['instructor-overview'] });
    },
  });

  if (detailQuery.isLoading) return <Spinner label="Loading assignment" />;
  if (detailQuery.error) return <ErrorBanner error={detailQuery.error} />;
  if (!detailQuery.data) return null;

  const { assignment, submission } = detailQuery.data;
  const days = daysUntil(assignment.due_date);

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={isStaff ? '/instructor' : '/assignments'} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> {isStaff ? 'Teaching hub' : 'Assignments'}
      </Link>

      <PageHeader
        title={assignment.title}
        subtitle={`${assignment.course_title} · due ${formatDate(assignment.due_date)}`}
        actions={
          <Pill tone={submission?.grade !== null && submission ? 'emerald' : submission ? 'sky' : days !== null && days < 0 ? 'rose' : 'amber'}>
            {submission?.grade !== null && submission ? `Graded ${submission.grade}/100` : submission ? 'Submitted' : days !== null && days < 0 ? 'Overdue' : 'Open'}
          </Pill>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-6">
          <h2 className="text-sm font-bold text-ink-900 dark:text-white">Instructions</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-600 dark:text-ink-300">{assignment.instructions}</p>

          {assignment.rubric.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-bold text-ink-900 dark:text-white">Rubric</h3>
              <div className="mt-2 overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
                {assignment.rubric.map((criterion, index) => (
                  <div
                    key={criterion.criterion}
                    className={index % 2 === 0 ? 'flex items-center justify-between gap-3 px-3 py-2.5' : 'flex items-center justify-between gap-3 bg-ink-50/60 px-3 py-2.5 dark:bg-ink-800/40'}
                  >
                    <p className="text-xs text-ink-600 dark:text-ink-300">{criterion.criterion}</p>
                    <span className="shrink-0 text-xs font-bold text-ink-800 dark:text-ink-100">{criterion.points} pts</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {!isStaff && (
            <div className="mt-6 border-t border-ink-100 pt-5 dark:border-ink-800">
              <h3 className="text-sm font-bold text-ink-900 dark:text-white">Your submission</h3>
              {submission ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-ink-100 p-3.5 dark:border-ink-800">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Submitted {timeAgo(submission.submitted_at)}</p>
                    {submission.content && <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-600 dark:text-ink-300">{submission.content}</p>}
                    {submission.file_url && (
                      <a href={submission.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                        <Link2 className="h-3 w-3" /> {submission.file_url}
                      </a>
                    )}
                  </div>
                  {submission.grade !== null && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">Instructor feedback</p>
                        <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">{submission.grade}/100</span>
                      </div>
                      {submission.feedback ? (
                        <RichText content={submission.feedback} className="mt-1.5 text-xs" />
                      ) : (
                        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">No written feedback.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <TextArea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder="Write your answer, or describe the attached work…"
                    rows={5}
                  />
                  <Field label="Attachment URL (optional)" hint="Link a GitHub repo, notebook, Google Drive file or PDF.">
                    <TextInput
                      value={fileUrl}
                      onChange={(event) => setFileUrl(event.target.value)}
                      placeholder="https://github.com/you/project"
                    />
                  </Field>
                  <ErrorBanner error={submit.error} />
                  <Button
                    loading={submit.isPending}
                    disabled={!content.trim() && !fileUrl.trim()}
                    onClick={() => submit.mutate()}
                    icon={<Send className="h-4 w-4" />}
                  >
                    Submit assignment
                  </Button>
                  {days !== null && days < 0 && (
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      This assignment is past due. Late submissions are accepted and flagged for the instructor.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-ink-400" />
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Deadline</h2>
            </div>
            <p className="mt-2 text-sm font-semibold text-ink-800 dark:text-ink-100">{formatDate(assignment.due_date)}</p>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              {days === null ? '' : days < 0 ? `${Math.abs(days)} days past due` : days === 0 ? 'Due today' : `${days} days remaining`}
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold text-ink-900 dark:text-white">How grading works</h2>
            <div className="mt-2 space-y-2 text-xs text-ink-500 dark:text-ink-400">
              <p className="flex gap-2"><ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" /> The instructor grades against the rubric above.</p>
              <p className="flex gap-2"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" /> Feedback lands in your notifications and on this page.</p>
              <p className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" /> Graded submissions cannot be replaced, so review before submitting.</p>
            </div>
          </Card>
        </div>
      </div>

      {isStaff && (
        <Card className="mt-6 p-6">
          <h2 className="text-base font-bold text-ink-900 dark:text-white">Submissions</h2>
          {submissionsQuery.isLoading ? (
            <Spinner label="Loading submissions" />
          ) : submissionsQuery.data?.submissions.length ? (
            <div className="mt-4 space-y-3">
              {submissionsQuery.data.submissions.map((item) => {
                const draft = grades[item.id] ?? { grade: item.grade !== null ? String(item.grade) : '', feedback: item.feedback ?? '' };
                return (
                  <div key={item.id} className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-ink-900 dark:text-white">{item.full_name}</p>
                        <p className="text-[11px] text-ink-400">{item.email} · submitted {timeAgo(item.submitted_at)}</p>
                      </div>
                      {item.grade !== null ? <Pill tone="emerald">{item.grade}/100</Pill> : <Pill tone="amber">Ungraded</Pill>}
                    </div>
                    {item.content && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-600 dark:text-ink-300">{item.content}</p>}
                    {item.file_url && (
                      <a href={item.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                        <FileUp className="h-3 w-3" /> {item.file_url}
                      </a>
                    )}
                    <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr_auto] sm:items-end">
                      <Field label="Grade">
                        <TextInput
                          type="number"
                          min={0}
                          max={100}
                          value={draft.grade}
                          onChange={(event) => setGrades((state) => ({ ...state, [item.id]: { ...draft, grade: event.target.value } }))}
                        />
                      </Field>
                      <Field label="Feedback">
                        <TextInput
                          value={draft.feedback}
                          onChange={(event) => setGrades((state) => ({ ...state, [item.id]: { ...draft, feedback: event.target.value } }))}
                          placeholder="What worked, what to fix"
                        />
                      </Field>
                      <Button
                        size="sm"
                        loading={grade.isPending}
                        disabled={draft.grade === ''}
                        onClick={() =>
                          grade.mutate({ submissionId: item.id, score: Number(draft.grade), feedback: draft.feedback })
                        }
                      >
                        Save grade
                      </Button>
                    </div>
                  </div>
                );
              })}
              <ErrorBanner error={grade.error} />
            </div>
          ) : (
            <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="No submissions yet" message="Learners will appear here once they submit." />
          )}
        </Card>
      )}
    </div>
  );
}
