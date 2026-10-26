import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Flag,
  Lock,
  MessageSquare,
  PlayCircle,
  Send,
  Sparkles,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Course, Module } from '../lib/types';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Pill,
  ProgressBar,
  RichText,
  Spinner,
  Tabs,
  TextArea,
  TextInput,
  cn,
} from '../lib/ui';
import { formatClock, formatDate, timeAgo } from '../lib/format';

type DetailResponse = {
  course: Course;
  can_edit: boolean;
  enrollment: { id: string; progress_percent: number } | null;
  modules: Module[];
  assignments: { id: string; title: string; instructions: string; due_date: string }[];
  announcements: { id: string; content: string; created_at: string; author: string }[];
};

type Thread = {
  id: string;
  title: string;
  created_at: string;
  author: string;
  replies: number;
  last_reply: string | null;
};

type ThreadPost = {
  id: string;
  content: string;
  created_at: string;
  author: string;
  avatar_url: string | null;
  staff_role: string | null;
  is_flagged: number;
};

type LeaderboardRow = {
  rank: number;
  id: string;
  full_name: string;
  avatar_url: string | null;
  progress: number;
  avg_score: number;
  attempts: number;
};

export default function CourseDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('curriculum');
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  const [threadId, setThreadId] = useState<string | null>(null);
  const [newThread, setNewThread] = useState({ title: '', content: '' });
  const [reply, setReply] = useState('');
  const [flagError, setFlagError] = useState<unknown>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.get<DetailResponse>(`/courses/${id}`),
    enabled: Boolean(id),
  });

  const enroll = useMutation({
    mutationFn: () => api.post(`/courses/${id}/enroll`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course', id] });
      queryClient.invalidateQueries({ queryKey: ['enrollments-me'] });
      navigate(`/courses/${id}/learn`);
    },
  });

  const threadsQuery = useQuery({
    queryKey: ['threads', id],
    queryFn: () => api.get<{ threads: Thread[] }>(`/courses/${id}/threads`),
    enabled: tab === 'discussion' && Boolean(data?.enrollment),
  });

  const threadQuery = useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => api.get<{ thread: { id: string; title: string; created_at: string }; posts: ThreadPost[] }>(`/threads/${threadId}`),
    enabled: Boolean(threadId),
  });

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', id],
    queryFn: () => api.get<{ leaderboard: LeaderboardRow[] }>(`/courses/${id}/leaderboard`),
    enabled: tab === 'leaderboard',
  });

  const createThread = useMutation({
    mutationFn: () => api.post(`/courses/${id}/threads`, newThread),
    onSuccess: (created) => {
      setNewThread({ title: '', content: '' });
      queryClient.invalidateQueries({ queryKey: ['threads', id] });
      setThreadId((created as { thread: { id: string } }).thread.id);
    },
  });

  const postReply = useMutation({
    mutationFn: () => api.post(`/threads/${threadId}/posts`, { content: reply }),
    onSuccess: () => {
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
      queryClient.invalidateQueries({ queryKey: ['threads', id] });
    },
  });

  const flagPost = useMutation({
    mutationFn: (postId: string) => api.post(`/posts/${postId}/flag`, { reason: 'Reported from course discussion' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['thread', threadId] }),
    onError: (caught) => setFlagError(caught),
  });

  if (isLoading) return <Spinner label="Loading course" />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const { course } = data;
  const isStudent = user?.role === 'student';
  const isStaff = user?.role === 'admin' || data.can_edit;
  const enrolled = Boolean(data.enrollment);
  const totalLectures = data.modules.reduce((sum, module) => sum + module.lectures.length, 0);

  const openLecture = (lectureId: string) => {
    navigate(`/courses/${course.id}/learn?lecture=${lectureId}`);
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      <div className="overflow-hidden rounded-3xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="relative h-48 bg-gradient-to-br from-brand-600 to-violet-700 sm:h-56">
          {course.thumbnail_url && <img src={course.thumbnail_url} alt="" className="h-full w-full object-cover opacity-70" />}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-ink-950/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="brand" className="border-white/20 bg-white/15 text-white backdrop-blur">{course.category}</Pill>
              <Pill tone="neutral" className="border-white/20 bg-white/15 capitalize text-white backdrop-blur">{course.difficulty}</Pill>
              {course.status !== 'approved' && <Pill tone="amber" className="capitalize">{course.status}</Pill>}
            </div>
            <h1 className="mt-2 max-w-3xl text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{course.title}</h1>
            <p className="mt-1 text-sm text-white/80">
              {course.instructor_name} · {totalLectures} lectures · {course.duration_minutes} min · {course.learners} learners
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex flex-wrap items-center gap-4 text-xs text-ink-500 dark:text-ink-400">
            <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> {data.modules.length} modules</span>
            <span className="inline-flex items-center gap-1.5"><PlayCircle className="h-4 w-4" /> {totalLectures} lectures</span>
            <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4" /> {data.assignments.length} assignments</span>
            <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" /> {course.learners} enrolled</span>
          </div>
          <div className="flex items-center gap-3">
            {isStaff ? (
              <Link to={`/instructor/courses/${course.id}`}>
                <Button variant="secondary">Manage course</Button>
              </Link>
            ) : enrolled ? (
              <Link to={`/courses/${course.id}/learn`}>
                <Button icon={<PlayCircle className="h-4 w-4" />}>Continue learning</Button>
              </Link>
            ) : isStudent ? (
              <Button loading={enroll.isPending} onClick={() => enroll.mutate()} icon={<ArrowRight className="h-4 w-4" />}>
                {course.price > 0 ? `Enroll · $${course.price}` : 'Enroll for free'}
              </Button>
            ) : null}
          </div>
        </div>
        {enroll.error && <div className="px-5 pb-5 sm:px-6"><ErrorBanner error={enroll.error} /></div>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          <Tabs
            tabs={[
              { id: 'curriculum', label: 'Curriculum' },
              { id: 'overview', label: 'Overview' },
              { id: 'discussion', label: 'Discussion' },
              { id: 'leaderboard', label: 'Leaderboard' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'curriculum' && (
            <div className="space-y-3">
              {data.modules.map((module, moduleIndex) => {
                const expanded = openModules[module.id] ?? moduleIndex === 0;
                return (
                  <Card key={module.id} className="overflow-hidden">
                    <button
                      onClick={() => setOpenModules((state) => ({ ...state, [module.id]: !expanded }))}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-ink-50/60 dark:hover:bg-ink-800/40"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                          {moduleIndex + 1}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-ink-900 dark:text-white">{module.title}</p>
                          <p className="text-[11px] text-ink-500 dark:text-ink-400">
                            {module.lectures.length} lectures · {module.quizzes.length} quiz{module.quizzes.length === 1 ? '' : 'zes'}
                          </p>
                        </div>
                      </div>
                      <ChevronDown className={cn('h-4 w-4 text-ink-400 transition-transform', expanded && 'rotate-180')} />
                    </button>

                    {expanded && (
                      <div className="border-t border-ink-100 dark:border-ink-800">
                        {module.lectures.map((lecture) => (
                          <button
                            key={lecture.id}
                            onClick={() => (enrolled || isStaff ? openLecture(lecture.id) : undefined)}
                            disabled={!enrolled && !isStaff}
                            className={cn(
                              'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                              enrolled || isStaff ? 'hover:bg-ink-50 dark:hover:bg-ink-800/50' : 'cursor-not-allowed opacity-70',
                            )}
                          >
                            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', lecture.completed ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400')}>
                              {lecture.completed ? <CheckCircle2 className="h-4 w-4" /> : enrolled || isStaff ? <PlayCircle className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold text-ink-800 dark:text-ink-100">{lecture.title}</span>
                              <span className="block text-[10px] text-ink-400">
                                Lecture · {Math.round(lecture.duration_seconds / 60)} min
                                {lecture.completed ? ' · completed' : ''}
                              </span>
                            </span>
                            <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                          </button>
                        ))}

                        {module.quizzes.map((quiz) => (
                          <div key={quiz.id} className="flex items-center gap-3 border-t border-ink-100 px-4 py-3 dark:border-ink-800">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                              <Target className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-ink-800 dark:text-ink-100">
                                {quiz.title} {quiz.is_ai_generated && <Pill tone="violet" className="ml-1">AI draft</Pill>}
                              </p>
                              <p className="text-[10px] text-ink-400">
                                {quiz.question_count} questions · auto-graded
                                {quiz.best_score !== null ? ` · best ${Math.round(quiz.best_score)}%` : ''}
                              </p>
                            </div>
                            {enrolled || isStaff ? (
                              <Link
                                to={`/quizzes/${quiz.id}`}
                                className="rounded-lg border border-ink-200 px-2.5 py-1 text-[11px] font-bold text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                              >
                                {quiz.best_score !== null ? 'Retake' : 'Take quiz'}
                              </Link>
                            ) : (
                              <Lock className="h-3.5 w-3.5 text-ink-300" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {tab === 'overview' && (
            <Card className="p-6">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">About this course</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{course.description}</p>

              {course.outcomes.length > 0 && (
                <>
                  <h3 className="mt-6 text-sm font-bold text-ink-900 dark:text-white">What you will be able to do</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {course.outcomes.map((outcome) => (
                      <div key={outcome} className="flex items-start gap-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <p className="text-xs text-ink-600 dark:text-ink-300">{outcome}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h3 className="mt-6 text-sm font-bold text-ink-900 dark:text-white">How the AI fits in</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                Every lecture transcript is chunked and embedded for this course only. When you ask the tutor a
                question, it retrieves the closest passages, answers at your chosen depth, and cites the lecture and
                timestamp. If the material does not cover it, the tutor says so instead of guessing.
              </p>

              {data.assignments.length > 0 && (
                <>
                  <h3 className="mt-6 text-sm font-bold text-ink-900 dark:text-white">Assignments</h3>
                  <div className="mt-2 space-y-2">
                    {data.assignments.map((assignment) => (
                      <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                        <div>
                          <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{assignment.title}</p>
                          <p className="text-[11px] text-ink-400">Due {formatDate(assignment.due_date)}</p>
                        </div>
                        {isStudent && enrolled && (
                          <Link to={`/assignments/${assignment.id}`} className="text-[11px] font-bold text-brand-600 hover:underline dark:text-brand-400">
                            Open assignment →
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {tab === 'discussion' && (
            <Card className="p-5">
              {!data.enrollment && !isStaff ? (
                <EmptyState
                  icon={<MessageSquare className="h-6 w-6" />}
                  title="Enroll to join the discussion"
                  message="Course discussions are open to enrolled learners and the instructor."
                  action={isStudent ? <Button size="sm" loading={enroll.isPending} onClick={() => enroll.mutate()}>Enroll now</Button> : undefined}
                />
              ) : threadId ? (
                <div>
                  <button onClick={() => setThreadId(null)} className="mb-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    ← All threads
                  </button>
                  {threadQuery.isLoading ? (
                    <Spinner label="Loading thread" />
                  ) : threadQuery.data ? (
                    <div>
                      <h2 className="text-base font-bold text-ink-900 dark:text-white">{threadQuery.data.thread.title}</h2>
                      <p className="text-[11px] text-ink-400">Started {timeAgo(threadQuery.data.thread.created_at)}</p>
                      <div className="mt-4 space-y-3">
                        {threadQuery.data.posts.map((post) => (
                          <div key={post.id} className="rounded-xl border border-ink-100 p-3.5 dark:border-ink-800">
                            <div className="flex items-center gap-2">
                              <Avatar name={post.author} src={post.avatar_url} size={28} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-ink-900 dark:text-white">
                                  {post.author}
                                  {post.staff_role && <Pill tone="brand" className="ml-1.5">{post.staff_role}</Pill>}
                                </p>
                                <p className="text-[10px] text-ink-400">{timeAgo(post.created_at)}</p>
                              </div>
                              {post.author !== user?.full_name && (
                                <button
                                  onClick={() => flagPost.mutate(post.id)}
                                  className="rounded p-1 text-ink-300 hover:text-rose-500"
                                  aria-label="Report post"
                                  title="Report post"
                                >
                                  <Flag className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-600 dark:text-ink-300">{post.content}</p>
                          </div>
                        ))}
                      </div>
                      <ErrorBanner error={flagError} />
                      <div className="mt-4">
                        <TextArea
                          value={reply}
                          onChange={(event) => setReply(event.target.value)}
                          placeholder="Write a reply…"
                          rows={3}
                        />
                        <div className="mt-2 flex justify-end">
                          <Button size="sm" loading={postReply.isPending} disabled={!reply.trim()} onClick={() => postReply.mutate()} icon={<Send className="h-3.5 w-3.5" />}>
                            Reply
                          </Button>
                        </div>
                        <ErrorBanner error={postReply.error} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-ink-900 dark:text-white">Course discussion</h2>
                    <span className="text-[11px] text-ink-400">{threadsQuery.data?.threads.length ?? 0} threads</span>
                  </div>

                  <div className="mt-4 space-y-2">
                    {threadsQuery.isLoading ? (
                      <Spinner label="Loading threads" />
                    ) : threadsQuery.data?.threads.length ? (
                      threadsQuery.data.threads.map((thread) => (
                        <button
                          key={thread.id}
                          onClick={() => setThreadId(thread.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-100 p-3 text-left hover:border-brand-200 hover:bg-brand-50/40 dark:border-ink-800 dark:hover:border-brand-500/30 dark:hover:bg-brand-500/5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-ink-900 dark:text-white">{thread.title}</p>
                            <p className="text-[10px] text-ink-400">
                              {thread.author} · {timeAgo(thread.created_at)} · {thread.replies} replies
                            </p>
                          </div>
                          <MessageSquare className="h-4 w-4 shrink-0 text-ink-300" />
                        </button>
                      ))
                    ) : (
                      <p className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
                        No threads yet. Ask the first question.
                      </p>
                    )}
                  </div>

                  <div className="mt-5 rounded-xl border border-ink-100 p-4 dark:border-ink-800">
                    <p className="text-xs font-bold text-ink-900 dark:text-white">Start a thread</p>
                    <div className="mt-2 space-y-2">
                      <TextInput
                        value={newThread.title}
                        onChange={(event) => setNewThread((state) => ({ ...state, title: event.target.value }))}
                        placeholder="What is your question about?"
                      />
                      <TextArea
                        value={newThread.content}
                        onChange={(event) => setNewThread((state) => ({ ...state, content: event.target.value }))}
                        placeholder="Add the detail that helps others answer…"
                        rows={3}
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          loading={createThread.isPending}
                          disabled={newThread.title.trim().length < 5 || newThread.content.trim().length < 5}
                          onClick={() => createThread.mutate()}
                        >
                          Post thread
                        </Button>
                      </div>
                      <ErrorBanner error={createThread.error} />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {tab === 'leaderboard' && (
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h2 className="text-base font-bold text-ink-900 dark:text-white">Course leaderboard</h2>
              </div>
              {leaderboardQuery.isLoading ? (
                <Spinner label="Loading leaderboard" />
              ) : leaderboardQuery.data?.leaderboard.length ? (
                <div className="space-y-2">
                  {leaderboardQuery.data.leaderboard.map((row) => (
                    <div key={row.id} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                      <span className={cn('grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold', row.rank === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400')}>
                        {row.rank}
                      </span>
                      <Avatar name={row.full_name} src={row.avatar_url} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-ink-900 dark:text-white">{row.full_name}</p>
                        <p className="text-[10px] text-ink-400">{Math.round(row.progress)}% progress · {row.attempts} attempts</p>
                      </div>
                      <span className="text-xs font-bold text-brand-600 dark:text-brand-400">{row.avg_score}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Trophy className="h-6 w-6" />} title="No quiz attempts yet" message="Scores appear here as learners complete quizzes." />
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {enrolled && data.enrollment && (
            <Card className="p-5">
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Your progress</h2>
              <p className="mt-3 text-3xl font-extrabold text-brand-600 dark:text-brand-400">{Math.round(data.enrollment.progress_percent)}%</p>
              <ProgressBar value={data.enrollment.progress_percent} className="mt-2" />
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                {data.modules.reduce((sum, module) => sum + module.lectures.filter((lecture) => lecture.completed).length, 0)} of {totalLectures} lectures complete
              </p>
              <Link to={`/courses/${course.id}/learn`}>
                <Button className="mt-4 w-full" size="sm">Open course player</Button>
              </Link>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-sm font-bold text-ink-900 dark:text-white">Instructor</h2>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={course.instructor_name} src={course.instructor_avatar} size={40} />
              <div>
                <p className="text-xs font-bold text-ink-900 dark:text-white">{course.instructor_name}</p>
                <p className="text-[11px] text-ink-400">Course author</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              Curriculum, quizzes and assignments are authored and reviewed by the instructor. The AI only generates
              drafts that the instructor must approve.
            </p>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-ink-400" />
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Announcements</h2>
            </div>
            {data.announcements.length ? (
              <div className="space-y-3">
                {data.announcements.map((announcement) => (
                  <div key={announcement.id} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                    <p className="text-[11px] font-bold text-ink-800 dark:text-ink-100">{announcement.author}</p>
                    <RichText content={announcement.content} className="mt-1 text-xs" />
                    <p className="mt-1 text-[10px] text-ink-400">{timeAgo(announcement.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-500 dark:text-ink-400">No announcements yet.</p>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Certificate</h2>
            </div>
            <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
              Complete every lecture to reach 100% and VertexLearn issues a downloadable PDF certificate with a
              verifiable certificate ID.
            </p>
          </Card>
        </div>
      </div>

      <div className="text-center text-[11px] text-ink-400">
        Course ID {course.id} · created {formatDate(course.created_at ?? undefined)} · {formatClock(course.duration_minutes * 60)} of content
      </div>
    </div>
  );
}
