import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson, writeJsonAtomic } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { loginRetryAfter, recordLoginFailure, tooManyAttemptsMessage } from '@/lib/security/rate-limit';
import { ApiError } from '@/lib/workout/api';
import { addDays, isDateKey, type DateKey } from '@/lib/habits/dates';
import { scoreAttempt, type Attempt } from './progress';
import { gradeQuestion, revealedQuestion } from './grade';
import { generatedQuestion } from './generated';
import type { AnalysisAttempt } from './analysis';
import type { DailyDay, Formula, PracticeSet, Question } from './types';

// Daily questions on disk, all under .data/daily (kept by backups):
//   days/YYYY-MM-DD.json   one day each, uploaded ahead of time
//   practice.json          practice-only questions (not tied to a day)
//   attempts/<user>.json   each user's answers
//   feedback.json          ratings and problem reports
//   notes.md               guidance the weekly generator reads every run

const root = () => path.join(process.cwd(), '.data', 'daily');
const daysDir = () => path.join(root(), 'days');
const dayFile = (date: DateKey) => path.join(daysDir(), `${date}.json`);

/* ── Days ───────────────────────────────────────────────────────────────── */

export async function readDay(date: DateKey): Promise<DailyDay | null> {
  if (!isDateKey(date)) return null;
  return readJson<DailyDay | null>(dayFile(date), null);
}

export async function listDates(): Promise<DateKey[]> {
  try {
    return (await fs.readdir(daysDir())).map((f) => f.replace(/\.json$/, '')).filter(isDateKey).sort();
  } catch {
    return [];
  }
}

export type IndexedQuestion = { question: Question; date: DateKey; core: boolean; boss: boolean };

// Every question by id, for regrading. Rebuilt after any change to the days.
// Kept on globalThis: each API route is bundled with its own copy of this
// module, and an upload through one route must refresh the cache for all.
const INDEX_KEY = Symbol.for('pi-dashboard.daily.questionIndex');
type IndexHolder = { [INDEX_KEY]?: Promise<Map<string, IndexedQuestion>> | null };
const holder = globalThis as IndexHolder;
const clearIndex = () => { holder[INDEX_KEY] = null; };

export function questionIndex() {
  holder[INDEX_KEY] ??= (async () => {
    const index = new Map<string, IndexedQuestion>();
    for (const date of await listDates()) {
      const day = await readDay(date);
      if (!day) continue;
      index.set(day.core.id, { question: day.core, date, core: true, boss: !!day.boss });
      for (const q of day.bonus) index.set(q.id, { question: q, date, core: false, boss: false });
    }
    return index;
  })();
  return holder[INDEX_KEY]!;
}

/** Save validated days (replacing those dates). Question ids must not clash with other stored days or practice questions. */
export async function saveDays(days: DailyDay[]) {
  const [index, practice] = await Promise.all([questionIndex(), practiceSet()]);
  const practiceIds = new Set(practice.questions.map((q) => q.id));
  const incomingDates = new Set(days.map((d) => d.date));
  const clashes = days.flatMap((d) => [d.core, ...d.bonus]
    .filter((q) => { const at = index.get(q.id); return (at && !incomingDates.has(at.date)) || practiceIds.has(q.id); })
    .map((q) => `${d.date}: question id ${q.id} is already used ${index.get(q.id) ? `on ${index.get(q.id)!.date}` : 'by a practice question'}`));
  if (clashes.length) throw new ApiError(400, clashes.join('\n'));

  const existing = new Set(await listDates());
  for (const day of days) await writeJsonAtomic(dayFile(day.date), day, true);
  clearIndex();
  return { added: days.filter((d) => !existing.has(d.date)).length, replaced: days.filter((d) => existing.has(d.date)).length };
}

/* ── Practice questions ─────────────────────────────────────────────────── */

const practiceFile = () => path.join(root(), 'practice.json');
const PRACTICE_KEY = Symbol.for('pi-dashboard.daily.practice');
type PracticeHolder = { [PRACTICE_KEY]?: Promise<PracticeSet> | null };
const practiceHolder = globalThis as PracticeHolder;

/** Every practice-only question, with the formulas they use. */
export function practiceSet() {
  practiceHolder[PRACTICE_KEY] ??= readJson<PracticeSet>(practiceFile(), { formulas: [], questions: [] }).then((set) => ({
    formulas: Array.isArray(set?.formulas) ? set.formulas : [],
    questions: Array.isArray(set?.questions) ? set.questions : [],
  }));
  return practiceHolder[PRACTICE_KEY]!;
}

