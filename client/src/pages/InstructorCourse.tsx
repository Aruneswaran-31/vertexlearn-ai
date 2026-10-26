import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  GraduationCap,
  Megaphone,
  Plus,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { Course, Module } from '../lib/types';
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
  RichText,
  Select,
  Spinner,
  StatCard,
  Tabs,
  TextArea,
  TextInput,
  cn,
} from '../lib/ui';
import { formatDate, timeAgo } from '../lib/format';

type DraftQuestion = {
  question_text: string;
  question_type: 'mcq';
  explanation: string;
  topic: string;
  options: { option_text: string; is_correct: boolean }[];
};

type CourseDetail = {
  course: Course;
  can_edit: boolean;
  modules: Module[];
  assignments: { id: string; title: string; instructions: string; due_date: string }[];
  announcements: { id: string; content: string; created_at: string; author: string }[];
};

type Analytics = {
  course: { id: string; title: string; status: string };
  overview: {
    learners: number;
    avg_progress: number;
    completions: number;
    completion_rate: number;
    avg_quiz_score: number;
    quiz_attempts: number;
  };
  lectures: {
    id: string;
    title: string;
    module_title: string;
    duration_seconds: number;
    completed: number;
    avg_watched: number;
    dropoff: number;
  }[];
  quizzes: { id: string; title: string; attempts: number; avg_score: number; best_score: number }[];
  at_risk_students: {
    id: string;
    full_name: string;
    email: string;
    progress_percent: number;
    avg_score: number | null;
    days_inactive: number;
    risk_reasons: string[];
  }[];
  topic_mastery: { topic: string; score: number }[];
};

