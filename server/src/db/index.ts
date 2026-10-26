import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../env.js';

const schemaPath = path.join(import.meta.dirname, 'schema.sql');

function openDatabase(): Database.Database {
  if (env.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  }
  const database = new Database(env.dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(fs.readFileSync(schemaPath, 'utf8'));
  return database;
}

export const db = openDatabase();

/** Short UUID-style identifier used across every table. */
export function newId(prefix?: string): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function closeDatabase(): void {
  if (db.open) db.close();
}
