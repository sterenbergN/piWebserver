import { complexity, type Complexity, type ControllerConfig } from './controllers';
import { robustness, type RobustPoint } from './linear';
import { pvSpan, type Params, type ProcessDef } from './model';
import type { Run } from './sim';

// The scorecard: every controller on a process is run through the same test
// scripts and judged on the same measures. Performance is measured on the true
// process value (what the plant gets), not the noisy reading.

export type StepResult = {
  t: number; from: number; to: number;
  /** % of the step size. */
  overshoot: number;
  /** s from the step until it stays within the band; null if it never settles before the next event. */
  settling: number | null;
  /** 10 → 90 % rise time, s. */
  rise: number | null;
  /** Units of the variable stepped (a 2×2 process has two). */
  unit?: string;
};

export type UpsetResult = {
  t: number; label: string;
  /** Largest deviation from setpoint, % of span. */
  peak: number;
  /** s until it stays within ±1 % of span; null if it never recovers before the next event. */
  recovery: number | null;
  /** The valve was still at a limit at the end: no controller could have recovered. */
  limited: boolean;
};

export type TestScore = {
  scenarioId: string;
  /** Integral of |error|, %·min (true PV, % of span). */
  iae: number;
  steps: StepResult[];
  upsets: UpsetResult[];
  /** Valve travel, full strokes per hour. */
  travel: number;
  /** Controller output movement, % per minute (noise passed to the valve). */
  cvActivity: number;
  /** Share of the time the output sat at a limit, %. */
  saturated: number;
};

export type Scorecard = {
  tests: TestScore[];
  iae: number;
  worstOvershoot: number;
  /** Longest settling time over all setpoint steps (Infinity if any never settled). */
  worstSettling: number;
  worstPeak: number;
  worstRecovery: number;
  travel: number;
  cvActivity: number;
  saturated: number;
  robust: RobustPoint[] | null;
  worstPm: number;
  worstGm: number;
  worstMs: number;
  stableAll: boolean;
  complexity: Complexity;
};

/** One controlled variable's signals in a run: the main PV, or a 2×2 process's second one. */
type Channel = {
  sp: Float64Array; y: Float64Array; valve: Float64Array; span: number; unit: string;
  /** Its own setpoint events, and what it starts at. */
  stepKind: 'sp' | 'sp2'; start: number;
  /** The other variable's setpoint changes count as upsets on this one. */
  otherKind: 'sp' | 'sp2' | null; otherLabel: string;
  /** Name it in the upset labels (2×2 processes only). */
  name: string | null;
};

export function scoreRun(proc: ProcessDef, run: Run): TestScore {
  const { trace, scenario, Ts } = run;
  const n = trace.t.length;
  let travel = 0, activity = 0, sat = 0, sat2 = 0;
  for (let i = 1; i < n; i++) {
    travel += Math.abs(trace.valve[i] - trace.valve[i - 1]);
    activity += Math.abs(trace.cv[i] - trace.cv[i - 1]);
    if (proc.mimo) {
      travel += Math.abs(trace.valve2[i] - trace.valve2[i - 1]);
      activity += Math.abs(trace.cv2[i] - trace.cv2[i - 1]);
    }
  }
  for (let i = 0; i < n; i++) {
    if (trace.cv[i] <= 0.01 || trace.cv[i] >= 99.99) sat++;
    if (proc.mimo && (trace.cv2[i] <= 0.01 || trace.cv2[i] >= 99.99)) sat2++;
  }
  const sec = proc.secondary;
  const channels: Channel[] = [{
    sp: trace.sp, y: trace.pvTrue, valve: trace.valve, span: pvSpan(proc), unit: proc.pv.unit, stepKind: 'sp', start: scenario.initialSp,
    otherKind: proc.mimo ? 'sp2' : null, otherLabel: `${sec?.label ?? ''} setpoint`, name: proc.mimo ? proc.pv.label.toLowerCase() : null,
  }];
  if (proc.mimo && sec) {
    channels.push({
      sp: trace.sp2, y: trace.pv2True, valve: trace.valve2, span: sec.hi - sec.lo, unit: sec.unit, stepKind: 'sp2', start: scenario.initialSp2 ?? proc.mimo.nominal2,
      otherKind: 'sp', otherLabel: `${proc.pv.label} setpoint`, name: sec.label.toLowerCase(),
    });
  }
  const duration = n * Ts;
  let iae = 0;
  const steps: StepResult[] = [];
  const upsets: UpsetResult[] = [];
  for (const ch of channels) {
    const r = scoreChannel(proc, scenario, ch, Ts, n, trace.t);
    iae += r.iae;
    steps.push(...r.steps);
    upsets.push(...r.upsets);
  }
  return {
    scenarioId: scenario.id,
    iae: iae / 60,
    steps, upsets,
    travel: travel / 100 / (duration / 3600),
    cvActivity: activity / (duration / 60),
    saturated: (Math.max(sat, sat2) / n) * 100,
  };
}

