// Long-term numbers for one account across every round it played in.

import { distance, offLine } from './geo';
import { handicapHistory, type HandicapEntry } from './handicap';
import { hitGreen, playerFor, playerTotals, scoreName, type ScoreName } from './round';
import type { Course, Round, Sport } from './types';

export type Rate = { made: number; tries: number };
const rate = (): Rate => ({ made: 0, tries: 0 });
export const pct = (r: Rate) => (r.tries ? Math.round((r.made / r.tries) * 100) : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export type TrendPoint = { roundId: string; date: string; courseName: string; holes: number; strokes: number; toPar: number; vsCourse: number | null };

export type GolfStats = {
  sport: Sport;
  rounds: number;
  holes: number;
  /** Average strokes and score to par, 18-hole and 9-hole rounds kept apart. */
  average: Record<9 | 18, { strokes: number | null; toPar: number | null; rounds: number }>;
  best: Record<9 | 18, TrendPoint | null>;
  /** Average over par on par 3s, 4s and 5s. */
  byPar: Record<number, number | null>;
  spread: Record<ScoreName, number>;
  penaltiesPerRound: number | null;
  fairways: { hit: number; left: number; right: number; short: number };
  greens: Rate;
  scrambling: Rate;
  puttsPerRound: number | null;
  puttsPerGreen: number | null;
  c1: Rate;
  c2: Rate;
  trend: TrendPoint[];
  handicap: HandicapEntry[];
};

/** Finished rounds of one sport this account played in, oldest first. */
export function roundsFor(rounds: Round[], userId: string, sport: Sport, courseId?: string) {
  return rounds
    .filter((r) => r.sport === sport && r.finishedAt && playerFor(r, userId) && (!courseId || r.courseId === courseId))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function golfStats(all: Round[], userId: string, sport: Sport, courseId?: string): GolfStats {
  const rounds = roundsFor(all, userId, sport, courseId);
  const spread = { ace: 0, albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, worse: 0 };
  const byParLists: Record<number, number[]> = {};
  const fairways = { hit: 0, left: 0, right: 0, short: 0 };
  const greens = rate(), scrambling = rate(), c1 = rate(), c2 = rate();
  const full: Record<9 | 18, TrendPoint[]> = { 9: [], 18: [] };
  const puttRounds: number[] = [];
  let putts = 0, puttGreens = 0, penalties = 0, holes = 0;
  const trend: TrendPoint[] = [];

  // A round against the same account's other rounds on that course and layout.
  const keyOf = (r: Round) => `${r.courseId ?? r.courseName}|${r.layoutId ?? ''}|${r.pars.length}`;
  const byCourse = new Map<string, number[]>();
  for (const r of rounds) {
    const me = playerFor(r, userId)!;
    const t = playerTotals(r, me.id);
    if (t.played === r.pars.length) byCourse.set(keyOf(r), [...(byCourse.get(keyOf(r)) || []), t.strokes]);
  }

  for (const r of rounds) {
    const me = playerFor(r, userId)!;
    const list = r.scores[me.id] || [];
    const t = playerTotals(r, me.id);
    let roundPutts = 0, puttHoles = 0;
    list.forEach((s, i) => {
      if (!s) return;
      const par = r.pars[i];
      holes++;
      spread[scoreName(s.strokes, par)!]++;
      (byParLists[par] ||= []).push(s.strokes - par);
      penalties += s.penalties || 0;
      if (s.fairway && par >= 4) fairways[s.fairway]++;
      const gir = hitGreen(s, par);
      if (gir !== null) {
        greens.tries++;
        if (gir) { greens.made++; puttGreens++; putts += s.putts!; }
        else { scrambling.tries++; if (s.strokes <= par) scrambling.made++; }
      }
      if (s.putts !== undefined) { roundPutts += s.putts; puttHoles++; }
      if (s.c1) { c1.made += s.c1[0]; c1.tries += s.c1[1]; }
      if (s.c2) { c2.made += s.c2[0]; c2.tries += s.c2[1]; }
    });
    if (puttHoles === r.pars.length) puttRounds.push(roundPutts);
    if (t.played !== r.pars.length) continue;
    const others = byCourse.get(keyOf(r)) || [];
    const vsCourse = others.length > 1 ? t.strokes - (others.reduce((a, b) => a + b, 0) - t.strokes) / (others.length - 1) : null;
    const point: TrendPoint = { roundId: r.id, date: r.date, courseName: r.courseName, holes: r.pars.length, strokes: t.strokes, toPar: t.toPar, vsCourse: round1(vsCourse) };
    trend.push(point);
    if (r.pars.length === 18 || r.pars.length === 9) full[r.pars.length].push(point);
  }

  const average = (n: 9 | 18) => ({
    strokes: round1(avg(full[n].map((p) => p.strokes))),
    toPar: round1(avg(full[n].map((p) => p.toPar))),
    rounds: full[n].length,
  });
  const best = (n: 9 | 18) => full[n].reduce<TrendPoint | null>((b, p) => (!b || p.toPar < b.toPar ? p : b), null);

  return {
    sport,
    rounds: rounds.length,
    holes,
    average: { 9: average(9), 18: average(18) },
    best: { 9: best(9), 18: best(18) },
    byPar: Object.fromEntries(Object.entries(byParLists).map(([par, xs]) => [par, round1(avg(xs))])),
    spread,
    penaltiesPerRound: rounds.length ? round1(penalties / rounds.length) : null,
    fairways,
    greens,
    scrambling,
    puttsPerRound: round1(avg(puttRounds)),
    puttsPerGreen: puttGreens ? Math.round((putts / puttGreens) * 100) / 100 : null,
    c1,
    c2,
    trend,
    handicap: sport === 'golf' ? handicapHistory(rounds, (r) => playerFor(r, userId)?.id ?? null) : [],
  };
}

export type ThrowRecord = {
  roundId: string;
  hole: number;
  kind: 'drive' | 'approach' | 'other';
  clubId?: string;
  discId?: string;
  /** Metres. */
  distance: number;
  /** Metres right (+) or left (−) of the tee-to-target line, for drives on holes with a known target. */
  offline: number | null;
  /** Degrees right (+) or left (−) of that line. */
  angle: number | null;
  from: Round['shots'][number]['from'];
  to: NonNullable<Round['shots'][number]['to']>;
};

/** Every finished shot this account marked, with how far it went and how far off line. */
export function throwsFor(rounds: Round[], userId: string, courses: Course[]): ThrowRecord[] {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const out: ThrowRecord[] = [];
  for (const r of rounds) {
    const me = playerFor(r, userId);
    if (!me) continue;
    const layout = courseById.get(r.courseId || '')?.layouts.find((l) => l.id === r.layoutId);
    for (const s of r.shots) {
      if (s.playerId !== me.id || s.deleted || s.lost || !s.to) continue;
      const target = layout?.holes[s.hole]?.target;
      const line = s.kind === 'drive' && target ? offLine(s.from, target, s.to) : null;
      const d = distance(s.from, s.to);
      out.push({
        roundId: r.id,
        hole: s.hole,
        kind: s.kind,
        clubId: s.clubId,
        discId: s.discId,
        distance: d,
        offline: line ? line.offline : null,
        angle: line && d > 0 ? (Math.asin(Math.max(-1, Math.min(1, line.offline / d))) * 180) / Math.PI : null,
        from: s.from,
        to: s.to,
      });
    }
  }
  return out;
}

export type DistanceSummary = { count: number; average: number; longest: number; leftRight: { left: number; right: number; average: number | null } };

/** Distances (metres) for a group of throws, and how they miss left and right. */
export function summarizeThrows(throws: ThrowRecord[]): DistanceSummary | null {
  if (!throws.length) return null;
  const sides = throws.filter((t) => t.offline !== null).map((t) => t.offline!);
  return {
    count: throws.length,
    average: throws.reduce((a, t) => a + t.distance, 0) / throws.length,
    longest: Math.max(...throws.map((t) => t.distance)),
    leftRight: {
      left: sides.filter((x) => x < -5).length,
      right: sides.filter((x) => x > 5).length,
      average: avg(sides),
    },
  };
}

/** Average score on each hole of a course layout, from this account's finished rounds. */
export function holeAverages(rounds: Round[], userId: string, courseId: string, layoutId: string | null) {
  const sums: { strokes: number; count: number; par: number }[] = [];
  for (const r of rounds) {
    if (r.courseId !== courseId || r.layoutId !== layoutId || !r.finishedAt) continue;
    const me = playerFor(r, userId);
    if (!me) continue;
    r.scores[me.id]?.forEach((s, i) => {
      if (!s) return;
      sums[i] ||= { strokes: 0, count: 0, par: r.pars[i] };
      sums[i].strokes += s.strokes;
      sums[i].count++;
    });
  }
  return sums.map((s) => (s ? { average: Math.round((s.strokes / s.count) * 100) / 100, par: s.par, count: s.count } : null));
}
