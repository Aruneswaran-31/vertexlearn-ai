# VertexLearn AI

An AI-augmented learning platform built from the **LMS-AI product requirements document** (Vertexon Learning Technologies). Students learn, get instant course-grounded answers, and are auto-graded; instructors author content and see who is falling behind; admins govern courses, roles and moderation.

The whole product runs as one repository with `npm install && npm run dev` — no Docker, no external database, no API key required.

---

## What is implemented

**Student workspace**

- Email/password auth with JWT access + rotating refresh tokens
- Dashboard with progress, streaks, due assignments, recent scores, badges and recommendations
- Filterable course catalog (search, category, difficulty, sort, pagination)
- Course player with per-lecture progress, resume position, transcript, resources
- Timestamped notes and bookmarks
- AI tutor scoped to the current course, with beginner / intermediate / advanced modes and lecture + timestamp citations
- Lecture summaries and module flashcards generated from transcripts
- Personalised 4-week study plan derived from quiz mastery and progress
- Auto-graded quizzes (MCQ, multi-select with partial credit, short answer by concept overlap) with explanations on review
- Assignments with rubrics, submissions, grading and feedback
- Badges, streak tracking, leaderboard and a real downloadable PDF certificate at 100% completion

**Instructor workspace**

- Course authoring: create course, modules, lectures, transcripts, assignments, announcements
- Transcript ingestion that chunks and embeds material for retrieval
- AI quiz drafts generated per lecture, reviewed question-by-question before publishing
- Lecture summaries
- Analytics per course: learners, completion rate, average quiz score, per-lecture drop-off, topic mastery
- **At-risk student alerts** driven by progress, quiz average and inactivity
- Submission grading with rubric

**Admin console**

- Platform metrics: users, DAU, enrollments, completion rate, revenue, AI usage, quiz averages
- Enrollment trend chart, popular courses, audit trail
- User management: search, role assignment, suspend/restore
- Course approval queue with approve/reject and reviewer comments
- Moderation of reported discussion posts

**Platform**

- Role-based access control (student / instructor / admin) enforced by middleware plus ownership checks
- Threaded per-course discussions with reporting
- In-app notifications
- Dark mode, accessible focus states, keyboard-friendly forms
- Rate limits matching the PRD (auth 10/min/IP, AI chat 20/min/user, API 300/min)
- Standard error envelope, input validation with Zod, SQLite schema mirroring the PRD entity model
- 25 integration tests, CI workflow, production build

---

## Quick start

Requirements: **Node.js 20+**.

```bash
npm install
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000/api/v1>
- Health: <http://localhost:4000/api/v1/health>

On first run the database is created at `data/vertexlearn.sqlite` and seeded automatically with 8 users, 4 courses (3 approved, 1 pending), graded attempts, discussions and a certificate.

### Demo accounts

Password for every seeded account: **`Demo@12345`**

| Role | Email | What to look at |
| --- | --- | --- |
| Student | `student@vertexlearn.ai` | Dashboard, DSA course player, AI tutor, study plan, certificate |
| Instructor | `instructor@vertexlearn.ai` | Teaching hub → DSA course → Analytics, AI quiz drafts |
| Admin | `admin@vertexlearn.ai` | Platform metrics, users, the pending course approval |

The sign-in page also has one-click demo buttons for each role.

### Useful commands

```bash
npm run dev            # API + Vite dev server (concurrently)
npm run dev:api        # API only, with watch
npm run dev:web        # Vite only
npm run seed           # seed only if the database is empty
npm test               # 25 integration tests (in-memory DB)
npm run typecheck      # server + client TypeScript
npm run build          # compile server, build SPA into dist/
npm start              # run the built app on http://localhost:4000
```

To reset the demo: stop the server, delete `data/`, and run `npm run seed`.

---

## How the AI tutor works

The PRD calls for retrieval-augmented generation over each course's own material. This build implements the full pipeline locally and can hand generation to Claude when a key exists.

1. **Ingestion** — when a lecture transcript is saved, it is split into overlapping sentence-aligned chunks (~700 characters).
2. **Embedding** — each chunk is embedded into a 512-dimensional vector using a deterministic hashed bag-of-words model over unigrams and bigrams, with sublinear term weighting and L2 normalisation. This keeps retrieval dependency-free and reproducible.
3. **Hybrid retrieval** — a question is scored against every chunk in *that course only* using cosine similarity **plus** IDF-weighted lexical overlap. Blending both keeps exact concept names from being missed in long passages.
4. **Grounding gate** — if the best passage has no meaningful term overlap (or too low a similarity), the tutor refuses instead of guessing. This is what stops the demo from answering a sourdough question with a linked-list answer.
5. **Answer construction** — windows of 2–3 consecutive sentences are scored for query coverage, saliency and causal markers ("because", "happens when"). The best window becomes the answer, with lecture and timestamp citations. Modes change framing: beginner adds plain-language framing and a next step, advanced adds mechanism/edge-case language.
6. **Optional Claude** — set `ANTHROPIC_API_KEY` and generation calls `claude-sonnet-4-6` with the retrieved excerpts, strict grounding instructions and citation requirements. If the call fails or the key is missing, the local engine answers instead. Summaries, quiz drafts and flashcards use the same optional path.

Per-topic mastery is updated from graded quiz answers and feeds study plans, difficulty and instructor analytics.

**Where citations come from:** each source is a real chunk of the lecture transcript. The timestamp shown is derived from the chunk's position in the lecture (60s per chunk); with real video, replace the simulated player's timer with an HLS player and store exact transcript offsets.

---

## Architecture

```
React 18 SPA (Vite, TypeScript, Tailwind, TanStack Query, Recharts)
        │  /api/v1 (JSON, JWT bearer)
        ▼
