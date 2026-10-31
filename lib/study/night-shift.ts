// The Night Shift, the solo version of Trivia Death: twelve hours on call, a door
// to pick each hour, and a boss at the end built from her weakest organ system. A
// wrong answer always stops to explain itself, then she has to fight to keep her
// coffee. The rules are pure and seeded, so a run can be tested start to finish.

import type { GameQuestion } from './games';
import { isRight, type PanceSystem } from './study';

export const SHIFT_ROOMS = 11;
const START_COFFEE = 3;
export const MAX_COFFEE = 5;
const BOSS_QUESTIONS = 5;
const BOSS_NEEDED = 3;
const BOSS_BONUS = 1000;
const LIGHTNING_QUESTIONS = 3;
const LIGHTNING_NEEDED = 2;
/** Answer faster than this for a bonus. There's never a penalty, so she can still read a long scenario. */
export const QUICK_SECONDS = 20;

export type DoorKind = 'clinic' | 'er' | 'charts' | 'break' | 'supply';
export const DOORS: Record<DoorKind, { icon: string; name: string; note: string; points: number }> = {
  clinic: { icon: '🩺', name: 'Clinic', note: 'A steady case.', points: 100 },
  er: { icon: '🚑', name: 'The ER', note: 'A long, messy case. Worth double.', points: 200 },
  charts: { icon: '📋', name: 'Chart review', note: 'One you’ve missed before.', points: 150 },
  break: { icon: '☕', name: 'Break room', note: 'Rest, and find some coffee.', points: 0 },
  supply: { icon: '🧰', name: 'Supply closet', note: 'See what’s lying around.', points: 0 },
};
const BOSS_POINTS = 300;
const LIGHTNING_POINTS = 50;

export type Phase = 'doors' | 'question' | 'feedback' | 'rest' | 'boss-intro' | 'defib' | 'code-intro' | 'over';
export type Room = DoorKind | 'boss' | 'lightning' | null;

export type Run = {
  rng: number;
  /** Rooms finished so far. */
  hour: number;
  coffee: number;
  score: number;
  streak: number;
  bestStreak: number;
  right: number;
  wrong: number;
  /** Takes away wrong choices. */
  consults: number;
  /** A second try if the next answer is wrong. */
  opinions: number;
  opinionArmed: boolean;
  phase: Phase;
  doors: DoorKind[];
  room: Room;
  questionId: string | null;
  hidden: number[];
  last: { right: boolean; points: number; answer: number[] } | null;
  boss: { left: number; right: number; system: PanceSystem | null };
  lightning: { left: number; right: number };
  used: string[];
  /** Questions she got wrong this run, for the recap. */
  missed: string[];
  message: string;
  won: boolean;
  bossBeaten: boolean;
  /** Rested last hour, so this hour has to be work. */
  rested: boolean;
};

