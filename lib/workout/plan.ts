import type { FixedLiftRef } from './types';
import { normalizeLiftKey } from './calibration-utils';

type PlanLift = { id: string; name: string; primaryMuscle?: string; secondaryMuscle?: string; [key: string]: any };

function shuffle<T>(items: T[], random = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Pick lifts for a workout:
 * 1. Pinned template lifts first, in order (matched by id, else by name so a
 *    template works at another gym).
 * 2. One lift per target muscle not yet covered.
 * 3. Random fill from lifts matching the target muscles, up to `count`.
 * Lifts not done in the last few workouts are preferred so sessions rotate.
 */
export function buildLiftPlan(
  availableLifts: PlanLift[],
  targetMuscles: string[],
  count: number,
  history: { timestamp?: string; logs?: Record<string, unknown> }[] = [],
  fixedLifts: FixedLiftRef[] = [],
  random: () => number = Math.random,
): PlanLift[] {
  const recentlyUsed = new Map<string, number>();
  [...history]
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, 3)
    .forEach((workout, age) => {
      Object.keys(workout.logs || {}).forEach((liftId) => {
        if (!recentlyUsed.has(liftId)) recentlyUsed.set(liftId, age);
      });
    });

  // Unused lifts first, then the ones done longest ago; random within a tier.
  const freshness = (lift: PlanLift) => (recentlyUsed.has(lift.id) ? recentlyUsed.get(lift.id)! : 99);
  const ordered = shuffle(availableLifts, random).sort((a, b) => freshness(b) - freshness(a));
  const matchesMuscles = (lift: PlanLift, muscles: string[]) =>
    muscles.includes(lift.primaryMuscle || '') || muscles.includes(lift.secondaryMuscle || '');

  const plan: PlanLift[] = [];
  const usedIds = new Set<string>();
  const add = (lift: PlanLift) => {
    usedIds.add(lift.id);
    plan.push(lift);
  };

  // Phase 0: pinned lifts (always included, even beyond `count`)
  for (const ref of fixedLifts) {
    const key = normalizeLiftKey(ref.name);
    const match = availableLifts.find((l) => l.id === ref.liftId)
      || availableLifts.find((l) => !usedIds.has(l.id) && normalizeLiftKey(l.name) === key);
    if (match && !usedIds.has(match.id)) add(match);
  }

  // Phase 1: one lift per target muscle not already covered (primary matches preferred)
  for (const muscle of targetMuscles) {
    if (plan.length >= count) break;
    if (plan.some((l) => l.primaryMuscle === muscle)) continue;
    const pick = ordered.find((l) => !usedIds.has(l.id) && l.primaryMuscle === muscle)
      || ordered.find((l) => !usedIds.has(l.id) && l.secondaryMuscle === muscle);
    if (pick) add(pick);
  }

  // Phase 2: random fill up to the requested lift count
  const pool = targetMuscles.length > 0 ? ordered.filter((l) => matchesMuscles(l, targetMuscles)) : ordered;
  for (const lift of pool) {
    if (plan.length >= count) break;
    if (!usedIds.has(lift.id)) add(lift);
  }

  return plan;
}
