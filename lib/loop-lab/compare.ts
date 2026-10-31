import { BASELINE_OVERRIDE, CONTROLLER_KINDS, defaultController, isAvailable, type ControllerConfig, type ControllerKind } from './controllers';
import { cleanParams, measuredDisturbances, type Params, type ProcessDef } from './model';
import { plantSummary } from './plant';
import { balancePoint } from './processes/jacket';
import { scorecard, type Scorecard, type TestScore } from './score';
import { runAll } from './sim';
import { autoTune, tuningCandidates } from './tuning';

// Every controller on a process, tuned the same way and put through the same
// tests, so the numbers can be compared directly. Most processes want the least
// error. A surge tank doesn't: its level is there to move, so there the goal is
// the calmest outflow that keeps the level in the tank.

export type CompareGoal = 'error' | 'calm';
export const goalOf = (proc: ProcessDef): CompareGoal => (proc.averaging ? 'calm' : 'error');

/** A surge tank's level must stay this close to its setpoint (% of span): at 50 it is overflowing or running dry. */
const CALM_PEAK_LIMIT = 45;
/** Moving a valve this many times more than is typical on the process, and more than this many strokes an hour, is wearing it out, whatever the error. */
const WEAR_LIMIT = { times: 10, strokes: 50 };
/** Above this peak sensitivity a loop still counts as stable, but only just. */
export const FRAGILE_MS = 3;
/** What they drive is an electric drive or a temperature unit's setpoint, not a valve: movement isn't wear. */
const NO_WEAR = new Set(['crane', 'servo', 'maglev', 'batch']);
/** A tuning has to keep this peak sensitivity over the plant's spread, unless none of them can. */
const MS_LIMIT = 2;
/** "As good" means within this factor of the best. */
export const GOOD_ENOUGH = 1.25;

/** One test's numbers. Null where it doesn't apply (no setpoint step in it) or it never happened (never settled). */
export type TestNumbers = {
  iae: number; travel: number;
  /** The sharpest valve move, % per minute. */
  sharpest: number;
  overshoot: number | null; settling: number | null; peak: number | null; recovery: number | null;
  /** Everything in the test settled or recovered. */
  settled: boolean;
  /** The test's limit was exceeded. */
  overLimit: boolean;
};

export type CompareRow = {
  id: string;
  kind: ControllerKind;
  rung: number;
  label: string;
  config: ControllerConfig;
  /** A change to the plant that goes with it (the fix isn't always in the controller). */
  plant?: Params;
  tests: TestNumbers[];
  iae: number; travel: number; worstPeak: number;
  overshoot: number; settling: number | null; recovery: number | null;
  ms: number | null;
  /** Stable at every operating point with the plant anywhere in its spread. */
  stable: boolean;
  tuningParams: number;
  needsModel: string | null;
  commissioning: number;
  maintainability: number;
};

export type Comparison = {
  process: string;
  goal: CompareGoal;
  tests: { id: string; name: string; limit?: string }[];
  rows: CompareRow[];
  /** Controllers left out, and why. */
  notApplicable: { label: string; reason: string }[];
};

const sig = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(4)) : v);
const orNull = (v: number) => (Number.isFinite(v) ? sig(v) : null);
const tick = () => new Promise<void>((r) => setTimeout(r));

function testNumbers(t: TestScore): TestNumbers {
  const settledSteps = t.steps.every((s) => s.settling !== null);
  const recovered = t.upsets.every((u) => u.recovery !== null || u.limited);
  return {
    iae: sig(t.iae), travel: sig(t.travel), sharpest: sig(t.sharpest),
    overshoot: t.steps.length ? sig(Math.max(...t.steps.map((s) => s.overshoot))) : null,
    settling: t.steps.length && settledSteps ? sig(Math.max(...t.steps.map((s) => s.settling ?? 0))) : null,
    peak: t.upsets.length ? sig(Math.max(...t.upsets.map((u) => u.peak))) : null,
    recovery: t.upsets.length && recovered ? sig(Math.max(...t.upsets.map((u) => u.recovery ?? 0))) : null,
    settled: settledSteps && recovered,
    overLimit: t.overLimit,
  };
}

/** The average of some ratios, each counting the same however big its test happens to be. */
const geoMean = (xs: number[]) => Math.exp(xs.reduce((sum, x) => sum + Math.log(Math.max(x, 1e-12)), 0) / Math.max(xs.length, 1));

/** What a tuning is compared with: PI on the same tests. */
export type TuneRef = { iae: number[]; travel: number };
const refOf = (s: Scorecard): TuneRef => ({ iae: s.tests.map((t) => t.iae), travel: s.travel });