function scoreChannel(proc: ProcessDef, scenario: Run['scenario'], ch: Channel, Ts: number, n: number, time: Float64Array) {
  const { span } = ch;
  const pct = (v: number) => (v / span) * 100;
  let iae = 0;
  for (let i = 0; i < n; i++) iae += Math.abs(pct(ch.sp[i] - ch.y[i])) * Ts;
  // Segments: each event runs until the next (or the end).
  const events = scenario.events.filter((e) => e.kind === ch.stepKind || e.kind === 'dist' || e.kind === ch.otherKind).sort((a, b) => a.t - b.t);
  const idx = (t: number) => Math.min(n - 1, Math.max(0, Math.round(t / Ts)));
  const steps: StepResult[] = [];
  const upsets: UpsetResult[] = [];
  let lastSp = ch.start;
  const trace = { pvTrue: ch.y, sp: ch.sp, valve: ch.valve, t: time };
  events.forEach((ev, k) => {
    // The next event's own sample already shows its effect, so stop just before it.
    const i0 = idx(ev.t), i1 = k + 1 < events.length ? Math.max(i0, idx(events[k + 1].t) - 1) : n - 1;
    if (ev.kind === ch.stepKind && (ev.kind === 'sp' || ev.kind === 'sp2')) {
      const from = lastSp, to = ev.value;
      lastSp = to;
      const step = to - from;
      if (Math.abs(step) < 1e-12) return;
      const dir = Math.sign(step);
      let over = 0, lastOut = -1, t10: number | null = null, t90: number | null = null;
      const band = Math.max(0.02 * Math.abs(step), 0.005 * span);
      for (let i = i0; i <= i1; i++) {
        const y = trace.pvTrue[i];
        over = Math.max(over, dir * (y - to));
        if (Math.abs(y - to) > band) lastOut = i;
        const frac = (y - from) / step;
        if (t10 === null && frac >= 0.1) t10 = trace.t[i];
        if (t90 === null && frac >= 0.9) t90 = trace.t[i];
      }
      steps.push({
        t: ev.t, from, to, unit: ch.unit,
        overshoot: (over / Math.abs(step)) * 100,
        settling: lastOut === i1 ? null : Math.max(0, (lastOut < 0 ? i0 : lastOut + 1) * Ts - ev.t),
        rise: t10 !== null && t90 !== null ? t90 - t10 : null,
      });
    } else {
      const spec = ev.kind === 'dist' ? proc.disturbances.find((d) => d.key === ev.key) : null;
      const what = ev.kind === 'dist' ? `${spec?.label ?? ev.key} → ${ev.value} ${spec?.unit ?? ''}`.trim() : ev.kind === 'sp' || ev.kind === 'sp2' ? `${ch.otherLabel} → ${ev.value}` : '';
      let peak = 0, lastOut = -1;
      const band = 0.01 * span;
      for (let i = i0; i <= i1; i++) {
        const dev = Math.abs(trace.pvTrue[i] - trace.sp[i]);
        peak = Math.max(peak, dev);
        if (dev > band) lastOut = i;
      }
      const atLimit = (i: number) => trace.valve[i] <= 0.5 || trace.valve[i] >= 99.5;
      upsets.push({
        t: ev.t, label: ch.name ? `${what} (effect on ${ch.name})` : what,
        peak: pct(peak),
        recovery: lastOut === i1 ? null : Math.max(0, (lastOut < 0 ? i0 : lastOut + 1) * Ts - ev.t),
        limited: lastOut === i1 && atLimit(i1),
      });
    }
  });
  return { iae, steps, upsets };
}

export function scorecard(proc: ProcessDef, params: Params, config: ControllerConfig, runs: Run[], withRobustness = true): Scorecard {
  const tests = runs.map((r) => scoreRun(proc, r));
  const steps = tests.flatMap((t) => t.steps);
  const upsets = tests.flatMap((t) => t.upsets);
  const totalTime = runs.reduce((s, r) => s + r.trace.t.length * r.Ts, 0) || 1;
  const weighted = (key: 'travel' | 'cvActivity' | 'saturated') =>
    tests.reduce((s, t, i) => s + t[key] * runs[i].trace.t.length * runs[i].Ts, 0) / totalTime;
  const robust = withRobustness && config.kind !== 'onoff' ? robustness(proc, params, config) : null;
  const worst = (f: (p: RobustPoint) => number | undefined, pickMin: boolean) => {
    const vals = (robust ?? []).map(f).filter((v): v is number => v !== undefined && Number.isFinite(v));
    if (!vals.length) return pickMin ? Infinity : NaN;
    return pickMin ? Math.min(...vals) : Math.max(...vals);
  };
  return {
    tests,
    iae: tests.reduce((s, t) => s + t.iae, 0),
    worstOvershoot: Math.max(0, ...steps.map((s) => s.overshoot)),
    worstSettling: steps.some((s) => s.settling === null) ? Infinity : Math.max(0, ...steps.map((s) => s.settling ?? 0)),
    worstPeak: Math.max(0, ...upsets.map((u) => u.peak)),
    // Upsets the valve physically couldn't reject don't count against the controller.
    worstRecovery: upsets.some((u) => u.recovery === null && !u.limited) ? Infinity : Math.max(0, ...upsets.map((u) => u.recovery ?? 0)),
    travel: weighted('travel'),
    cvActivity: weighted('cvActivity'),
    saturated: weighted('saturated'),
    robust,
    worstPm: worst((p) => p.worst?.pm, true),
    worstGm: worst((p) => p.worst?.gm, true),
    worstMs: worst((p) => p.worst?.ms, false),
    stableAll: (robust ?? []).every((p) => p.stableAll),
    complexity: complexity(proc, config),
  };
}

/** Which way is better for each scorecard row (for highlighting the best in a comparison). */
export const BETTER: Record<string, 'low' | 'high'> = {
  iae: 'low', worstOvershoot: 'low', worstSettling: 'low', worstPeak: 'low', worstRecovery: 'low',
  travel: 'low', cvActivity: 'low', saturated: 'low', worstPm: 'high', worstGm: 'high', worstMs: 'low',
};
