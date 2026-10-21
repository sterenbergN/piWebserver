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
import type { DailyDay, Question } from './types';

// Daily questions on disk, all under .data/daily (kept by backups):
//   days/YYYY-MM-DD.json   one day each, uploaded ahead of time
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

/** Save validated days (replacing those dates). Question ids must not clash with other stored days. */
export async function saveDays(days: DailyDay[]) {
  const index = await questionIndex();
  const incomingDates = new Set(days.map((d) => d.date));
  const clashes = days.flatMap((d) => [d.core, ...d.bonus]
    .filter((q) => { const at = index.get(q.id); return at && !incomingDates.has(at.date); })
    .map((q) => `${d.date}: question id ${q.id} is already used on ${index.get(q.id)!.date}`));
  if (clashes.length) throw new ApiError(400, clashes.join('\n'));

  const existing = new Set(await listDates());
  for (const day of days) await writeJsonAtomic(dayFile(day.date), day, true);
  clearIndex();
  return { added: days.filter((d) => !existing.has(d.date)).length, replaced: days.filter((d) => existing.has(d.date)).length };
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