/** A small seeded generator, kept in the run so it can be replayed in a test. */
function roll(run: Pick<Run, 'rng'>) {
  run.rng = (run.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(run.rng ^ (run.rng >>> 15), 1 | run.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(run: Pick<Run, 'rng'>, list: T[]) => list[Math.floor(roll(run) * list.length)];

export const questionOf = (pool: GameQuestion[], run: Run) => pool.find((q) => q.id === run.questionId) ?? null;

function rollDoors(run: Run, pool: GameQuestion[]): DoorKind[] {
  const work: DoorKind[] = ['clinic', 'er', ...(pool.some((q) => q.priority > 1) ? ['charts' as const] : [])];
  const first = pick(run, work);
  const otherWork = work.filter((d) => d !== first);
  const rest = !run.rested && roll(run) < 0.45;
  return [first, rest ? pick(run, ['break', 'supply'] as DoorKind[]) : pick(run, otherWork)];
}

/** Draw a question she hasn't seen this run, starting over once she's seen them all. */
function draw(run: Run, pool: GameQuestion[], prefer: (q: GameQuestion) => boolean) {
  let fresh = pool.filter((q) => !run.used.includes(q.id));
  if (!fresh.length) {
    run.used = [];
    fresh = pool;
  }
  const preferred = fresh.filter(prefer);
  const from = preferred.length ? preferred : fresh;
  // What she's missing comes up more often than the rest.
  const urgent = from.filter((q) => q.priority > 1);
  const chosen = pick(run, urgent.length && roll(run) < 0.6 ? urgent : from);
  run.used.push(chosen.id);
  run.questionId = chosen.id;
  run.hidden = [];
  run.phase = 'question';
}

export function startRun(pool: GameQuestion[], seed: number, bossSystem: PanceSystem | null = null): Run {
  const run: Run = {
    rng: seed | 0, hour: 0, coffee: START_COFFEE, score: 0, streak: 0, bestStreak: 0, right: 0, wrong: 0,
    consults: 1, opinions: 1, opinionArmed: false,
    phase: 'doors', doors: [], room: null, questionId: null, hidden: [], last: null,
    boss: { left: BOSS_QUESTIONS, right: 0, system: bossSystem },
    lightning: { left: 0, right: 0 },
    used: [], missed: [], message: '', won: false, bossBeaten: false, rested: false,
  };
  run.doors = rollDoors(run, pool);
  return run;
}

export function enterDoor(run: Run, pool: GameQuestion[], index: number) {
  if (run.phase !== 'doors') return run;
  const kind = run.doors[index];
  if (!kind) return run;
  run.room = kind;
  run.last = null;
  run.message = '';
  if (kind === 'break') {
    if (run.coffee < MAX_COFFEE) {
      run.coffee++;
      run.message = 'Burnt, lukewarm, and exactly what you needed. +1 coffee.';
    } else {
      run.score += 100;
      run.message = 'You can’t hold any more coffee. You nap instead. +100.';
    }
    run.phase = 'rest';
    run.rested = true;
    return run;
  }
  if (kind === 'supply') {
    if (roll(run) < 0.5) {
      run.consults++;
      run.message = 'You found a consult pad. +1 Consult.';
    } else {
      run.opinions++;
      run.message = 'A colleague owes you a favor. +1 Second Opinion.';
    }
    run.phase = 'rest';
    run.rested = true;
    return run;
  }
  run.rested = false;
  if (kind === 'charts') draw(run, pool, (q) => q.priority > 1);
  else if (kind === 'er') {
    // The ER gets the longest cases of what's left.
    const lengths = pool.filter((q) => !run.used.includes(q.id)).map((q) => q.stem.length).sort((a, b) => b - a);
    const cutoff = lengths[Math.floor(lengths.length / 3)] ?? 0;
    draw(run, pool, (q) => q.stem.length >= cutoff);
  } else draw(run, pool, () => true);
  return run;
}

/** A consult takes away wrong choices, always leaving at least one to fool her. */
export function spendConsult(run: Run, pool: GameQuestion[]) {
  const q = questionOf(pool, run);
  if (run.phase !== 'question' || !q || run.consults <= 0 || run.hidden.length) return run;
  const wrong = q.choices.map((_, i) => i).filter((i) => !q.correct.includes(i));
  const canHide = Math.min(q.correct.length > 1 ? 1 : 2, wrong.length - 1);
  if (canHide <= 0) return run;
  for (let i = 0; i < canHide; i++) {
    const open = wrong.filter((w) => !run.hidden.includes(w));
    run.hidden.push(pick(run, open));
  }
  run.consults--;
  return run;
}

export function spendOpinion(run: Run) {
  if (run.phase !== 'question' || run.opinions <= 0 || run.opinionArmed) return run;
  run.opinions--;
  run.opinionArmed = true;
  return run;
}

function points(run: Run, seconds: number) {
  const base = run.room === 'boss' ? BOSS_POINTS : run.room === 'lightning' ? LIGHTNING_POINTS : DOORS[run.room as DoorKind]?.points ?? 100;
  const streak = 1 + Math.min(run.streak, 4) * 0.25;
  const quick = seconds <= QUICK_SECONDS ? 1.25 : 1;
  return Math.round(base * streak * quick);
}

/**
 * Answer the question on the table. Returns what to save, if anything: her first
 * answer is the honest one, so a second opinion's retry isn't saved.
 */
export function answerQuestion(run: Run, pool: GameQuestion[], answer: number[], seconds: number): { questionId: string; answer: number[] } | null {
  const q = questionOf(pool, run);
  if (run.phase !== 'question' || !q) return null;
  const right = isRight(q, answer);
  const retrying = run.message === SECOND_OPINION;
  const record = retrying ? null : { questionId: q.id, answer };
  run.message = '';
  if (!right && run.opinionArmed) {
    // Back to the same question, with the wrong answer gone.
    run.opinionArmed = false;
    run.hidden = [...new Set([...run.hidden, ...answer])];
    if (q.correct.length === 1 && q.choices.length - run.hidden.length >= 2) {
      run.message = SECOND_OPINION;
      return record;
    }
  }
  if (right) {
    run.streak++;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
    run.right++;
    const earned = points(run, seconds);
    run.score += earned;
    run.last = { right: true, points: earned, answer };
  } else {
    run.streak = 0;
    run.wrong++;
    if (!run.missed.includes(q.id)) run.missed.push(q.id);
    run.last = { right: false, points: 0, answer };
  }
  run.phase = 'feedback';
  return record;
}
export const SECOND_OPINION = '“Are you sure? Look at it again.”';

function loseCoffee(run: Run) {
  run.coffee--;
  if (run.coffee <= 0) {
    run.phase = 'over';
    run.won = false;
    return true;
  }
  return false;
}

function nextHour(run: Run, pool: GameQuestion[]) {
  run.hour++;
  run.room = null;
  run.questionId = null;
  run.last = null;
  run.opinionArmed = false;
  run.message = '';
  if (run.hour >= SHIFT_ROOMS) {
    run.phase = 'boss-intro';
    return;
  }
  run.phase = 'doors';
  run.doors = rollDoors(run, pool);
}

/** Move on from a rest, an explanation, or the boss's introduction. */
export function proceed(run: Run, pool: GameQuestion[]) {
  if (run.phase === 'rest') {
    nextHour(run, pool);
    return run;
  }
  if (run.phase === 'boss-intro') {
    run.room = 'boss';
    const system = run.boss.system;
    draw(run, pool, (q) => !system || q.system === system);
    return run;
  }
  if (run.phase === 'code-intro') {
    run.room = 'lightning';
    run.lightning = { left: LIGHTNING_QUESTIONS, right: 0 };
    draw(run, pool, () => true);
    return run;
  }
  if (run.phase !== 'feedback' || !run.last) return run;

  if (run.room === 'boss') {
    run.boss.left--;
    if (run.last.right) run.boss.right++;
    if (run.boss.left > 0) {
      const system = run.boss.system;
      draw(run, pool, (q) => !system || q.system === system);
      return run;
    }
    run.bossBeaten = run.boss.right >= BOSS_NEEDED;
    if (run.bossBeaten) run.score += BOSS_BONUS;
    else if (loseCoffee(run)) return run;
    run.hour = SHIFT_ROOMS + 1;
    run.phase = 'over';
    run.won = true;
    return run;
  }

  if (run.room === 'lightning') {
    run.lightning.left--;
    if (run.last.right) run.lightning.right++;
    if (run.lightning.left > 0) {
      draw(run, pool, () => true);
      return run;
    }
    const saved = run.lightning.right >= LIGHTNING_NEEDED;
    if (!saved && loseCoffee(run)) return run;
    nextHour(run, pool);
    run.message = saved ? 'Patient stable. You keep your coffee.' : 'You lost that one. There goes a coffee.';
    return run;
  }

  // A wrong answer on a regular case calls a code: fight to keep your coffee.
  if (!run.last.right) {
    if (pool.length >= LIGHTNING_QUESTIONS + 2 && roll(run) < 0.6) run.phase = 'code-intro';
    else run.phase = 'defib';
    run.questionId = null;
    return run;
  }
  nextHour(run, pool);
  return run;
}

/** The defibrillator: tap in the green. A hit keeps her coffee. */
export function defibResult(run: Run, pool: GameQuestion[], hit: boolean) {
  if (run.phase !== 'defib') return run;
  if (!hit && loseCoffee(run)) return run;
  nextHour(run, pool);
  run.message = hit ? 'Clear! Sinus rhythm. You keep your coffee.' : 'Too late. There goes a coffee.';
  return run;
}

/** How wide the green zone is, as a share of the bar. It narrows through the night. */
export const defibZone = (hour: number) => Math.max(0.12, 0.28 - hour * 0.015);

/** What the clock says: the shift runs 7pm to 7am. */
export function clockFor(hour: number) {
  const h = (19 + Math.min(hour, 12)) % 24;
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
}