/** Add practice questions (a question with an existing id replaces it). Ids must not clash with day questions. */
export async function savePractice(incoming: PracticeSet) {
  const [index, current] = await Promise.all([questionIndex(), practiceSet()]);
  const clashes = incoming.questions.filter((q) => index.has(q.id)).map((q) => `practice: question id ${q.id} is already used on ${index.get(q.id)!.date}`);
  if (clashes.length) throw new ApiError(400, clashes.join('\n'));
  const have = new Set(current.questions.map((q) => q.id));
  const ids = new Set(incoming.questions.map((q) => q.id));
  const formulaIds = new Set(incoming.formulas.map((f) => f.id));
  const next: PracticeSet = {
    formulas: [...current.formulas.filter((f) => !formulaIds.has(f.id)), ...incoming.formulas],
    questions: [...current.questions.filter((q) => !ids.has(q.id)), ...incoming.questions],
  };
  await writeJsonAtomic(practiceFile(), next, true);
  practiceHolder[PRACTICE_KEY] = null;
  return { added: incoming.questions.filter((q) => !have.has(q.id)).length, replaced: incoming.questions.filter((q) => have.has(q.id)).length, total: next.questions.length };
}

export type FoundQuestion = {
  question: Question;
  /** The question's day; null for practice-only and generated questions. */
  date: DateKey | null;
  core: boolean;
  boss: boolean;
  /** A practice question (uploaded or generated), not one from a day. */
  practice: boolean;
  generated: boolean;
  formulas: Formula[];
};

/** Any question by id: from a day, the practice set, or a generator. */
export async function findQuestion(id: unknown): Promise<FoundQuestion | null> {
  if (typeof id !== 'string') return null;
  const at = (await questionIndex()).get(id);
  if (at) {
    const used = new Set(at.question.formulas ?? []);
    const day = await readDay(at.date);
    return { question: at.question, date: at.date, core: at.core, boss: at.boss, practice: false, generated: false, formulas: (day?.formulas ?? []).filter((f) => used.has(f.id)) };
  }
  const practice = await practiceSet();
  const q = practice.questions.find((x) => x.id === id);
  if (q) {
    const used = new Set(q.formulas ?? []);
    return { question: q, date: null, core: false, boss: false, practice: true, generated: false, formulas: practice.formulas.filter((f) => used.has(f.id)) };
  }
  const made = generatedQuestion(id);
  return made ? { question: made.question, date: null, core: false, boss: false, practice: true, generated: true, formulas: made.formulas } : null;
}

/** Stored questions by id, for regrading attempts (generated ones keep their saved grade). */
export async function gradingMap() {
  const [index, practice] = await Promise.all([questionIndex(), practiceSet()]);
  return new Map<string, Question>([...[...index].map(([id, at]) => [id, at.question] as const), ...practice.questions.map((q) => [q.id, q] as const)]);
}

/**
 * Attempts graded part by part against the current questions (with any
 * "common slip" each wrong part matched), ready for analyze().
 */
export async function analysisAttempts(attempts: Attempt[]): Promise<AnalysisAttempt[]> {
  const [index, practice] = await Promise.all([questionIndex(), practiceSet()]);
  const lookup = (id: string) => index.get(id)?.question ?? practice.questions.find((q) => q.id === id) ?? generatedQuestion(id)?.question;
  return attempts.map((a) => {
    const q = lookup(a.questionId);
    const { result } = scoreAttempt(a, q);
    const parts = q && a.responses ? gradeQuestion(q, a.responses).parts.map((p) => ({
      correct: p.correct, type: q.parts.find((x) => x.id === p.id)!.answer.type, ...(p.mistake ? { mistake: p.mistake } : {}),
    })) : undefined;
    return {
      questionId: a.questionId, at: a.at, answeredOn: a.answeredOn, meta: q ? { ...a.meta, track: q.track, topic: q.topic, difficulty: q.difficulty } : a.meta,
      status: result.status, correct: result.correct, total: result.total, hints: a.hints, tries: a.tries, ...(parts ? { parts } : {}),
    };
  });
}

export async function deleteDay(date: DateKey) {
  if (!isDateKey(date)) throw new ApiError(400, 'Invalid date');
  await fs.rm(dayFile(date), { force: true });
  clearIndex();
}

