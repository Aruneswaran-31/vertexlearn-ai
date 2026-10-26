import { useQuery } from '@tanstack/react-query';
import { Award, Download, Flame, GraduationCap, Lock, Sparkles, Target, Trophy } from 'lucide-react';
import { api, downloadWithAuth } from '../lib/api';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Pill, ProgressBar, Spinner, StatCard } from '../lib/ui';
import { formatDate } from '../lib/format';

type Badge = {
  slug: string;
  name: string;
  description: string;
  criteria: string;
  earned: boolean;
  earned_at: string | null;
};

const badgeIcons: Record<string, typeof Award> = {
  first_steps: Sparkles,
  course_complete: GraduationCap,
  week_streak: Flame,
  perfect_quiz: Target,
  curious_mind: Sparkles,
};

type Certificate = {
  id: string;
  issued_at: string;
  course_title: string;
  course_id: string;
  instructor_name: string;
  certificate_url: string;
};

export default function Achievements() {
  const badgesQuery = useQuery({ queryKey: ['badges'], queryFn: () => api.get<{ badges: Badge[]; earned_count: number }>('/users/me/badges') });
  const streakQuery = useQuery({
    queryKey: ['streak'],
    queryFn: () => api.get<{ current: number; longest: number; last_active_date: string | null; activity: { day: string; lectures: number }[] }>('/users/me/streak'),
  });
  const certificatesQuery = useQuery({
    queryKey: ['certificates'],
    queryFn: () => api.get<{ certificates: Certificate[] }>('/certificates/me'),
  });
  const attemptsQuery = useQuery({
    queryKey: ['my-attempts'],
    queryFn: () => api.get<{ attempts: { id: string; score: number; title: string; course_title: string }[] }>('/quiz-attempts/me'),
  });

  if (badgesQuery.isLoading) return <Spinner label="Loading achievements" />;
  if (badgesQuery.error) return <ErrorBanner error={badgesQuery.error} />;

  const badges = badgesQuery.data?.badges ?? [];
  const earned = badges.filter((badge) => badge.earned);
  const last14 = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.now() - (13 - index) * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const match = streakQuery.data?.activity.find((entry) => entry.day === key);
    return { key, lectures: match?.lectures ?? 0, label: date.toLocaleDateString('en-GB', { weekday: 'narrow' }) };
  });
  const bestScore = attemptsQuery.data?.attempts.reduce((best, attempt) => Math.max(best, attempt.score), 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Achievements"
        subtitle="Milestones unlock badges, streaks keep momentum, and completing a course issues a verifiable PDF certificate."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Badges earned" value={`${earned.length}/${badges.length}`} icon={<Award className="h-5 w-5" />} tone="amber" />
        <StatCard label="Current streak" value={`${streakQuery.data?.current ?? 0} days`} hint={`Best ${streakQuery.data?.longest ?? 0} days`} icon={<Flame className="h-5 w-5" />} />
        <StatCard label="Best quiz score" value={bestScore ? `${Math.round(bestScore)}%` : '—'} icon={<Target className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Certificates" value={certificatesQuery.data?.certificates.length ?? 0} icon={<Trophy className="h-5 w-5" />} tone="sky" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Badge collection</h2>
              <span className="text-xs text-ink-400">{earned.length} earned</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {badges.map((badge) => {
                const Icon = badgeIcons[badge.slug] ?? Award;
                return (
                  <div
                    key={badge.slug}
                    className={
                      badge.earned
                        ? 'rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-ink-900'
                        : 'rounded-xl border border-dashed border-ink-200 p-4 opacity-70 dark:border-ink-700'
                    }
                  >
                    <div className="flex items-start justify-between">
                      <span className={badge.earned ? 'grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300' : 'grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-400 dark:bg-ink-800'}>
                        {badge.earned ? <Icon className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                      </span>
                      {badge.earned && <Pill tone="amber">Earned</Pill>}
                    </div>
                    <p className="mt-3 text-sm font-bold text-ink-900 dark:text-white">{badge.name}</p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{badge.description}</p>
                    <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-ink-400">{badge.criteria}</p>
                    {badge.earned_at && <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">Unlocked {formatDate(badge.earned_at)}</p>}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Certificates</h2>
              <GraduationCap className="h-4 w-4 text-ink-400" />
            </div>
            {certificatesQuery.isLoading ? (
              <Spinner label="Loading certificates" />
            ) : certificatesQuery.data?.certificates.length ? (
              <div className="mt-4 space-y-3">
                {certificatesQuery.data.certificates.map((certificate) => (
                  <div key={certificate.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                    <div>
                      <p className="text-sm font-bold text-ink-900 dark:text-white">{certificate.course_title}</p>
                      <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">
                        Issued {formatDate(certificate.issued_at)} · {certificate.instructor_name}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-ink-400">ID {certificate.id}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void downloadWithAuth(
                          certificate.certificate_url,
                          `VertexLearn-${certificate.course_title.replace(/[^a-z0-9]+/gi, '-')}.pdf`,
                        )
                      }
                      icon={<Download className="h-3.5 w-3.5" />}
                    >
                      Download PDF
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<GraduationCap className="h-6 w-6" />}
                title="No certificates yet"
                message="Complete 100% of a course's lectures and the PDF certificate is issued automatically."
              />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" />
              <h2 className="text-base font-bold text-ink-900 dark:text-white">Last 14 days</h2>
            </div>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">Each bar is a lecture you touched that day.</p>
            <div className="mt-4 flex h-28 items-end gap-1.5">
              {last14.map((day) => (
                <div key={day.key} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={day.lectures ? 'w-full rounded-t bg-gradient-to-t from-brand-500 to-violet-400' : 'w-full rounded-t bg-ink-100 dark:bg-ink-800'}
                    style={{ height: `${Math.max(6, Math.min(100, day.lectures * 40))}%` }}
                    title={`${day.key}: ${day.lectures} lecture${day.lectures === 1 ? '' : 's'}`}
                  />
                  <span className="text-[9px] text-ink-400">{day.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-ink-50 p-3 dark:bg-ink-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink-700 dark:text-ink-200">Streak progress</span>
                <span className="text-ink-400">{streakQuery.data?.current ?? 0}/7 days</span>
              </div>
              <ProgressBar value={Math.min(100, ((streakQuery.data?.current ?? 0) / 7) * 100)} className="mt-2" />
              <p className="mt-1.5 text-[10px] text-ink-400">Seven consecutive days unlocks the Seven-Day Streak badge.</p>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-bold text-ink-900 dark:text-white">Recent quiz scores</h2>
            {attemptsQuery.data?.attempts.length ? (
              <div className="mt-3 space-y-2">
                {attemptsQuery.data.attempts.slice(0, 6).map((attempt) => (
                  <div key={attempt.id}>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-semibold text-ink-700 dark:text-ink-200">{attempt.title}</span>
                      <span className="shrink-0 font-bold text-ink-500 dark:text-ink-300">{Math.round(attempt.score)}%</span>
                    </div>
                    <ProgressBar value={attempt.score} className="mt-1" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">No quiz attempts yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