Express 4 API ── auth + RBAC + rate limits + Zod validation
        ├── LMS modules: courses, enrollments, progress, notes,
        │   assignments, quizzes/auto-grading, gamification,
        │   discussions, notifications, admin
        ├── AI engine: chunking → embeddings → hybrid retrieval →
        │   grounded answer / summaries / quiz drafts / plans
        └── PDF certificates (pdf-lib)
        ▼
SQLite (better-sqlite3) — 33 tables mirroring the PRD schema
```

See [docs/architecture.md](docs/architecture.md) for request flows, the data model and the scaling path back to the PRD's Postgres + pgvector + Redis topology.

### Repository layout

```
client/                 React SPA
  src/components/       AppShell, course cards, shared UI
  src/pages/            Landing, auth, student, instructor, admin
  src/lib/              API client, auth/theme contexts, types, UI kit
server/src/
  modules/              REST route modules (auth, courses, ai, admin, …)
  ai/                   chunking, embeddings, hybrid retriever, engine, Claude client
  services/             activity (streaks/badges/certificates), PDF rendering
  middleware/           auth/RBAC, errors, rate limits
  db/                   schema.sql, connection, seed data
tests/                  Vitest + Supertest integration suite
docs/                   PRD, architecture, OpenAPI spec
.github/workflows/ci.yml
```

---

## API surface

Base URL `/api/v1`. Everything except auth and the public catalog requires `Authorization: Bearer <access_token>`.

| Group | Endpoints |
| --- | --- |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Courses | `GET /courses`, `GET /courses/:id`, `POST /courses`, `PUT /courses/:id`, `POST /courses/:id/modules`, `POST /modules/:id/lectures`, `PUT /lectures/:id`, `POST /courses/:id/approve`, `GET /courses/:id/analytics`, `/roster`, `/leaderboard`, `POST /courses/:id/announcements` |
| Learning | `POST /courses/:id/enroll`, `GET /enrollments/me`, `POST /lectures/:id/progress`, notes and bookmarks CRUD |
| Assignments | `POST /assignments`, `GET /assignments/:id`, `POST /assignments/:id/submit`, `GET /assignments/:id/submissions`, `PUT /submissions/:id/grade` |
| Quizzes | `POST /quizzes`, `GET /quizzes/:id`, `POST /quizzes/:id/attempt`, `POST /attempts/:id/submit`, `GET /attempts/:id`, `GET /quiz-attempts/me` |
| AI | `POST /ai/chat/sessions`, `POST /ai/chat/sessions/:id/messages`, `PUT …/mode`, `POST /ai/lectures/:id/summarize`, `POST /ai/lectures/:id/generate-quiz`, `GET/POST /ai/modules/:id/flashcards`, `POST /ai/study-plan`, `GET /ai/study-plan/:courseId`, `GET /ai/status` |
| Gamification | `GET /users/me/badges`, `/users/me/streak`, `/recommendations/me`, `/certificates/me`, `/certificates/:id/download` |
| Discussions | `GET/POST /courses/:id/threads`, `GET /threads/:id`, `POST /threads/:id/posts`, `POST /posts/:id/flag` |
| Admin | `GET /admin/users`, `PUT /admin/users/:id/role`, `/admin/users/:id/suspend`, `GET /admin/courses/pending`, `/admin/analytics/overview`, `/admin/moderation/flagged-posts`, `PUT /admin/moderation/posts/:id` |

Full spec: [docs/api-spec.yaml](docs/api-spec.yaml).

**Error format**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "email must be a valid email address", "field": "email" } }
```

