import { approximate, linearizePlant, pathModel } from './linear';
import { cleanParams, defaultParams, type Params, type ParamSpec, type ProcessDef } from './model';

// The plant in three numbers (gain, time constant, dead time), how each
// setting moves them, and "make it…" goals that pick the setting that does
// what you ask. Everything is measured on the model, so it holds for every
// process, including an identified one.

export type PlantSummary = {
  /** % of span per % of valve (integrating: per second, see kPrime). */
  K: number;
  tau: number;
  theta: number;
  kPrime: number;
  integrating: boolean;
};

/** First-order-plus-dead-time view of valve → measurement at the nominal point, with half a controller cycle. */
export function plantSummary(proc: ProcessDef, raw: Params): PlantSummary | null {
  try {
    const p = cleanParams(proc, raw);
    const m = linearizePlant(proc, p, proc.nominalPv);
    const f = approximate(pathModel(m, m.C, m.theta), p.Ts / 2);
    if (!Number.isFinite(f.tau) || !Number.isFinite(f.theta)) return null;
    return { K: f.K, tau: f.tau, theta: f.theta, kPrime: f.kPrime, integrating: f.integrating && !Number.isFinite(m.K) };
  } catch {
    return null;
  }
}

/** Settings whose effect isn't on gain or speed: what they do instead. */
export const OTHER_EFFECTS: Record<string, string> = {
  valveChar: 'Changes how the gain varies across the valve\'s range, not the speed: see the installed-characteristic plot.',
  valveRate: 'Only limits big, fast moves (a large setpoint step or a saturated valve); small control moves never reach it.',
  valveDeadband: 'Adds stick-slip: the valve ignores small changes of direction, so a PI loop slowly winds up, jumps and cycles.',
  txNoise: 'Makes the reading noisier. Doesn\'t change the plant, but the controller passes the noise to the valve: more wear, less gain you can use.',
  Ts: 'How often the controller runs. Each cycle adds about half a cycle of dead time, so a slow cycle eats into the speed you can tune for.',
};

export type Effect = { dK: number; dTau: number; dTheta: number };

/** The test change used to measure a setting's effect: +20 %, or a small step from zero. */
function nudge(spec: ParamSpec, v: number) {
  if (Math.abs(v) > 1e-12) return Math.min(spec.max, v * 1.2);
  return Math.min(spec.max, v + (spec.step ? spec.step * 10 : (spec.max - spec.min) * 0.05));
}

const rel = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) > 1e-12 ? (b - a) / Math.abs(a) : 0);

/** How raising each numeric setting moves gain, time constant and dead time (relative changes). */
export function settingEffects(proc: ProcessDef, raw: Params): Record<string, Effect> {
  const p = cleanParams(proc, raw);
  const base = plantSummary(proc, p);
  const out: Record<string, Effect> = {};
  if (!base) return out;
  const gain = (s: PlantSummary) => (s.integrating ? s.kPrime : s.K);
  for (const spec of proc.params) {
    if (spec.options || (OTHER_EFFECTS[spec.key] && spec.key !== 'Ts')) continue;
    const v = p[spec.key];
    const up = nudge(spec, v);
    if (up === v) continue;
    const s = plantSummary(proc, { ...p, [spec.key]: up });
    if (!s) continue;
    out[spec.key] = { dK: rel(gain(base), gain(s)), dTau: rel(base.tau, s.tau), dTheta: rel(base.theta, s.theta) };
  }
  return out;
}

