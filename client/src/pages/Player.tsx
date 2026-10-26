import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Layers,
  Loader2,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ChatMessage, Course, Lecture, Module, Source } from '../lib/types';
import {
  Button,
  Card,
  ErrorBanner,
  Pill,
  ProgressBar,
  RichText,
  Spinner,
  Tabs,
  TextArea,
  cn,
} from '../lib/ui';
import { formatClock, formatDuration, timeAgo } from '../lib/format';

type DetailResponse = {
  course: Course;
  enrollment: { id: string; progress_percent: number } | null;
  modules: Module[];
  assignments: { id: string; title: string; due_date: string }[];
  announcements: { id: string; content: string; created_at: string; author: string }[];
};

type Note = { id: string; content: string; timestamp_seconds: number; created_at: string };
type Bookmark = { id: string; label: string | null; timestamp_seconds: number };
type Flashcard = { id: string; question: string; answer: string };
type Mode = 'beginner' | 'intermediate' | 'advanced';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'beginner', label: 'Beginner', hint: 'Plain language' },
  { id: 'intermediate', label: 'Intermediate', hint: 'Course level' },
  { id: 'advanced', label: 'Advanced', hint: 'Edge cases' },
];

export default function Player() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.get<DetailResponse>(`/courses/${id}`),
    enabled: Boolean(id),
  });

  const lectures = useMemo(
    () => (data?.modules ?? []).flatMap((module) => module.lectures.map((lecture) => ({ ...lecture, module }))),
    [data],
  );

  const initialLectureId =
    searchParams.get('lecture') ??
    lectures.find((lecture) => !lecture.completed)?.id ??
    lectures[0]?.id ??
    '';

  const [lectureId, setLectureId] = useState(initialLectureId);
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(0);
  const [tab, setTab] = useState('tutor');
  const [noteDraft, setNoteDraft] = useState('');
  const [bookmarkLabel, setBookmarkLabel] = useState('');
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!lectureId && initialLectureId) setLectureId(initialLectureId);
  }, [initialLectureId, lectureId]);

  const selected = lectures.find((lecture) => lecture.id === lectureId) ?? lectures[0];
  const lectureIndex = lectures.findIndex((lecture) => lecture.id === selected?.id);
  const module = selected?.module;

  useEffect(() => {
    setWatched(selected?.watched_seconds ?? 0);
    setPlaying(false);
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (selected) next.set('lecture', selected.id);
      return next;
    }, { replace: true });
  }, [selected?.id, selected?.watched_seconds, setSearchParams, selected]);

  const progress = useMutation({
    mutationFn: (payload: { watched_seconds: number; completed?: boolean }) =>
      api.post(`/lectures/${selected.id}/progress`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course', id] });
      queryClient.invalidateQueries({ queryKey: ['enrollments-me'] });
    },
  });

  // Simulated playback: real deployments attach an HLS player and report the
  // same progress endpoint from its timeupdate event.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!playing || !selected) return;
    const timer = setInterval(() => {
      setWatched((current) => {
        const duration = selected.duration_seconds || 600;
        const next = Math.min(duration, current + 1);
        if (next >= duration * 0.95 && !selected.completed) {
          setPlaying(false);
          progressRef.current.mutate({ watched_seconds: next, completed: true });
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, selected?.id, selected?.duration_seconds, selected?.completed]);

  const saveProgress = () => {
    if (!selected) return;
    progress.mutate({ watched_seconds: watched, completed: watched >= (selected.duration_seconds || 0) * 0.9 });
  };

  const markComplete = () => {
    if (!selected) return;
    setWatched(selected.duration_seconds);
    progress.mutate({ watched_seconds: selected.duration_seconds, completed: true });
  };

  const notesQuery = useQuery({
    queryKey: ['notes', selected?.id],
    queryFn: () => api.get<{ notes: Note[]; bookmarks: Bookmark[] }>(`/lectures/${selected.id}/notes`),
    enabled: tab === 'notes' && Boolean(selected?.id),
  });

  const addNote = useMutation({
    mutationFn: () =>
      api.post(`/lectures/${selected.id}/notes`, { content: noteDraft, timestamp_seconds: Math.floor(watched) }),
    onSuccess: () => {
      setNoteDraft('');
      queryClient.invalidateQueries({ queryKey: ['notes', selected?.id] });
    },
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) => api.del(`/notes/${noteId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes', selected?.id] }),
  });

  const addBookmark = useMutation({
    mutationFn: () =>
      api.post(`/lectures/${selected.id}/bookmarks`, {
        timestamp_seconds: Math.floor(watched),
        label: bookmarkLabel || `Bookmark at ${formatClock(watched)}`,
      }),
    onSuccess: () => {
      setBookmarkLabel('');
      queryClient.invalidateQueries({ queryKey: ['notes', selected?.id] });
    },
  });

  const deleteBookmark = useMutation({
    mutationFn: (bookmarkId: string) => api.del(`/bookmarks/${bookmarkId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes', selected?.id] }),
  });

  /* -------------------------------- AI tutor -------------------------------- */

  const sessionQuery = useQuery({
    queryKey: ['ai-session', id],
    queryFn: () =>
      api.post<{ session: { id: string; mode: Mode; messages: ChatMessage[]; course_title: string } }>('/ai/chat/sessions', {
        course_id: id,
        mode: 'intermediate',
      }),
    enabled: Boolean(id) && Boolean(data?.enrollment),
  });

  const [mode, setMode] = useState<Mode>('intermediate');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (sessionQuery.data?.session) {
      setMessages(sessionQuery.data.session.messages ?? []);
      setMode(sessionQuery.data.session.mode);
    }
  }, [sessionQuery.data?.session?.id]);

  const changeMode = useMutation({
    mutationFn: (next: Mode) => api.put(`/ai/chat/sessions/${sessionQuery.data!.session.id}/mode`, { mode: next }),
    onError: () => setMode(mode),
  });

  const ask = useMutation({
    mutationFn: (text: string) =>
      api.post<{ message: ChatMessage; engine: string; grounded: boolean }>(
        `/ai/chat/sessions/${sessionQuery.data!.session.id}/messages`,
        { message: text },
      ),
    onMutate: (text) => {
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, sender: 'user', content: text, created_at: new Date().toISOString() },
      ]);
      setQuestion('');
    },
    onSuccess: (result) => {
      setMessages((current) => [...current, result.message]);
    },
    onError: () => {
      setMessages((current) => current.slice(0, -1));
    },
  });

  const sendQuestion = (text: string) => {
    if (!text.trim() || !sessionQuery.data) return;
    ask.mutate(text.trim());
  };

  const flashcardsQuery = useQuery({
    queryKey: ['flashcards', module?.id],
    queryFn: () => api.get<{ flashcards: Flashcard[] }>(`/ai/modules/${module!.id}/flashcards`),
    enabled: tab === 'flashcards' && Boolean(module?.id),
  });

  const generateFlashcards = useMutation({
    mutationFn: () => api.post<{ flashcards: Flashcard[]; engine: string }>(`/ai/modules/${module!.id}/flashcards`, { count: 8 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['flashcards', module?.id] }),
  });

  if (isLoading) return <Spinner label="Opening course player" />;
  if (error) return <ErrorBanner error={error} />;
  if (!data || !selected) return null;

  if (!data.enrollment) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Enroll to open the player</p>
        <Link to={`/courses/${id}`} className="mt-3 inline-block">
          <Button size="sm">Back to course</Button>
        </Link>
      </Card>
    );
  }

  const duration = selected.duration_seconds || 600;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={`/courses/${id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> {data.course.title}
        </Link>
        <div className="flex items-center gap-3">
          <div className="hidden w-44 sm:block">
            <ProgressBar value={data.enrollment.progress_percent} showLabel />
          </div>
          <Pill tone="brand">
            <Sparkles className="h-3 w-3" /> AI tutor enabled
          </Pill>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_1fr_400px]">
        {/* Lecture list */}
        <Card className="order-2 max-h-[calc(100vh-9rem)] overflow-y-auto p-3 xl:order-1">
          <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">Curriculum</p>
          {data.modules.map((courseModule) => (
            <div key={courseModule.id} className="mb-3">
              <p className="px-1 py-1 text-[11px] font-bold text-ink-600 dark:text-ink-300">{courseModule.title}</p>
              <div className="space-y-0.5">
                {courseModule.lectures.map((lecture) => (
                  <button
                    key={lecture.id}
                    onClick={() => setLectureId(lecture.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[11px] transition-colors',
                      lecture.id === selected.id
                        ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'text-ink-600 hover:bg-ink-50 dark:text-ink-400 dark:hover:bg-ink-800',
                    )}
                  >
                    {lecture.completed ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <Play className="mt-0.5 h-3 w-3 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block leading-snug">{lecture.title}</span>
                      <span className="mt-0.5 block text-[10px] font-normal text-ink-400">{formatDuration(lecture.duration_seconds)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>

        {/* Player */}
        <div className="order-1 space-y-4 xl:order-2">
          <Card className="overflow-hidden">
            <div className="relative flex aspect-video flex-col items-center justify-center bg-gradient-to-br from-ink-900 via-ink-950 to-brand-950 text-white">
              {selected.video_url ? (
                <iframe
                  src={selected.video_url}
                  title={selected.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="px-8 text-center">
                  <span className={cn('mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/10 backdrop-blur', playing && 'animate-pulse')}>
                    {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
                  </span>
                  <p className="mt-4 text-sm font-semibold">{selected.title}</p>
                  <p className="mt-1 text-xs text-white/50">
                    Transcript-driven lecture · {formatDuration(selected.duration_seconds)}
                  </p>
                  <p className="mx-auto mt-3 max-w-sm text-[11px] leading-relaxed text-white/40">
                    This demo ships lecture transcripts instead of video files. Playback advances through the lecture
                    so progress, notes, bookmarks and certificates behave exactly as they would with an HLS stream.
                  </p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent p-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.min(100, (watched / duration) * 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
                  <span>{formatClock(watched)} / {formatClock(duration)}</span>
                  <span>{selected.completed ? 'Completed' : `${Math.round((watched / duration) * 100)}% watched`}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 p-4 dark:border-ink-800">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={playing ? 'outline' : 'primary'}
                  onClick={() => setPlaying((value) => !value)}
                  icon={playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                >
                  {playing ? 'Pause' : 'Play lecture'}
                </Button>
                <Button size="sm" variant="outline" onClick={saveProgress} loading={progress.isPending}>
                  Save position
                </Button>
                {!selected.completed && (
                  <Button size="sm" variant="secondary" onClick={markComplete} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                    Mark complete
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lectureIndex <= 0}
                  onClick={() => setLectureId(lectures[lectureIndex - 1].id)}
                  icon={<ChevronLeft className="h-4 w-4" />}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lectureIndex >= lectures.length - 1}
                  onClick={() => setLectureId(lectures[lectureIndex + 1].id)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {progress.error && <div className="px-4 pb-4"><ErrorBanner error={progress.error} /></div>}
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">{module?.title}</p>
                <h1 className="mt-0.5 text-lg font-bold text-ink-900 dark:text-white">{selected.title}</h1>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
                <Clock className="h-3.5 w-3.5" /> {formatDuration(selected.duration_seconds)}
              </div>
            </div>

            {selected.transcript ? (
              <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50/50 p-4 dark:border-ink-800 dark:bg-ink-800/30">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">Transcript · grounded source for the tutor</p>
                <div className="scrollbar-thin max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                  {selected.transcript}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">No transcript attached to this lecture.</p>
            )}

            {selected.resource_urls.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.resource_urls.map((resource) => (
                  <span key={resource} className="chip">
                    <FileText className="h-3 w-3" /> {resource}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* AI panel */}
        <div className="order-3">
          <Card className="flex h-[calc(100vh-9rem)] min-h-[540px] flex-col overflow-hidden">
            <div className="border-b border-ink-100 p-3 dark:border-ink-800">
              <Tabs
                tabs={[
                  { id: 'tutor', label: 'AI tutor' },
                  { id: 'notes', label: 'Notes' },
                  { id: 'flashcards', label: 'Cards' },
                ]}
                active={tab}
                onChange={setTab}
              />
            </div>

            {tab === 'tutor' && (
              <>
                <div className="border-b border-ink-100 px-3 py-2.5 dark:border-ink-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <BrainCircuit className="h-4 w-4 text-brand-500" />
                      <span className="text-xs font-bold text-ink-900 dark:text-white">Course tutor</span>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                      grounded
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {MODES.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setMode(item.id);
                          changeMode.mutate(item.id);
                        }}
                        title={item.hint}
                        className={cn(
                          'flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors',
                          mode === item.id
                            ? 'bg-brand-600 text-white'
                            : 'bg-ink-100 text-ink-500 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-400',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  {sessionQuery.isLoading ? (
                    <Spinner label="Connecting tutor" />
                  ) : sessionQuery.error ? (
                    <ErrorBanner error={sessionQuery.error} />
                  ) : messages.length === 0 ? (
                    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3 dark:border-brand-500/20 dark:bg-brand-500/5">
                      <p className="text-xs font-bold text-ink-900 dark:text-white">Ask about this course</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                        Answers come only from the lecture transcripts. I cite the lecture and timestamp, and I say so
                        when the material does not cover something.
                      </p>
                      <div className="mt-2.5 space-y-1.5">
                        {[
                          'Why does quicksort degrade to O(n²) on sorted input?',
                          'Explain Big-O in simple terms',
                          'What is the difference between BFS and DFS?',
                        ].map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => sendQuestion(suggestion)}
                            className="block w-full rounded-lg border border-brand-100 bg-white px-2.5 py-1.5 text-left text-[11px] font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-500/20 dark:bg-ink-900 dark:text-brand-300"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className={cn('flex', message.sender === 'user' ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[92%] rounded-2xl px-3 py-2.5 text-xs',
                            message.sender === 'user'
                              ? 'rounded-br-sm bg-brand-600 text-white'
                              : 'rounded-bl-sm bg-ink-50 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
                          )}
                        >
                          {message.sender === 'user' ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                          ) : (
                            <>
                              <RichText content={message.content} />
                              {message.sources && message.sources.length > 0 && (
                                <div className="mt-2.5 space-y-1 border-t border-ink-200/70 pt-2 dark:border-ink-700/70">
                                  <p className="text-[9px] font-bold uppercase tracking-wide text-ink-400">Sources</p>
                                  {message.sources.map((source: Source) => (
                                    <button
                                      key={`${source.lecture_id}-${source.timestamp_seconds}`}
                                      onClick={() => {
                                        const target = lectures.find((lecture) => lecture.id === source.lecture_id);
                                        if (target) {
                                          setLectureId(target.id);
                                          setWatched(source.timestamp_seconds);
                                        }
                                      }}
                                      className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-left text-[10px] hover:bg-white dark:bg-ink-900/60 dark:hover:bg-ink-900"
                                    >
                                      <span className="truncate font-semibold text-ink-600 dark:text-ink-300">{source.lecture_title}</span>
                                      <span className="shrink-0 font-mono text-brand-600 dark:text-brand-400">{formatClock(source.timestamp_seconds)}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          <p className={cn('mt-1 text-[9px]', message.sender === 'user' ? 'text-white/60' : 'text-ink-400')}>
                            {timeAgo(message.created_at)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  {ask.isPending && (
                    <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-[11px] text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching this course's lectures…
                    </div>
                  )}
                  <ErrorBanner error={ask.error} />
                </div>

                <div className="border-t border-ink-100 p-3 dark:border-ink-800">
                  <div className="flex items-end gap-2">
                    <TextArea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          sendQuestion(question);
                        }
                      }}
                      placeholder={`Ask about ${data.course.title}…`}
                      rows={2}
                      className="min-h-0 resize-none text-xs"
                      disabled={!sessionQuery.data}
                    />
                    <Button
                      size="sm"
                      className="h-9"
                      disabled={!question.trim() || !sessionQuery.data}
                      loading={ask.isPending}
                      onClick={() => sendQuestion(question)}
                      aria-label="Send question"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[9px] text-ink-400">Enter to send · Shift+Enter for a new line</p>
                </div>
              </>
            )}

            {tab === 'notes' && (
              <div className="flex-1 overflow-y-auto p-3">
                <p className="text-xs font-bold text-ink-900 dark:text-white">Notes at {formatClock(watched)}</p>
                <TextArea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Write a note tied to this timestamp…"
                  rows={3}
                  className="mt-2 text-xs"
                />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    size="sm"
                    disabled={!noteDraft.trim()}
                    loading={addNote.isPending}
                    onClick={() => addNote.mutate()}
                    icon={<Plus className="h-3.5 w-3.5" />}
                  >
                    Add note
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={addBookmark.isPending}
                    onClick={() => addBookmark.mutate()}
                    icon={<Bookmark className="h-3.5 w-3.5" />}
                  >
                    Bookmark {formatClock(watched)}
                  </Button>
                </div>
                <input
                  value={bookmarkLabel}
                  onChange={(event) => setBookmarkLabel(event.target.value)}
                  placeholder={`Optional bookmark label for ${formatClock(watched)}`}
                  className="input mt-2 h-9 py-1.5 text-[11px]"
                  aria-label="Bookmark label"
                />
                <ErrorBanner error={addNote.error ?? addBookmark.error} />

                <div className="mt-4 space-y-2">
                  {notesQuery.isLoading ? (
                    <Spinner label="Loading notes" />
                  ) : notesQuery.data?.notes.length ? (
                    notesQuery.data.notes.map((note) => (
                      <div key={note.id} className="group rounded-xl border border-ink-100 p-2.5 dark:border-ink-800">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                            <NotebookPen className="h-2.5 w-2.5" /> {formatClock(note.timestamp_seconds)}
                          </span>
                          <button
                            onClick={() => deleteNote.mutate(note.id)}
                            className="text-ink-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                            aria-label="Delete note"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-600 dark:text-ink-300">{note.content}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-dashed border-ink-200 p-3 text-center text-[11px] text-ink-400 dark:border-ink-700">
                      No notes on this lecture yet.
                    </p>
                  )}
                </div>

                {notesQuery.data?.bookmarks.length ? (
                  <div className="mt-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Bookmarks</p>
                    <div className="mt-1.5 space-y-1">
                      {notesQuery.data.bookmarks.map((bookmark) => (
                        <div key={bookmark.id} className="flex items-center gap-2 rounded-lg border border-ink-100 px-2 py-1.5 dark:border-ink-800">
                          <BookmarkCheck className="h-3 w-3 text-brand-500" />
                          <button onClick={() => setWatched(bookmark.timestamp_seconds)} className="min-w-0 flex-1 truncate text-left text-[10px] text-ink-600 dark:text-ink-300">
                            {bookmark.label ?? 'Bookmark'} · {formatClock(bookmark.timestamp_seconds)}
                          </button>
                          <button onClick={() => deleteBookmark.mutate(bookmark.id)} aria-label="Delete bookmark" className="text-ink-300 hover:text-rose-500">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {tab === 'flashcards' && (
              <div className="flex-1 overflow-y-auto p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-ink-900 dark:text-white">Module flashcards</p>
                    <p className="text-[10px] text-ink-400">Generated from {module?.title}</p>
                  </div>
                  <Button size="sm" variant="outline" loading={generateFlashcards.isPending} onClick={() => generateFlashcards.mutate()} icon={<Wand2 className="h-3.5 w-3.5" />}>
                    {flashcardsQuery.data?.flashcards.length ? 'Regenerate' : 'Generate'}
                  </Button>
                </div>
                <ErrorBanner error={generateFlashcards.error ?? flashcardsQuery.error} />

                <div className="mt-3 space-y-2">
                  {flashcardsQuery.isLoading ? (
                    <Spinner label="Loading cards" />
                  ) : flashcardsQuery.data?.flashcards.length ? (
                    flashcardsQuery.data.flashcards.map((card) => (
                      <button
                        key={card.id}
                        onClick={() => setFlipped((state) => ({ ...state, [card.id]: !state[card.id] }))}
                        className="w-full rounded-xl border border-ink-200 bg-gradient-to-br from-white to-ink-50 p-3 text-left transition-colors hover:border-brand-300 dark:border-ink-700 dark:from-ink-900 dark:to-ink-800"
                      >
                        <p className="text-[9px] font-bold uppercase tracking-wide text-brand-500">{flipped[card.id] ? 'Answer' : 'Question'}</p>
                        <p className="mt-1 text-[11px] font-semibold leading-relaxed text-ink-800 dark:text-ink-100">
                          {flipped[card.id] ? card.answer : card.question}
                        </p>
                        <p className="mt-1.5 text-[9px] text-ink-400">{flipped[card.id] ? 'Tap to hide' : 'Tap to reveal'}</p>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-ink-200 p-4 text-center dark:border-ink-700">
                      <Layers className="mx-auto h-6 w-6 text-ink-300" />
                      <p className="mt-2 text-[11px] font-semibold text-ink-700 dark:text-ink-200">No cards yet</p>
                      <p className="mt-1 text-[10px] text-ink-400">Generate Q/A pairs from this module's transcripts.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
