import type { ControllerConfig } from './controllers';
import { rng } from './linalg';
import type { Params, ProcessDef, Scenario } from './model';
import { scorecard, type Scorecard } from './score';
import { runScenario, type Run } from './sim';

// Robustness in time: the same test on plants that have drifted within the spread each
// process lists for its uncertain parameters, with the controller keeping its tuning. The
// scorecard's margins judge that spread on the linearized loop; this runs it, so whatever
// the margins can't see (limits, saturation, the nonlinear plant away from the operating
// point) shows up too.

/** Factors on each uncertain parameter, drawn evenly within its spread; the same draws every time. */
export function driftedPlants(proc: ProcessDef, samples = 8, seed = 11): Record<string, number>[] {
  const r = rng(seed);
  return Array.from({ length: samples }, () =>
    Object.fromEntries(proc.uncertain.map((u) => [u.key, 1 + u.spread * (2 * r.next() - 1)])));
}

export type DriftedRun = { factors: Record<string, number>; run: Run; card: Scorecard };

/** One test on a drifted plant: the plant as it really is from the start, the controller as set up. */
export function runDrifted(proc: ProcessDef, params: Params, controller: ControllerConfig, scenario: Scenario, factors: Record<string, number>): DriftedRun {
  const drifted: Scenario = {
    ...scenario,
    events: [...Object.entries(factors).map(([key, factor]) => ({ t: 0, kind: 'param' as const, key, factor })), ...scenario.events],
  };
  const run = runScenario(proc, { params, controller }, drifted);
  return { factors, run: { ...run, scenario }, card: scorecard(proc, params, controller, [run], false) };
}

/** The worst of each measure over a set of runs (Infinity where any never settled or recovered). */
export function worstOf(cards: Scorecard[]) {
  const max = (f: (c: Scorecard) => number) => (cards.length ? Math.max(...cards.map(f)) : NaN);
  return {
    iae: max((c) => c.iae),
    overshoot: max((c) => c.worstOvershoot),
    settling: max((c) => c.worstSettling),
    peak: max((c) => c.worstPeak),
    recovery: max((c) => c.worstRecovery),
    /** Runs that never settled after a step or never recovered from an upset the valve could reject. */
    failed: cards.filter((c) => !Number.isFinite(c.worstSettling) || !Number.isFinite(c.worstRecovery)).length,
  };
}
