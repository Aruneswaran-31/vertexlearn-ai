# Architecture

VertexLearn AI is a single-repository full-stack application. The browser talks to one Express API over JSON; the API owns authentication, the LMS domain, the retrieval-augmented AI engine and PDF generation, and persists everything in SQLite.

```
┌─────────────────────────────────────────────────────────────────────┐
│ React 18 SPA                                                        │
│ Vite · TypeScript · Tailwind · TanStack Query · Recharts · Router   │
│ Student / Instructor / Admin workspaces, AI tutor panel             │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ /api/v1 · JWT bearer · JSON
┌─────────────────────────────────▼───────────────────────────────────┐
│ Express 4 API                                                       │
│  middleware: CORS → rate limit → JWT auth → RBAC → Zod → errors     │
│                                                                     │
│  modules/         auth · courses · enrollments · assignments        │
│                   quizzes · gamification · discussions · admin     │
│  ai/              chunking · embeddings · hybrid retriever          │
│                   engine (tutor, summary, quiz draft, plan)         │
│                   llm (optional Anthropic Claude)                   │
│  services/        activity (streak/badges/certificates) · PDF       │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ better-sqlite3 (synchronous, WAL)
┌─────────────────────────────────▼───────────────────────────────────┐
│ SQLite · 33 tables mirroring the PRD entity model                   │
│ users, roles, courses, modules, lectures, enrollments, progress,    │
│ notes, bookmarks, assignments, submissions, quizzes, attempts,      │
│ answers, certificates, badges, streaks, chat, document_chunks,      │
│ study_plans, flashcards, recommendations, topic_mastery, threads,   │
│ posts, announcements, notifications, approvals, payments, audit     │
└─────────────────────────────────────────────────────────────────────┘
```

## Runtime boundaries

| Concern | Owner | Notes |
| --- | --- | --- |
| Session | `middleware/auth.ts` | 30-minute access JWT, 7-day refresh token stored as a SHA-256 hash and rotated on use |
| Authorisation | `requireRole`, `requireExactRole`, `assertCourseAccess` | Role gates per route; ownership checked again in the service layer |
| Validation | Zod schemas in each module | Returns the PRD's error envelope with the offending field |
| Rate limits | `middleware/rateLimit.ts` | Auth 10/min/IP, AI chat 20/min/user, general 300/min; fixed window in memory |
| Progress | `services/activity.ts` | Lecture completion → recompute percentage → certificate at 100% |
| AI | `ai/engine.ts` | Never writes outside its course scope; cites retrieved chunks |

## Request flows

### 1. Enrollment and learning loop

1. `POST /courses/:id/enroll` verifies the course is approved and not owned by the caller, creates one enrollment (unique constraint handles retries) and a notification.
2. The player fetches `GET /courses/:id`, which returns modules, lectures, per-lecture progress and quiz best scores for the current learner.
3. Playback reports `POST /lectures/:id/progress` with watched seconds / completion. The service upserts `lecture_progress`, touches the daily streak, awards **First Steps** on the first completion and recalculates the enrollment percentage.
4. When the percentage reaches 100, `issueCertificateIfComplete` inserts a certificate row, notifies the learner, awards **Course Finisher** and the learner can download a generated PDF.
5. Instructors see the aggregates through `GET /courses/:id/analytics`.

### 2. AI tutor question

```
POST /ai/chat/sessions/:id/messages
  ├─ session ownership + enrollment check
  ├─ store the learner message
  ├─ retrieve(courseId, question)
  │    ├─ load all chunks for the course
  │    ├─ vector cosine + IDF lexical overlap → blended score
  │    └─ top 6 passages with lecture title and approximate timestamp
  ├─ grounding gate (lexical overlap ≥ 0.3 and score ≥ 0.1, or score ≥ 0.32)
  │    └─ fails → refuse, no sources
  ├─ generation
  │    ├─ Claude available → grounded prompt with numbered excerpts, citations required
  │    └─ otherwise → local window scoring (2–3 sentences, coverage + salience + causal markers)
  ├─ store AI message with source lecture ids
  └─ touch streak, award "Curious Mind" at ten questions
```

**Why hybrid retrieval?** A 512-dimension hashed bag-of-words vector captures topical similarity but dilutes exact terms in long passages. Blending in IDF-weighted term overlap makes questions like “why does quicksort degrade on sorted input” land on the specific paragraph rather than the lecture's opening definition. Windows then fix the second problem: single-sentence answers lose the causal chain.

