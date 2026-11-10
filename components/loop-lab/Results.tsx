'use client';

import { Fragment, useMemo, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { MEASURES, SPREAD_NOTE } from '@/lib/loop-lab/measures';
import { cleanParams, nominalDisturbances, type ProcessDef } from '@/lib/loop-lab/model';
import { findSteady, steadyState, type Run, type Sample } from '@/lib/loop-lab/sim';
import { BETTER, type Scorecard, type TestScore } from '@/lib/loop-lab/score';
import Chart, { fmt, type Series } from './Chart';
import { ProcessDrawing as SchematicsDrawing } from './Schematics';

export const PALETTE = ['var(--habit-1)', 'var(--habit-2)', 'var(--habit-3)', 'var(--habit-7)', 'var(--habit-5)', 'var(--habit-4)'];

export const dur = (s: number | null) => {
  if (s === null || !Number.isFinite(s)) return 'never';
  return s < 120 ? `${fmt(s, 3)} s` : `${fmt(s / 60, 3)} min`;
};

/** A compact schematic of the process reflecting the scrubbed sample state. */
export function ProcessDrawing({ proc, params, sample, dist }: { proc: ProcessDef; params?: Record<string, number>; sample: Sample; dist: Record<string, number> }) {
  const p = cleanParams(proc, params ?? {});
  const d = { ...nominalDisturbances(proc), ...dist };
  const pvVal = Number.isFinite(sample.pvTrue) ? sample.pvTrue : (Number.isFinite(sample.pv) ? sample.pv : proc.nominalPv);
  const pv2Fallback = proc.mimo ? proc.mimo.nominal2 : pvVal;
  const pv2Val = Number.isFinite(sample.pv2True) ? sample.pv2True : (Number.isFinite(sample.pv2) ? sample.pv2 : pv2Fallback);

  const st = findSteady(proc, p, d, pvVal, Number.isFinite(pv2Val) ? pv2Val : undefined);
  const x = steadyState(proc, st);
  x[0] = sample.valve;

  if (proc.id === 'flow') {
    x[1] = sample.pv;
  } else if (proc.id === 'tank' || proc.id === 'surge' || proc.id === 'drum') {
    x[1] = pvVal;
  } else if (proc.id === 'stirred' || proc.id === 'jacket' || proc.id === 'hx') {
    x[2] = pvVal;
  } else if (proc.id === 'maglev') {
    x[1] = pvVal;
    x[2] = 0;
  } else if (proc.id === 'blend') {
    x[1] = pvVal;
  } else if (proc.id === 'feeder' || proc.id === 'batch') {
    x[2] = pvVal;
  } else if (proc.id === 'mixing') {
    const u2 = 'u2' in st ? (st as { u2?: number }).u2 : undefined;
    const v2 = Number.isFinite(sample.valve2) ? sample.valve2 : undefined;
    x[1] = pv2Val;
    x[2] = pvVal;
    x[3] = v2 ?? u2 ?? d.v2 ?? 50;
  } else if (proc.id === 'crane') {
    x[1] = pvVal;
    x[2] = 0;
    x[3] = ((sample.pv2 ?? 0) * Math.PI) / 180;
    x[4] = 0;
  } else if (proc.id === 'servo') {
    const wRad = (pvVal * 2 * Math.PI) / 60;
    x[1] = wRad;
    x[2] = 0;
    x[3] = wRad;
  } else if ((proc.id as string) === 'pfr' || proc.id === 'custom') {
    x[x.length - 2] = pvVal;
  }

  return <SchematicsDrawing proc={proc} p={p} d={d} x={x} />;
}

/** Time axis in minutes for long runs. */
function useTime(run: Run | undefined) {
  return useMemo(() => {
    if (!run) return { t: new Float64Array(), unit: 's', scale: 1 };
    const long = run.scenario.duration > 600;
    const scale = long ? 1 / 60 : 1;
    return { t: long ? run.trace.t.map((v) => v * scale) : run.trace.t, unit: long ? 'min' : 's', scale };
  }, [run]);
}

export type TrendEntry = { label: string; color: string; run: Run };

/** Process value and controller output over a test, one or more controllers overlaid. */
export function TrendPanel({ proc, params, entries, showMeasured = true, height = 210 }: { proc: ProcessDef; params?: Record<string, number>; entries: TrendEntry[]; showMeasured?: boolean; height?: number }) {
  const first = entries[0]?.run;
  const { t, unit, scale } = useTime(first);
  // The charts share a time axis: hover one and all of them read out the same moment. Only the bottom one labels it.
  const [hover, setHover] = useState<number | null>(null);
  const sync = { value: hover, set: setHover };

  const single = entries.length === 1;
  const [showSchematic, setShowSchematic] = useState<boolean>(single);
  const [showPID, setShowPID] = useState<boolean>(false);
  const [showDist, setShowDist] = useState<boolean>(false);
  const [showBands, setShowBands] = useState<boolean>(true);

  if (!first) return <div className="ll-empty">No run yet.</div>;
  const times = entries.map((e) => (e.run === first ? t : e.run.trace.t.map((v) => v * scale)));

  // Hover time in seconds for scrubbing and settling bands
  const hoverX = hover !== null ? hover / scale : null;
  const scrubIdx = hoverX !== null
    ? Math.min(first.trace.t.length - 1, Math.max(0, Math.round(hoverX / first.Ts)))
    : 0;

  const scrubSample: Sample = {
    t: first.trace.t[scrubIdx] ?? 0,
    sp: first.trace.sp[scrubIdx] ?? 0,
    pv: first.trace.pv[scrubIdx] ?? 0,
    pvTrue: first.trace.pvTrue[scrubIdx] ?? 0,
    cv: first.trace.cv[scrubIdx] ?? 0,
    valve: first.trace.valve[scrubIdx] ?? 0,
    P: first.trace.P[scrubIdx] ?? 0,
    I: first.trace.I[scrubIdx] ?? 0,
    D: first.trace.D[scrubIdx] ?? 0,
    Kc: first.trace.Kc[scrubIdx] ?? 0,
    pv2: first.trace.pv2[scrubIdx] ?? NaN,
    sp2: first.trace.sp2[scrubIdx] ?? NaN,
    ff: first.trace.ff[scrubIdx] ?? 0,
    pred: first.trace.pred[scrubIdx] ?? NaN,
    alt: first.trace.alt[scrubIdx] ?? NaN,
    pv2True: first.trace.pv2True[scrubIdx] ?? NaN,
    cv2: first.trace.cv2[scrubIdx] ?? NaN,
    valve2: first.trace.valve2[scrubIdx] ?? NaN,
  };

  const scrubDist: Record<string, number> = {};
  for (const [k, arr] of Object.entries(first.trace.dist)) {
    scrubDist[k] = arr[scrubIdx] ?? 0;
  }

  // ±2% Settling band calculation around active / last setpoint step
  const spEvents = first.scenario.events.filter((ev) => ev.kind === 'sp');
  const span = proc.pv.hi - proc.pv.lo;
  let activeSp = first.trace.sp[0] ?? proc.nominalPv;
  let stepSize = span;

  if (spEvents.length > 0) {
    if (hoverX !== null) {
      const past = spEvents.filter((ev) => ev.t <= hoverX);
      if (past.length > 0) {
        const curr = past[past.length - 1];
        activeSp = curr.value;
        const prevIdx = spEvents.indexOf(curr) - 1;
        const prevVal = prevIdx >= 0 ? spEvents[prevIdx].value : (first.trace.sp[0] ?? proc.nominalPv);
        stepSize = Math.max(Math.abs(activeSp - prevVal), span * 0.05);
      } else {
        activeSp = first.trace.sp[0] ?? proc.nominalPv;
        stepSize = Math.max(Math.abs(spEvents[0].value - activeSp), span * 0.05);
      }
    } else {
      const last = spEvents[spEvents.length - 1];
      activeSp = last.value;
      const prevVal = spEvents.length > 1 ? spEvents[spEvents.length - 2].value : (first.trace.sp[0] ?? proc.nominalPv);
      stepSize = Math.max(Math.abs(activeSp - prevVal), span * 0.05);
    }
  }

  const tol = Math.max(0.02 * stepSize, 0.005 * span);
  const settlingBands = showBands ? [{ lo: activeSp - tol, hi: activeSp + tol, color: 'rgba(16, 185, 129, 0.12)' }] : undefined;

  const pv: Series[] = [
    { label: 'Setpoint', color: 'var(--ll-sp)', x: t, y: first.trace.sp, dash: '5 4', width: 1.4 },
    ...(single && showMeasured ? [{ label: 'Measured', color: 'var(--muted)', x: t, y: first.trace.pv, width: 1 }] : []),
    ...(single && Array.from(first.trace.pred).some(Number.isFinite)
      ? [{ label: first.trace.Kc.every((v) => v === 0) ? 'Observer estimate' : 'Predicted (what the PID sees)', color: 'var(--habit-7)', x: t, y: first.trace.pred, dash: '3 3', width: 1.3 }] : []),
    ...entries.map((e, i) => ({ label: single ? `${proc.pv.label} (true)` : e.label, color: e.color, x: times[i], y: e.run.trace.pvTrue, width: 2 })),
  ];

  const cv: Series[] = entries.flatMap((e, i) => single
    ? [
        { label: 'Controller output', color: 'var(--ll-cv)', x: times[i], y: e.run.trace.cv, width: 1.2 },
        { label: proc.mimo ? `${proc.tags.valve} stem` : 'Valve stem', color: 'var(--ll-valve)', x: times[i], y: e.run.trace.valve, width: 1.8 },
        ...(proc.mimo ? [{ label: `${proc.mimo.valve} stem`, color: 'var(--habit-3)', x: times[i], y: e.run.trace.valve2, width: 1.8 }] : []),
      ]
    : [
        { label: proc.mimo ? `${e.label}: ${proc.tags.valve}` : e.label, color: e.color, x: times[i], y: e.run.trace.valve, width: 1.6 },
        ...(proc.mimo ? [{ label: `${e.label}: ${proc.mimo.valve}`, color: e.color, x: times[i], y: e.run.trace.valve2, width: 1.2, dash: '4 3' }] : []),
      ]);
  if (single && Array.from(first.trace.alt).some(Number.isFinite)) {
    cv.push({ label: 'Override controller (its own output)', color: 'var(--habit-6)', x: t, y: first.trace.alt, dash: '4 3', width: 1.2 });
  }

  // P / I / D / FF Breakdown
  const pidSeries: Series[] = entries.flatMap((e, i) => {
    const tr = e.run.trace;
    const time = times[i];
    const prefix = single ? '' : `${e.label} `;
    const dash = single ? undefined : i === 0 ? undefined : i === 1 ? '4 3' : '2 2';
    const hasFF = Array.from(tr.ff).some((v) => Math.abs(v) > 1e-6);
    return [
      { label: `${prefix}P`, color: '#3b82f6', x: time, y: tr.P, dash, width: 1.5 },
      { label: `${prefix}I`, color: '#10b981', x: time, y: tr.I, dash, width: 1.5 },
      { label: `${prefix}D`, color: '#f59e0b', x: time, y: tr.D, dash, width: 1.5 },
      ...(hasFF ? [{ label: `${prefix}FF`, color: '#a855f7', x: time, y: tr.ff, dash, width: 1.5 }] : []),
    ];
  });

  // Disturbances breakdown
  const distColors = ['var(--habit-4)', 'var(--habit-5)', 'var(--habit-6)', 'var(--habit-2)', 'var(--habit-1)', 'var(--habit-7)'];
  const distSeries: Series[] = proc.disturbances.flatMap((d, di) => {
    const tr = first.trace.dist[d.key];
    if (!tr) return [];
    return [{
      label: `${d.label} (${d.unit})`,
      color: distColors[di % distColors.length],
      x: t,
      y: tr,
      width: 1.6,
    }];
  });

  const sec = proc.secondary;
  const inner = single && sec && !proc.mimo && Array.from(first.trace.sp2).some(Number.isFinite);
  // A 2×2 process: the second controlled variable gets its own chart, every run on it.
  const second: Series[] | null = proc.mimo && sec ? [
    { label: 'Setpoint', color: 'var(--ll-sp)', x: t, y: first.trace.sp2, dash: '5 4', width: 1.4 },
    ...entries.map((e, i) => ({ label: single ? `${sec.label} (true)` : e.label, color: single ? 'var(--habit-3)' : e.color, x: times[i], y: e.run.trace.pv2True, width: 2 })),
  ] : null;

  const events = first.scenario.events.filter((ev) => (ev.kind === 'dist' || ev.kind === 'freeze')).map((ev) => ({ at: ev.t * scale, label: ev.kind === 'dist' ? `${proc.disturbances.find((d) => d.key === ev.key)?.label ?? ev.key} → ${ev.value}` : 'sensor freeze' }));

  const pvHGuides = showBands
    ? [
        { at: activeSp + tol, label: '+2%', color: 'rgba(16, 185, 129, 0.65)', dash: '3 3' },
        { at: activeSp - tol, label: '−2%', color: 'rgba(16, 185, 129, 0.65)', dash: '3 3' },
      ]
    : [];

  const hasDistChart = showDist && proc.disturbances.length > 0 && distSeries.length > 0;
  const hasPIDChart = showPID;
  const lastChart = hasDistChart ? 'dist' : hasPIDChart ? 'pid' : 'valve';

  return (
    <div>
      {/* Chart toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem 0.8rem', marginBottom: '0.65rem' }}>
        <div className="ll-seg is-small" role="toolbar" aria-label="Chart view options">
          <button type="button" aria-pressed={showSchematic} onClick={() => setShowSchematic((v) => !v)}>
            Show schematic
          </button>
          <button type="button" aria-pressed={showPID} onClick={() => setShowPID((v) => !v)}>
            Show P / I / D terms
          </button>
          {proc.disturbances.length > 0 && (
            <button type="button" aria-pressed={showDist} onClick={() => setShowDist((v) => !v)}>
              Show disturbances
            </button>
          )}
          <button type="button" aria-pressed={showBands} onClick={() => setShowBands((v) => !v)}>
            Show ±2% settling bands
          </button>
        </div>
      </div>

      {/* Scrubbable schematic card */}
      {showSchematic && (
        <div className="ll-card" style={{ padding: '0.65rem 0.85rem', marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem 0.8rem', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem' }}>
              <strong style={{ color: 'var(--foreground)' }}>At t = {fmt(scrubSample.t, 2)} s</strong>
              <span style={{ color: 'var(--muted)', fontSize: '0.73rem' }}>(hover chart to scrub)</span>
            </div>
            {first.scenario.events.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem' }}>
                <button
                  type="button"
                  className="ll-btn is-small"
                  style={{ padding: '0.1rem 0.45rem', minHeight: '22px', fontSize: '0.72rem' }}
                  onClick={() => setHover(0)}
                  title="Jump to t = 0 s"
                >
                  Start (0 s)
                </button>
                {first.scenario.events.map((ev, i) => {
                  const evLabel = ev.kind === 'sp'
                    ? `SP → ${fmt(ev.value, 3)}`
                    : ev.kind === 'dist'
                    ? `${proc.disturbances.find((d) => d.key === ev.key)?.label ?? ev.key} → ${fmt(ev.value, 3)}`
                    : 'Freeze';
                  return (
                    <button
                      key={i}
                      type="button"
                      className="ll-btn is-small"
                      style={{ padding: '0.1rem 0.45rem', minHeight: '22px', fontSize: '0.72rem' }}
                      onClick={() => setHover(ev.t * scale)}
                      title={`Jump to t = ${fmt(ev.t, 2)} s (${evLabel})`}
                    >
                      {evLabel} ({fmt(ev.t, 1)}s)
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <ProcessDrawing proc={proc} params={params} sample={scrubSample} dist={scrubDist} />
        </div>
      )}

      <Chart
        sync={sync}
        label={`${proc.pv.label} during ${first.scenario.name}`}
        series={pv}
        x={{ label: `Time (${unit})`, hideLabel: true }}
        y={{ label: `${proc.pv.label} (${proc.pv.unit})` }}
        vGuides={events}
        hGuides={pvHGuides}
        bands={settlingBands}
        height={height}
      />
      {inner && (
        <Chart
          sync={sync}
          label={`${sec.label} during the test`}
          height={Math.round(height * 0.62)}
          x={{ label: `Time (${unit})`, hideLabel: true }}
          y={{ label: `${sec.label} (${sec.unit})` }}
          series={[
            { label: `${sec.loopTag} setpoint`, color: 'var(--ll-sp)', x: t, y: first.trace.sp2, dash: '5 4', width: 1.3 },
            { label: `${sec.label} (measured)`, color: 'var(--habit-7)', x: t, y: first.trace.pv2, width: 1.5 },
          ]}
        />
      )}
      {second && sec && (
        <Chart
          sync={sync}
          label={`${sec.label} during ${first.scenario.name}`}
          height={Math.round(height * 0.7)}
          x={{ label: `Time (${unit})`, hideLabel: true }}
          y={{ label: `${sec.label} (${sec.unit})` }}
          series={second}
        />
      )}
      <Chart
        sync={sync}
        label="Valve during the test"
        series={cv}
        x={{ label: `Time (${unit})`, hideLabel: lastChart !== 'valve' }}
        y={{ label: single ? 'Output (%)' : 'Valve stem (%)', min: -2, max: 102 }}
        height={Math.round(height * 0.62)}
        legend
      />
      {showPID && (
        <Chart
          sync={sync}
          label="Controller terms (P, I, D)"
          height={145}
          series={pidSeries}
          x={{ label: `Time (${unit})`, min: 0, max: first.scenario.duration * scale, hideLabel: lastChart !== 'pid' }}
          y={{ label: 'Term (%)', decimals: 1 }}
          hGuides={[{ at: 0 }]}
          vGuides={events}
          legend
        />
      )}
      {hasDistChart && (
        <Chart
          sync={sync}
          label="Disturbances during the test"
          height={130}
          series={distSeries}
          x={{ label: `Time (${unit})`, min: 0, max: first.scenario.duration * scale, hideLabel: lastChart !== 'dist' }}
          y={{ label: 'Disturbance' }}
          vGuides={events}
          legend
        />
      )}
    </div>
  );
}

// ─── Scorecard ──────────────────────────────────────────────────────────────

type Row = { key: keyof Scorecard | string; label: string; note: string; get: (s: Scorecard) => number; show: (v: number) => string; better?: 'low' | 'high' };

const ROWS: { group: string; rows: Row[] }[] = [
  {
    group: 'Performance',
    rows: [
      { key: 'iae', label: 'IAE', note: 'Integral of |error| over all tests, % of span × min', get: (s) => s.iae, show: (v) => fmt(v, 3) },
      { key: 'worstOvershoot', label: 'Worst overshoot', note: '% of the setpoint step', get: (s) => s.worstOvershoot, show: (v) => `${fmt(v, 2)} %` },
      { key: 'worstSettling', label: 'Slowest settling', note: 'to within 2 % of the step', get: (s) => s.worstSettling, show: dur },
      { key: 'worstPeak', label: 'Worst upset peak', note: 'deviation after a disturbance, % of span', get: (s) => s.worstPeak, show: (v) => `${fmt(v, 2)} %` },
      { key: 'worstRecovery', label: 'Slowest recovery', note: 'back within ±1 % of span', get: (s) => s.worstRecovery, show: dur },
    ],
  },
  {
    group: 'Effort',
    rows: [
      { key: 'travel', label: 'Valve travel', note: 'full strokes per hour: wear', get: (s) => s.travel, show: (v) => `${fmt(v, 3)} /h` },
      { key: 'cvActivity', label: 'Output activity', note: '% moved per minute: noise passed to the valve', get: (s) => s.cvActivity, show: (v) => `${fmt(v, 3)} %/min` },
      { key: 'saturated', label: 'Time at a limit', note: 'output pinned at 0 or 100 %', get: (s) => s.saturated, show: (v) => `${fmt(v, 2)} %` },
    ],
  },
  {
    group: 'Robustness (linear, all operating points, ±spread)',
    rows: [
      { key: 'worstPm', label: 'Worst phase margin', note: '≥ 45° is comfortable', get: (s) => s.worstPm, show: (v) => (Number.isFinite(v) ? `${fmt(v, 3)}°` : '—') },
      { key: 'worstGm', label: 'Worst gain margin', note: '≥ 6 dB is comfortable', get: (s) => s.worstGm, show: (v) => (Number.isFinite(v) ? `${fmt(v, 3)} dB` : '∞') },
      { key: 'worstMs', label: 'Worst peak sensitivity Ms', note: '< 1.4 robust, > 2 fragile', get: (s) => s.worstMs, show: (v) => (Number.isFinite(v) ? fmt(v, 3) : '—') },
    ],
  },
];

const dots = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);

export type ScoreEntry = { label: string; color: string; score: Scorecard };

/** The rows a compact scorecard keeps: one or two per group. */
const COMPACT = new Set(['iae', 'worstOvershoot', 'worstRecovery', 'travel', 'cvActivity', 'worstMs']);

/** One row of the scorecard: a measure, how to show it, and how to rank it. */
type TableRow = {
  key: string;
  label: string;
  note?: string;
  cell: (s: Scorecard) => React.ReactNode;
  /** For highlighting the best and worst when comparing. */
  rank?: Row;
};

const ROBUST_KEYS = new Set(['worstPm', 'worstGm', 'worstMs', 'stableAll']);

/** The explanation under a measure: what, how, what's good, what moves it. */
function MeasureExplain({ id, proc }: { id: string; proc?: ProcessDef }) {
  const info = MEASURES[id];
  if (!info) return null;
  const spread = proc && ROBUST_KEYS.has(id) ? proc.uncertain.map((u) => {
    const spec = proc.params.find((x) => x.key === u.key);
    return `${spec?.label ?? u.key} ±${Math.round(u.spread * 100)} %`;
  }) : [];
  return (
    <div className="ll-measure-info">
      <p className="ll-measure-what">{info.what}</p>
      <div className="ll-sub">How it is calculated</div>
      <MathText className="ll-prose">{info.how}</MathText>
      {spread.length > 0 && <p className="ll-note">{SPREAD_NOTE} For the {proc!.name.toLowerCase()}: {spread.join(', ')}; at {proc!.opPoints.map((x) => `${fmt(x, 3)} ${proc!.pv.unit}`).join(', ')}.</p>}
      <div className="ll-split">
        <div><div className="ll-sub">What to aim for</div><p>{info.good}</p></div>
        <div><div className="ll-sub">What changes it</div><p>{info.improve}</p></div>
      </div>
    </div>
  );
}

function DeltaBadge({ nowVal, baseVal, better }: { nowVal: number; baseVal: number; better?: 'low' | 'high' }) {
  if (!Number.isFinite(nowVal) || !Number.isFinite(baseVal) || baseVal <= 0) return null;
  const diff = nowVal - baseVal;
  const pct = (diff / baseVal) * 100;
  if (Math.abs(pct) < 0.5) return null;
  const isBetter = better === 'high' ? pct > 0 : pct < 0;
  const sign = pct > 0 ? '+' : '−';
  const label = `${sign}${Math.abs(Math.round(pct))}%`;
  return (
    <span
      className={`ll-delta ${isBetter ? 'is-good' : 'is-warn'}`}
      style={{
        fontSize: '0.72rem',
        marginLeft: '0.35rem',
        opacity: 0.85,
        fontWeight: 600,
        color: isBetter ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)',
        whiteSpace: 'nowrap',
      }}
      title={`${pct > 0 ? '+' : ''}${fmt(pct, 2)}% relative vs baseline`}
    >
      {label}
    </span>
  );
}

export function ScorecardTable({ entries, compact = false, proc }: { entries: ScoreEntry[]; compact?: boolean; proc?: ProcessDef }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!entries.length) return <div className="ll-empty">Run the tests to see a scorecard.</div>;
  const measured = (row: Row): TableRow => ({ key: row.key as string, label: row.label, note: row.note, cell: (sc) => row.show(row.get(sc)), rank: row });
  const stable: TableRow = {
    key: 'stableAll', label: 'Stable over the spread', note: 'every operating point, plant parameters varied',
    cell: (sc) => (sc.robust ? (sc.stableAll ? 'yes' : <span className="ll-badge is-bad">no</span>) : '—'),
  };
  const complexityRows: TableRow[] = [
    { key: 'tuningParams', label: 'Tuning parameters', note: 'numbers someone has to set and keep right', cell: (sc) => sc.complexity.tuningParams },
    { key: 'needsModel', label: 'Needs a model of', cell: (sc) => sc.complexity.needsModel ?? 'nothing beyond a bump test' },
    { key: 'commissioning', label: 'Commissioning effort', note: '1 switch on and tune … 5 needs an engineer', cell: (sc) => <span title={`${sc.complexity.commissioning} of 5`}>{dots(sc.complexity.commissioning)}</span> },
    { key: 'maintainability', label: 'Maintainability', note: '5 any technician … 1 only its designer', cell: (sc) => <span title={`${sc.complexity.maintainability} of 5`}>{dots(sc.complexity.maintainability)}</span> },
  ];
  const groups: { group: string; rows: TableRow[] }[] = compact
    ? [{ group: 'Key measures', rows: [...ROWS.flatMap((g) => g.rows).filter((r) => COMPACT.has(r.key as string)).map(measured), complexityRows[0]] }]
    : [
        ...ROWS.map((g, i) => ({ group: g.group, rows: [...g.rows.map(measured), ...(i === ROWS.length - 1 ? [stable] : [])] })),
        { group: 'Cost of complexity', rows: complexityRows },
      ];
  const compare = entries.length > 1;
  const nowIdx = entries.findIndex((e) => e.label === 'Now');
  const targetNowIdx = nowIdx >= 0 ? nowIdx : (compare ? 1 : -1);
  const baselineIdx = targetNowIdx === 0 ? 1 : 0;

  const cls = (row: Row, v: number, all: number[]) => {
    const better = row.better ?? BETTER[row.key as string];
    if (!compare || !better) return '';
    const finite = all.filter(Number.isFinite);
    if (!finite.length) return '';
    const best = better === 'low' ? Math.min(...finite) : Math.max(...finite);
    const worst = better === 'low' ? Math.max(...all) : Math.min(...all);
    if (v === best && best !== worst) return 'is-best';
    if (v === worst && best !== worst) return 'is-worst';
    return '';
  };
  return (
    <div className="ll-table-wrap">
      <table className="ll-table ll-scorecard">
        <thead>
          <tr>
            <th>Measure</th>
            {entries.map((e, i) => <th key={i}><span className="ll-swatch" style={{ background: e.color }} />{e.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.group}>
              {groups.length > 1 && <tr className="ll-score-group"><th colSpan={entries.length + 1}>{g.group}</th></tr>}
              {g.rows.map((row) => {
                const vals = row.rank ? entries.map((e) => row.rank!.get(e.score)) : [];
                const isOpen = open === row.key;
                return (
                  <Fragment key={row.key}>
                    <tr className={isOpen ? 'is-open' : ''}>
                      <td>
                        <button className="ll-measure" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : row.key)}>
                          <span className="ll-measure-label">{row.label}<svg className={`ll-measure-caret${isOpen ? ' is-open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3.5 5 6.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                        </button>
                      </td>
                      {entries.map((e, i) => {
                        const isTarget = compare && i === targetNowIdx;
                        const nowVal = isTarget && row.rank ? vals[targetNowIdx] : NaN;
                        const baseVal = isTarget && row.rank ? vals[baselineIdx] : NaN;
                        const better = row.rank?.better ?? (row.rank ? BETTER[row.rank.key as string] : undefined);
                        return (
                          <td key={i} className={row.rank ? cls(row.rank, vals[i], vals) : ''} style={row.key === 'needsModel' ? { maxWidth: '14rem' } : undefined}>
                            {row.cell(e.score)}
                            {isTarget && row.rank && (
                              <DeltaBadge nowVal={nowVal} baseVal={baseVal} better={better} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {isOpen && (
                      <tr className="ll-measure-row">
                        <td colSpan={entries.length + 1}>{row.note && <p className="ll-measure-note">{row.note}</p>}<MeasureExplain id={row.key} proc={proc} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Per-test detail: every setpoint step and upset. */
export function TestDetail({ proc, test }: { proc: ProcessDef; test: TestScore }) {
  return (
    <div>
      <div className="ll-table-wrap">
        <table className="ll-table">
          <thead><tr><th>Event</th><th>Overshoot / peak</th><th>Settling / recovery</th><th>Rise</th></tr></thead>
          <tbody>
            {test.steps.map((s, i) => (
              <tr key={`s${i}`}>
                <td>Setpoint {fmt(s.from, 3)} → {fmt(s.to, 3)} {s.unit ?? proc.pv.unit} at {dur(s.t)}</td>
                <td>{fmt(s.overshoot, 2)} %</td><td>{dur(s.settling)}</td><td>{s.rise === null ? '—' : dur(s.rise)}</td>
              </tr>
            ))}
            {test.upsets.map((u, i) => (
              <tr key={`u${i}`}>
                <td>{u.label} at {dur(u.t)}</td>
                <td>{fmt(u.peak, 2)} % of span</td>
                <td>{u.limited ? <span className="ll-badge is-warn">valve at limit</span> : dur(u.recovery)}</td><td>—</td>
              </tr>
            ))}
            <tr><td>Whole test</td><td colSpan={3} style={{ textAlign: 'right' }}>IAE {fmt(test.iae, 3)} · travel {fmt(test.travel, 3)} /h · at a limit {fmt(test.saturated, 2)} %</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── At a glance ────────────────────────────────────────────────────────────

type Tone = 'good' | 'warn' | 'bad' | '';

function Stat({ title, value, sub, tone }: { title: string; value: string; sub: string; tone: Tone }) {
  return (
    <div className={`ll-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="ll-stat-title">{title}</span>
      <strong>{value}</strong>
      <span className="ll-stat-sub">{sub}</span>
    </div>
  );
}

/** How one test went, for its tab. */
function testTone(t: TestScore): Tone {
  if (t.steps.some((s) => s.settling === null) || t.upsets.some((u) => u.recovery === null && !u.limited)) return 'bad';
  if (t.steps.some((s) => s.overshoot > 15)) return 'warn';
  return 'good';
}

/** The tests, each with a mark for how it went: where to look is the first thing to know. */
export function TestTabs({ tests, runs, value, onChange }: { tests: TestScore[]; runs: Run[]; value: number; onChange: (i: number) => void }) {
  const said: Record<Tone, string> = { good: 'settled and recovered', warn: 'large overshoot', bad: 'did not settle or recover', '': '' };
  return (
    <div className="ll-tests" role="tablist" aria-label="Test">
      {runs.map((r, i) => {
        const tone = tests[i] ? testTone(tests[i]) : '';
        return (
          <button key={r.scenario.id} role="tab" aria-selected={value === i} onClick={() => onChange(i)} title={said[tone]}>
            <span className={`ll-dot is-${tone}`} aria-hidden />{r.scenario.name}<span className="sr-only">: {said[tone]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The scorecard in four numbers and a sentence. */
export function ResultSummary({ proc, score, busy }: { proc: ProcessDef; score: Scorecard; busy?: boolean }) {
  const span = proc.pv.hi - proc.pv.lo;
  const inUnits = (pct: number) => `${fmt((pct / 100) * span, 2)} ${proc.pv.unit}`;
  // Judge performance on the normal tests; the deliberately-wrong-plant test belongs to robustness.
  const normal = score.tests.filter((t) => t.scenarioId !== 'mismatch');
  const mismatch = score.tests.find((t) => t.scenarioId === 'mismatch');
  const steps = normal.flatMap((t) => t.steps);
  const upsets = normal.flatMap((t) => t.upsets);
  const hasSteps = steps.length > 0;
  const hasUpsets = upsets.length > 0;
  const overshoot = Math.max(0, ...steps.map((s) => s.overshoot));
  const settling = steps.some((s) => s.settling === null) ? Infinity : Math.max(0, ...steps.map((s) => s.settling ?? 0));
  const peak = Math.max(0, ...upsets.map((u) => u.peak));
  const recovery = upsets.some((u) => u.recovery === null && !u.limited) ? Infinity : Math.max(0, ...upsets.map((u) => u.recovery ?? 0));
  const neverSettles = !Number.isFinite(settling);
  const neverRecovers = !Number.isFinite(recovery);
  const mismatchOs = mismatch ? Math.max(0, ...mismatch.steps.map((s) => s.overshoot)) : NaN;
  const ms = score.worstMs;
  const robustTone: Tone = !score.robust ? '' : !score.stableAll || ms > 2 ? 'bad' : ms > 1.6 ? 'warn' : 'good';

  const verdict: string[] = [];
  if (score.robust && !score.stableAll) verdict.push('Goes unstable when the plant drifts within its normal spread.');
  else if (score.robust && ms > 2) verdict.push('Works on paper but fragile: a modest change in the plant could make it ring or go unstable.');
  if (neverSettles) verdict.push('Some setpoint changes never settle.');
  else if (overshoot > 15) verdict.push('Setpoint changes overshoot a lot.');
  if (neverRecovers) verdict.push('Some upsets are never fully corrected.');
  if (!verdict.length) verdict.push(score.robust ? 'Solid: it settles, recovers from every upset and keeps healthy margins.' : 'It settles and recovers; on-off has no margins to check, it just cycles.');
  const good = verdict[0].startsWith('Solid') || verdict[0].startsWith('It settles');

  return (
    <div className="ll-summary">
      <p className={`ll-verdict-line is-${!good && (score.robust && (!score.stableAll || ms > 2) || neverSettles || neverRecovers) ? 'bad' : good ? 'good' : 'warn'}`} aria-live="polite">
        <span className="ll-dot" aria-hidden />{verdict.join(' ')}
        {busy && <span className="ll-busy">Running…</span>}
      </p>
      <div className="ll-stats">
        {hasSteps && (
          <Stat title="Setpoint changes" tone={neverSettles ? 'bad' : overshoot > 15 ? 'warn' : 'good'}
            value={`${fmt(overshoot, 2)} %`} sub={neverSettles ? 'overshoot; some never settle' : `overshoot; settles in ${dur(settling)}`} />
        )}
        {hasUpsets && (
          <Stat title="Upsets" tone={neverRecovers ? 'bad' : ''}
            value={inUnits(peak)} sub={neverRecovers ? 'worst; some never recover' : `worst; back in ${dur(recovery)}`} />
        )}
        <Stat title="Valve" tone="" value={`${fmt(score.travel, 2)} strokes/h`} sub={`moves ${fmt(score.cvActivity, 2)} %/min`} />
        <Stat title="Robustness" tone={robustTone}
          value={score.robust ? `Ms ${fmt(ms, 3)}` : 'n/a'}
          sub={`${!score.robust ? 'on-off has no linear model' : !score.stableAll ? 'unstable over the spread' : ms > 2 ? 'fragile (aim below 1.6)' : ms > 1.6 ? 'acceptable' : 'robust'}${Number.isFinite(mismatchOs) ? `; wrong plant ${fmt(mismatchOs, 2)} %` : ''}`} />
      </div>
    </div>
  );
}
