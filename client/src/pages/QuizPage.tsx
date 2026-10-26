import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  HelpCircle,
  RotateCcw,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, ErrorBanner, Pill, ProgressBar, RichText, Spinner } from '../lib/ui';
import { cn } from '../lib/ui';

type Question = {
  id: string;
  question_text: string;
  question_type: 'mcq' | 'multi_select' | 'short_answer';
  topic: string | null;
  explanation?: string;
  expected_answer?: string;
  options: { id: string; option_text: string; is_correct?: boolean }[];
};

type QuizResponse = {
  quiz: { id: string; title: string; course_id: string; is_ai_generated: boolean };
  questions: Question[];
  attempts: { id: string; score: number | null; started_at: string; submitted_at: string | null }[];
  best_score: number;
  can_edit: boolean;
};

type Review = {
  question_id: string;
  question_text: string;
  question_type: string;
  topic: string | null;
  explanation: string | null;
  correct_options: string[];
  selected_options: string[];
  is_correct: boolean | null;
  feedback: string;
  correct_option_texts: string[];
};

type SubmitResponse = {
  attempt: { id: string; score: number; graded_questions: number; total_questions: number };
  review: Review[];
};

export default function QuizPage() {
  const { id = '' } = useParams();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; text: string }>>({});
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [preview, setPreview] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['quiz', id],
    queryFn: () => api.get<QuizResponse>(`/quizzes/${id}`),
    enabled: Boolean(id),
  });

  const start = useMutation({
    mutationFn: () => api.post<{ attempt_id: string }>(`/quizzes/${id}/attempt`),
    onSuccess: (response) => {
      setAttemptId(response.attempt_id);
      setAnswers({});
      setIndex(0);
      setResult(null);
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<SubmitResponse>(`/attempts/${attemptId}/submit`, {
        answers: Object.entries(answers).map(([questionId, answer]) => ({
          question_id: questionId,
          selected_option_ids: answer.selected,
          text_answer: answer.text || undefined,
        })),
      }),
    onSuccess: (response) => {
      setResult(response);
      setAttemptId(null);
      void refetch();
    },
  });

  const questions = data?.questions ?? [];
  const current = questions[index];
  const answered = useMemo(
    () =>
      questions.filter((question) => {
        const answer = answers[question.id];
        return Boolean(answer && (answer.selected.length || answer.text.trim()));
      }).length,
    [answers, questions],
  );

  if (isLoading) return <Spinner label="Loading quiz" />;
  if (error) return <ErrorBanner error={error} />;
  if (!data || !questions.length) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">This quiz has no questions yet.</p>
        <Link to="/dashboard" className="mt-3 inline-block"><Button size="sm" variant="outline">Back to dashboard</Button></Link>
      </Card>
    );
  }

  const toggleOption = (question: Question, optionId: string) => {
    setAnswers((currentAnswers) => {
      const existing = currentAnswers[question.id] ?? { selected: [], text: '' };
      if (question.question_type === 'mcq') {
        return { ...currentAnswers, [question.id]: { ...existing, selected: [optionId] } };
      }
      const selected = existing.selected.includes(optionId)
        ? existing.selected.filter((item) => item !== optionId)
        : [...existing.selected, optionId];
      return { ...currentAnswers, [question.id]: { ...existing, selected } };
    });
  };

  /* ------------------------------- Results ------------------------------- */
  if (result) {
    const score = result.attempt.score;
    const tone = score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'rose';
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Link to={`/courses/${data.quiz.course_id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to course
        </Link>

        <Card className="overflow-hidden text-center">
          <div className={cn('px-6 py-8', tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-500/10' : tone === 'amber' ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-rose-50 dark:bg-rose-500/10')}>
            <div className={cn('mx-auto grid h-24 w-24 place-items-center rounded-full border-4 bg-white text-3xl font-extrabold dark:bg-ink-900', tone === 'emerald' ? 'border-emerald-400 text-emerald-600 dark:text-emerald-300' : tone === 'amber' ? 'border-amber-400 text-amber-600 dark:text-amber-300' : 'border-rose-400 text-rose-600 dark:text-rose-300')}>
              {Math.round(score)}%
            </div>
            <h1 className="mt-4 text-xl font-extrabold text-ink-900 dark:text-white">
              {score >= 80 ? 'Strong result' : score >= 50 ? 'Close — review the misses' : 'This topic needs another pass'}
            </h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {result.attempt.graded_questions} of {result.attempt.total_questions} questions auto-graded · mastery updated
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 p-5">
            <Button variant="outline" onClick={() => { setResult(null); void refetch(); }} icon={<RotateCcw className="h-4 w-4" />}>
              Retake quiz
            </Button>
            <Link to={`/courses/${data.quiz.course_id}/learn`}>
              <Button icon={<Sparkles className="h-4 w-4" />}>Ask the tutor about misses</Button>
            </Link>
            <Link to="/dashboard">
              <Button variant="ghost">Dashboard</Button>
            </Link>
          </div>
        </Card>

        <div className="space-y-3">
          {result.review.map((item) => (
            <Card key={item.question_id} className="p-4">
              <div className="flex items-start gap-2.5">
                {item.is_correct ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                ) : item.is_correct === null ? (
                  <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 dark:text-white">{item.question_text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {item.topic && <Pill tone="neutral">{item.topic}</Pill>}
                    <span className={cn('text-[11px] font-semibold', item.is_correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                      {item.is_correct ? 'Correct' : item.is_correct === null ? 'Awaiting review' : 'Incorrect'}
                    </span>
                  </div>
                  <div className="mt-2 rounded-lg bg-ink-50 p-2.5 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                    <p className="font-semibold text-ink-800 dark:text-ink-100">{item.feedback}</p>
                    {item.correct_option_texts.length > 0 && !item.is_correct && (
                      <p className="mt-1">Correct answer: {item.correct_option_texts.join(' · ')}</p>
                    )}
                    {item.explanation && (
                      <div className="mt-1.5 border-t border-ink-200 pt-1.5 dark:border-ink-700">
                        <RichText content={item.explanation} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  /* ------------------------------ Instructor ------------------------------ */
  if (data.can_edit) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Link to={`/courses/${data.quiz.course_id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to course
        </Link>
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Pill tone="violet">Instructor preview</Pill>
              <h1 className="mt-2 text-xl font-extrabold text-ink-900 dark:text-white">{data.quiz.title}</h1>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                {questions.length} questions · {data.quiz.is_ai_generated ? 'AI-generated draft' : 'Author-built'}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPreview((value) => !value)} icon={<Eye className="h-3.5 w-3.5" />}>
              {preview ? 'Hide answers' : 'Show answers'}
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {questions.map((question, questionIndex) => (
              <div key={question.id} className="rounded-xl border border-ink-100 p-3.5 dark:border-ink-800">
                <p className="text-xs font-semibold text-ink-900 dark:text-white">{questionIndex + 1}. {question.question_text}</p>
                <div className="mt-2 grid gap-1.5">
                  {question.options.map((option) => (
                    <div key={option.id} className={cn('rounded-lg border px-2.5 py-1.5 text-[11px]', preview && option.is_correct ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-ink-100 text-ink-600 dark:border-ink-800 dark:text-ink-300')}>
                      {option.option_text}
                      {preview && option.is_correct && <span className="ml-1.5 font-bold">· correct</span>}
                    </div>
                  ))}
                </div>
                {preview && question.explanation && <p className="mt-2 text-[10px] text-ink-400">Why: {question.explanation}</p>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  /* -------------------------------- Intro -------------------------------- */
  if (!attemptId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link to={`/courses/${data.quiz.course_id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to course
        </Link>
        <Card className="mt-3 overflow-hidden">
          <div className="bg-gradient-to-br from-violet-600 to-brand-700 p-6 text-white">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur">
              <Target className="h-3 w-3" /> Auto-graded checkpoint
            </span>
            <h1 className="mt-3 text-2xl font-extrabold">{data.quiz.title}</h1>
            <p className="mt-1 text-sm text-white/75">
              {questions.length} questions · untimed · instant feedback with explanations
            </p>
          </div>
          <div className="p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-ink-50 p-3 text-center dark:bg-ink-800">
                <p className="text-xl font-extrabold text-ink-900 dark:text-white">{data.attempts.length}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink-400">Attempts</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-3 text-center dark:bg-ink-800">
                <p className="text-xl font-extrabold text-ink-900 dark:text-white">{data.best_score ? `${Math.round(data.best_score)}%` : '—'}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink-400">Best score</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-3 text-center dark:bg-ink-800">
                <p className="text-xl font-extrabold text-ink-900 dark:text-white">{questions.length}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink-400">Questions</p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              Each attempt updates your per-topic mastery and feeds your study plan. You can retake this quiz as many
              times as you like; the tutor can explain any miss using the cited lecture segment.
            </p>
            <ErrorBanner error={start.error} />
            <Button className="mt-4 w-full" size="lg" loading={start.isPending} onClick={() => start.mutate()}>
              Start attempt <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* -------------------------------- Attempt -------------------------------- */
  const answer = answers[current.id] ?? { selected: [], text: '' };
  const isLast = index === questions.length - 1;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-500 dark:text-ink-400">{data.quiz.title}</p>
        <p className="text-xs font-bold text-ink-700 dark:text-ink-200">{answered}/{questions.length} answered</p>
      </div>
      <ProgressBar value={((index + 1) / questions.length) * 100} className="mb-4" />

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <Pill tone="brand">Question {index + 1} of {questions.length}</Pill>
          <Pill tone="neutral">{current.question_type.replace('_', ' ')}</Pill>
        </div>
        <h2 className="mt-4 text-base font-bold leading-relaxed text-ink-900 dark:text-white">{current.question_text}</h2>
        {current.question_type === 'multi_select' && (
          <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">Select all that apply — partial credit is awarded.</p>
        )}

        <div className="mt-4 space-y-2">
          {current.question_type === 'short_answer' ? (
            <textarea
              value={answer.text}
              onChange={(event) =>
                setAnswers((currentAnswers) => ({
                  ...currentAnswers,
                  [current.id]: { ...answer, text: event.target.value },
                }))
              }
              rows={4}
              placeholder="Type your answer…"
              className="input text-sm"
            />
          ) : (
            current.options.map((option) => {
              const selected = answer.selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => toggleOption(current, option.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors',
                    selected
                      ? 'border-brand-400 bg-brand-50 text-brand-900 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-100'
                      : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800',
                  )}
                >
                  {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-500" /> : <Circle className="h-4 w-4 shrink-0 text-ink-300" />}
                  {option.option_text}
                </button>
              );
            })
          )}
        </div>

        <ErrorBanner error={submit.error} />

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex((value) => value - 1)} icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            Previous
          </Button>
          {isLast ? (
            <Button
              loading={submit.isPending}
              disabled={answered === 0}
              onClick={() => submit.mutate()}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              Submit attempt
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIndex((value) => value + 1)}>
              Next question <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-10 gap-1.5">
        {questions.map((question, questionIndex) => {
          const value = answers[question.id];
          const done = Boolean(value && (value.selected.length || value.text.trim()));
          return (
            <button
              key={question.id}
              onClick={() => setIndex(questionIndex)}
              aria-label={`Go to question ${questionIndex + 1}`}
              className={cn(
                'grid h-7 place-items-center rounded-md text-[10px] font-bold transition-colors',
                questionIndex === index
                  ? 'bg-brand-600 text-white'
                  : done
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                    : 'bg-ink-100 text-ink-500 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-400',
              )}
            >
              {questionIndex + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
