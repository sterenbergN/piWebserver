// A World Handicap System estimate. It needs a course rating and slope for the
// tees played, which come from the scorecard; rounds without them don't count.
// Simplified from the real rules: no playing-conditions adjustment, no caps on
// how fast the index can rise, and two 9-hole rounds add up to one 18.

import type { Round } from './types';

export const MAX_INDEX = 54;

/** Best-of table: with n differentials, average the lowest `count` and add `adjust`. */
const TABLE: [min: number, count: number, adjust: number][] = [
  [20, 8, 0], [19, 7, 0], [17, 6, 0], [15, 5, 0], [12, 4, 0], [9, 3, 0], [7, 2, 0], [6, 2, -1], [5, 1, 0], [4, 1, -1], [3, 1, -2],
];

/** Handicap index from differentials, oldest first; null with fewer than 3. */
export function handicapIndex(differentials: number[]): number | null {
  const recent = differentials.slice(-20);
  const row = TABLE.find(([min]) => recent.length >= min);
  if (!row) return null;
  const [, count, adjust] = row;
  const best = [...recent].sort((a, b) => a - b).slice(0, count);
  const index = best.reduce((a, b) => a + b, 0) / count + adjust;
  return Math.min(MAX_INDEX, Math.round(index * 10) / 10);
}

/** Strokes received over the holes played. A 9-hole round uses half the index. */
export function courseHandicap(index: number, slope: number, rating: number, par: number, holes: number) {
  const i = holes <= 9 ? index / 2 : index;
  return Math.round(i * (slope / 113) + (rating - par));
}

/** Strokes received on a hole of stroke index `si` (1 = hardest). Plus handicaps give strokes back on the easiest. */
export function strokesOnHole(courseHcp: number, si: number, holes: number) {
  if (courseHcp >= 0) return Math.floor(courseHcp / holes) + (si <= courseHcp % holes ? 1 : 0);
  const back = -courseHcp;
  return -(Math.floor(back / holes) + (si > holes - (back % holes) ? 1 : 0)) || 0;
}

/**
 * The player's score with each hole capped at net double bogey (par + 2 + strokes
 * received), or at par + 5 before there's an index. Null unless every hole is scored.
 */
export function adjustedGross(round: Round, playerId: string, courseHcp: number | null) {
  const list = round.scores[playerId];
  if (!list || list.some((s) => !s)) return null;
  const holes = round.pars.length;
  return list.reduce((sum, s, i) => {
    const par = round.pars[i];
    // Without stroke indexes from the card, the holes are ranked in order.
    const si = round.si?.[i] ?? i + 1;
    const cap = courseHcp === null ? par + 5 : par + 2 + strokesOnHole(courseHcp, si, holes);
    return sum + Math.min(s!.strokes, cap);
  }, 0);
}

export function differential(adjusted: number, rating: number, slope: number) {
  return Math.round((113 / slope) * (adjusted - rating) * 10) / 10;
}

export type HandicapEntry = { roundId: string; date: string; holes: number; differential: number; index: number | null };

/**
 * Walk a player's golf rounds in date order, working out each differential with the
 * index they had going in. `playerOf` names the player in each round (or null).
 */
export function handicapHistory(rounds: Round[], playerOf: (round: Round) => string | null): HandicapEntry[] {
  const out: HandicapEntry[] = [];
  const counted: number[] = [];
  let pendingNine: number | null = null;
  const sorted = rounds
    .filter((r) => r.sport === 'golf' && r.finishedAt && r.rating && r.slope && (r.pars.length === 9 || r.pars.length === 18))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const round of sorted) {
    const playerId = playerOf(round);
    if (!playerId) continue;
    const index = handicapIndex(counted);
    const holes = round.pars.length;
    const par = round.pars.reduce((a, b) => a + b, 0);
    const hcp = index === null ? null : courseHandicap(index, round.slope!, round.rating!, par, holes);
    const adjusted = adjustedGross(round, playerId, hcp);
    if (adjusted === null) continue;
    const diff = differential(adjusted, round.rating!, round.slope!);
    if (holes === 18) counted.push(diff);
    else if (pendingNine === null) pendingNine = diff;
    else { counted.push(Math.round((pendingNine + diff) * 10) / 10); pendingNine = null; }
    out.push({ roundId: round.id, date: round.date, holes, differential: diff, index: handicapIndex(counted) });
  }
  return out;
}
