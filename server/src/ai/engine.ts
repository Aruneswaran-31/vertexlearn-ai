import { db, newId, nowIso } from '../db/index.js';
import { callClaude, aiEngineName } from './llm.js';
import { embed, cosine, tokenize } from './embeddings.js';
import { retrieve, toSources, type RetrievedChunk, type Source } from './retriever.js';

export type ChatMode = 'beginner' | 'intermediate' | 'advanced';
export type AiEngine = 'claude' | 'local';

const MODE_LABEL: Record<ChatMode, string> = {
  beginner: 'Beginner — plain language, short sentences, one concrete example',
  intermediate: 'Intermediate — precise but concise, assumes the course prerequisites',
  advanced: 'Advanced — mechanism, trade-offs and edge cases',
};

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function courseTitle(courseId: string): string {
  const row = db.prepare('SELECT title FROM courses WHERE id = ?').get(courseId) as
    | { title: string }
    | undefined;
  return row?.title ?? 'this course';
}

function technicalTerms(text: string, limit = 24): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.length < 4 || /^\d+$/.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function scoreSentence(sentence: string, queryTokens: Set<string>, keywordWeights: Map<string, number>): number {
  const tokens = tokenize(sentence);
  if (!tokens.length) return 0;
  let overlap = 0;
  for (const token of new Set(tokens)) {
    if (queryTokens.has(token)) overlap += 1;
  }
  const coverage = overlap / Math.max(1, queryTokens.size);
  const salience = tokens.reduce((sum, token) => sum + (keywordWeights.get(token) ?? 0), 0) / tokens.length;
  return coverage * 3 + salience;
}

function deterministicShuffle<T>(items: T[], seedText: string): T[] {
  const seed = [...seedText].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 7);
  const copy = [...items];
  let state = seed || 7;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* AI tutor                                                           */
/* ------------------------------------------------------------------ */

export async function answerQuestion(options: {
  userId: string;
  courseId: string;
  question: string;
  mode: ChatMode;
  history?: { sender: string; content: string }[];
}): Promise<{
  reply: string;
  sources: Source[];
  engine: AiEngine;
  grounded: boolean;
}> {
  const { courseId, question, mode } = options;
  const chunks = retrieve(courseId, question, 6);
  const best = chunks[0];
  // Similarity alone produces false positives on unrelated questions, so also
  // require real term overlap with the matched course passage.
  const grounded = Boolean(best && ((best.lexical >= 0.3 && best.score >= 0.1) || best.score >= 0.32));

  if (!grounded) {
    return {
      reply:
        "I couldn't find that in this course's material, so I won't guess. Try rephrasing with a term from the lectures, or check the module resources. If it's outside the syllabus, ask your instructor to add it to the course notes.",
      sources: [],
      engine: aiEngineName(),
      grounded: false,
    };
  }

  const relevant = chunks.filter((chunk) => chunk.score >= Math.max(0.05, best!.score * 0.55)).slice(0, 4);
  const sources = toSources(relevant);
  const title = courseTitle(courseId);

  const claude = await callClaude({
    system: `You are VertexLearn AI, the tutor embedded in the course "${title}".
You must answer ONLY from the numbered course excerpts provided. Never use outside knowledge.
If the excerpts do not contain the answer, say so and suggest what to review.
Speak at this level: ${MODE_LABEL[mode]}.
Cite every claim with bracketed excerpt numbers like [1] or [2].
Use short paragraphs or bullets. End with one concrete next step from the course material.
Do not invent lecture titles, timestamps or facts.`,
    prompt: `Student question: ${question}

Course excerpts:
${relevant.map((chunk, index) => `[${index + 1}] Lecture "${chunk.lecture_title}" (${formatTimestamp(chunk.timestamp_seconds)}): ${chunk.text}`).join('\n\n')}

Previous conversation (most recent last):
${(options.history ?? [])
  .slice(-4)
  .map((message) => `${message.sender === 'user' ? 'Student' : 'Tutor'}: ${message.content.slice(0, 500)}`)
  .join('\n') || 'None'}`,
    maxTokens: 700,
  });

  if (claude) {
    return { reply: claude.text, sources, engine: 'claude', grounded: true };
  }

  const local = localAnswer(question, chunks, mode, title);
  return { reply: local.reply, sources: local.sources, engine: 'local', grounded: true };
}

