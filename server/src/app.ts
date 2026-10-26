import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authRouter } from './modules/auth.js';
import { coursesRouter } from './modules/courses.js';
import { enrollmentsRouter } from './modules/enrollments.js';
import { assignmentsRouter } from './modules/assignments.js';
import { quizzesRouter } from './modules/quizzes.js';
import { gamificationRouter } from './modules/gamification.js';
import { discussionsRouter } from './modules/discussions.js';
import { adminRouter } from './modules/admin.js';
import { aiRouter } from './modules/ai.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: env.corsOrigin.split(',').map((origin) => origin.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vertexlearn-api', time: new Date().toISOString() });
  });

  const generalLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    scope: 'user',
    message: 'API rate limit reached. Please wait a moment.',
  });

  api.use(generalLimiter);
  api.use('/auth', authRouter);
  api.use(coursesRouter);
  api.use(enrollmentsRouter);
  api.use(assignmentsRouter);
  api.use(quizzesRouter);
  api.use(gamificationRouter);
  api.use(discussionsRouter);
  api.use(aiRouter);
  api.use(adminRouter);

  app.use('/api/v1', api);

  const publicDir = path.join(process.cwd(), 'dist', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
