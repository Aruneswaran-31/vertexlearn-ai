/**
 * Local embedding model.
 *
 * The PRD specifies a vector store (pgvector) populated by an embedding model.
 * To keep the demo dependency-free and deterministic, this module implements a
 * hashed bag-of-words vectorizer with sublinear term weighting over unigrams and
 * bigrams. It is a genuine retrieval embedding (cosine similarity in a fixed
 * 512-dimensional space), just not a neural one — swapping in a hosted embedding
 * API only requires replacing `embed()` and keeping the storage contract.
 */

const DIMENSIONS = 512;

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves`.split(
    /\s+/,
  ),
);

export type Vector = number[];

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[.]+|[.]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function hash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function addTerm(vector: Float64Array, term: string, weight: number): void {
  const position = hash(term) % DIMENSIONS;
  const sign = hash(`sign:${term}`) % 2 === 0 ? 1 : -1;
  vector[position] += sign * weight;
}

export function embed(text: string): Vector {
  const tokens = tokenize(text);
  const vector = new Float64Array(DIMENSIONS);
  const counts = new Map<string, number>();

  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, count] of counts) {
    addTerm(vector, token, 1 + Math.log(count));
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    addTerm(vector, `${tokens[i]}_${tokens[i + 1]}`, 0.6);
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;

  return Array.from(vector, (value) => Math.round((value / norm) * 100000) / 100000);
}

export function cosine(a: Vector, b: Vector): number {
  if (!a.length || !b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function serializeVector(vector: Vector): string {
  return JSON.stringify(vector);
}

export function parseVector(value: string): Vector {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
