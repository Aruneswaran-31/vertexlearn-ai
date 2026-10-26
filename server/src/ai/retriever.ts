import { db, newId, nowIso } from '../db/index.js';
import { chunkText } from './chunking.js';
import { cosine, embed, parseVector, serializeVector, tokenize } from './embeddings.js';

export type RetrievedChunk = {
  chunk_id: string;
  lecture_id: string;
  lecture_title: string;
  chunk_index: number;
  text: string;
  score: number;
  lexical: number;
  timestamp_seconds: number;
};

export type Source = {
  lecture_id: string;
  lecture_title: string;
  timestamp_seconds: number;
  excerpt: string;
  score: number;
};

/** Chunk and embed a lecture transcript, replacing any previous chunks. */
export function ingestLecture(lectureId: string): number {
  const lecture = db
    .prepare(
      `SELECT l.*, m.course_id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`,
    )
    .get(lectureId) as
    | { id: string; course_id: string; transcript: string | null }
    | undefined;
  if (!lecture) return 0;

  db.prepare('DELETE FROM document_chunks WHERE lecture_id = ?').run(lectureId);

  const transcript = lecture.transcript?.trim();
  if (!transcript) return 0;

  const insert = db.prepare(
    'INSERT INTO document_chunks (id, course_id, lecture_id, chunk_index, chunk_text, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const chunks = chunkText(transcript);
  db.transaction(() => {
    for (const chunk of chunks) {
      insert.run(
        newId(),
        lecture.course_id,
        lectureId,
        chunk.index,
        chunk.text,
        serializeVector(embed(chunk.text)),
        nowIso(),
      );
    }
  })();
  return chunks.length;
}

export function ingestCourse(courseId: string): number {
  const lectures = db
    .prepare(
      `SELECT l.id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = ?`,
    )
    .all(courseId) as { id: string }[];
  return lectures.reduce((total, lecture) => total + ingestLecture(lecture.id), 0);
}

/**
 * Hybrid retrieval over a single course: cosine similarity from the local
 * embeddings combined with IDF-weighted lexical overlap. The lexical term keeps
 * exact concept names ("sorted input", "precision") from being missed when the
 * vector is diluted by a long passage; zero-overlap matches are demoted so an
 * unrelated question does not look grounded.
 */
export function retrieve(courseId: string, query: string, k = 5): RetrievedChunk[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.lecture_id, c.chunk_index, c.chunk_text, c.embedding, l.title AS lecture_title
       FROM document_chunks c JOIN lectures l ON l.id = c.lecture_id
       WHERE c.course_id = ?`,
    )
    .all(courseId) as {
    id: string;
    lecture_id: string;
    chunk_index: number;
    chunk_text: string;
    embedding: string;
    lecture_title: string;
  }[];

  const queryVector = embed(query);
  const queryTerms = [...new Set(tokenize(query))];
  const totalTerms = Math.max(1, queryTerms.length);

  const documentFrequency = new Map<string, number>();
  const tokenCache = new Map<string, Set<string>>();
  for (const row of rows) {
    const tokens = new Set(tokenize(row.chunk_text));
    tokenCache.set(row.id, tokens);
    for (const term of queryTerms) if (tokens.has(term)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const idf = (term: string) => Math.log(1 + rows.length / Math.max(1, documentFrequency.get(term) ?? 0));
  const totalIdf = queryTerms.reduce((sum, term) => sum + idf(term), 0) || 1;

  return rows
    .map((row) => {
      const tokens = tokenCache.get(row.id)!;
      const lexicalIdf = queryTerms.reduce((sum, term) => sum + (tokens.has(term) ? idf(term) : 0), 0);
      const lexical = Math.round((lexicalIdf / totalIdf) * 10000) / 10000;
      const vector = cosine(queryVector, parseVector(row.embedding));
      const score = lexical > 0 ? vector * 0.72 + lexical * 0.28 : vector * 0.55;
      return {
        chunk_id: row.id,
        lecture_id: row.lecture_id,
        lecture_title: row.lecture_title,
        chunk_index: row.chunk_index,
        text: row.chunk_text,
        lexical,
        score: Math.round(score * 10000) / 10000,
        timestamp_seconds: row.chunk_index * 60,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function toSources(chunks: RetrievedChunk[]): Source[] {
  return chunks.map((chunk) => ({
    lecture_id: chunk.lecture_id,
    lecture_title: chunk.lecture_title,
    timestamp_seconds: chunk.timestamp_seconds,
    excerpt: chunk.text.slice(0, 220),
    score: chunk.score,
  }));
}