/**
 * What the tuning is judged on: lower is better. Error relative to PI in each test, so one big test can't
 * drown out the others, with a growing cost for wearing out the valve; or, for averaging, how sharply the outflow moves.
 */
function tuningCost(goal: CompareGoal, s: Scorecard, ref: TuneRef) {
  if (goal === 'calm') return geoMean(s.tests.map((t) => t.sharpest + 1e-6)) * (s.worstPeak > CALM_PEAK_LIMIT ? 1000 * (s.worstPeak / CALM_PEAK_LIMIT) : 1);
  const failed = s.tests.filter((t) => t.steps.some((x) => x.settling === null) || t.upsets.some((u) => u.recovery === null && !u.limited)).length;
  return geoMean(s.tests.map((t, i) => t.iae / Math.max(ref.iae[i], 1e-9))) * (1 + 0.15 * Math.log2(1 + s.travel / Math.max(ref.travel, 1e-9))) * 1.25 ** failed;
}

export type TuneResult = { config: ControllerConfig; score: Scorecard; tried: number; note: string };

/**
 * The tuning that does best on the tests. Everything worth trying (from the rules, at a range of speeds)
 * runs through every test, and the best that stays stable and robust over the plant's spread wins.
 */
export async function tuneOnTests(proc: ProcessDef, params: Params, config: ControllerConfig,
  opts: { ref?: TuneRef; onStep?: () => void } = {}): Promise<TuneResult> {
  const goal = goalOf(proc);
  const setup = (c: ControllerConfig) => ({ params, controller: c });
  let ref = opts.ref;
  if (!ref) {
    const pi = autoTune(proc, params, withoutD(defaultController('pid', proc)))?.config ?? defaultController('pid', proc);
    ref = refOf(scorecard(proc, params, pi, runAll(proc, setup(pi)), false));
  }
  const tried = tuningCandidates(proc, params, config).map((c) => {
    const s = scorecard(proc, params, c, runAll(proc, setup(c)), false);
    return { c, cost: tuningCost(goal, s, ref!) };
  }).filter((x) => Number.isFinite(x.cost)).sort((a, b) => a.cost - b.cost);
  opts.onStep?.();
  await tick();
  if (!tried.length) {
    return { config, score: scorecard(proc, params, config, runAll(proc, setup(config))), tried: 0, note: 'Nothing tried stayed finite on the tests.' };
  }
  // The robustness check costs more than the tests do: only as many as it takes.
  let first: { c: ControllerConfig; score: Scorecard } | null = null, stableOnly: { c: ControllerConfig; score: Scorecard } | null = null;
  for (const x of tried.slice(0, 8)) {
    const score = scorecard(proc, params, x.c, runAll(proc, setup(x.c)), true);
    first ??= { c: x.c, score };
    if (score.stableAll) stableOnly ??= { c: x.c, score };
    // A hair over the limit isn't a different kind of loop.
    if (score.stableAll && (!score.robust || !Number.isFinite(score.worstMs) || score.worstMs <= MS_LIMIT * 1.02)) {
      return { config: x.c, score, tried: tried.length, note: `Tried ${tried.length} tunings on all ${proc.scenarios.length} tests; this one does best while staying robust (Ms ≤ ${MS_LIMIT}) over the plant’s spread.` };
    }
    await tick();
  }
  const best = stableOnly ?? first!;
  return {
    config: best.c, score: best.score, tried: tried.length,
    note: stableOnly
      ? `Tried ${tried.length} tunings on all ${proc.scenarios.length} tests. None keeps Ms ≤ ${MS_LIMIT} over the plant’s spread; this is the best that at least stays stable.`
      : `Tried ${tried.length} tunings on all ${proc.scenarios.length} tests. None stays stable over the whole of the plant’s spread: this controller doesn’t suit this plant.`,
  };
}

const withoutD = (c: ControllerConfig): ControllerConfig => (c.kind === 'pid' ? { ...c, pid: { ...c.pid, Td: 0 } } : c);

/** What a process offers each rung, and why not when it doesn't. */
function whyNot(proc: ProcessDef, params: Params, kind: ControllerKind): string | null {
  if (kind === 'custom') return 'your own code: nothing to tune automatically';
  if (!isAvailable(proc, kind)) {
    const needs: Partial<Record<ControllerKind, string>> = {
      characterized: 'no known nonlinearity to invert', feedforward: 'no measured disturbance', cascade: 'no inner measurement',
      ratio: 'no wild flow to follow', multiloop: 'one variable, one valve', mpc: 'one variable, one valve',
    };
    return proc.mimo ? 'it controls one variable with one valve; this process has two of each' : needs[kind] ?? 'not available here';
  }
  if (kind === 'override' && !BASELINE_OVERRIDE[proc.id]) return 'no limit to protect here';
  if (kind === 'smith') {
    const s = plantSummary(proc, params);
    if (!s || s.integrating || s.tau <= 0 || !Number.isFinite(s.K)) return 'it needs a stable plant to predict';
    if (s.theta < 0.15 * s.tau) return 'hardly any dead time to take out';
  }
  return null;
}

