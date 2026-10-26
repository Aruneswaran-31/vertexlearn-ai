import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Moon, Palette, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Avatar, Button, Card, ErrorBanner, Field, PageHeader, Pill, TextInput } from '../lib/ui';

export default function Settings() {
  const { user, refresh } = useAuth();
  const { theme, toggle } = useTheme();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [headline, setHeadline] = useState(user?.headline ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFullName(user?.full_name ?? '');
    setHeadline(user?.headline ?? '');
    setAvatarUrl(user?.avatar_url ?? '');
  }, [user?.id]);

  if (!user) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put('/users/me', { full_name: fullName, headline, avatar_url: avatarUrl });
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle="Your profile, appearance and account information." />

      <div className="space-y-5">
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-brand-500" />
            <h2 className="text-base font-bold text-ink-900 dark:text-white">Profile</h2>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Avatar name={fullName || user.full_name} src={avatarUrl || null} size={56} />
            <div>
              <p className="text-sm font-bold text-ink-900 dark:text-white">{user.full_name}</p>
              <p className="text-xs text-ink-500 dark:text-ink-400">{user.email}</p>
              <div className="mt-1 flex gap-1.5">
                <Pill tone="brand" className="capitalize">{user.role}</Pill>
                <Pill tone="amber">🔥 {user.streak.current}-day streak</Pill>
              </div>
            </div>
          </div>

          <form onSubmit={save} className="mt-5 space-y-3">
            <Field label="Full name" htmlFor="name">
              <TextInput id="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} />
            </Field>
            <Field label="Headline" htmlFor="headline" hint="Shown to instructors and in discussion threads.">
              <TextInput id="headline" value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="What are you working towards?" maxLength={160} />
            </Field>
            <Field label="Avatar URL" htmlFor="avatar" hint="Optional. A square image works best.">
              <TextInput id="avatar" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://…" />
            </Field>
            <ErrorBanner error={error} />
            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving}>Save changes</Button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Profile updated
                </span>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-brand-500" />
            <h2 className="text-base font-bold text-ink-900 dark:text-white">Appearance</h2>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-ink-100 p-4 dark:border-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300">
                {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </span>
              <div>
                <p className="text-xs font-bold text-ink-900 dark:text-white">{theme === 'dark' ? 'Dark theme' : 'Light theme'}</p>
                <p className="text-[11px] text-ink-500 dark:text-ink-400">Applies across the whole workspace and persists on this device.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={toggle}>Switch</Button>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-500" />
            <h2 className="text-base font-bold text-ink-900 dark:text-white">Account & security</h2>
          </div>
          <dl className="mt-3 divide-y divide-ink-100 text-xs dark:divide-ink-800">
            {[
              ['Account ID', user.id],
              ['Role', user.role],
              ['Email', user.email],
              ['Session', 'Short-lived JWT access token with rotating refresh token'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
                <dd className="truncate font-semibold text-ink-800 dark:text-ink-100">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 rounded-xl bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500 dark:bg-ink-800 dark:text-ink-400">
            This is a demo deployment. Passwords for the seeded accounts are intentionally public; do not reuse a real
            password here. In production this screen would also expose password rotation and active sessions.
          </p>
        </Card>
      </div>
    </div>
  );
}
