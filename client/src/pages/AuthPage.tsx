import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BrainCircuit, CheckCircle2, GraduationCap, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, ErrorBanner, Field, Select, TextInput, cn } from '../lib/ui';
import { homeFor } from '../App';

type Mode = 'login' | 'register';

const demoAccounts = [
  { role: 'Student', email: 'student@vertexlearn.ai', icon: UserRound, description: 'Ananya · 2 enrollments, streak, AI tutor history' },
  { role: 'Instructor', email: 'instructor@vertexlearn.ai', icon: GraduationCap, description: 'Rohit · courses, analytics, at-risk alerts' },
  { role: 'Admin', email: 'admin@vertexlearn.ai', icon: ShieldCheck, description: 'Meera · approvals, users, platform metrics' },
];

export default function AuthPage({ mode }: { mode: Mode }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('student@vertexlearn.ai');
  const [password, setPassword] = useState('Demo@12345');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const destination = (location.state as { from?: string } | null)?.from;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const account =
        mode === 'login'
          ? await login(email, password)
          : await register({ fullName, email, password, role });
      navigate(destination && destination !== '/login' ? destination : homeFor(account.role), { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  };

  const useDemo = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Demo@12345');
    setError(null);
    setLoading(true);
    try {
      const account = await login(demoEmail, 'Demo@12345');
      navigate(homeFor(account.role), { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white dark:bg-ink-950">
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-ink-950 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.45),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.35),transparent_45%)]" />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 backdrop-blur">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-sm font-extrabold tracking-tight">VertexLearn AI</span>
          </Link>
          <h1 className="mt-20 max-w-md text-4xl font-extrabold leading-[1.1] tracking-tight">
            Doubts answered in seconds. Weak topics caught before the exam.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">
            The AI tutor answers only from the course material and cites the lecture segment it used — so learners
            can trust it and instructors can verify it.
          </p>
          <div className="mt-8 space-y-3">
            {[
              'Grounded RAG tutor with lecture + timestamp citations',
              'Auto-graded MCQs, multi-select and short answers',
              'Per-topic mastery, study plans and at-risk alerts',
              'Real PDF certificates issued at course completion',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 p-4 backdrop-blur">
          <BrainCircuit className="h-8 w-8 text-brand-300" />
          <p className="text-xs leading-relaxed text-white/70">
            Seeded with three real course transcripts, graded attempts, discussion threads and a pending course
            approval — enough to demo every workflow end to end.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-white">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              VertexLearn AI
            </Link>
          </div>

          <div className="mt-8 lg:mt-0">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900 dark:text-white">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
              {mode === 'login'
                ? 'Sign in to continue your course, or use a demo account below.'
                : 'Start as a student, or open a teaching workspace as an instructor.'}
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <Field label="Full name" htmlFor="fullName">
                <TextInput
                  id="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  minLength={2}
                />
              </Field>
            )}

            <Field label="Email" htmlFor="email">
              <TextInput
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field label="Password" htmlFor="password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
              <TextInput
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : 1}
              />
            </Field>

            {mode === 'register' && (
              <Field label="I am joining as" htmlFor="role">
                <Select
                  id="role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as 'student' | 'instructor')}
                  options={[
                    { value: 'student', label: 'Student — learn and take quizzes' },
                    { value: 'instructor', label: 'Instructor — author courses and analytics' },
                  ]}
                />
              </Field>
            )}

            <ErrorBanner error={error} />

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {mode === 'login' ? 'Sign in' : 'Create account'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-ink-500 dark:text-ink-400">
            {mode === 'login' ? (
              <>
                New here?{' '}
                <Link to="/register" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link to="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  Sign in
                </Link>
              </>
            )}
          </p>

          <div className="mt-8 rounded-2xl border border-ink-200 bg-ink-50/60 p-4 dark:border-ink-800 dark:bg-ink-900/60">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">Demo accounts · password Demo@12345</p>
            <div className="mt-3 space-y-2">
              {demoAccounts.map((account) => {
                const Icon = account.icon;
                return (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => void useDemo(account.email)}
                    disabled={loading}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border border-ink-200 bg-white p-3 text-left transition-colors',
                      'hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-900 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5',
                    )}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-ink-900 dark:text-white">{account.role}</span>
                      <span className="block truncate text-[11px] text-ink-500 dark:text-ink-400">{account.description}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