---

## Tests

```bash
npm test
```

The suite runs against a fresh in-memory database seeded with the demo dataset and covers:

- Public catalog only exposes approved courses; bad credentials; protected routes; student blocked from admin
- Correct answers are hidden from learners before submitting
- Enrollment idempotency, progress recalculation, notes and bookmarks
- Tutor grounding on-topic, refusal off-topic, summaries, flashcards, study plans
- Instructor-only AI quiz drafts with four options and exactly one correct answer
- Perfect auto-graded attempt, mastery update, duplicate submission rejection, quiz payload validation
- Certificate PDF download (`%PDF-` header), badges/streak/recommendations
- At-risk analytics and ownership checks
- Discussion reporting and admin moderation
- Admin course approval becomes publicly visible; role updates

Type checks and production builds run in CI alongside the tests.

---

## Configuration

Copy `.env.example` to `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `DB_PATH` | `data/vertexlearn.sqlite` | SQLite file (`:memory:` supported) |
| `JWT_SECRET` | dev fallback | **Set a real secret in production** |
| `ACCESS_TOKEN_TTL` | `30m` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh token lifetime |
| `ANTHROPIC_API_KEY` | — | Optional; enables Claude generation |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Optional model override |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `SEED_DEMO_DATA` | `true` | Seed when the database is empty |

In development Vite proxies `/api` to port 4000. In production Express serves the built SPA from `dist/public`.

---

## Scope and deliberate deviations from the PRD

The PRD specifies a four-week, three-service build (Express + FastAPI + PostgreSQL/pgvector + Redis + S3 + Docker). This repository is a **single deployable implementation** that preserves the product behaviour and data model while staying runnable anywhere:

| PRD | This build | Why |
| --- | --- | --- |
| Node LMS service + Python FastAPI AI service | One Express service with an `ai/` module | Same boundaries in-process; no second runtime to deploy for a demo |
| PostgreSQL + pgvector | SQLite with vectors stored as JSON arrays | Zero-setup, runs in constrained environments; schema mirrors the PRD tables |
| Managed embedding model | Deterministic hashed embeddings + hybrid lexical retrieval | No API key or model hosting needed; swap `embed()` to upgrade |
| Redis cache/queue | In-process fixed-window rate limits, synchronous work | Single node; BullMQ/Celery jobs are the scale-out path |
| S3 + HLS video | Transcript-driven player that reports progress through the same API | No media hosting in the demo; player is the integration point |
| Payment gateway | Seeded payment records and revenue metrics | Explicitly out of scope in the PRD (§3.2) |
| AI plagiarism detection | Not implemented | PRD future enhancement |

Not production-hardened: use a managed database, a shared rate-limit store, secrets management, HTTPS, backups and an object store before real deployment.

---

## Roadmap (from PRD §15)

Live classes and whiteboards · peer study rooms · AI plagiarism detection · subscription billing and instructor payouts · native mobile apps · offline sync · full i18n including AI replies · cohort analytics and predictive at-risk flagging · marketplace features · adaptive module ordering · voice tutor · SSO/SAML.

---

## Docs

- [Product requirements (source PRD)](docs/prd.md)
- [Architecture and request flows](docs/architecture.md)
- [OpenAPI 3.0 spec](docs/api-spec.yaml)
