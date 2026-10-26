import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  FileCheck2,
  GraduationCap,
  Quote,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Course } from '../lib/types';
import { Avatar, Pill, cn } from '../lib/ui';
import { useAuth } from '../lib/auth';
import { homeFor } from '../App';

const features = [
  {
    icon: BrainCircuit,
    title: 'A tutor that knows the course',
    body: 'Retrieval-augmented answers come only from the course material, with the exact lecture and timestamp cited. No generic internet answers.',
  },
  {
    icon: FileCheck2,
    title: 'Grading that gives feedback',
    body: 'Multiple choice, multi-select and short answers are auto-graded instantly. Instructors review exception cases, not every submission.',
  },
  {
    icon: BarChart3,
    title: 'Weak topics, not just scores',
    body: 'Per-topic mastery feeds difficulty adjustment, study plans and the next quiz the learner sees.',
  },
  {
    icon: Users,
    title: 'Early alerts for instructors',
    body: 'Learners who stall or fall below the mastery threshold appear in the analytics feed before they disappear entirely.',
  },
  {
    icon: GraduationCap,
    title: 'A complete course loop',
    body: 'Enroll, learn, take notes, submit assignments, pass quizzes and download a real PDF certificate at 100% completion.',
  },
  {
    icon: ShieldCheck,
    title: 'Governance built in',
    body: 'Admins approve courses, manage roles, review platform metrics and moderate reported discussion posts.',
  },
];