function localAnswer(
  question: string,
  chunks: RetrievedChunk[],
  mode: ChatMode,
  title: string,
): { reply: string; sources: Source[] } {
  const corpus = chunks.map((chunk) => chunk.text).join(' ');
  const queryTokens = new Set(tokenize(question));
  const queryList = [...queryTokens].filter((token) => token.length > 2);
  const weights = new Map<string, number>();
  const terms = technicalTerms(corpus, 30);
  terms.forEach((term, index) => weights.set(term, 1 - index / (terms.length * 1.4)));

  type Window = { text: string; chunkIndex: number; score: number; sentences: string[] };
  const windows: Window[] = [];
  const causalQuestion = /\bwhy\b|\breason\b|\bcause\b|\bhow does\b/i.test(question);

  chunks.forEach((chunk, chunkIndex) => {
    const sentences = splitSentences(chunk.text);
    for (let i = 0; i < sentences.length; i += 1) {
      // Avoid starting an answer on an unsupported pronoun like "That happens…".
      if (/^(that|this|it|they|these|those|such)\b/i.test(sentences[i])) continue;
      for (const width of [2, 3]) {
        if (i + width > sentences.length) continue;
        const group = sentences.slice(i, i + width);
        const text = group.join(' ');
        const groupTokens = new Set(tokenize(text));
        const overlap = queryList.filter((token) => groupTokens.has(token)).length;
        const coverage = overlap / Math.max(1, queryList.length);
        const salience =
          group.reduce((sum, sentence) => sum + scoreSentence(sentence, queryTokens, weights), 0) / group.length;
        // "Why" questions need the mechanism sentence, not a definition that
        // merely restates the claim. Mechanism cues therefore outrank generic
        // connectives, and passage relevance never outweighs the sentence itself.
        const mechanism = /happens? when|occurs? when|only when|as soon as|leads? to|causes?|results? in|because|so that|which means|in that case/i.test(text);
        const connective = /because|therefore|since|if |so /i.test(text);
        const causalBoost = causalQuestion ? (mechanism ? 1.1 : connective ? 0.35 : 0) : 0;
        const definitionOnly = /^(we also|we now|we then|we can|they are|there are)\b/i.test(text) ? 0.45 : 0;
        windows.push({
          text,
          chunkIndex,
          score: coverage * 4 + salience + chunk.score * 1.2 + causalBoost - definitionOnly,
          sentences: group,
        });
      }
    }
  });

  const picked: Window[] = [];
  const normalize = (sentence: string) => sentence.slice(0, 60).toLowerCase();
  for (const candidate of windows.sort((a, b) => b.score - a.score)) {
    const overlapsExisting = picked.some((item) => {
      const existing = new Set(item.sentences.map(normalize));
      return candidate.sentences.some((sentence) => existing.has(normalize(sentence)));
    });
    if (overlapsExisting) continue;
    picked.push(candidate);
    if (picked.length === 3) break;
  }

  if (!picked.length) {
    return {
      reply: `The course material on this topic is thin. The closest lecture is "${chunks[0]?.lecture_title ?? title}" — re-watch it and ask me again with a specific term.`,
      sources: [],
    };
  }

  const top = picked[0];
  const topTerms = new Set(tokenize(top.text));
  const support = picked
    .slice(1)
    .filter((item) => {
      if (item.chunkIndex === top.chunkIndex) return true;
      // Only pull in another passage when it adds a query concept the answer lacks.
      return tokenize(item.text).some((token) => queryList.includes(token) && !topTerms.has(token));
    })
    .slice(0, 2);

  const sources: Source[] = [];
  const citationByChunk = new Map<number, number>();
  const cite = (chunkIndex: number): number => {
    const existing = citationByChunk.get(chunkIndex);
    if (existing) return existing;
    const chunk = chunks[chunkIndex];
    sources.push({
      lecture_id: chunk.lecture_id,
      lecture_title: chunk.lecture_title,
      timestamp_seconds: chunk.timestamp_seconds,
      excerpt: chunk.text.slice(0, 220),
      score: chunk.score,
    });
    citationByChunk.set(chunkIndex, sources.length);
    return sources.length;
  };

  const topCitation = cite(top.chunkIndex);
  const bullets = support.map((item) => `- ${item.text} [${cite(item.chunkIndex)}]`).join('\n');
  const supportBlock = bullets ? `\n\n**Supporting detail from the course:**\n${bullets}` : '';
  const topChunk = chunks[top.chunkIndex];
  const nextStep = `*${topChunk.lecture_title}* around ${formatTimestamp(topChunk.timestamp_seconds)}`;

  if (mode === 'beginner') {
    return {
      sources,
      reply: `**In simple terms:** ${top.text} [${topCitation}]${supportBlock}

**Your next step:** re-watch ${nextStep}, then try the module quiz — the questions come from exactly this material.`,
    };
  }

  if (mode === 'advanced') {
    return {
      sources,
      reply: `**Direct answer:** ${top.text} [${topCitation}]${supportBlock}

**Going deeper:** the full derivation is in ${nextStep}. Compare it with the other lectures in the module and check which assumptions each one makes.`,
    };
  }

  return {
    sources,
    reply: `**Answer:** ${top.text} [${topCitation}]${supportBlock}

**In the course:** ${nextStep}. Re-watch that segment, then test yourself with the module quiz.`,
  };
}