/** Days ready from today on, counting until the first gap. */
export async function bufferDays(today: DateKey) {
  const dates = new Set(await listDates());
  let n = 0;
  while (dates.has(addDays(today, n))) n++;
  return n;
}

/* ── Attempts ───────────────────────────────────────────────────────────── */

/** `pending`: checks used so far on questions not finished yet, by question id. */
export type UserDaily = { attempts: Attempt[]; leaderboard?: boolean; pending?: Record<string, number> };

function attemptsFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(root(), 'attempts', `${userId}.json`);
}

export async function readUserDaily(userId: string): Promise<UserDaily> {
  const data = await readJson<UserDaily>(attemptsFile(userId), { attempts: [] });
  const pending = data.pending && typeof data.pending === 'object' ? data.pending : {};
  return { attempts: Array.isArray(data.attempts) ? data.attempts : [], leaderboard: !!data.leaderboard, pending };
}

export function updateUserDaily<R>(userId: string, mutate: (data: UserDaily) => R) {
  return updateJson<UserDaily, R>(attemptsFile(userId), { attempts: [] }, (data) => {
    if (!Array.isArray(data.attempts)) data.attempts = [];
    return mutate(data);
  });
}

export async function listUserIds() {
  try {
    return (await fs.readdir(path.join(root(), 'attempts'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

/** A finished question as the page shows it: your answers and grade, the answer key and solution, your feedback. */
export function answeredView(q: Question, attempt: Attempt, fb?: Feedback) {
  const { result, regraded, xp } = scoreAttempt(attempt, q);
  return {
    ...result, parts: gradeQuestion(q, attempt.responses).parts, responses: attempt.responses, hints: attempt.hints, tries: attempt.tries ?? 1, xp, regraded,
    late: attempt.answeredOn > attempt.date, question: revealedQuestion(q),
    feedback: { rating: fb?.rating ?? null, difficulty: fb?.difficulty ?? null, report: fb?.report ?? null },
  };
}

/* ── Feedback and generator notes ───────────────────────────────────────── */

export type FeedbackReport = { kind: string; note: string };
export type Feedback = {
  questionId: string;
  date: DateKey;
  userId: string;
  at: string;
  rating?: 'up' | 'down';
  difficulty?: 'easy' | 'right' | 'hard';
  report?: FeedbackReport;
};

const feedbackFile = () => path.join(root(), 'feedback.json');
export const readFeedback = () => readJson<{ entries: Feedback[] }>(feedbackFile(), { entries: [] });
export const updateFeedback = <R>(mutate: (data: { entries: Feedback[] }) => R) =>
  updateJson<{ entries: Feedback[] }, R>(feedbackFile(), { entries: [] }, (data) => {
    if (!Array.isArray(data.entries)) data.entries = [];
    return mutate(data);
  });

const notesFile = () => path.join(root(), 'notes.md');
export async function readNotes() {
  try { return await fs.readFile(notesFile(), 'utf-8'); } catch { return ''; }
}
export async function writeNotes(text: string) {
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(notesFile(), text.slice(0, 50_000));
}

/* ── Who may manage questions ───────────────────────────────────────────── */

function sameSecret(given: string, expected: string) {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * The site admin (signed in), or the weekly generator with the upload token
 * (DAILY_UPLOAD_TOKEN, sent as "Authorization: Bearer …"). The token can manage
 * questions, feedback and notes, nothing else on the site.
 */
export async function requireDailyManager(request: Request): Promise<'admin' | 'token'> {
  if (await isAdminAuthenticated()) return 'admin';
  const header = request.headers.get('authorization') || '';
  const expected = process.env.DAILY_UPLOAD_TOKEN?.trim();
  if (!header.startsWith('Bearer ') || !expected) throw new ApiError(401, 'Unauthorized');
  const wait = loginRetryAfter(request, 'daily-token');
  if (wait) throw new ApiError(429, tooManyAttemptsMessage(wait));
  if (expected.length >= 24 && sameSecret(header.slice(7).trim(), expected)) return 'token';
  await recordLoginFailure(request, 'daily-token');
  throw new ApiError(401, 'Unauthorized');
}

/** The user's local day, if it's within a day of the server's (it can't be used to peek ahead). */
export function clampToday(value: unknown): DateKey {
  const serverDay = new Date().toISOString().slice(0, 10);
  return isDateKey(value) && value >= addDays(serverDay, -1) && value <= addDays(serverDay, 1) ? value : serverDay;
}
