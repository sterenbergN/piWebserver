// Attempts and everything worked out from them: XP, streak, accuracy by track
// and topic, and achievements. Attempts keep the answers you gave, and are
// graded against the current question, so fixing a wrong answer key regrades
// everyone automatically.

import { addDays, weekStart, type DateKey } from '@/lib/habits/dates';
import { gradeQuestion, type QuestionResult, type QuestionStatus } from './grade';
import type { PartResponse, Question, Track } from './types';

/** `practice`: a practice-only or generated question (half XP, never the streak). */
export type AttemptMeta = { track: Track; topic: string; difficulty: number; title: string; core: boolean; boss: boolean; practice?: boolean };

export type Attempt = {
  questionId: string;
  /** The question's day. */
  date: DateKey;
  /** Your local day when you answered (later than `date` for catch-up). */
  answeredOn: DateKey;
  at: string;
  /** null: you opened the worked solution without answering. */
  responses: Record<string, PartResponse> | null;
  hints: number;
  /** Checks it took (1–3); each one after the first costs some XP. Missing on old attempts: 1. */
  tries?: number;
  /** The grade when you answered; a later correction shows as "regraded". */
  result: Pick<QuestionResult, 'correct' | 'total' | 'status'>;
  meta: AttemptMeta;
};

export const XP_RULES = {
  /** A fully solved question is worth base + perDifficulty × difficulty. */
  base: 10,
  perDifficulty: 10,
  /** For answering, even when wrong. */
  effort: 5,
  /** For giving up and reading the worked solution. */
  studied: 3,
  hintCost: 0.2,
  /** How many times you may check an answer before it locks. */
  maxTries: 3,
  /** XP lost for each check after the first. */
  retryCost: 0.15,
  minHintFactor: 0.5,
  /** Catching up on an earlier day. */
  late: 0.5,
  /** Practice-only and generated questions. */
  practice: 0.5,
  boss: 1.5,
};

export function attemptMeta(q: Question, core: boolean, boss: boolean, practice = false): AttemptMeta {
  return { track: q.track, topic: q.topic, difficulty: q.difficulty, title: q.title, core, boss: core && boss, ...(practice ? { practice: true } : {}) };
}

/** An attempt's result, regraded if the question is at hand. */
export function scoreAttempt(attempt: Attempt, question?: Question) {
  const result = question ? gradeQuestion(question, attempt.responses) : { ...attempt.result, parts: [] };
  const regraded = !!question && (result.correct !== attempt.result.correct || result.total !== attempt.result.total);
  return { result, regraded, xp: attemptXp(attempt, result) };
}

/** The XP multiplier for solving on check number `tries` (1 = first go). */
export function triesFactor(tries = 1) {
  return 1 - XP_RULES.retryCost * (Math.min(XP_RULES.maxTries, Math.max(1, tries)) - 1);
}

export function attemptXp(attempt: Pick<Attempt, 'meta' | 'hints' | 'date' | 'answeredOn' | 'tries'>, result: Pick<QuestionResult, 'correct' | 'total' | 'status'>) {
  let xp: number;
  if (result.status === 'studied') xp = XP_RULES.studied;
  else {
    const full = XP_RULES.base + XP_RULES.perDifficulty * attempt.meta.difficulty;
    xp = result.correct === 0 ? XP_RULES.effort : full * (result.correct / result.total) * triesFactor(attempt.tries);
    xp *= Math.max(XP_RULES.minHintFactor, 1 - XP_RULES.hintCost * attempt.hints);
  }
  if (attempt.answeredOn > attempt.date) xp *= XP_RULES.late;
  if (attempt.meta.practice) xp *= XP_RULES.practice;
  if (attempt.meta.boss) xp *= XP_RULES.boss;
  return Math.round(xp);
}

export type ScoredAttempt = Attempt & { status: QuestionStatus; correct: number; total: number; xp: number; regraded: boolean };

export function scoreAll(attempts: Attempt[], questions: Map<string, Question>): ScoredAttempt[] {
  return attempts.map((a) => {
    const { result, regraded, xp } = scoreAttempt(a, questions.get(a.questionId));
    return { ...a, status: result.status, correct: result.correct, total: result.total, xp, regraded };
  });
}

/** Days you did that day's core question on the day itself (answering or studying both count). */
function onTimeDays(attempts: Attempt[]) {
  return new Set(attempts.filter((a) => a.meta.core && a.answeredOn === a.date).map((a) => a.date));
}