/* ------------------------------------------------------------------ */
/* Summaries, quiz drafts, flashcards                                 */
/* ------------------------------------------------------------------ */

export async function summarizeLecture(lectureId: string): Promise<{ summary: string; engine: AiEngine }> {
  const lecture = db
    .prepare(
      `SELECT l.*, m.course_id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`,
    )
    .get(lectureId) as
    | { id: string; title: string; transcript: string | null; course_id: string; summary: string | null }
    | undefined;
  if (!lecture) throw new Error('Lecture not found');

  const transcript = (lecture.transcript ?? '').trim();
  if (transcript.length < 120) {
    const summary = 'This lecture has no transcript yet. Upload or paste a transcript to generate a summary.';
    db.prepare('UPDATE lectures SET summary = ? WHERE id = ?').run(summary, lectureId);
    return { summary, engine: 'local' };
  }

  const sentences = splitSentences(transcript);
  const keywords = technicalTerms(transcript, 20);
  const weights = new Map<string, number>();
  keywords.forEach((term, index) => weights.set(term, 1 - index / (keywords.length * 1.3)));
  const salient = [...sentences]
    .map((sentence, index) => ({
      sentence,
      score: tokenize(sentence).reduce((sum, token) => sum + (weights.get(token) ?? 0), 0) / Math.sqrt(tokenize(sentence).length || 1) + (index < 2 ? 0.4 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.sentence);

  const localSummary = [
    `**Key points**`,
    ...salient.map((sentence) => `- ${sentence}`),
    '',
    `**Terms to know:** ${keywords.slice(0, 8).join(', ')}`,
  ].join('\n');

  const claude = await callClaude({
    system:
      'You summarize lecture transcripts for an LMS. Use only the transcript. Output 5 bullet points of key ideas, then a line "Terms to know:" with 6-8 terms. Be concrete, no preamble.',
    prompt: `Lecture: ${lecture.title}\n\nTranscript:\n${transcript.slice(0, 12000)}`,
    maxTokens: 700,
  });

  const summary = claude?.text ?? localSummary;
  db.prepare('UPDATE lectures SET summary = ? WHERE id = ?').run(summary, lectureId);
  return { summary, engine: claude ? 'claude' : 'local' };
}

export type QuizDraftQuestion = {
  question_text: string;
  question_type: 'mcq';
  explanation: string;
  topic: string;
  options: { option_text: string; is_correct: boolean }[];
};

export async function generateQuizDraft(
  lectureId: string,
  count = 6,
): Promise<{ questions: QuizDraftQuestion[]; engine: AiEngine }> {
  const lecture = db
    .prepare('SELECT * FROM lectures WHERE id = ?')
    .get(lectureId) as { id: string; title: string; transcript: string | null } | undefined;
  if (!lecture) throw new Error('Lecture not found');
  const transcript = (lecture.transcript ?? '').trim();
  if (transcript.length < 200) return { questions: [], engine: 'local' };

  const claude = await callClaude({
    system: `You write multiple-choice quiz drafts for an instructor to review.
Use ONLY the transcript. Return strict JSON: an array of ${count} objects with keys
question_text (string), explanation (string, quote the supporting sentence), topic (short string),
options (array of exactly 4 objects: option_text, is_correct boolean — exactly one true).
No markdown fences, no commentary.`,
    prompt: `Lecture: ${lecture.title}\n\nTranscript:\n${transcript.slice(0, 12000)}`,
    maxTokens: 1800,
    temperature: 0.2,
  });

  if (claude) {
    const parsed = parseQuizJson(claude.text);
    if (parsed.length) return { questions: parsed, engine: 'claude' };
  }

  const sentences = splitSentences(transcript).filter((sentence) => sentence.length > 70);
  const keywords = technicalTerms(transcript, 40);
  const weights = new Map<string, number>();
  keywords.forEach((term, index) => weights.set(term, 1 - index / (keywords.length * 1.5)));

  const candidates = [...sentences]
    .map((sentence) => ({
      sentence,
      score: tokenize(sentence).reduce((sum, token) => sum + (weights.get(token) ?? 0), 0) * (/\b(is|are|means|refers|because|therefore|used|called|defined)\b/i.test(sentence) ? 1.6 : 1),
    }))
    .sort((a, b) => b.score - a.score);

  const questions: QuizDraftQuestion[] = [];
  const usedTerms = new Set<string>();

  for (const candidate of candidates) {
    if (questions.length >= count) break;
    const sentenceTokens = tokenize(candidate.sentence).filter(
      (token) => token.length > 3 && !/^\d+$/.test(token) && !usedTerms.has(token),
    );
    const answer = sentenceTokens.sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0))[0];
    if (!answer) continue;
    const pattern = new RegExp(`\\b${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(candidate.sentence)) continue;

    const blanked = candidate.sentence.replace(pattern, '_____');
    const distractors = keywords.filter((term) => term !== answer && !usedTerms.has(term)).slice(0, 3);
    if (distractors.length < 3) continue;

    const options = deterministicShuffle(
      [
        { option_text: answer, is_correct: true },
        ...distractors.map((term) => ({ option_text: term, is_correct: false })),
      ],
      candidate.sentence,
    );
    usedTerms.add(answer);
    questions.push({
      question_text: `Fill in the blank: ${blanked}`,
      question_type: 'mcq',
      explanation: candidate.sentence,
      topic: answer,
      options,
    });
  }

  return { questions, engine: 'local' };
}

function parseQuizJson(raw: string): QuizDraftQuestion[] {
  try {
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const data = JSON.parse(cleaned);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item) =>
          typeof item?.question_text === 'string' &&
          Array.isArray(item?.options) &&
          item.options.length === 4 &&
          item.options.filter((option: { is_correct?: boolean }) => option.is_correct).length === 1,
      )
      .map((item) => ({
        question_text: String(item.question_text),
        question_type: 'mcq' as const,
        explanation: String(item.explanation ?? ''),
        topic: String(item.topic ?? 'General'),
        options: item.options.map((option: { option_text?: string; is_correct?: boolean }) => ({
          option_text: String(option.option_text ?? ''),
          is_correct: Boolean(option.is_correct),
        })),
      }));
  } catch {
    return [];
  }
}

export async function generateFlashcards(
  moduleId: string,
  count = 8,
): Promise<{ cards: { question: string; answer: string }[]; engine: AiEngine }> {
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId) as
    | { id: string; title: string; course_id: string }
    | undefined;
  if (!module) throw new Error('Module not found');

  const lectures = db
    .prepare('SELECT title, transcript FROM lectures WHERE module_id = ? ORDER BY order_index')
    .all(moduleId) as { title: string; transcript: string | null }[];
  const transcript = lectures.map((lecture) => `${lecture.title}\n${lecture.transcript ?? ''}`).join('\n\n');

  const claude = await callClaude({
    system: `Create spaced-repetition flashcards from this module's material.
Use only the material. Return strict JSON array of {"question","answer"} pairs (${count} max). No markdown.`,
    prompt: transcript.slice(0, 12000),
    maxTokens: 1400,
    temperature: 0.2,
  });

  let cards: { question: string; answer: string }[] = [];
  if (claude) {
    try {
      const cleaned = claude.text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        cards = parsed
          .filter((card) => typeof card?.question === 'string' && typeof card?.answer === 'string')
          .slice(0, count);
      }
    } catch {
      cards = [];
    }
  }

  if (!cards.length) {
    const sentences = splitSentences(
      lectures.map((lecture) => lecture.transcript ?? '').join('\n\n'),
    );
    const patterns = [
      /^(.{3,80}?)\s+(is|are)\s+(.{25,260})$/i,
      /^(.{3,80}?)\s+(refers to|means|describes|measures|represents)\s+(.{20,260})$/i,
    ];
    const skipSubject = /^(if|when|because|so|this|that|these|those|it|there|but|and|in|for|use|always|finally|practical|one|a real-time|report|consider|note|question|the answer|the remaining|the main)\b/i;
    const seen = new Set<string>();

    for (const sentence of sentences) {
      for (const pattern of patterns) {
        const match = sentence.match(pattern);
        if (!match) continue;
        const subject = match[1].trim().replace(/[,;:]$/, '');
        if (subject.split(/\s+/).length > 4 || skipSubject.test(subject) || /^(merging|splitting|using|choosing|taking|adding|making)\b/i.test(subject)) continue;
        const key = subject.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const verb = match[2].toLowerCase() === 'are' ? 'are' : 'is';
        const question =
          subject.split(/\s+/).length > 2
            ? `What does the course mean by "${subject}"?`
            : `What ${verb} ${subject}?`;
        cards.push({ question, answer: `${subject} ${match[2]} ${match[3]}`.trim() });
        break;
      }
      if (cards.length >= count) break;
    }

    if (!cards.length) {
      const keywords = technicalTerms(transcript, 12);
      for (const term of keywords) {
        const sentence = sentences.find((candidate) => new RegExp(`\\b${term}\\b`, 'i').test(candidate));
        if (!sentence) continue;
        cards.push({ question: `What does the course say about ${term}?`, answer: sentence });
        if (cards.length >= count) break;
      }
    }
  }

  db.prepare('DELETE FROM flashcards WHERE module_id = ?').run(moduleId);
  const insert = db.prepare(
    'INSERT INTO flashcards (id, module_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const card of cards) insert.run(newId(), moduleId, card.question, card.answer, nowIso());
  })();

  return { cards, engine: claude ? 'claude' : 'local' };
}

/* ------------------------------------------------------------------ */
/* Mastery, study plan, recommendations                               */
/* ------------------------------------------------------------------ */

export function updateMasteryFromAttempt(attemptId: string): void {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attemptId) as
    | { id: string; user_id: string; quiz_id: string }
    | undefined;
  if (!attempt) return;

  const quiz = db
    .prepare(
      `SELECT q.id, m.course_id FROM quizzes q JOIN modules m ON m.id = q.module_id WHERE q.id = ?`,
    )
    .get(attempt.quiz_id) as { id: string; course_id: string } | undefined;
  if (!quiz) return;

  const rows = db
    .prepare(
      `SELECT qq.topic AS topic, qa.is_correct AS correct
       FROM quiz_answers qa JOIN quiz_questions qq ON qq.id = qa.question_id
       WHERE qa.attempt_id = ?`,
    )
    .all(attemptId) as { topic: string | null; correct: number | null }[];

  const grouped = new Map<string, { correct: number; total: number }>();
  for (const row of rows) {
    const topic = (row.topic ?? 'General').trim() || 'General';
    const bucket = grouped.get(topic) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    bucket.correct += row.correct ? 1 : 0;
    grouped.set(topic, bucket);
  }

  for (const [topic, bucket] of grouped) {
    const score = Math.round((bucket.correct / bucket.total) * 100);
    const existing = db
      .prepare('SELECT id, score FROM topic_mastery WHERE user_id = ? AND course_id = ? AND topic = ?')
      .get(attempt.user_id, quiz.course_id, topic) as { id: string; score: number } | undefined;
    if (existing) {
      // Weighted blend so one bad attempt does not erase earlier mastery.
      const blended = Math.round(existing.score * 0.4 + score * 0.6);
      db.prepare('UPDATE topic_mastery SET score = ?, updated_at = ? WHERE id = ?').run(
        blended,
        nowIso(),
        existing.id,
      );
    } else {
      db.prepare(
        'INSERT INTO topic_mastery (id, user_id, course_id, topic, score, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(newId(), attempt.user_id, quiz.course_id, topic, score, nowIso());
    }
  }
}

export function getMastery(userId: string, courseId: string) {
  return db
    .prepare('SELECT topic, score FROM topic_mastery WHERE user_id = ? AND course_id = ? ORDER BY score ASC')
    .all(userId, courseId) as { topic: string; score: number }[];
}

export async function buildStudyPlan(userId: string, courseId: string) {
  const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(courseId) as
    | { title: string }
    | undefined;
  const mastery = getMastery(userId, courseId);
  const weak = mastery.filter((entry) => entry.score < 70).slice(0, 4);

  const attempts = db
    .prepare(
      `SELECT qa.score, qa.submitted_at, q.title
       FROM quiz_attempts qa
       JOIN quizzes q ON q.id = qa.quiz_id
       JOIN modules m ON m.id = q.module_id
       WHERE qa.user_id = ? AND m.course_id = ? AND qa.submitted_at IS NOT NULL
       ORDER BY qa.submitted_at DESC LIMIT 6`,
    )
    .all(userId, courseId) as { score: number; title: string }[];

  const progress = db
    .prepare('SELECT progress_percent FROM enrollments WHERE user_id = ? AND course_id = ?')
    .get(userId, courseId) as { progress_percent: number } | undefined;

  const nextLectures = db
    .prepare(
      `SELECT l.title, m.title AS module_title FROM lectures l
       JOIN modules m ON m.id = l.module_id
       LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id
       LEFT JOIN enrollments e ON e.id = lp.enrollment_id AND e.user_id = ?
       WHERE m.course_id = ? AND (lp.completed IS NULL OR lp.completed = 0)
       ORDER BY m.order_index, l.order_index LIMIT 4`,
    )
    .all(userId, courseId) as { title: string; module_title: string }[];

  const average = attempts.length
    ? Math.round(attempts.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / attempts.length)
    : null;

  const focusTopics = weak.length
    ? weak.map((entry) => entry.topic)
    : mastery.length
      ? mastery.slice(0, 2).map((entry) => entry.topic)
      : ['course foundations'];

  const weeks = [
    {
      week: 1,
      focus: `Close the gaps: ${focusTopics.slice(0, 2).join(' & ')}`,
      tasks: [
        `Re-watch the lecture segments covering ${focusTopics[0] ?? 'the fundamentals'} and write a 5-line summary in your notes.`,
        nextLectures[0]
          ? `Complete "${nextLectures[0].title}" (${nextLectures[0].module_title}) and mark it complete.`
          : 'Review your notes for the first module and mark any gaps.',
        'Ask the AI tutor one "why" question per weak topic and read the cited lecture segment.',
      ],
    },
    {
      week: 2,
      focus: 'Practice and retrieval',
      tasks: [
        weak.length
          ? `Retake the quiz for ${weak[0].topic} and target 80%+.`
          : 'Attempt every published module quiz once without notes.',
        nextLectures[1]
          ? `Study "${nextLectures[1].title}" and add two timestamped bookmarks.`
          : 'Revise the highest-weight lecture in the course.',
        'Generate flashcards for the weakest module and review them twice this week.',
      ],
    },
    {
      week: 3,
      focus: 'Apply what you know',
      tasks: [
        'Submit the next assignment using the rubric as a checklist.',
        nextLectures[2]
          ? `Finish "${nextLectures[2].title}" and connect it to what you learned in week 1.`
          : 'Write a one-page explanation of the course’s core idea in your own words.',
        'Ask the AI tutor for an advanced-level explanation of your weakest topic.',
      ],
    },
    {
      week: 4,
      focus: 'Consolidate and finish',
      tasks: [
        nextLectures[3]
          ? `Complete "${nextLectures[3].title}" to push course progress past ${Math.min(
              100,
              Math.round((progress?.progress_percent ?? 0) + 15),
            )}%.`
          : 'Complete any remaining lectures and resources.',
        'Retake every quiz; aim for a personal best on the weakest module.',
        'Download your certificate once progress reaches 100%.',
      ],
    },
  ];

  const summary = `You are ${progress?.progress_percent ?? 0}% through ${course?.title ?? 'this course'}${
    average !== null ? ` with an average quiz score of ${average}%` : ''
  }. ${
    weak.length
      ? `The plan front-loads ${weak.map((entry) => entry.topic).join(', ')} because those topics are below 70% mastery.`
      : 'No weak topics detected yet — attempt a quiz so the plan can adapt to your results.'
  }`;

  const plan = {
    headline: `Personalised 4-week plan for ${course?.title ?? 'your course'}`,
    summary,
    average_score: average,
    progress_percent: progress?.progress_percent ?? 0,
    weak_topics: weak,
    weeks,
  };

  db.prepare('DELETE FROM study_plans WHERE user_id = ? AND course_id = ?').run(userId, courseId);
  db.prepare(
    'INSERT INTO study_plans (id, user_id, course_id, plan_json, generated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(newId(), userId, courseId, JSON.stringify(plan), nowIso());

  return { plan, engine: 'local' as AiEngine };
}

export function refreshRecommendations(userId: string) {
  const enrolled = db
    .prepare(
      `SELECT c.id, c.title, c.category FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ?`,
    )
    .all(userId) as { id: string; title: string; category: string | null }[];

  const completed = db
    .prepare(
      `SELECT c.id, c.title FROM certificates ct JOIN courses c ON c.id = ct.course_id WHERE ct.user_id = ?`,
    )
    .all(userId) as { id: string; title: string }[];

  const enrolledIds = new Set(enrolled.map((course) => course.id));
  const anchorText = enrolled.length
    ? enrolled.map((course) => `${course.title} ${course.category ?? ''}`).join(' ')
    : completed.map((course) => course.title).join(' ');
  const anchorVector = embed(anchorText || 'programming computer science foundations');

  const enrolledList = [...enrolledIds];
  const exclusion = enrolledList.length
    ? `AND id NOT IN (${enrolledList.map(() => '?').join(',')})`
    : '';
  const catalog = db
    .prepare(`SELECT * FROM courses WHERE status = 'approved' ${exclusion}`)
    .all(...enrolledList) as {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    difficulty: string | null;
  }[];

  const scored = catalog
    .map((course) => {
      const similarity = cosine(
        anchorVector,
        embed(`${course.title} ${course.category ?? ''} ${course.description ?? ''}`),
      );
      const learners = db
        .prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ?')
        .get(course.id) as { count: number };
      const popularity = Math.min(learners.count, 20) / 20;
      const score = Math.round((55 + similarity * 35 + popularity * 10) * 10) / 10;
      const sameCategory = enrolled.some((item) => item.category && item.category === course.category);
      const reason = completed.length
        ? `Builds on ${completed[0].title} and matches your interests`
        : sameCategory
          ? `Matches the ${course.category} track you are already studying`
          : 'A strong next step to broaden your skill set';
      return { course, score, reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  db.prepare('DELETE FROM recommendations WHERE user_id = ?').run(userId);
  const insert = db.prepare(
    'INSERT INTO recommendations (id, user_id, recommended_course_id, reason, score, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const item of scored) {
      // Only surface plausible matches; a weak similarity is a bad recommendation.
      if (item.score <= 0) continue;
      insert.run(newId(), userId, item.course.id, item.reason, item.score, nowIso());
    }
  })();

  return db
    .prepare(
      `SELECT r.id, r.reason, r.score, c.id AS course_id, c.title, c.category, c.difficulty, c.thumbnail_url
       FROM recommendations r JOIN courses c ON c.id = r.recommended_course_id
       WHERE r.user_id = ? ORDER BY r.score DESC LIMIT 3`,
    )
    .all(userId);
}

export function localEngineLabel(): AiEngine {
  return aiEngineName();
}
