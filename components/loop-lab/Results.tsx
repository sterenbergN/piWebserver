'use client';

import { Fragment, useMemo, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { MEASURES, SPREAD_NOTE } from '@/lib/loop-lab/measures';
import type { ProcessDef } from '@/lib/loop-lab/model';
import type { Run } from '@/lib/loop-lab/sim';
import { BETTER, type Scorecard, type TestScore } from '@/lib/loop-lab/score';
import Chart, { fmt, type Series } from './Chart';

export const PALETTE = ['var(--habit-1)', 'var(--habit-2)', 'var(--habit-3)', 'var(--habit-7)', 'var(--habit-5)', 'var(--habit-4)'];

export const dur = (s: number | null) => {
  if (s === null || !Number.isFinite(s)) return 'never';
  return s < 120 ? `${fmt(s, 3)} s` : `${fmt(s / 60, 3)} min`;
};

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
export function TrendPanel({ proc, entries, showMeasured = true, height = 210 }: { proc: ProcessDef; entries: TrendEntry[]; showMeasured?: boolean; height?: number }) {
  const first = entries[0]?.run;
  const { t, unit, scale } = useTime(first);
  if (!first) return <div className="ll-empty">No run yet.</div>;
  const times = entries.map((e) => (e.run === first ? t : e.run.trace.t.map((v) => v * scale)));
  const single = entries.length === 1;
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
  const sec = proc.secondary;
  const inner = single && sec && !proc.mimo && Array.from(first.trace.sp2).some(Number.isFinite);
  // A 2×2 process: the second controlled variable gets its own chart, every run on it.
  const second: Series[] | null = proc.mimo && sec ? [
    { label: 'Setpoint', color: 'var(--ll-sp)', x: t, y: first.trace.sp2, dash: '5 4', width: 1.4 },
    ...entries.map((e, i) => ({ label: single ? `${sec.label} (true)` : e.label, color: single ? 'var(--habit-3)' : e.color, x: times[i], y: e.run.trace.pv2True, width: 2 })),
  ] : null;
  const events = first.scenario.events.filter((ev) => (ev.kind === 'dist' || ev.kind === 'freeze')).map((ev) => ({ at: ev.t * scale, label: ev.kind === 'dist' ? `${proc.disturbances.find((d) => d.key === ev.key)?.label ?? ev.key} → ${ev.value}` : 'sensor freeze' }));
  return (
    <div>
      <Chart label={`${proc.pv.label} during ${first.scenario.name}`} series={pv} x={{ label: `Time (${unit})` }} y={{ label: `${proc.pv.label} (${proc.pv.unit})` }} vGuides={events} height={height} />
      {inner && (
        <Chart label={`${sec.label} during the test`} height={Math.round(height * 0.7)} x={{ label: `Time (${unit})` }} y={{ label: `${sec.label} (${sec.unit})` }}
          series={[
            { label: `${sec.loopTag} setpoint`, color: 'var(--ll-sp)', x: t, y: first.trace.sp2, dash: '5 4', width: 1.3 },
            { label: `${sec.label} (measured)`, color: 'var(--habit-7)', x: t, y: first.trace.pv2, width: 1.5 },
          ]} />
      )}
      {second && sec && (
        <Chart label={`${sec.label} during ${first.scenario.name}`} height={Math.round(height * 0.8)} x={{ label: `Time (${unit})` }} y={{ label: `${sec.label} (${sec.unit})` }} series={second} />
      )}
      <Chart label="Valve during the test" series={cv} x={{ label: `Time (${unit})` }} y={{ label: single ? 'Output (%)' : 'Valve stem (%)', min: -2, max: 102 }} height={Math.round(height * 0.7)} legend />
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
            <th>Measure <span className="ll-row-note">tap one to see what it means</span></th>
            {entries.map((e, i) => <th key={i}><span className="ll-swatch" style={{ background: e.color }} />{e.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.group}>
              <tr><th colSpan={entries.length + 1} style={{ textAlign: 'left', paddingTop: '0.7rem' }}>{g.group}</th></tr>
              {g.rows.map((row) => {
                const vals = row.rank ? entries.map((e) => row.rank!.get(e.score)) : [];
                const isOpen = open === row.key;
                return (
                  <Fragment key={row.key}>
                    <tr className={isOpen ? 'is-open' : ''}>
                      <td>
                        <button className="ll-measure" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : row.key)}>
                          <span className="ll-measure-label">{row.label} <span aria-hidden className="ll-measure-icon">{isOpen ? '−' : 'ⓘ'}</span></span>
                          {row.note && <span className="ll-row-note">{row.note}</span>}
                        </button>
                      </td>
                      {entries.map((e, i) => (
                        <td key={i} className={row.rank ? cls(row.rank, vals[i], vals) : ''} style={row.key === 'needsModel' ? { maxWidth: '14rem' } : undefined}>{row.cell(e.score)}</td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr className="ll-measure-row">
                        <td colSpan={entries.length + 1}><MeasureExplain id={row.key} proc={proc} /></td>
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

/** The scorecard in four numbers and a sentence. */
export function ResultSummary({ proc, score }: { proc: ProcessDef; score: Scorecard }) {
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
    <div>
      <div className="ll-stats">
        {hasSteps && (
          <Stat title="Setpoint changes" tone={neverSettles ? 'bad' : overshoot > 15 ? 'warn' : 'good'}
            value={`${fmt(overshoot, 2)} % overshoot`} sub={neverSettles ? 'some never settle' : `settles within ${dur(settling)}`} />
        )}
        {hasUpsets && (
          <Stat title="Upsets" tone={neverRecovers ? 'bad' : ''}
            value={`${inUnits(peak)} worst`} sub={neverRecovers ? 'some never recover' : `back on setpoint within ${dur(recovery)}`} />
        )}
        <Stat title="Valve" tone="" value={`${fmt(score.travel, 2)} strokes/h`} sub={`output moves ${fmt(score.cvActivity, 2)} %/min`} />
        <Stat title="Robustness" tone={robustTone}
          value={score.robust ? `Ms ${fmt(ms, 3)}` : 'n/a'}
          sub={`${!score.robust ? 'on-off has no linear model' : !score.stableAll ? 'unstable over the spread' : ms > 2 ? 'fragile (aim below 1.6)' : ms > 1.6 ? 'acceptable' : 'robust'}${Number.isFinite(mismatchOs) ? ` · wrong-plant test: ${fmt(mismatchOs, 2)} % overshoot` : ''}`} />
      </div>
      <p className={`ll-verdict-line${good ? ' is-good' : ''}`}>{verdict.join(' ')}</p>
    </div>
  );
}
