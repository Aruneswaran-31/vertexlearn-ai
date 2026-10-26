import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  DollarSign,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  Avatar,
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
  Tabs,
  TextArea,
  TextInput,
  cn,
} from '../lib/ui';
import { formatDate, timeAgo } from '../lib/format';

type Overview = {
  users: { total: number; students: number; instructors: number; new_7d: number; dau: number };
  courses: { total: number; approved: number; pending: number };
  enrollments: { total: number; avg_progress: number; completed: number; completion_rate: number };
  ai: { tutor_messages: number };
  quizzes: { attempts: number; avg_score: number };
  revenue: { total: number; currency: string };
  enrollments_by_day: { day: string; count: number }[];
  top_courses: { title: string; category: string; learners: number; avg_progress: number }[];
  audit_logs: { id: string; action: string; entity: string; created_at: string; actor: string | null }[];
};

type AdminUser = {
  id: string;
  full_name: string;
  email: string;
  is_active: number;
  created_at: string;
  role: string;
  enrollments: number;
  courses: number;
};

type PendingCourse = {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  status: string;
  price: number;
  created_at: string;
  instructor_name: string;
  instructor_email: string;
  modules: number;
  lectures: number;
};

type FlaggedPost = {
  id: string;
  content: string;
  created_at: string;
  thread_title: string;
  course_title: string;
  author: string;
  author_email: string;
};