/** The variants compared for a process: every rung that applies, and the combinations people actually weigh up. */
function variantsFor(proc: ProcessDef, params: Params) {
  const list: { id: string; label: string; kind: ControllerKind; make: () => ControllerConfig; plant?: Params }[] = [];
  const allMeasured = () => measuredDisturbances(proc).map((d) => ({ from: d.key, gain: 0, lead: 0, lag: 0 }));
  for (const k of CONTROLLER_KINDS) {
    const base = () => defaultController(k.kind, proc);
    if (k.kind === 'pid') {
      list.push({ id: 'pi', label: 'PI', kind: 'pid', make: () => withoutD(base()) });
      // Split-range: the same PI with the two valves' ranges balanced, a change to the plant rather than the controller.
      if (proc.split) list.push({ id: 'pi-balanced', label: 'PI, split balanced', kind: 'pid', make: () => withoutD(base()), plant: { split: Math.round(balancePoint(params)) } });
      const withD = () => { const c = base() as Extract<ControllerConfig, { kind: 'pid' }>; return { ...c, pid: { ...c.pid, Td: c.pid.Td || 1 } }; };
      list.push({ id: 'pid', label: 'PID', kind: 'pid', make: withD });
      if (proc.split) list.push({ id: 'pid-balanced', label: 'PID, split balanced', kind: 'pid', make: withD, plant: { split: Math.round(balancePoint(params)) } });
    } else if (k.kind === 'feedforward') {
      list.push({ id: k.kind, label: k.short, kind: k.kind, make: () => ({ ...base(), ff: allMeasured() }) as ControllerConfig });
    } else if (k.kind === 'cascade') {
      list.push({ id: k.kind, label: k.short, kind: k.kind, make: base });
      if (measuredDisturbances(proc).length) list.push({ id: 'cascade-ff', label: 'Cascade + feedforward', kind: k.kind, make: () => ({ ...base(), ff: allMeasured() }) as ControllerConfig });
    } else if (k.kind === 'multiloop') {
      list.push({ id: k.kind, label: 'Two loops', kind: k.kind, make: base });
      list.push({ id: 'multiloop-dec', label: 'Two loops + decoupler', kind: k.kind, make: () => ({ ...base(), decouple: true }) as ControllerConfig });
    } else list.push({ id: k.kind, label: k.short, kind: k.kind, make: base });
  }
  return list;
}

/** The whole comparison for a process. Takes a while: run it ahead of time, or with progress showing. */
export async function compareProcess(proc: ProcessDef, rawParams: Params, onProgress?: (done: number, total: number, label: string) => void): Promise<Comparison> {
  const params = cleanParams(proc, rawParams);
  const notApplicable: Comparison['notApplicable'] = [];
  const rows: CompareRow[] = [];
  const variants = variantsFor(proc, params);
  const pi = autoTune(proc, params, withoutD(defaultController('pid', proc)))?.config ?? withoutD(defaultController('pid', proc));
  const refScore = scorecard(proc, params, pi, runAll(proc, { params, controller: pi }), false);
  const ref = refOf(refScore);
  let done = 0;
  for (const v of variants) {
    const meta = CONTROLLER_KINDS.find((k) => k.kind === v.kind)!;
    const reason = whyNot(proc, params, v.kind);
    onProgress?.(done++, variants.length, v.label);
    await tick();
    if (reason) {
      if (!notApplicable.some((n) => n.label === meta.short)) notApplicable.push({ label: meta.short, reason });
      continue;
    }
    const { config, score } = await tuneOnTests(proc, v.plant ? { ...params, ...v.plant } : params, v.make(), { ref });
    // A PID whose rule gives no derivative is the PI again, and a schedule of identical gains is one PI.
    if (v.id.startsWith('pid') && config.kind === 'pid' && config.pid.Td === 0) { notApplicable.push({ label: 'PID', reason: 'the plant is close to first order: derivative has nothing to act on' }); continue; }
    if (v.kind === 'schedule' && config.kind === 'schedule') {
      const kc = config.points.map((p) => p.Kc);
      if (Math.max(...kc) <= 1.1 * Math.min(...kc)) { notApplicable.push({ label: meta.short, reason: 'the gain hardly changes over the range' }); continue; }
    }
    rows.push({
      id: v.id, kind: v.kind, rung: meta.rung, label: v.label, config, ...(v.plant ? { plant: v.plant } : {}),
      tests: score.tests.map(testNumbers),
      iae: sig(score.iae), travel: sig(score.travel), worstPeak: sig(score.worstPeak),
      overshoot: sig(score.worstOvershoot), settling: orNull(score.worstSettling), recovery: orNull(score.worstRecovery),
      ms: score.robust ? orNull(score.worstMs) : null,
      stable: score.stableAll,
      tuningParams: score.complexity.tuningParams, needsModel: score.complexity.needsModel,
      commissioning: score.complexity.commissioning, maintainability: score.complexity.maintainability,
    });
  }
  return { process: proc.id, goal: goalOf(proc), tests: proc.scenarios.map((s) => ({ id: s.id, name: s.name, ...(s.limit ? { limit: s.limit.label } : {}) })), rows, notApplicable };
}

