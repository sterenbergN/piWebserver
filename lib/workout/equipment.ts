// Shared equipment math used by both the tracker UI and the progression API so
// the weights the engine suggests are always reachable with the +/- buttons.

export type StationLike = {
  type?: string;
  minWeight?: number;
  maxWeight?: number;
  increment?: number;
  additionalWeights?: number[];
  additionalWeight?: number; // legacy single add-on weight
  dumbbellPairs?: number[];
  baseWeight?: number;
  plateSets?: number[];
  bodyWeightAdditions?: number[];
} | null | undefined;

const DEFAULT_WEIGHTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
/** Guard against misconfigured stations (e.g. increment 0.01 over 0–10000). */
const MAX_LADDER_STEPS = 2000;

function roundWeight(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveNumbers(values: unknown): number[] {
  return Array.isArray(values)
    ? values.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values.map(roundWeight))).sort((a, b) => a - b);
}

/** Read-time backward compat: convert singular additionalWeight to array */
export function getAdditionalWeights(station: StationLike): number[] {
  const list = positiveNumbers(station?.additionalWeights);
  if (list.length > 0) return list;
  const legacy = Number(station?.additionalWeight);
  return Number.isFinite(legacy) && legacy > 0 ? [legacy] : [];
}

/** All distinct sums of any subset of `values` (each value usable once). */
function subsetSums(values: number[]): number[] {
  const sums = new Set<number>([0]);
  for (const value of values) {
    for (const existing of Array.from(sums)) {
      sums.add(roundWeight(existing + value));
    }
  }
  return Array.from(sums);
}

/**
 * Every weight the station can actually be set to, ascending.
 * `scaleFactor` converts machine-labelled weight to calibrated weight.
 */
export function getPossibleWeights(station: StationLike, scaleFactor = 1): number[] {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  if (!station) return DEFAULT_WEIGHTS;

  if (station.type === 'stack' || station.type === 'cable') {
    const increment = Number(station.increment) > 0 ? Number(station.increment) : 10;
    const minWeight = Number.isFinite(Number(station.minWeight)) && Number(station.minWeight) >= 0 ? Number(station.minWeight) : 10;
    const maxWeight = Number(station.maxWeight) > 0 ? Number(station.maxWeight) : 300;
    // Add-ons are separate options (a +5 or a +10 magnet), never stacked
    // together — unlike plates, a 15 only exists if it's listed.
    const additions = [0, ...getAdditionalWeights(station)];

    const possible: number[] = [];
    for (let step = 0; step <= MAX_LADDER_STEPS; step++) {
      const w = minWeight + step * increment;
      if (w > maxWeight + 1e-9) break;
      for (const add of additions) {
        possible.push((w + add) * scale);
      }
    }
    return uniqueSorted(possible);
  }

  if (station.type === 'dumbbells') {
    const pairs = positiveNumbers(station.dumbbellPairs);
    return uniqueSorted(pairs.length > 0 ? pairs : [5, 10, 15, 20, 25]);
  }

  if (station.type === 'plates') {
    const base = Number.isFinite(Number(station.baseWeight)) ? Number(station.baseWeight) : 45;
    const plates = positiveNumbers(station.plateSets);
    if (plates.length === 0) return [base];
    // plateSets lists the plates available for ONE side; each is loaded on both.
    return uniqueSorted(subsetSums(plates).map((half) => base + half * 2));
  }

  if (station.type === 'bodyweight') {
    return uniqueSorted([0, ...positiveNumbers(station.bodyWeightAdditions)]);
  }

  return [0, 5, 10, 15];
}

/** Snap a weight to the nearest value the station supports. */
export function snapToPossibleWeight(weight: number, possible: number[]): number {
  if (possible.length === 0) return weight;
  return possible.reduce((best, current) =>
    Math.abs(current - weight) < Math.abs(best - weight) ? current : best
  );
}

/** Move one step up or down the station's weight ladder. */
export function stepWeight(current: number, direction: 1 | -1, possible: number[]): number {
  if (possible.length === 0) return Math.max(0, current + 5 * direction);
  const idx = possible.findIndex((w) => Math.abs(w - current) < 1e-6);
  if (idx === -1) {
    // Off-ladder (e.g. equipment changed): move to the nearest rung in that direction.
    if (direction === 1) return possible.find((w) => w > current) ?? possible[possible.length - 1];
    return [...possible].reverse().find((w) => w < current) ?? possible[0];
  }
  const nextIdx = Math.min(possible.length - 1, Math.max(0, idx + direction));
  return possible[nextIdx];
}

/**
 * Plates to load on EACH side to reach `targetWeight`, loading the biggest
 * plates possible the way people do in a gym (185 → 45 + 25 per side, never
 * 35 + 35). Unlike a plain greedy pass, this still finds a combination whenever
 * one exists (e.g. 30/side from [25, 15, 15] → 15 + 15, where greedy picks 25
 * and fails). Returns null if the exact weight can't be built.
 */
export function calculatePlates(targetWeight: number, baseWeight: number, availablePlates: number[]): number[] | null {
  const perSide = roundWeight((targetWeight - baseWeight) / 2);
  if (perSide < 0) return null;
  if (perSide === 0) return [];

  const toCents = (value: number) => Math.round(value * 100);
  const targetCents = toCents(perSide);
  const plates = positiveNumbers(availablePlates).sort((a, b) => b - a);

  // Heaviest-first: compare plate lists (each sorted biggest first) element by
  // element, so [45, 25] beats [35, 35] and [45] beats [25, 10, 10].
  const heavier = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] > b[i];
    return a.length < b.length;
  };

  // best[sum] = heaviest-first plates reaching that sum (each physical plate used
  // once). Plates are added biggest first, so every list stays sorted.
  let best = new Map<number, number[]>([[0, []]]);
  for (const plate of plates) {
    const plateCents = toCents(plate);
    const next = new Map(best);
    for (const [sum, used] of best) {
      const newSum = sum + plateCents;
      if (newSum > targetCents) continue;
      const candidate = [...used, plate];
      const existing = next.get(newSum);
      if (!existing || heavier(candidate, existing)) next.set(newSum, candidate);
    }
    best = next;
  }

  const result = best.get(targetCents);
  return result ? [...result].sort((a, b) => b - a) : null;
}
