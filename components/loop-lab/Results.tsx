'use client';

import { Fragment, useMemo } from 'react';
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
    ...entries.map((e, i) => ({ label: single ? `${proc.pv.label} (true)` : e.label, color: e.color, x: times[i], y: e.run.trace.pvTrue, width: 2 })),
  ];
  const cv: Series[] = entries.flatMap((e, i) => single
    ? [
        { label: 'Controller output', color: 'var(--ll-cv)', x: times[i], y: e.run.trace.cv, width: 1.2 },
        { label: 'Valve stem', color: 'var(--ll-valve)', x: times[i], y: e.run.trace.valve, width: 1.8 },
      ]
    : [{ label: e.label, color: e.color, x: times[i], y: e.run.trace.valve, width: 1.6 }]);
  const events = first.scenario.events.filter((ev) => ev.kind === 'dist' || ev.kind === 'freeze').map((ev) => ({ at: ev.t * scale, label: ev.kind === 'dist' ? `${proc.disturbances.find((d) => d.key === ev.key)?.label ?? ev.key} → ${ev.value}` : 'sensor freeze' }));
  return (
    <div>
      <Chart label={`${proc.pv.label} during ${first.scenario.name}`} series={pv} x={{ label: `Time (${unit})` }} y={{ label: `${proc.pv.label} (${proc.pv.unit})` }} vGuides={events} height={height} />
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

export function ScorecardTable({ entries, compact = false }: { entries: ScoreEntry[]; compact?: boolean }) {
  if (!entries.length) return <div className="ll-empty">Run the tests to see a scorecard.</div>;
  const groups = compact ? [{ group: 'Key measures', rows: ROWS.flatMap((g) => g.rows).filter((r) => COMPACT.has(r.key as string)) }] : ROWS;
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
      <table className="ll-table">
        <thead>
          <tr>
            <th>Measure</th>
            {entries.map((e, i) => <th key={i}><span className="ll-swatch" style={{ background: e.color }} />{e.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.group}>
              <tr><th colSpan={entries.length + 1} style={{ textAlign: 'left', paddingTop: '0.7rem' }}>{g.group}</th></tr>
              {g.rows.map((row) => {
                const vals = entries.map((e) => row.get(e.score));
                return (
                  <tr key={row.key as string}>
                    <td>{row.label}<span className="ll-row-note">{row.note}</span></td>
                    {vals.map((v, i) => <td key={i} className={cls(row, v, vals)}>{row.show(v)}</td>)}
                  </tr>
                );
              })}
            </Fragment>
          ))}
          {compact ? (
            <tr>
              <td>Tuning parameters<span className="ll-row-note">cost of complexity</span></td>
              {entries.map((e, i) => <td key={i}>{e.score.complexity.tuningParams}</td>)}
            </tr>
          ) : (
            <>
          <tr>
            <td>Stable over the spread<span className="ll-row-note">every operating point, plant parameters varied</span></td>
            {entries.map((e, i) => <td key={i}>{e.score.robust ? (e.score.stableAll ? 'yes' : <span className="ll-badge is-bad">no</span>) : '—'}</td>)}
          </tr>
          <tr><th colSpan={entries.length + 1} style={{ textAlign: 'left', paddingTop: '0.7rem' }}>Cost of complexity</th></tr>
          <tr>
            <td>Tuning parameters<span className="ll-row-note">numbers someone has to set and keep right</span></td>
            {entries.map((e, i) => <td key={i}>{e.score.complexity.tuningParams}</td>)}
          </tr>
          <tr>
            <td>Needs a model of</td>
            {entries.map((e, i) => <td key={i} style={{ textAlign: 'right', maxWidth: '14rem' }}>{e.score.complexity.needsModel ?? 'nothing beyond a bump test'}</td>)}
          </tr>
          <tr>
            <td>Commissioning effort<span className="ll-row-note">1 switch on and tune … 5 needs an engineer</span></td>
            {entries.map((e, i) => <td key={i} title={`${e.score.complexity.commissioning} of 5`}>{dots(e.score.complexity.commissioning)}</td>)}
          </tr>
          <tr>
            <td>Maintainability<span className="ll-row-note">5 any technician … 1 only its designer</span></td>
            {entries.map((e, i) => <td key={i} title={`${e.score.complexity.maintainability} of 5`}>{dots(e.score.complexity.maintainability)}</td>)}
          </tr>
            </>
          )}
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
                <td>Setpoint {fmt(s.from, 3)} → {fmt(s.to, 3)} {proc.pv.unit} at {dur(s.t)}</td>
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
