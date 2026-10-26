export type Chunk = { text: string; index: number };

/**
 * Split a lecture transcript into overlapping, sentence-aligned chunks suitable
 * for embedding. Chunks are roughly 700 characters with ~120 characters of
 * overlap so a concept that straddles a boundary is still retrievable.
 */
export function chunkText(input: string, targetSize = 700, overlap = 120): Chunk[] {
  const text = input.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!text) return [];

  const sentences = text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let length = 0;

  const flush = () => {
    if (!buffer.length) return;
    chunks.push({ text: buffer.join(' ').trim(), index: chunks.length });
    // keep a tail of the buffer for overlap
    let tail = '';
    while (buffer.length && tail.length < overlap) {
      tail = `${buffer.pop() ?? ''} ${tail}`.trim();
    }
    buffer = tail ? [tail] : [];
    length = tail.length;
  };

  for (const sentence of sentences) {
    if (length + sentence.length > targetSize && buffer.length > 0) {
      flush();
      if (buffer.length === 0) length = 0;
    }
    buffer.push(sentence);
    length += sentence.length + 1;
  }

  if (buffer.length && buffer.join(' ').trim()) {
    chunks.push({ text: buffer.join(' ').trim(), index: chunks.length });
  }

  return chunks.filter((chunk) => chunk.text.length > 40);
}

/** Rough timestamp for a chunk, assuming ~150 spoken words per minute. */
export function chunkTimestamp(chunkIndex: number): number {
  return chunkIndex * 60;
}
