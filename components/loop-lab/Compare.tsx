'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { benchLink } from '@/lib/loop-lab/catalog';
import { compareProcess, countsIn, eligible, FRAGILE_MS, GOOD_ENOUGH, metricOf, outOfTheRunning, overallOf, overallWinner, testWinner, type Comparison, type CompareRow, type TestNumbers } from '@/lib/loop-lab/compare';
import { describeController, type ControllerConfig } from '@/lib/loop-lab/controllers';
import type { Params, ProcessDef } from '@/lib/loop-lab/model';
import { fmt } from './Chart';

type Metric = { id: string; label: string; unit: string; test: (t: TestNumbers) => number | null; all: (r: CompareRow) => number | null; format?: (v: number) => string };

const seconds = (v: number) => (v < 120 ? `${fmt(v, 3)} s` : `${fmt(v / 60, 3)} min`);
const METRICS: Metric[] = [
  { id: 'iae', label: 'Error', unit: 'IAE, % of span × min. All the time away from setpoint, added up.', test: (t) => t.iae, all: (r) => r.iae },
  { id: 'overshoot', label: 'Overshoot', unit: '% of the setpoint step, the worst one.', test: (t) => t.overshoot, all: (r) => r.overshoot, format: (v) => `${fmt(v, 2)} %` },
  { id: 'settling', label: 'Settling', unit: 'Time to stay within 2 % of a setpoint step, the slowest one.', test: (t) => t.settling, all: (r) => r.settling, format: seconds },
  { id: 'peak', label: 'Upset peak', unit: 'How far an upset pushes it, % of span, the worst one.', test: (t) => t.peak, all: (r) => r.worstPeak, format: (v) => `${fmt(v, 2)} %` },
  { id: 'recovery', label: 'Recovery', unit: 'Time back to within 1 % of span after an upset, the slowest one.', test: (t) => t.recovery, all: (r) => r.recovery, format: seconds },
  { id: 'travel', label: 'Valve travel', unit: 'Full strokes per hour: what the loop costs the valve.', test: (t) => t.travel, all: (r) => r.travel },
];

const show = (m: Metric, v: number | null) => (v === null ? '—' : m.format ? m.format(v) : fmt(v, 3));
const percentLess = (a: number, b: number) => Math.round((1 - a / b) * 100);

/** The answer in a sentence, from the numbers. */
function verdict(c: Comparison) {
  const w = overallWinner(c);
  if (!w) return { text: 'Nothing here stays stable over the plant’s whole spread: this plant needs more than tuning.', tone: 'bad' };
  const noun = c.goal === 'calm' ? 'valve movement' : 'error';
  const pi = c.rows.find((r) => r.id === 'pi');
  const fragile = w.simplest.ms !== null && w.simplest.ms > FRAGILE_MS ? ` Its margins are thin, though (Ms ${fmt(w.simplest.ms, 3)}): none of these is robust here.` : '';
  if (w.simplest.id === 'pi' && w.best.id === 'pi') return { text: `PI is the best here, and the simplest.${fragile}`, tone: 'good' };
  if (w.simplest.id !== w.best.id) {
    return { text: `${w.simplest.label} is enough: within ${Math.round((GOOD_ENOUGH - 1) * 100)} % of the lowest ${noun} (${w.best.label}), with less to go wrong.${fragile}`, tone: fragile ? 'warn' : 'good' };
  }
  const better = pi && eligible(c, pi) && overallOf(c, pi) > 0 ? `: ${percentLess(overallOf(c, w.best), overallOf(c, pi))} % less ${noun} than PI` : '';
  return { text: `${w.best.label} is the clear choice${better}.${fragile}`, tone: fragile ? 'warn' : 'good' };
}