export default function InstructorCourse() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('curriculum');
  const [moduleTitle, setModuleTitle] = useState('');
  const [lectureFor, setLectureFor] = useState<{ moduleId: string; moduleTitle: string } | null>(null);
  const [lectureForm, setLectureForm] = useState({ title: '', transcript: '', minutes: '15', video_url: '', resources: '' });
  const [draft, setDraft] = useState<{ lecture: { id: string; title: string }; questions: DraftQuestion[]; selected: number[]; title: string; moduleId: string } | null>(null);
  const [summary, setSummary] = useState<{ title: string; text: string } | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ title: '', instructions: '', due_date: '', rubric: [{ criterion: '', points: '30' }] });
  const [announcement, setAnnouncement] = useState('');

  const courseQuery = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.get<CourseDetail>(`/courses/${id}`),
    enabled: Boolean(id),
  });

  const analyticsQuery = useQuery({
    queryKey: ['course-analytics', id],
    queryFn: () => api.get<Analytics>(`/courses/${id}/analytics`),
    enabled: tab === 'analytics',
  });

  const addModule = useMutation({
    mutationFn: () => api.post(`/courses/${id}/modules`, { title: moduleTitle }),
    onSuccess: () => {
      setModuleTitle('');
      queryClient.invalidateQueries({ queryKey: ['course', id] });
    },
  });

  const addLecture = useMutation({
    mutationFn: () =>
      api.post(`/modules/${lectureFor!.moduleId}/lectures`, {
        title: lectureForm.title,
        transcript: lectureForm.transcript,
        duration_seconds: Math.round(Number(lectureForm.minutes || 15) * 60),
        video_url: lectureForm.video_url,
        resource_urls: lectureForm.resources
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setLectureFor(null);
      setLectureForm({ title: '', transcript: '', minutes: '15', video_url: '', resources: '' });
      queryClient.invalidateQueries({ queryKey: ['course', id] });
    },
  });

  const draftQuiz = useMutation({
    mutationFn: (lecture: { id: string; title: string; moduleId: string }) =>
      api.post<{ questions: DraftQuestion[] }>(`/ai/lectures/${lecture.id}/generate-quiz`, { count: 6 }),
    onSuccess: (result, lecture) => {
      setDraft({
        lecture: { id: lecture.id, title: lecture.title },
        questions: result.questions,
        selected: result.questions.map((_, index) => index),
        title: `Checkpoint: ${lecture.title}`,
        moduleId: lecture.moduleId,
      });
    },
  });

  const publishQuiz = useMutation({
    mutationFn: () =>
      api.post('/quizzes', {
        module_id: draft!.moduleId,
        title: draft!.title,
        is_ai_generated: true,
        generated_from_lecture_id: draft!.lecture.id,
        questions: draft!.questions.filter((_, index) => draft!.selected.includes(index)),
      }),
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ['course', id] });
      queryClient.invalidateQueries({ queryKey: ['course-analytics', id] });
    },
  });

  const summarize = useMutation({
    mutationFn: (lecture: { id: string; title: string }) => api.post<{ summary: string }>(`/ai/lectures/${lecture.id}/summarize`),
    onSuccess: (result, lecture) => setSummary({ title: lecture.title, text: result.summary }),
  });

  const createAssignment = useMutation({
    mutationFn: () =>
      api.post('/assignments', {
        course_id: id,
        title: assignmentForm.title,
        instructions: assignmentForm.instructions,
        due_date: new Date(assignmentForm.due_date).toISOString(),
        rubric: assignmentForm.rubric
          .filter((item) => item.criterion.trim())
          .map((item) => ({ criterion: item.criterion, points: Number(item.points) || 0 })),
      }),
    onSuccess: () => {
      setAssignmentOpen(false);
      setAssignmentForm({ title: '', instructions: '', due_date: '', rubric: [{ criterion: '', points: '30' }] });
      queryClient.invalidateQueries({ queryKey: ['course', id] });
    },
  });

  const postAnnouncement = useMutation({
    mutationFn: () => api.post(`/courses/${id}/announcements`, { content: announcement }),
    onSuccess: () => {
      setAnnouncement('');
      queryClient.invalidateQueries({ queryKey: ['course', id] });
    },
  });

  if (courseQuery.isLoading) return <Spinner label="Loading course workspace" />;
  if (courseQuery.error) return <ErrorBanner error={courseQuery.error} />;
  if (!courseQuery.data) return null;

  const { course, modules, assignments, announcements } = courseQuery.data;
  const analytics = analyticsQuery.data;
  const lectureCount = modules.reduce((sum, module) => sum + module.lectures.length, 0);

  return (
    <div>
      <Link to="/instructor" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Teaching hub
      </Link>

      <PageHeader
        title={course.title}
        subtitle={`${course.category} · ${course.difficulty} · ${modules.length} modules · ${lectureCount} lectures · ${course.learners} learners`}
        actions={
          <>
            <Pill tone={course.status === 'approved' ? 'emerald' : course.status === 'pending' ? 'amber' : 'rose'} className="capitalize">{course.status}</Pill>
            <Link to={`/courses/${course.id}`}>
              <Button variant="outline" size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />}>View public page</Button>
            </Link>
          </>
        }
      />

      <Tabs
        className="mb-5"
        tabs={[
          { id: 'curriculum', label: 'Curriculum' },
          { id: 'analytics', label: 'Analytics' },
          { id: 'assignments', label: 'Assignments', count: assignments.length },
          { id: 'announcements', label: 'Announcements' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'curriculum' && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-3">
            {modules.map((module, moduleIndex) => (
              <Card key={module.id} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{moduleIndex + 1}</span>
                    <div>
                      <p className="text-sm font-bold text-ink-900 dark:text-white">{module.title}</p>
                      <p className="text-[10px] text-ink-400">{module.lectures.length} lectures · {module.quizzes.length} quizzes</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setLectureFor({ moduleId: module.id, moduleTitle: module.title })} icon={<Plus className="h-3 w-3" />}>
                    Lecture
                  </Button>
                </div>
                <div>
                  {module.lectures.map((lecture) => (
                    <div key={lecture.id} className="border-b border-ink-50 px-4 py-3 last:border-0 dark:border-ink-800/60">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{lecture.title}</p>
                          <p className="text-[10px] text-ink-400">
                            {Math.round(lecture.duration_seconds / 60)} min · {lecture.transcript ? `${lecture.transcript.split(/\s+/).length} words indexed` : 'no transcript'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={summarize.isPending && summarize.variables?.id === lecture.id}
                            onClick={() => summarize.mutate({ id: lecture.id, title: lecture.title })}
                            icon={<FileText className="h-3 w-3" />}
                          >
                            Summary
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!lecture.transcript}
                            loading={draftQuiz.isPending && draftQuiz.variables?.id === lecture.id}
                            onClick={() => draftQuiz.mutate({ id: lecture.id, title: lecture.title, moduleId: module.id })}
                            icon={<Sparkles className="h-3 w-3" />}
                          >
                            Draft quiz
                          </Button>
                        </div>
                      </div>
                      {lecture.summary && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[10px] font-semibold text-brand-600 dark:text-brand-400">Saved summary</summary>
                          <RichText content={lecture.summary} className="mt-1 text-[11px]" />
                        </details>
                      )}
                    </div>
                  ))}

                  {module.quizzes.map((quiz) => (
                    <div key={quiz.id} className="flex items-center justify-between gap-2 bg-violet-50/40 px-4 py-2.5 dark:bg-violet-500/5">
                      <div className="flex items-center gap-2">
                        <Target className="h-3.5 w-3.5 text-violet-500" />
                        <div>
                          <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-100">{quiz.title}</p>
                          <p className="text-[10px] text-ink-400">{quiz.question_count} questions{quiz.is_ai_generated ? ' · AI draft published' : ''}</p>
                        </div>
                      </div>
                      <Link to={`/quizzes/${quiz.id}`} className="text-[10px] font-bold text-violet-600 hover:underline dark:text-violet-400">Preview</Link>
                    </div>
                  ))}
                </div>
              </Card>
            ))}

            <Card className="p-4">
              <p className="text-xs font-bold text-ink-900 dark:text-white">Add a module</p>
              <div className="mt-2 flex gap-2">
                <TextInput
                  value={moduleTitle}
                  onChange={(event) => setModuleTitle(event.target.value)}
                  placeholder="Module title"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && moduleTitle.trim().length >= 3) addModule.mutate();
                  }}
                />
                <Button size="sm" loading={addModule.isPending} disabled={moduleTitle.trim().length < 3} onClick={() => addModule.mutate()}>
                  Add
                </Button>
              </div>
              <ErrorBanner error={addModule.error} />
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Course checklist</h2>
              <div className="mt-3 space-y-2 text-xs">
                {[
                  [modules.length > 0, 'At least one module'],
                  [lectureCount > 0, 'Lecture content added'],
                  [modules.some((module) => module.lectures.some((lecture) => lecture.transcript)), 'Transcripts indexed for the AI tutor'],
                  [modules.some((module) => module.quizzes.length > 0), 'A published checkpoint quiz'],
                  [assignments.length > 0, 'An assignment with a rubric'],
                  [course.status === 'approved', 'Admin approval for public listing'],
                ].map(([done, label]) => (
                  <div key={String(label)} className="flex items-start gap-2">
                    <CheckCircle2 className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', done ? 'text-emerald-500' : 'text-ink-300 dark:text-ink-600')} />
                    <span className={done ? 'text-ink-600 dark:text-ink-300' : 'text-ink-400'}>{label as string}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-500" />
                <h2 className="text-sm font-bold text-ink-900 dark:text-white">How the AI uses this</h2>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                Each transcript is split into overlapping chunks and embedded when you save it. The tutor retrieves
                only from this course, and every answer cites the lecture and timestamp. Quiz drafts are generated from
                a single lecture and never published without your review.
              </p>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Course facts</h2>
              <dl className="mt-2 divide-y divide-ink-100 text-[11px] dark:divide-ink-800">
                {[
                  ['Price', course.price > 0 ? `$${course.price}` : 'Free'],
                  ['Learners', String(course.learners)],
                  ['Created', course.created_at ? formatDate(course.created_at) : '—'],
                  ['Course ID', course.id.slice(0, 8)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 py-1.5">
                    <dt className="text-ink-400">{label}</dt>
                    <dd className="font-semibold text-ink-700 dark:text-ink-200">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <div>
          {analyticsQuery.isLoading ? (
            <Spinner label="Crunching analytics" />
          ) : analyticsQuery.error ? (
            <ErrorBanner error={analyticsQuery.error} />
          ) : analytics ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Learners" value={analytics.overview.learners} icon={<Users className="h-5 w-5" />} />
                <StatCard label="Avg progress" value={`${analytics.overview.avg_progress}%`} icon={<BarChart3 className="h-5 w-5" />} tone="sky" />
                <StatCard label="Completion rate" value={`${analytics.overview.completion_rate}%`} hint={`${analytics.overview.completions} certificates`} icon={<GraduationCap className="h-5 w-5" />} tone="emerald" />
                <StatCard label="Avg quiz score" value={`${analytics.overview.avg_quiz_score}%`} hint={`${analytics.overview.quiz_attempts} attempts`} icon={<Target className="h-5 w-5" />} tone="amber" />
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <Card className="p-5">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-white">Lecture drop-off</h2>
                  <p className="text-[11px] text-ink-400">Percentage of enrolled learners who have not completed each lecture.</p>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.lectures.map((lecture) => ({ name: lecture.title.length > 18 ? `${lecture.title.slice(0, 18)}…` : lecture.title, dropoff: lecture.dropoff }))} margin={{ top: 4, right: 8, bottom: 40, left: -14 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} unit="%" />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Bar dataKey="dropoff" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="p-5">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-white">Topic mastery</h2>
                  <p className="text-[11px] text-ink-400">Average mastery across all graded answers.</p>
                  <div className="mt-3 space-y-3">
                    {analytics.topic_mastery.length ? (
                      analytics.topic_mastery.map((topic) => (
                        <div key={topic.topic}>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-ink-700 dark:text-ink-200">{topic.topic}</span>
                            <span className={cn('font-bold', topic.score < 50 ? 'text-rose-500' : topic.score < 75 ? 'text-amber-500' : 'text-emerald-500')}>
                              {Math.round(topic.score)}%
                            </span>
                          </div>
                          <ProgressBar value={topic.score} className="mt-1" />
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-ink-400">No graded attempts yet.</p>
                    )}
                  </div>
                </Card>
              </div>

              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h2 className="text-sm font-bold text-ink-900 dark:text-white">Students who may need help</h2>
                  <Pill tone="amber">{analytics.at_risk_students.length}</Pill>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">Flagged for low progress, weak quiz scores or 7+ days of inactivity.</p>
                {analytics.at_risk_students.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-ink-100 text-[10px] uppercase tracking-wide text-ink-400 dark:border-ink-800">
                          <th className="py-2 pr-3 font-semibold">Learner</th>
                          <th className="py-2 pr-3 font-semibold">Progress</th>
                          <th className="py-2 pr-3 font-semibold">Quiz avg</th>
                          <th className="py-2 pr-3 font-semibold">Inactive</th>
                          <th className="py-2 font-semibold">Why flagged</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.at_risk_students.map((student) => (
                          <tr key={student.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                            <td className="py-2 pr-3">
                              <p className="font-semibold text-ink-800 dark:text-ink-100">{student.full_name}</p>
                              <p className="text-[10px] text-ink-400">{student.email}</p>
                            </td>
                            <td className="py-2 pr-3 text-ink-600 dark:text-ink-300">{Math.round(student.progress_percent)}%</td>
                            <td className="py-2 pr-3 text-ink-600 dark:text-ink-300">{student.avg_score !== null ? `${Math.round(student.avg_score)}%` : '—'}</td>
                            <td className="py-2 pr-3 text-ink-600 dark:text-ink-300">{student.days_inactive}d</td>
                            <td className="py-2">
                              <div className="flex flex-wrap gap-1">
                                {student.risk_reasons.map((reason) => (
                                  <Pill key={reason} tone="rose">{reason}</Pill>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-ink-200 p-4 text-center text-[11px] text-ink-400 dark:border-ink-700">
                    Nobody is currently flagged. Keep an eye on this after the next checkpoint.
                  </p>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-bold text-ink-900 dark:text-white">Assessment performance</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {analytics.quizzes.map((quiz) => (
                    <div key={quiz.id} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                      <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{quiz.title}</p>
                      <p className="mt-0.5 text-[10px] text-ink-400">{quiz.attempts} attempts</p>
                      <div className="mt-2 flex items-center gap-3 text-[11px]">
                        <span className="font-bold text-brand-600 dark:text-brand-400">Avg {Math.round(quiz.avg_score)}%</span>
                        <span className="text-ink-400">Best {Math.round(quiz.best_score)}%</span>
                      </div>
                      <ProgressBar value={quiz.avg_score} className="mt-1.5" />
                    </div>
                  ))}
                  {!analytics.quizzes.length && <p className="text-[11px] text-ink-400">No quizzes yet.</p>}
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      )}

      {tab === 'assignments' && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-3">
            {assignments.length ? (
              assignments.map((assignment) => (
                <Card key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-bold text-ink-900 dark:text-white">{assignment.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">Due {formatDate(assignment.due_date)}</p>
                  </div>
                  <Link to={`/assignments/${assignment.id}`}>
                    <Button size="sm" variant="outline" icon={<ClipboardCheck className="h-3.5 w-3.5" />}>Grade submissions</Button>
                  </Link>
                </Card>
              ))
            ) : (
              <EmptyState
                icon={<ClipboardCheck className="h-6 w-6" />}
                title="No assignments"
                message="Publish an assignment with a rubric so learners know exactly how they will be graded."
                action={<Button onClick={() => setAssignmentOpen(true)}>New assignment</Button>}
              />
            )}
          </div>
          <Card className="h-fit p-5">
            <h2 className="text-sm font-bold text-ink-900 dark:text-white">Publish an assignment</h2>
            <div className="mt-3 space-y-2">
              <Field label="Title">
                <TextInput value={assignmentForm.title} onChange={(event) => setAssignmentForm({ ...assignmentForm, title: event.target.value })} placeholder="e.g. Benchmark three algorithms" />
              </Field>
              <Field label="Instructions">
                <TextArea value={assignmentForm.instructions} onChange={(event) => setAssignmentForm({ ...assignmentForm, instructions: event.target.value })} rows={4} placeholder="What should the learner submit?" />
              </Field>
              <Field label="Due date">
                <TextInput type="date" value={assignmentForm.due_date} onChange={(event) => setAssignmentForm({ ...assignmentForm, due_date: event.target.value })} />
              </Field>
              <Field label="Rubric" hint="Criterion and points. Add more in the full builder later.">
                <TextInput
                  value={assignmentForm.rubric[0]?.criterion ?? ''}
                  onChange={(event) => setAssignmentForm({ ...assignmentForm, rubric: [{ criterion: event.target.value, points: assignmentForm.rubric[0]?.points ?? '30' }] })}
                  placeholder="Correctness and edge cases"
                />
              </Field>
              <ErrorBanner error={createAssignment.error} />
              <Button
                size="sm"
                className="w-full"
                loading={createAssignment.isPending}
                disabled={assignmentForm.title.length < 4 || assignmentForm.instructions.length < 10 || !assignmentForm.due_date}
                onClick={() => createAssignment.mutate()}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                Publish assignment
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'announcements' && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-3">
            {announcements.length ? (
              announcements.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-3.5 w-3.5 text-brand-500" />
                    <p className="text-[11px] font-bold text-ink-800 dark:text-ink-100">{item.author}</p>
                    <span className="text-[10px] text-ink-400">{timeAgo(item.created_at)}</span>
                  </div>
                  <RichText content={item.content} className="mt-1.5 text-xs" />
                </Card>
              ))
            ) : (
              <EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements" message="Announcements notify every enrolled learner." />
            )}
          </div>
          <Card className="h-fit p-5">
            <h2 className="text-sm font-bold text-ink-900 dark:text-white">New announcement</h2>
            <TextArea
              className="mt-2"
              value={announcement}
              onChange={(event) => setAnnouncement(event.target.value)}
              rows={5}
              placeholder="Share a deadline, a live session or an insight from the analytics…"
            />
            <Button
              className="mt-2 w-full"
              size="sm"
              loading={postAnnouncement.isPending}
              disabled={announcement.trim().length < 5}
              onClick={() => postAnnouncement.mutate()}
              icon={<Send className="h-3.5 w-3.5" />}
            >
              Post to all learners
            </Button>
            <ErrorBanner error={postAnnouncement.error} />
          </Card>
        </div>
      )}

      {/* Add lecture modal */}
      <Modal
        open={Boolean(lectureFor)}
        onClose={() => setLectureFor(null)}
        title={`Add lecture · ${lectureFor?.moduleTitle ?? ''}`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setLectureFor(null)}>Cancel</Button>
            <Button
              loading={addLecture.isPending}
              disabled={lectureForm.title.length < 3 || lectureForm.transcript.length < 120}
              onClick={() => addLecture.mutate()}
            >
              Add & index transcript
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Lecture title">
            <TextInput value={lectureForm.title} onChange={(event) => setLectureForm({ ...lectureForm, title: event.target.value })} placeholder="e.g. Dijkstra's algorithm" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Duration (minutes)">
              <TextInput type="number" min={1} value={lectureForm.minutes} onChange={(event) => setLectureForm({ ...lectureForm, minutes: event.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Video URL" hint="Optional HLS/embed URL.">
                <TextInput value={lectureForm.video_url} onChange={(event) => setLectureForm({ ...lectureForm, video_url: event.target.value })} placeholder="https://…" />
              </Field>
            </div>
          </div>
          <Field label="Transcript" hint="Required for the AI tutor and quiz drafts. At least 120 characters.">
            <TextArea value={lectureForm.transcript} onChange={(event) => setLectureForm({ ...lectureForm, transcript: event.target.value })} rows={8} placeholder="Paste the lecture transcript here…" />
          </Field>
          <Field label="Resource labels" hint="Comma separated, e.g. Slides (PDF), Worked examples (ZIP).">
            <TextInput value={lectureForm.resources} onChange={(event) => setLectureForm({ ...lectureForm, resources: event.target.value })} />
          </Field>
          <ErrorBanner error={addLecture.error} />
        </div>
      </Modal>

      {/* AI quiz draft modal */}
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title="Review AI quiz draft"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            <Button
              loading={publishQuiz.isPending}
              disabled={!draft?.selected.length || !draft?.title.trim()}
              onClick={() => publishQuiz.mutate()}
            >
              Publish {draft?.selected.length ?? 0} question{draft?.selected.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        {draft && (
          <div>
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3 text-[11px] text-ink-600 dark:border-brand-500/20 dark:bg-brand-500/5 dark:text-ink-300">
              Generated from <strong>{draft.lecture.title}</strong>. Uncheck anything that is ambiguous or not grounded in
              the lecture before publishing. {draft.questions.length} drafts, {draft.selected.length} selected.
            </div>
            <div className="mt-3">
              <Field label="Quiz title">
                <TextInput value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </Field>
            </div>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {draft.questions.map((question, index) => {
                const checked = draft.selected.includes(index);
                return (
                  <label
                    key={index}
                    className={cn(
                      'block cursor-pointer rounded-xl border p-3 transition-colors',
                      checked ? 'border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/5' : 'border-ink-200 opacity-70 dark:border-ink-700',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            selected: checked ? draft.selected.filter((item) => item !== index) : [...draft.selected, index],
                          })
                        }
                        className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink-900 dark:text-white">{index + 1}. {question.question_text}</p>
                        <div className="mt-1.5 grid gap-1">
                          {question.options.map((option, optionIndex) => (
                            <span
                              key={optionIndex}
                              className={cn(
                                'rounded px-2 py-1 text-[10px]',
                                option.is_correct
                                  ? 'bg-emerald-100 font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
                                  : 'bg-ink-50 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
                              )}
                            >
                              {option.option_text}{option.is_correct ? ' ✓' : ''}
                            </span>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[10px] text-ink-400">Topic: {question.topic} · {question.explanation}</p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <ErrorBanner error={publishQuiz.error ?? draftQuiz.error} />
          </div>
        )}
      </Modal>

      {/* Summary modal */}
      <Modal open={Boolean(summary)} onClose={() => setSummary(null)} title={`Summary · ${summary?.title ?? ''}`} wide>
        {summary && <RichText content={summary.text} />}
        <p className="mt-3 rounded-xl bg-ink-50 p-3 text-[10px] text-ink-400 dark:bg-ink-800">
          Saved to the lecture so learners can revisit it. Generated only from this lecture's transcript.
        </p>
      </Modal>

      {/* Assignment modal (kept for empty-state action) */}
      <Modal open={assignmentOpen} onClose={() => setAssignmentOpen(false)} title="New assignment">
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Use the sidebar form on the Assignments tab to publish an assignment with a rubric and deadline.
        </p>
      </Modal>
    </div>
  );
}