export default function AdminPanel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ course: PendingCourse; verdict: 'approved' | 'rejected' } | null>(null);
  const [comment, setComment] = useState('');

  const overviewQuery = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get<Overview>('/admin/analytics/overview') });

  const usersParams = new URLSearchParams({ page: String(page), limit: '20' });
  if (search) usersParams.set('q', search);
  if (roleFilter) usersParams.set('role', roleFilter);
  const usersQuery = useQuery({
    queryKey: ['admin-users', usersParams.toString()],
    queryFn: () =>
      api.get<{ users: AdminUser[]; pagination: { page: number; pages: number; total: number } }>(`/admin/users?${usersParams.toString()}`),
    enabled: tab === 'users',
  });

  const pendingQuery = useQuery({
    queryKey: ['admin-pending'],
    queryFn: () => api.get<{ courses: PendingCourse[]; recent_decisions: { id: string; title: string; decision: string; reviewed_at: string; reviewer: string | null; comment: string | null }[] }>('/admin/courses/pending'),
    enabled: tab === 'approvals',
  });

  const flaggedQuery = useQuery({
    queryKey: ['admin-flagged'],
    queryFn: () => api.get<{ posts: FlaggedPost[] }>('/admin/moderation/flagged-posts'),
    enabled: tab === 'moderation',
  });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.put(`/admin/users/${id}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const suspend = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.put(`/admin/users/${id}/suspend`, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const approve = useMutation({
    mutationFn: () =>
      api.post(`/courses/${decision!.course.id}/approve`, { decision: decision!.verdict, comment: comment || undefined }),
    onSuccess: () => {
      setDecision(null);
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['admin-pending'] });
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
  });

  const moderate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'dismiss' | 'remove' }) => api.put(`/admin/moderation/posts/${id}`, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-flagged'] }),
  });

  const overview = overviewQuery.data;

  return (
    <div>
      <PageHeader
        title="Platform admin"
        subtitle="Approvals, account governance, moderation and the platform-wide metrics that show whether learning is actually happening."
        actions={<Pill tone="violet"><ShieldCheck className="h-3 w-3" /> Admin access</Pill>}
      />

      <Tabs
        className="mb-5"
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'users', label: 'Users' },
          { id: 'approvals', label: 'Approvals', count: overview?.courses.pending },
          { id: 'moderation', label: 'Moderation' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="space-y-5">
          {overviewQuery.isLoading ? (
            <Spinner label="Loading platform metrics" />
          ) : overviewQuery.error ? (
            <ErrorBanner error={overviewQuery.error} />
          ) : overview ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Total users" value={overview.users.total} hint={`${overview.users.new_7d} new this week`} icon={<Users className="h-5 w-5" />} />
                <StatCard label="Daily active" value={overview.users.dau} hint="Activity in the last 24h" icon={<Activity className="h-5 w-5" />} tone="emerald" />
                <StatCard label="Courses" value={overview.courses.total} hint={`${overview.courses.approved} approved · ${overview.courses.pending} pending`} icon={<BookOpen className="h-5 w-5" />} tone="sky" />
                <StatCard label="Revenue" value={`$${overview.revenue.total}`} hint="Successful payments" icon={<DollarSign className="h-5 w-5" />} tone="amber" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Enrollments" value={overview.enrollments.total} hint={`${overview.users.students} students · ${overview.users.instructors} instructors`} icon={<BadgeCheck className="h-5 w-5" />} />
                <StatCard label="Completion rate" value={`${overview.enrollments.completion_rate}%`} hint={`${overview.enrollments.completed} course completions`} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
                <StatCard label="Quiz attempts" value={overview.quizzes.attempts} hint={`Average ${overview.quizzes.avg_score}%`} icon={<BookOpen className="h-5 w-5" />} tone="sky" />
                <StatCard label="Tutor questions" value={overview.ai.tutor_messages} hint="Grounded AI replies" icon={<ShieldCheck className="h-5 w-5" />} tone="brand" />
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <Card className="p-5">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-white">Enrollments · last 14 days</h2>
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.enrollments_by_day} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="enrollGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(value: string) => value.slice(5)} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#enrollGradient)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="p-5">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-white">Most popular courses</h2>
                  <div className="mt-3 space-y-3">
                    {overview.top_courses.map((course) => (
                      <div key={course.title}>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate font-semibold text-ink-700 dark:text-ink-200">{course.title}</span>
                          <span className="shrink-0 text-ink-400">{course.learners} learners</span>
                        </div>
                        <ProgressBar value={course.avg_progress} className="mt-1" />
                      </div>
                    ))}
                    {!overview.top_courses.length && <p className="text-[11px] text-ink-400">No published courses yet.</p>}
                  </div>
                </Card>
              </div>

              <Card className="p-5">
                <h2 className="text-sm font-bold text-ink-900 dark:text-white">Audit trail</h2>
                <div className="mt-3 space-y-2">
                  {overview.audit_logs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2 text-[11px] dark:border-ink-800">
                      <span className="font-semibold text-ink-700 dark:text-ink-200">{log.action}</span>
                      <span className="text-ink-400">{log.entity} · {log.actor ?? 'system'} · {timeAgo(log.created_at)}</span>
                    </div>
                  ))}
                  {!overview.audit_logs.length && <p className="text-[11px] text-ink-400">No admin actions recorded yet.</p>}
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {tab === 'users' && (
        <div>
          <Card className="mb-4 p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <TextInput
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by name or email"
                  className="pl-9"
                />
              </div>
              <Select
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All roles' },
                  { value: 'student', label: 'Students' },
                  { value: 'instructor', label: 'Instructors' },
                  { value: 'admin', label: 'Admins' },
                ]}
              />
            </div>
          </Card>

          {usersQuery.isLoading ? (
            <Spinner label="Loading users" />
          ) : usersQuery.error ? (
            <ErrorBanner error={usersQuery.error} />
          ) : usersQuery.data?.users.length ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-100 text-[10px] uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3 font-semibold">Enrollments</th>
                    <th className="px-4 py-3 font-semibold">Courses</th>
                    <th className="px-4 py-3 font-semibold">Joined</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.data.users.map((account) => (
                    <tr key={account.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={account.full_name} size={30} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink-800 dark:text-ink-100">{account.full_name}</p>
                            <p className="truncate text-[10px] text-ink-400">{account.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={account.role}
                          onChange={(event) => setRole.mutate({ id: account.id, role: event.target.value })}
                          className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-[11px] font-semibold capitalize dark:border-ink-700 dark:bg-ink-900"
                          aria-label={`Role for ${account.full_name}`}
                        >
                          <option value="student">student</option>
                          <option value="instructor">instructor</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{account.enrollments}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{account.courses}</td>
                      <td className="px-4 py-3 text-ink-400">{formatDate(account.created_at)}</td>
                      <td className="px-4 py-3">
                        <Pill tone={account.is_active ? 'emerald' : 'rose'} className="capitalize">{account.is_active ? 'Active' : 'Suspended'}</Pill>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant={account.is_active ? 'ghost' : 'outline'}
                          loading={suspend.isPending}
                          onClick={() => suspend.mutate({ id: account.id, active: !account.is_active })}
                        >
                          {account.is_active ? 'Suspend' : 'Restore'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No users match" message="Try a different search term." />
          )}

          <ErrorBanner error={setRole.error ?? suspend.error} />

          {usersQuery.data && usersQuery.data.pagination.pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <span className="text-xs text-ink-500 dark:text-ink-400">Page {page} of {usersQuery.data.pagination.pages}</span>
              <Button variant="outline" size="sm" disabled={page === usersQuery.data.pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      {tab === 'approvals' && (
        <div>
          {pendingQuery.isLoading ? (
            <Spinner label="Loading approval queue" />
          ) : pendingQuery.error ? (
            <ErrorBanner error={pendingQuery.error} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
              <div className="space-y-3">
                {pendingQuery.data?.courses.length ? (
                  pendingQuery.data.courses.map((course) => (
                    <Card key={course.id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-ink-900 dark:text-white">{course.title}</h3>
                          <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">
                            {course.instructor_name} · {course.instructor_email}
                          </p>
                          <p className="mt-1 text-[10px] text-ink-400">
                            {course.category} · {course.difficulty} · {course.modules} modules · {course.lectures} lectures · submitted {timeAgo(course.created_at)}
                          </p>
                        </div>
                        <Pill tone="amber">Pending</Pill>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-ink-500 dark:text-ink-400">{course.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/courses/${course.id}`}>
                          <Button size="sm" variant="outline">Inspect course</Button>
                        </Link>
                        <Button
                          size="sm"
                          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setDecision({ course, verdict: 'approved' });
                            setComment('');
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<XCircle className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setDecision({ course, verdict: 'rejected' });
                            setComment('');
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    </Card>
                  ))
                ) : (
                  <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Approval queue is empty" message="New instructor submissions will appear here before they become public." />
                )}
              </div>

              <Card className="h-fit p-5">
                <h2 className="text-sm font-bold text-ink-900 dark:text-white">Recent decisions</h2>
                <div className="mt-3 space-y-2">
                  {pendingQuery.data?.recent_decisions.length ? (
                    pendingQuery.data.recent_decisions.map((item) => (
                      <div key={item.id} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-100">{item.title}</p>
                          <Pill tone={item.decision === 'approved' ? 'emerald' : 'rose'}>{item.decision}</Pill>
                        </div>
                        <p className="mt-0.5 text-[10px] text-ink-400">{item.reviewer ?? 'admin'} · {timeAgo(item.reviewed_at)}</p>
                        {item.comment && <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-400">{item.comment}</p>}
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-ink-400">No decisions recorded.</p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {tab === 'moderation' && (
        <div>
          {flaggedQuery.isLoading ? (
            <Spinner label="Loading reported posts" />
          ) : flaggedQuery.error ? (
            <ErrorBanner error={flaggedQuery.error} />
          ) : flaggedQuery.data?.posts.length ? (
            <div className="space-y-3">
              {flaggedQuery.data.posts.map((post) => (
                <Card key={post.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold text-ink-800 dark:text-ink-100">{post.author} <span className="font-normal text-ink-400">· {post.author_email}</span></p>
                      <p className="text-[10px] text-ink-400">{post.course_title} · thread “{post.thread_title}” · {timeAgo(post.created_at)}</p>
                    </div>
                    <Pill tone="rose"><AlertTriangle className="h-3 w-3" /> Reported</Pill>
                  </div>
                  <p className="mt-2 rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-ink-700 dark:bg-rose-500/10 dark:text-ink-200">{post.content}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => moderate.mutate({ id: post.id, action: 'dismiss' })}>
                      Dismiss report
                    </Button>
                    <Button size="sm" variant="danger" loading={moderate.isPending} onClick={() => moderate.mutate({ id: post.id, action: 'remove' })} icon={<Trash2 className="h-3.5 w-3.5" />}>
                      Remove post
                    </Button>
                  </div>
                </Card>
              ))}
              <ErrorBanner error={moderate.error} />
            </div>
          ) : (
            <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No reported posts" message="Community reports land here for review." />
          )}
        </div>
      )}

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision?.verdict === 'approved' ? `Approve “${decision?.course.title}”?` : `Reject “${decision?.course.title}”?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              variant={decision?.verdict === 'approved' ? 'primary' : 'danger'}
              loading={approve.isPending}
              onClick={() => approve.mutate()}
            >
              {decision?.verdict === 'approved' ? 'Approve & publish' : 'Reject with feedback'}
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          {decision?.verdict === 'approved'
            ? 'The course becomes visible in the public catalog and the instructor is notified. You can archive it later if needed.'
            : 'The instructor is notified with your comment and can resubmit after changes.'}
        </p>
        <div className="mt-3">
          <Field label={decision?.verdict === 'approved' ? 'Note to instructor (optional)' : 'What needs to change?'}>
            <TextArea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder={decision?.verdict === 'approved' ? 'Optional note' : 'Explain what to fix before resubmission'} />
          </Field>
        </div>
        <ErrorBanner error={approve.error} />
      </Modal>
    </div>
  );
}
