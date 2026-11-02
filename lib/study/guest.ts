// A shared test taken without an account. Everything stays in the browser it was
// taken in: the test as it was first opened, and every try at it. The same rules
// grade it as for an account (startAttempt, saveAttempt, finishAttempt).

import type { DateKey } from '@/lib/habits/dates';
import { emptyProgress, finishAttempt, normalizeProgress, saveAttempt, startAttempt, type Attempt, type AttemptMode, type ProgressData, type StudyTest } from './study';

export type GuestEntry = { test: StudyTest; progress: ProgressData; openedAt: string };
export type GuestData = { tests: Record<string, GuestEntry> };

export const GUEST_KEY = 'study-guest';
/** Only so many, so one browser can't fill its storage with old tests. */
const MAX_GUEST_TESTS = 30;

export function readGuestData(raw: string | null): GuestData {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    const tests: Record<string, GuestEntry> = {};
    for (const [id, entry] of Object.entries(parsed?.tests ?? {})) {
      const e = entry as Partial<GuestEntry>;
      if (e?.test && Array.isArray(e.test.questions)) tests[id] = { test: e.test, progress: normalizeProgress(e.progress), openedAt: String(e.openedAt ?? '') };
    }
    return { tests };
  } catch {
    return { tests: {} };
  }
}

/** Open a shared test here. Once it's been tried it keeps the version those tries were graded on; until then it takes the latest. */
export function openGuestTest(data: GuestData, shareId: string, latest: StudyTest, now: string): GuestEntry {
  const kept = data.tests[shareId];
  if (kept && kept.progress.attempts.length) return kept;
  const entry: GuestEntry = { test: latest, progress: kept?.progress ?? emptyProgress(), openedAt: kept?.openedAt || now };
  data.tests[shareId] = entry;
  const ids = Object.keys(data.tests);
  if (ids.length > MAX_GUEST_TESTS) {
    const oldest = ids.filter((id) => id !== shareId).sort((a, b) => data.tests[a].openedAt.localeCompare(data.tests[b].openedAt))[0];
    delete data.tests[oldest];
  }
  return entry;
}

export function startGuestAttempt(entry: GuestEntry, input: { mode: AttemptMode; fresh?: boolean; questionIds?: string[] }, makeId: () => string, seed: number, now: string) {
  return startAttempt(entry.progress, entry.test, input, makeId, seed, now);
}

const attemptIn = (entry: GuestEntry, attemptId: string): Attempt => {
  const attempt = entry.progress.attempts.find((a) => a.id === attemptId);
  if (!attempt) throw new Error('That try isn’t in this browser any more.');
  return attempt;
};

export function saveGuestAttempt(entry: GuestEntry, input: { attemptId: string; answers: unknown; flagged: unknown; elapsed: unknown }) {
  const attempt = attemptIn(entry, input.attemptId);
  if (!attempt.finishedAt) saveAttempt(attempt, entry.test, input);
  return attempt;
}

export function finishGuestAttempt(entry: GuestEntry, input: { attemptId: string; answers: unknown; flagged: unknown; elapsed: unknown }, today: DateKey, now: string) {
  const attempt = saveGuestAttempt(entry, input);
  return finishAttempt(entry.progress, attempt, entry.test, today, now);
}

export function forgetGuestTest(data: GuestData, shareId: string) {
  delete data.tests[shareId];
}
