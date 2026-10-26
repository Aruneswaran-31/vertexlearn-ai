import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Compass, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import type { Course } from '../lib/types';
import CourseCard from '../components/CourseCard';
import { Button, EmptyState, ErrorBanner, PageHeader, Select, Spinner, TextInput } from '../lib/ui';

type CatalogResponse = {
  courses: Course[];
  categories: string[];
  pagination: { page: number; pages: number; total: number };
};

export default function Catalog() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, category, difficulty, sort]);

  const params = new URLSearchParams({ page: String(page), limit: '9', sort });
  if (debounced) params.set('q', debounced);
  if (category) params.set('category', category);
  if (difficulty) params.set('difficulty', difficulty);

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalog', params.toString()],
    queryFn: () => api.get<CatalogResponse>(`/courses?${params.toString()}`),
  });

  return (
    <div>
      <PageHeader
        title="Course catalog"
        subtitle="Every course is taught by a vetted instructor and approved by the platform team. Filter by category, level or search a topic."
      />

      <div className="card mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search courses, topics or categories"
              className="pl-9"
              aria-label="Search courses"
            />
          </div>
          <Select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
            options={[
              { value: '', label: 'All categories' },
              ...(data?.categories ?? []).map((item) => ({ value: item, label: item })),
            ]}
          />
          <Select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
            aria-label="Filter by difficulty"
            options={[
              { value: '', label: 'Any level' },
              { value: 'beginner', label: 'Beginner' },
              { value: 'intermediate', label: 'Intermediate' },
              { value: 'advanced', label: 'Advanced' },
            ]}
          />
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort courses"
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'popular', label: 'Most learners' },
              { value: 'title', label: 'A → Z' },
            ]}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {data ? `${data.pagination.total} course${data.pagination.total === 1 ? '' : 's'}` : 'Loading courses'} · all levels · certificate on completion
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <Spinner label="Loading catalog" />
      ) : data?.courses.length ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
          {data.pagination.pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <span className="px-2 text-xs font-semibold text-ink-500 dark:text-ink-400">
                Page {page} of {data.pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === data.pagination.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Compass className="h-6 w-6" />}
          title="No courses match those filters"
          message="Try a different category or clear the search to see everything on the platform."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setCategory('');
                setDifficulty('');
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}
    </div>
  );
}
