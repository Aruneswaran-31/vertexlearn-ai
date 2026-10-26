import { Link } from 'react-router-dom';
import { BookOpen, Clock, Star, Users } from 'lucide-react';
import type { Course } from '../lib/types';
import { Pill, ProgressBar } from '../lib/ui';

export default function CourseCard({ course }: { course: Course }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      className="card group flex flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-brand-500 to-violet-600">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt=""
            className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-white/70">
            <BookOpen className="h-10 w-10" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/80 to-transparent p-3">
          <div className="flex items-center justify-between">
            <Pill tone="brand" className="border-white/20 bg-white/15 text-white backdrop-blur">
              {course.category}
            </Pill>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold capitalize text-white backdrop-blur">
              {course.difficulty}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug text-ink-900 dark:text-white">{course.title}</h3>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">by {course.instructor_name}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500 dark:text-ink-400">
          <span className="inline-flex items-center gap-1">
            <BookOpen className="h-3 w-3" /> {course.lectures} lectures
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {course.duration_minutes} min
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {course.learners}
          </span>
        </div>

        <div className="mt-3 flex-1" />

        {course.enrolled ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
              <span className="text-emerald-600 dark:text-emerald-400">Enrolled</span>
              <span className="text-ink-500 dark:text-ink-400">{Math.round(course.progress_percent)}% complete</span>
            </div>
            <ProgressBar value={course.progress_percent} />
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500 dark:text-ink-400">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {course.learners > 0 ? '4.8' : 'New'}
            </span>
            <span className="text-sm font-bold text-ink-900 dark:text-white">
              {course.price > 0 ? `$${course.price.toFixed(0)}` : 'Free'}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
