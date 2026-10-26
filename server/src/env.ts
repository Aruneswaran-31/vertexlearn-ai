import 'dotenv/config';
import path from 'node:path';

const root = process.cwd();

const configuredPort = Number(process.env.PORT);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4000,
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'vertexlearn.sqlite'),
  jwtSecret: process.env.JWT_SECRET ?? 'vertexlearn-dev-secret-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '30m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  seedDemoData: process.env.SEED_DEMO_DATA !== 'false',
};

export const isProduction = env.nodeEnv === 'production';