// ─── Reading a comparison ───────────────────────────────────────────────────

/** Why a controller can't be called best here, whatever its numbers. Null if it can. */
export function outOfTheRunning(c: Comparison, row: CompareRow) {
  if (row.kind === 'onoff') return 'cycles by design';
  if (!row.stable) return 'unstable over the plant’s spread';
  if (c.goal === 'calm' && row.worstPeak > CALM_PEAK_LIMIT) return 'level close to the limits of the tank';
  if (!NO_WEAR.has(c.process) && row.travel > WEAR_LIMIT.strokes) {
    const others = c.rows.filter((r) => r.kind !== 'onoff').map((r) => r.travel).sort((a, b) => a - b);
    const typical = others[Math.floor(others.length / 2)];
    if (row.travel > WEAR_LIMIT.times * typical) return `wears the valve: ${Math.round(row.travel / typical)}× the usual travel`;
  }
  return null;
}
export const eligible = (c: Comparison, row: CompareRow) => outOfTheRunning(c, row) === null;

/**
 * Whether a controller's result in a test counts. It has to settle, unless the goal is a calm outflow (the level is
 * meant to wander) or the test has a limit: then keeping to it is the point, and it may mean giving up the setpoint.
 */
export const countsIn = (c: Comparison, row: CompareRow, i: number) => (c.tests[i].limit ? !row.tests[i].overLimit : c.goal === 'calm' || row.tests[i].settled);

export const metricOf = (c: Comparison, row: CompareRow, test: number) => (c.goal === 'calm' ? row.tests[test].sharpest : row.tests[test].iae);

/**
 * How a controller does over all the tests: on average, how many times the best number in each test (1 is the best
 * everywhere). Each test counts the same, however big its numbers. A test it failed (never settled, or broke the limit,
 * where others managed) scores no better than the worst of those still in the running.
 */
export function overallOf(c: Comparison, row: CompareRow) {
  const racing = c.rows.filter((r) => eligible(c, r));
  const pool = racing.length ? racing : c.rows.filter((r) => r.kind !== 'onoff');
  return geoMean(c.tests.map((_, i) => {
    const values = pool.map((r) => metricOf(c, r, i));
    const counted = pool.filter((r) => countsIn(c, r, i)).map((r) => metricOf(c, r, i));
    const best = Math.max(Math.min(...(counted.length ? counted : values)), 1e-12);
    const own = Math.max(1, metricOf(c, row, i) / best);
    return counted.length && !countsIn(c, row, i) ? Math.max(own, Math.max(...values) / best) : own;
  }));
}

export type Winner = { best: CompareRow; simplest: CompareRow };

/** The lowest number among those fit, and the least effort to commission and keep right within reach of it. */
function pick(c: Comparison, value: (row: CompareRow) => number, allowed: (row: CompareRow) => boolean): Winner | null {
  let pool = c.rows.filter((r) => eligible(c, r) && allowed(r));
  if (!pool.length) pool = c.rows.filter((r) => eligible(c, r));
  if (!pool.length) return null;
  const best = pool.reduce((a, b) => (value(b) < value(a) ? b : a));
  const effort = (r: CompareRow) => r.commissioning * 100 + r.tuningParams + r.rung / 100;
  const simplest = pool.filter((r) => value(r) <= value(best) * GOOD_ENOUGH + 1e-12).sort((x, y) => effort(x) - effort(y))[0] ?? best;
  return { best, simplest };
}

/** Who wins one test. One that never settled there only counts if nobody did. */
export const testWinner = (c: Comparison, i: number) => pick(c, (r) => metricOf(c, r, i), (r) => countsIn(c, r, i));
/** Who wins over all the tests. */
export const overallWinner = (c: Comparison) => pick(c, (r) => overallOf(c, r), () => true);