/** The effect in words: "slower (τ +18 %), less gain (K −9 %)". Empty when nothing moves noticeably. */
export function describeEffect(e: Effect | undefined) {
  if (!e) return '';
  const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} %`;
  const parts: string[] = [];
  if (Math.abs(e.dTau) >= 0.03) parts.push(`${e.dTau > 0 ? 'slower' : 'faster'} (τ ${pct(e.dTau)})`);
  if (Math.abs(e.dTheta) >= 0.03) parts.push(`${e.dTheta > 0 ? 'more' : 'less'} dead time (θ ${pct(e.dTheta)})`);
  if (Math.abs(e.dK) >= 0.03) parts.push(`${e.dK > 0 ? 'more' : 'less'} gain (K ${pct(e.dK)})`);
  return parts.join(', ');
}

// ─── Goals ──────────────────────────────────────────────────────────────────

export type GoalId = 'slower' | 'faster' | 'deadtime' | 'gainUp' | 'gainDown' | 'noisy' | 'worn';

export const GOALS: { id: GoalId; label: string; hint: string }[] = [
  { id: 'slower', label: 'Slower to respond', hint: 'Longer time constant: takes longer to get there.' },
  { id: 'faster', label: 'Faster to respond', hint: 'Shorter time constant.' },
  { id: 'deadtime', label: 'More dead time', hint: 'A longer wait before anything happens: the hardest thing for a controller.' },
  { id: 'gainUp', label: 'More gain', hint: 'The PV moves more per % of valve.' },
  { id: 'gainDown', label: 'Less gain', hint: 'The PV moves less per % of valve.' },
  { id: 'noisy', label: 'Noisier reading', hint: 'More measurement noise.' },
  { id: 'worn', label: 'Worn valve', hint: 'Sticky and slow: deadband and a slower actuator.' },
];

export type GoalResult = {
  params: Params;
  changes: { key: string; label: string; unit: string; from: number; to: number }[];
  before: PlantSummary | null;
  after: PlantSummary | null;
};

/**
 * Make the plant do what the goal asks by changing the setting that does it
 * most on this process: a physical (process) setting where one does,
 * otherwise an instrument. Each step is a factor of 1.5.
 */
export function applyGoal(proc: ProcessDef, raw: Params, goal: GoalId): GoalResult | null {
  const p = cleanParams(proc, raw);
  const before = plantSummary(proc, p);
  const spec = (key: string) => proc.params.find((s) => s.key === key)!;
  const clampTo = (key: string, v: number) => Math.min(spec(key).max, Math.max(spec(key).min, v));
  const set: Params = {};

  if (goal === 'noisy') set.txNoise = clampTo('txNoise', Math.max(0.5, p.txNoise * 2));
  else if (goal === 'worn') {
    set.valveDeadband = clampTo('valveDeadband', Math.max(1, p.valveDeadband + 0.5));
    set.valveTau = clampTo('valveTau', p.valveTau * 2);
  } else if (goal === 'deadtime') {
    set.txDelay = clampTo('txDelay', p.txDelay + 0.5 * Math.max(before?.theta ?? 1, 0.2));
  } else {
    const metric = goal === 'slower' || goal === 'faster' ? 'dTau' : 'dK';
    const dir = goal === 'slower' || goal === 'gainUp' ? 1 : -1;
    const effects = settingEffects(proc, p);
    // Best lever: the biggest effect on the metric, physical settings first.
    const pick = (group: 'process' | 'any') => Object.entries(effects)
      .filter(([k]) => k !== 'Ts' && k !== 'txDelay' && (group === 'any' || spec(k).group === 'process'))
      .map(([k, e]) => ({ k, e: e[metric] }))
      .filter((x) => Math.abs(x.e) >= 0.05)
      .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))[0];
    const best = pick('process') ?? pick('any');
    if (!best) return null;
    const v = p[best.k];
    const factor = Math.sign(best.e) === dir ? 1.5 : 1 / 1.5;
    set[best.k] = clampTo(best.k, Math.abs(v) > 1e-12 ? v * factor : v + (spec(best.k).step ?? 0.1) * 10);
  }
  const params = { ...p, ...set };
  const changes = Object.entries(set)
    .filter(([k, v]) => v !== p[k])
    .map(([k, v]) => ({ key: k, label: spec(k).label, unit: spec(k).unit, from: p[k], to: v }));
  if (!changes.length) return null;
  return { params, changes, before, after: plantSummary(proc, params) };
}

/** The plant with the process's default settings, for "was" comparisons. */
export const defaultSummary = (proc: ProcessDef) => plantSummary(proc, defaultParams(proc));