export default function ComparePanel({ proc, params, plantChanges, onUse }: {
  proc: ProcessDef; params: Params; plantChanges: number; onUse?: (c: ControllerConfig) => void;
}) {
  const [stored, setStored] = useState<Comparison | null>(null);
  const [live, setLive] = useState<{ key: string; data: Comparison } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [metricId, setMetricId] = useState('');
  const key = JSON.stringify([proc.id, params]);

  useEffect(() => {
    let on = true;
    setStored(null);
    void import('@/lib/loop-lab/compare-data.json').then((m) => {
      if (on) setStored((m.default as unknown as Record<string, Comparison>)[proc.id] ?? null);
    });
    return () => { on = false; };
  }, [proc.id]);

  const runLive = async () => {
    setProgress('Starting…');
    const data = await compareProcess(proc, params, (done, total, label) => setProgress(`Tuning ${label} (${done + 1} of ${total})…`));
    setLive({ key, data });
    setProgress(null);
  };

  const c = live?.key === key ? live.data : stored;
  if (!c) return <div className="ll-empty">Loading the comparison…</div>;
  const usingStored = c === stored;
  const defaultMetric = c.goal === 'calm' ? 'travel' : 'iae';
  const metric = METRICS.find((m) => m.id === (metricId || defaultMetric))!;
  const v = verdict(c);
  const racing = c.rows.filter((r) => eligible(c, r));
  const name = c.goal === 'calm' ? 'Calmest outflow' : 'Lowest error';
  const judged = c.goal === 'calm' ? 'valve travel, with the level staying in the tank' : 'error (IAE)';

  /** The best number in a test or overall, for the metric on show. */
  const bestOf = (value: (r: CompareRow) => number | null, counts: (r: CompareRow) => boolean) => {
    const vals = racing.filter(counts).map(value).filter((x): x is number => x !== null);
    return vals.length ? Math.min(...vals) : null;
  };
  const cellClass = (val: number | null, best: number | null, inRace: boolean) => {
    if (!inRace) return 'is-out';
    if (val === null || best === null) return '';
    if (val <= best * 1.001 + 1e-12) return 'is-best';
    return val <= best * GOOD_ENOUGH ? 'is-near' : '';
  };
  const open = (row: CompareRow) => (onUse
    ? <button className="ll-link ll-cmp-name" onClick={() => onUse(row.config)} title="Use this tuning on the bench">{row.label}</button>
    : <Link className="ll-cmp-name" href={benchLink({ process: proc.id, params, controller: row.config })} title="Open this tuning on the bench">{row.label}</Link>);

  return (
    <div className="ll-cmp">
      <p className={`ll-verdict-line is-${v.tone}`}><span className="ll-dot" aria-hidden />{v.text}</p>
      <p className="ll-purpose">
        {c.rows.length} controllers, each tuned the same way on this plant, through the same {c.tests.length} tests.
        {' '}{c.goal === 'calm' ? 'A surge tank’s level is there to move, so the goal is the calmest outflow, not the tightest level.' : ''}
      </p>

      {plantChanges > 0 && usingStored && (
        <p className="ll-cmp-stale">
          <span>These numbers are for the default plant, and you have changed {plantChanges} setting{plantChanges > 1 ? 's' : ''}.</span>
          <button className="ll-btn is-small" onClick={runLive} disabled={!!progress}>{progress ?? 'Re-run for this plant'}</button>
        </p>
      )}
      {!usingStored && <p className="ll-cmp-stale"><span>Tuned and run on your plant, as it is now.</span></p>}

      <section className="ll-part">
        <div className="ll-part-head"><h3>Which one for which test</h3></div>
        <div className="ll-table-wrap">
          <table className="ll-table ll-cmp-winners">
            <thead><tr><th>Test</th><th>{name}</th><th>Simplest within {Math.round((GOOD_ENOUGH - 1) * 100)} %</th></tr></thead>
            <tbody>
              {c.tests.map((t, i) => {
                const w = testWinner(c, i);
                return (
                  <tr key={t.id}>
                    <td>{t.name}{t.limit && <span className="ll-cmp-limit">Must keep to {t.limit}</span>}</td>
                    <td>{w ? <><strong>{w.best.label}</strong> <span className="ll-small">{fmt(metricOf(c, w.best, i), 3)}</span></> : '—'}</td>
                    <td>{w ? (w.simplest.id === w.best.id ? <span className="ll-small">the same</span> : <><strong>{w.simplest.label}</strong> <span className="ll-small">{fmt(metricOf(c, w.simplest, i), 3)}</span></>) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ll-note">Judged on {judged}. Lower is better. Controllers that never settled in a test or broke its limit don’t count there.</p>
      </section>

      <section className="ll-part">
        <div className="ll-part-head">
          <h3>All the numbers</h3>
          <div className="ll-seg is-small" role="group" aria-label="Which number">
            {METRICS.map((m) => <button key={m.id} aria-pressed={metric.id === m.id} onClick={() => setMetricId(m.id)}>{m.label}</button>)}
          </div>
        </div>
        <div className="ll-table-wrap ll-cmp-scroll">
          <table className="ll-table ll-cmp-matrix">
            <thead>
              <tr>
                <th>Controller</th>
                {c.tests.map((t) => <th key={t.id} title={t.name}>{t.name}</th>)}
                <th className="is-total">All tests</th>
                <th title="Peak sensitivity, worst over the operating points and the plant's spread. Below 1.6 is robust, above 2 fragile.">Ms</th>
                <th title="Numbers someone has to set and keep right">To tune</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row) => {
                const out = outOfTheRunning(c, row);
                return (
                  <tr key={row.id} className={out ? 'is-out-row' : ''}>
                      <th scope="row">
                        {open(row)}
                        <span className="ll-cmp-how" title={describeController(proc, row.config)}>{out ?? describeController(proc, row.config)}</span>
                      </th>
                      {c.tests.map((t, i) => {
                        const val = metric.test(row.tests[i]);
                        const best = bestOf((r) => metric.test(r.tests[i]), (r) => countsIn(c, r, i));
                        const counts = countsIn(c, row, i);
                        return (
                          <td key={t.id} className={cellClass(val, best, !out && counts)}>
                            {show(metric, val)}
                            {row.tests[i].overLimit ? <sup title="Went over this test's limit">!</sup> : !t.limit && !row.tests[i].settled ? <sup title="Didn't settle or recover in this test">*</sup> : null}
                          </td>
                        );
                      })}
                      <td className={`is-total ${cellClass(metric.all(row), bestOf(metric.all, () => true), !out)}`}>{show(metric, metric.all(row))}</td>
                      <td className={row.ms !== null && row.ms > 2 ? 'is-warn' : ''}>{row.ms === null ? '—' : fmt(row.ms, 3)}</td>
                      <td>{row.tuningParams}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ll-note">
          {metric.unit} <span className="ll-cmp-key is-best">Best</span> <span className="ll-cmp-key is-near">within {Math.round((GOOD_ENOUGH - 1) * 100)} %</span>
          {' '}<sup>*</sup> didn’t settle or recover in that test. <sup>!</sup> broke the test’s limit. {onUse ? 'Click a controller to put its tuning on the bench.' : 'Click a controller to open its tuning on the bench.'}
        </p>
      </section>

      <details className="ll-more">
        <summary>How this was compared</summary>
        <div className="ll-prose ll-cmp-method">
          <p><strong>Tuning.</strong> Every controller starts from the tuning rules, then a range of speeds runs through every test. The one kept has the lowest error, with a growing cost for valve movement, among those that stay stable and keep Ms at or below 2 over the plant’s spread. No controller gets hand-tuning the others don’t.</p>
          <p><strong>Best.</strong> On-off can’t win (it cycles by design), nor anything unstable over the plant’s spread, nor (on valves) anything moving the valve more than 10× the usual and over 50 strokes an hour. “Simplest” is the first rung up the ladder within {Math.round((GOOD_ENOUGH - 1) * 100)} % of the best.</p>
          <p><strong>Limits of the numbers.</strong> Ms is checked on the linear model, so MPC, which has none, shows a dash, and the self-tuner’s is for the PI it starts from. Error is not everything: look at valve travel, Ms and how much there is to tune before deciding.</p>
          {c.notApplicable.length > 0 && <p><strong>Left out here.</strong> {c.notApplicable.map((n) => `${n.label}: ${n.reason}`).join('. ')}.</p>}
        </div>
      </details>
    </div>
  );
}
