import { createApp } from './app.js';
import { db, closeDatabase } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { ensureBadgeCatalog } from './services/activity.js';
import { env } from './env.js';

ensureBadgeCatalog();

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
if (env.seedDemoData && userCount.count === 0) {
  console.log('[vertexlearn] empty database detected — seeding demo data');
  const result = seedIfEmpty();
  console.log(`[vertexlearn] seeded ${result.users} users, ${result.courses} courses, ${result.chunks} indexed chunks`);
}

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[vertexlearn] API listening on http://localhost:${env.port}`);
  console.log(`[vertexlearn] AI engine: ${env.anthropicApiKey ? `Claude (${env.anthropicModel})` : 'local grounded retrieval'}`);
});

function shutdown(signal: string) {
  console.log(`[vertexlearn] ${signal} received, shutting down`);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
