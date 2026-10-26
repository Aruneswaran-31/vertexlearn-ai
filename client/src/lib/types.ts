export type Role = 'student' | 'instructor' | 'admin';

export type User = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  avatar_url: string | null;
  headline: string | null;
  is_active: boolean;
  streak: { current: number; longest: number };
};

export type Course = {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  thumbnail_url: string | null;
  price: number;
  status: string;
  outcomes: string[];
  instructor_id: string;
  instructor_name: string;
  instructor_avatar?: string | null;
  created_at?: string;
  learners: number;
  modules: number;
  lectures: number;
  duration_minutes: number;
  enrolled: boolean;
  progress_percent: number;
};

export type Lecture = {
  id: string;
  title: string;
  video_url: string | null;
  duration_seconds: number;
  order_index: number;
  summary: string | null;
  resource_urls: string[];
  transcript?: string;
  completed: boolean;
  watched_seconds: number;
};

export type QuizSummary = {
  id: string;
  title: string;
  question_count: number;
  is_ai_generated: boolean;
  best_score: number | null;
};

export type Module = {
  id: string;
  title: string;
  order_index: number;
  lectures: Lecture[];
  quizzes: QuizSummary[];
};

export type Source = {
  lecture_id: string;
  lecture_title: string;
  timestamp_seconds: number;
  excerpt: string;
  score: number;
};

export type ChatMessage = {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  sources?: Source[];
  created_at: string;
};

export type StudyPlan = {
  headline: string;
  summary: string;
  average_score: number | null;
  progress_percent: number;
  weak_topics: { topic: string; score: number }[];
  weeks: { week: number; focus: string; tasks: string[] }[];
};
