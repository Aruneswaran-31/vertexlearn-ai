import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Bell, CheckCheck, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, cn } from '../lib/ui';
import { timeAgo } from '../lib/format';

type Notification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>('/notifications'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (isLoading) return <Spinner label="Loading notifications" />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="Grading results, new assignments, course approvals and achievement unlocks."
        actions={
          (data?.unread ?? 0) > 0 ? (
            <Button variant="outline" size="sm" loading={markAll.isPending} onClick={() => markAll.mutate()} icon={<CheckCheck className="h-3.5 w-3.5" />}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <ErrorBanner error={error ?? markRead.error ?? markAll.error} />

      {data?.notifications.length ? (
        <div className="space-y-2">
          {data.notifications.map((notification) => (
            <Card key={notification.id} className={cn('p-4', !notification.is_read && 'border-brand-200 bg-brand-50/30 dark:border-brand-500/30 dark:bg-brand-500/5')}>
              <div className="flex items-start gap-3">
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', notification.is_read ? 'bg-ink-100 text-ink-400 dark:bg-ink-800' : 'bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300')}>
                  {notification.title.toLowerCase().includes('badge') ? <Award className="h-4 w-4" /> : notification.title.toLowerCase().includes('streak') ? <Sparkles className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-ink-900 dark:text-white">{notification.title}</p>
                    {!notification.is_read && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
                  </div>
                  {notification.body && <p className="mt-0.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{notification.body}</p>}
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-[10px] text-ink-400">{timeAgo(notification.created_at)}</span>
                    {notification.link && (
                      <Link to={notification.link} onClick={() => markRead.mutate(notification.id)} className="text-[10px] font-bold text-brand-600 hover:underline dark:text-brand-400">
                        Open →
                      </Link>
                    )}
                    {!notification.is_read && (
                      <button onClick={() => markRead.mutate(notification.id)} className="text-[10px] font-semibold text-ink-400 hover:text-ink-700 dark:hover:text-ink-200">
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="You're all caught up" message="Notifications appear when something happens in your courses." />
      )}
    </div>
  );
}