**Grounding:** the tutor is deliberately conservative. Asking about sourdough in a DSA course returns a refusal with zero sources; a paraphrased question containing no course vocabulary may also be refused. This is preferable to a confident hallucination and matches the PRD's “grounded only in that course's material” requirement.

### 3. Quiz auto-grading

```
POST /quizzes/:id/attempt      → creates attempt (started_at)
POST /attempts/:id/submit      → validates ownership and single submission
  ├─ MCQ        exact selected option
  ├─ multi      partial credit: (correct selected − incorrect selected) / correct count
  ├─ short      token overlap against expected_answer ≥ 0.6; otherwise instructor review
  ├─ writes quiz_answers with per-question feedback
  ├─ score = earned / graded × 100 (ungraded short answers excluded)
  ├─ updateMasteryFromAttempt → per-topic blended mastery (40% old / 60% new)
  └─ 100% → Perfect Score badge; < 50% → notification
```

Correct options are never serialised to a learner before submission; the instructor preview is the only route that exposes them.

### 4. Study plan and recommendations

- **Study plan** is rule-based and deterministic: weak topics (mastery < 70), recent attempts, current progress and the next incomplete lectures feed a four-week schedule. Generating a plan persists it; learners can regenerate at any time.
- **Recommendations** embed the titles/categories of enrolled and completed courses, score every approved course not already enrolled by similarity plus popularity, persist the top three with a human-readable reason, and return them on the dashboard.

### 5. Admin governance

Course creation defaults to `pending`. Admins read the queue, inspect the public preview, then approve or reject with a comment. Approval writes `course_approvals`, flips `courses.status`, notifies the instructor and logs an audit entry. Role changes replace `user_roles` atomically; suspending sets `users.is_active`, which the auth middleware checks on every request.

## Data model

```
users ─┬─ user_roles ── roles
       ├─ refresh_tokens
       ├─ streaks, user_badges ── badges
       ├─ enrollments ── courses ── modules ── lectures
       │        └─ lecture_progress        └─ quizzes ── questions ── options
       ├─ notes, bookmarks                 └─ attempts ── answers
       ├─ assignment_submissions ── assignments
       ├─ certificates, study_plans, recommendations, topic_mastery
       ├─ ai_chat_sessions ── ai_chat_messages
       └─ notifications
courses ── document_chunks (course-scoped retrieval index)
courses ── discussion_threads ── discussion_posts
courses ── announcements, course_approvals, payments
audit_logs
```

Indexes cover every foreign key used in list queries plus `courses.status`, `notifications(user_id, is_read)` and `document_chunks(course_id)`.

The full DDL is in [server/src/db/schema.sql](../server/src/db/schema.sql). It intentionally mirrors the PRD's PostgreSQL definitions: UUID-style text primary keys, timestamp text columns, JSON-encoded arrays and rubrics, and vector embeddings stored as JSON arrays because SQLite has no `pgvector`.

## Security posture

- bcrypt password hashing (cost 10), generic login failure messages, suspended accounts rejected in middleware
- Access and refresh tokens are separate types; refresh rotation revokes the previous hash
- Every mutation validates input with Zod and re-checks resource ownership
- Correct quiz answers, other learners' notes, submissions and certificates are not exposed
- AI retrieval is filtered by `course_id` and requires enrollment (or staff access)
- Rate limits on authentication, AI endpoints and the API generally
- Standard error envelope avoids leaking stack traces; unhandled errors are logged server-side

Known demo limitations: SQLite has no encryption at rest, secrets live in `.env`, and the rate limiter is per process.

## Scaling path back to the PRD topology

| Step | Change |
| --- | --- |
| Multiple API instances | Move rate limits/refresh revocation to Redis; run behind a load balancer |
| More content | Move embeddings to pgvector or a vector store; batch ingestion in a job queue |
| Media | Upload to S3, transcode to HLS, serve through a CDN; keep the progress endpoint |
| AI isolation | Extract `ai/` into the FastAPI service from the PRD; it already has clean inputs (question, course id, mode) and outputs (reply, sources, engine) |
| Analytics | Add read replicas and materialised aggregates for course/platform dashboards |
| Jobs | BullMQ workers for certificate generation, recommendation refresh, streak evaluation and notification email |

The module boundaries were kept close to the PRD's `modules/` layout specifically so these moves do not require a rewrite.