export default function Landing() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['landing-courses'],
    queryFn: () => api.get<{ courses: Course[] }>('/courses?limit=3&sort=popular'),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-white dark:bg-ink-950">
      <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/85 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25">
              <Sparkles className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <span className="text-sm font-extrabold tracking-tight text-ink-900 dark:text-white">VertexLearn AI</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-500 dark:text-ink-400 md:flex">
            <a href="#features" className="hover:text-ink-900 dark:hover:text-white">Platform</a>
            <a href="#courses" className="hover:text-ink-900 dark:hover:text-white">Courses</a>
            <a href="#how" className="hover:text-ink-900 dark:hover:text-white">How it works</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                to={homeFor(user.role)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Open workspace <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden h-9 items-center rounded-xl px-3 text-sm font-semibold text-ink-600 hover:bg-ink-100 sm:inline-flex dark:text-ink-300 dark:hover:bg-ink-800">
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Get started <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.16),_transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.22),_transparent_60%)]" />
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 lg:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <Pill tone="brand" className="mb-5">
                <Sparkles className="h-3 w-3" /> RAG tutor · auto-grading · mastery analytics
              </Pill>
              <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-ink-900 sm:text-5xl lg:text-6xl dark:text-white">
                Online learning that
                <span className="bg-gradient-to-r from-brand-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent"> adapts to each student</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-600 sm:text-lg dark:text-ink-300">
                VertexLearn AI tracks progress, targets weak topics and answers doubts in seconds — grounded in the
                course's own lectures. Instructors get time back and see who needs help before it is too late.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  to={user ? homeFor(user.role) : '/register'}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700"
                >
                  {user ? 'Continue learning' : 'Create free account'} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-5 text-sm font-semibold text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  Sign in
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-ink-500 dark:text-ink-400">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Demo data included</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Works without an API key</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Student, instructor & admin</span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-100 via-violet-100 to-fuchsia-100 blur-2xl dark:from-brand-500/20 dark:via-violet-500/20 dark:to-fuchsia-500/10" />
              <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl shadow-ink-900/10 dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-center justify-between border-b border-ink-100 pb-3 dark:border-ink-800">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                      <BrainCircuit className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold text-ink-900 dark:text-white">AI tutor</p>
                      <p className="text-[10px] text-ink-400">Quicksort & Pivot Selection</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                    grounded
                  </span>
                </div>
                <div className="space-y-3 pt-4">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-3.5 py-2.5 text-xs leading-relaxed text-white">
                    Why does quicksort degrade to O(n²) on sorted input?
                  </div>
                  <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-ink-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                    If you always choose the first element as the pivot, sorted input makes every partition
                    unbalanced: one side empty, the other with n−1 elements. That gives n levels instead of log n,
                    so the total work is O(n²).
                    <span className="mt-2 block text-[10px] font-semibold text-brand-600 dark:text-brand-400">
                      Source: Quicksort and Pivot Selection · 1:00
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      ['Mastery', '62%'],
                      ['Next quiz', '5 Qs'],
                      ['Study plan', '4 wks'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-ink-100 p-2 text-center dark:border-ink-800">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
                        <p className="text-xs font-bold text-ink-800 dark:text-ink-100">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-y border-ink-200 bg-ink-50/60 py-16 dark:border-ink-800 dark:bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">The platform</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white">
              Built around the learner, not the content library
            </h2>
            <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
              Six capabilities that turn a passive course catalog into an active study partner.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="card p-5">
                  <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-sm font-bold text-ink-900 dark:text-white">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{feature.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="courses" className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">Live catalog</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white">Courses seeded and ready to explore</h2>
            </div>
            <Link to="/catalog" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
              Browse all courses →
            </Link>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(data?.courses ?? []).map((course) => (
              <Link key={course.id} to={`/courses/${course.id}`} className="card group overflow-hidden">
                <div className="relative h-36 bg-ink-100 dark:bg-ink-800">
                  {course.thumbnail_url && (
                    <img src={course.thumbnail_url} alt="" className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105" />
                  )}
                  <span className="absolute left-3 top-3">
                    <Pill tone="brand">{course.category}</Pill>
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">{course.difficulty}</p>
                  <h3 className="mt-1 line-clamp-2 text-sm font-bold text-ink-900 dark:text-white">{course.title}</h3>
                  <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                    {course.instructor_name} · {course.lectures} lectures · {course.learners} learner{course.learners === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-ink-200 bg-ink-50/60 py-16 dark:border-ink-800 dark:bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">How it works</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white">
                One loop: learn → retrieve → adapt
              </h2>
              <div className="mt-6 space-y-4">
                {[
                  ['01', 'Learn with context', 'Watch a lecture, keep timestamped notes and bookmarks, and track progress per lecture.'],
                  ['02', 'Ask the course itself', 'Questions are embedded and matched against the lecture transcripts; the answer cites the segment it came from.'],
                  ['03', 'Practice and get graded', 'Quizzes auto-grade instantly with explanations. Weak topics feed mastery scores.'],
                  ['04', 'Adapt the plan', 'Study plans reprioritise weak topics, while instructors see at-risk learners and topic-level analytics.'],
                ].map(([step, title, body]) => (
                  <div key={step} className="flex gap-4">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{step}</span>
                    <div>
                      <p className="text-sm font-bold text-ink-900 dark:text-white">{title}</p>
                      <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card p-5 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Quote className="h-4 w-4 text-brand-500" />
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-400">Learner outcome</p>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  “I used to wait a day for a TA reply. Now I ask at 11 PM, get an answer with the exact lecture
                  timestamp, and my study plan already knows which topic I keep failing.”
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <Avatar name="Ananya Sharma" size={34} />
                  <div>
                    <p className="text-xs font-bold text-ink-900 dark:text-white">Ananya Sharma</p>
                    <p className="text-[11px] text-ink-400">Final-year B.Tech · demo learner</p>
                  </div>
                </div>
              </div>
              <div className="card p-5">
                <p className="text-3xl font-extrabold text-ink-900 dark:text-white">&lt;10s</p>
                <p className="mt-1 text-xs font-medium text-ink-500 dark:text-ink-400">Median doubt resolution inside the course</p>
              </div>
              <div className="card p-5">
                <p className="text-3xl font-extrabold text-ink-900 dark:text-white">100%</p>
                <p className="mt-1 text-xs font-medium text-ink-500 dark:text-ink-400">Of objective quiz types auto-graded with feedback</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white">Try the whole platform</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-ink-500 dark:text-ink-400">
            Sign in with a seeded student, instructor or admin account. Passwords are shown on the sign-in page —
            this is a demo build.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/login" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white hover:bg-brand-700">
              Sign in to the demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/register" className={cn('inline-flex h-11 items-center rounded-xl border border-ink-200 bg-white px-6 text-sm font-semibold text-ink-700 hover:bg-ink-50', 'dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800')}>
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-200 py-8 dark:border-ink-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-ink-400 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} VertexLearn AI · demo implementation of the LMS-AI product requirements.</p>
          <p>Built with React, Express, SQLite and local retrieval-augmented generation.</p>
        </div>
      </footer>
    </div>
  );
}
