import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Award,
  Bell,
  BookOpen,
  ChevronDown,
  Flame,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { api } from '../lib/api';
import { Avatar, cn } from '../lib/ui';
import { homeFor } from '../App';

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };

const studentNav: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/catalog', label: 'Course catalog', icon: BookOpen },
  { to: '/assignments', label: 'Assignments', icon: GraduationCap },
  { to: '/achievements', label: 'Achievements', icon: Award },
];

const instructorNav: NavItem[] = [
  { to: '/instructor', label: 'Teaching hub', icon: LayoutDashboard },
  { to: '/catalog', label: 'Course catalog', icon: BookOpen },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Platform admin', icon: ShieldCheck },
  { to: '/instructor', label: 'Teaching hub', icon: LayoutDashboard },
  { to: '/catalog', label: 'Course catalog', icon: BookOpen },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25">
        <Sparkles className="h-4 w-4" strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-extrabold tracking-tight text-ink-900 dark:text-white">VertexLearn</span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">AI learning</span>
      </span>
    </Link>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });

  const nav = user?.role === 'admin' ? adminNav : user?.role === 'instructor' ? instructorNav : studentNav;

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Logo />
        <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
          <X className="h-5 w-5 text-ink-400" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <p className="px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">Workspace</p>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/instructor' || item.to === '/admin'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {item.to === '/notifications' && (notifications?.unread ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {notifications!.unread}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mx-3 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-violet-50 p-4 dark:border-brand-500/20 dark:from-brand-500/10 dark:to-violet-500/10">
        <div className="flex items-center gap-2 text-brand-700 dark:text-brand-300">
          <Flame className="h-4 w-4" />
          <span className="text-lg font-bold">{user.streak.current}-day streak</span>
        </div>
        <p className="mt-1 text-xs text-brand-700/70 dark:text-brand-300/70">
          {user.role === 'student'
            ? `Longest: ${user.streak.longest} days. Keep it alive today.`
            : 'Your learners can see their streaks on the dashboard.'}
        </p>
        <Link
          to={user.role === 'student' ? '/dashboard' : homeFor(user.role)}
          className="mt-3 inline-flex text-xs font-bold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
        >
          {user.role === 'student' ? 'See study plan' : 'Open workspace'}
        </Link>
      </div>

      <div className="mt-3 flex items-center gap-2 px-3 pb-2">
        <button
          onClick={toggle}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <Link
          to="/settings"
          aria-label="Settings"
          className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      </div>
      <div className="px-5 pb-5 pt-1 text-[10px] text-ink-400">VertexLearn AI · demo build</div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-ink-50 dark:bg-ink-950">
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white lg:block dark:border-ink-800 dark:bg-ink-900">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-72 border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ink-200 bg-white/85 px-4 backdrop-blur sm:px-6 dark:border-ink-800 dark:bg-ink-950/85">
          <div className="flex min-w-0 items-center gap-3">
            <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu className="h-5 w-5 text-ink-500" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">
                {user.role === 'student'
                  ? `Welcome back, ${user.full_name.split(' ')[0]}`
                  : user.role === 'instructor'
                    ? `Teaching hub · ${user.full_name.split(' ')[0]}`
                    : `Platform admin · ${user.full_name.split(' ')[0]}`}
              </p>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">{user.headline ?? user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/notifications"
              className="relative rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {(notifications?.unread ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {notifications!.unread}
                </span>
              )}
            </Link>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-xl border border-ink-200 p-1 pr-2 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                aria-expanded={menuOpen}
              >
                <Avatar name={user.full_name} src={user.avatar_url} size={30} />
                <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-800 dark:bg-ink-900">
                  <div className="border-b border-ink-100 px-4 py-3 dark:border-ink-800">
                    <p className="text-sm font-semibold text-ink-900 dark:text-white">{user.full_name}</p>
                    <p className="truncate text-xs text-ink-500">{user.email}</p>
                    <span className="mt-1.5 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                      {user.role}
                    </span>
                  </div>
                  <button
                    onClick={() => navigate('/settings')}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
                  >
                    <SettingsIcon className="h-4 w-4" /> Settings
                  </button>
                  <button
                    onClick={async () => {
                      await logout();
                      navigate('/login');
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>

        <footer className="border-t border-ink-200 px-6 py-4 text-center text-xs text-ink-400 dark:border-ink-800">
          VertexLearn AI · grounded course tutor, auto-graded quizzes, instructor analytics
        </footer>
      </div>
    </div>
  );
}