export function questionStreak(attempts: Attempt[], today: DateKey) {
  const days = onTimeDays(attempts);
  let current = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;
  let best = 0;
  let run = 0;
  const sorted = [...days].sort();
  sorted.forEach((d, i) => {
    run = i > 0 && addDays(sorted[i - 1], 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return { current, best, doneToday: days.has(today) };
}

type Tally = { answered: number; solved: number; partsRight: number; partsTotal: number; xp: number };
const tally = (): Tally => ({ answered: 0, solved: 0, partsRight: 0, partsTotal: 0, xp: 0 });
function add(t: Tally, a: ScoredAttempt) {
  t.xp += a.xp;
  if (a.status === 'studied') return;
  t.answered++;
  if (a.status === 'solved') t.solved++;
  t.partsRight += a.correct;
  t.partsTotal += a.total;
}

export type Achievement = { id: string; icon: string; title: string; description: string; earned: boolean; progress?: [number, number] };

function achievements(scored: ScoredAttempt[], best: number): Achievement[] {
  const solved = scored.filter((a) => a.status === 'solved');
  const solvedIn = (track: Track) => solved.filter((a) => a.meta.track === track).length;
  let cleanRun = 0;
  let bestClean = 0;
  for (const a of [...scored].sort((x, y) => x.at.localeCompare(y.at))) {
    if (a.status === 'studied') continue;
    cleanRun = a.status === 'solved' && a.hints === 0 && (a.tries ?? 1) === 1 ? cleanRun + 1 : 0;
    bestClean = Math.max(bestClean, cleanRun);
  }
  const byDay = new Map<DateKey, ScoredAttempt[]>();
  for (const a of scored) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);
  const sweptDay = [...byDay.values()].some((list) => list.length >= 3 && list.every((a) => a.status === 'solved'));
  const late = scored.filter((a) => a.answeredOn > a.date && a.status !== 'studied').length;
  const xp = scored.reduce((sum, a) => sum + a.xp, 0);
  const count = (id: string, icon: string, title: string, description: string, have: number, need: number): Achievement =>
    ({ id, icon, title, description, earned: have >= need, progress: [Math.min(have, need), need] });
  return [
    count('first', '🎯', 'First solve', 'Solve any question.', solved.length, 1),
    count('streak-7', '🔥', 'On a roll', 'A 7-day streak.', best, 7),
    count('streak-30', '☄️', 'Unstoppable', 'A 30-day streak.', best, 30),
    count('boss', '👹', 'Boss slayer', 'Fully solve a Friday boss problem.', solved.filter((a) => a.meta.boss).length, 1),
    count('mech', '⚙️', 'Gearhead', 'Solve 10 mechanical questions.', solvedIn('mechanical'), 10),
    count('controls', '📈', 'Closed loop', 'Solve 10 controls questions.', solvedIn('controls'), 10),
    count('automation', '🤖', 'PLC whisperer', 'Solve 10 automation questions.', solvedIn('automation'), 10),
    count('clean', '🧼', 'No training wheels', 'Solve 5 in a row first time, without hints.', bestClean, 5),
    count('bonus', '🎁', 'Overachiever', 'Solve 20 bonus questions.', solved.filter((a) => !a.meta.core).length, 20),
    { id: 'sweep', icon: '🏆', title: 'Clean sweep', description: 'Solve the core and every bonus question of a day (3 or more).', earned: sweptDay },
    count('catchup', '🔁', 'Catching up', 'Answer 5 questions from earlier days.', late, 5),
    count('xp', '💎', 'Thousand club', 'Earn 1,000 XP from questions.', xp, 1000),
  ];
}

export function questionStats(scored: ScoredAttempt[], today: DateKey) {
  const total = tally();
  const byTrack = new Map<Track, Tally>();
  const byTopic = new Map<string, Tally & { track: Track; topic: string }>();
  for (const a of scored) {
    add(total, a);
    if (!byTrack.has(a.meta.track)) byTrack.set(a.meta.track, tally());
    add(byTrack.get(a.meta.track)!, a);
    const key = `${a.meta.track}/${a.meta.topic}`;
    if (!byTopic.has(key)) byTopic.set(key, { ...tally(), track: a.meta.track, topic: a.meta.topic });
    add(byTopic.get(key)!, a);
  }
  const streak = questionStreak(scored, today);
  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, (i - 11) * 7)).map((week) => ({
    week,
    xp: scored.filter((a) => weekStart(a.answeredOn) === week).reduce((s, a) => s + a.xp, 0),
  }));
  /** The core question's outcome per day, for the calendar. */
  const coreByDay: Record<DateKey, QuestionStatus> = {};
  for (const a of scored) if (a.meta.core) coreByDay[a.date] = a.status;

  return {
    total,
    byTrack: [...byTrack].map(([track, t]) => ({ track, ...t })),
    byTopic: [...byTopic.values()].sort((a, b) => b.answered - a.answered || a.topic.localeCompare(b.topic)),
    streak,
    weeks,
    coreByDay,
    xpThisWeek: weeks[weeks.length - 1].xp,
    achievements: achievements(scored, streak.best),
  };
}
