'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { driftedPlants, runDrifted, worstOf, type DriftedRun } from '@/lib/loop-lab/drift';
import type { ProcessDef } from '@/lib/loop-lab/model';
import { scorecard } from '@/lib/loop-lab/score';
import type { Run } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import Chart, { fmt, type Series } from './Chart';
import type { DriftRequest } from './drift.worker';
import { plainSymbol } from './PlantEditor';
import { PALETTE, dur } from './Results';

const SAMPLES = 8;
/** The longer check: the same first eight draws and more. */
const MORE = 24;

const pct = (v: number) => (Number.isFinite(v) ? `${fmt(v, 3)} %` : '—');
const time = (v: number) => (Number.isFinite(v) ? dur(v) : 'never');

/**
 * The selected test run again on plants drifted within the process's stated spread, the
 * controller keeping its tuning: robustness checked in time, not only on the margins.
 */
export default function DriftPanel({ proc, exp, nominal }: { proc: ProcessDef; exp: Experiment; nominal: Run }) {
  const scenario = nominal.scenario;
  const key = JSON.stringify([exp, scenario.id]);
  const [state, setState] = useState<{ key: string; runs: DriftedRun[]; running: boolean; samples: number }>({ key: '', runs: [], running: false, samples: SAMPLES });
  const token = useRef(0);
  const worker = useRef<Worker | null>(null);
  const stop = () => {
    token.current++;
    worker.current?.terminate();
    worker.current = null;
  };
  // A different setup or test: whatever was running is for something else now.
  useEffect(() => () => {
    token.current++;
    worker.current?.terminate();
    worker.current = null;
  }, [key]);

  const nominalCard = useMemo(() => scorecard(proc, exp.params, exp.controller, [nominal], false), [proc, exp, nominal]);
  const current = state.key === key ? state : { key, runs: [], running: false, samples: SAMPLES };
  const samplesNow = current.samples;
  const done = current.runs.length === samplesNow;
  const total = current.runs.length;

  const start = (samples: number) => {
    stop();
    const mine = token.current;
    setState({ key, runs: [], running: true, samples });
    const runs: DriftedRun[] = [];
    const add = (r: DriftedRun) => {
      runs.push(r);
      setState({ key, runs: [...runs], running: runs.length < samples, samples });
    };
    // Off the page's thread where the browser can, so the page stays responsive while they run.
    try {
      const w = new Worker(new URL('./drift.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onmessage = (e: MessageEvent<{ i?: number; run?: DriftedRun; done?: boolean; error?: string }>) => {
        if (token.current !== mine) return;
        if (e.data.run) add(e.data.run);
        if (e.data.done || e.data.error) {
          w.terminate();
          if (worker.current === w) worker.current = null;
          if (e.data.error) setState({ key, runs: [...runs], running: false, samples });
        }
      };
      w.onerror = () => {
        // The worker wouldn't start: run them here instead.
        w.terminate();
        if (token.current === mine && runs.length === 0) here(samples, mine, add);
      };
      w.postMessage({ process: proc.id, params: exp.params, controller: exp.controller, scenario, samples } satisfies DriftRequest);
    } catch {
      here(samples, mine, add);
    }
  };
  // Without a worker: one plant per tick, so the page still answers between them.
  const here = (samples: number, mine: number, add: (r: DriftedRun) => void) => {
    const plants = driftedPlants(proc, samples);
    const next = (i: number) => {
      if (token.current !== mine) return;
      add(runDrifted(proc, exp.params, exp.controller, scenario, plants[i]));
      if (i + 1 < plants.length) window.setTimeout(() => next(i + 1), 0);
    };
    window.setTimeout(() => next(0), 0);
  };

  if (!proc.uncertain.length) return null;
  const spreadText = proc.uncertain.map((u) => {
    const spec = proc.params.find((s) => s.key === u.key);
    return `${spec?.label.toLowerCase() ?? u.key} ±${Math.round(u.spread * 100)} %`;
  }).join(', ');
  const nom = worstOf([nominalCard]);
  const worst = worstOf(current.runs.map((r) => r.card));
  const steps = nominalCard.tests[0]?.steps.length > 0;
  const upsets = nominalCard.tests[0]?.upsets.length > 0;
  const long = scenario.duration > 600;
  const ts = (r: Run) => (long ? r.trace.t.map((v) => v / 60) : r.trace.t);

  const series: Series[] = [
    { label: 'Setpoint', color: 'var(--ll-sp)', x: ts(nominal), y: nominal.trace.sp, dash: '5 4', width: 1.3 },
    ...current.runs.map((r, i) => ({
      label: i === 0 ? 'Drifted plants' : `Drifted plant ${i + 1}`, quiet: i > 0, color: 'var(--muted)', x: ts(r.run), y: r.run.trace.pvTrue, width: 1,
    })),
    { label: 'As set up', color: PALETTE[0], x: ts(nominal), y: nominal.trace.pvTrue, width: 2.2 },
  ];

  return (
    <details className="ll-more" open={current.runs.length > 0 || undefined}>
      <summary>This test on drifted plants</summary>
      <p className="ll-note">
        The same test on {SAMPLES} (or {MORE}) plants with {spreadText}, drawn at random within that spread (the same draws every time).
        The controller keeps its tuning. The scorecard&apos;s margins judge this spread on the linearized loop; this runs it.
      </p>
      <div className="ll-actions" style={{ margin: '0.5rem 0' }}>
        <button className="ll-btn is-small" onClick={() => start(SAMPLES)} disabled={current.running}>
          {current.running ? `Running ${current.runs.length + 1} of ${samplesNow}…` : done && samplesNow === SAMPLES ? 'Run again' : `Run on ${SAMPLES} drifted plants`}
        </button>
        {!current.running && <button className="ll-btn is-small is-quiet" onClick={() => start(MORE)}>{done && samplesNow === MORE ? `Run on ${MORE} again` : `…or on ${MORE}`}</button>}
        {current.running && <button className="ll-btn is-small is-quiet" onClick={() => { stop(); setState({ ...current, running: false }); }}>Stop</button>}
      </div>
      {current.runs.length > 0 && (
        <>
          <Chart label={`${proc.pv.label} on drifted plants during ${scenario.name}`} height={210} series={series}
            x={{ label: `Time (${long ? 'min' : 's'})` }} y={{ label: `${proc.pv.label} (${proc.pv.unit})` }} />
          {(done || (!current.running && current.runs.length > 0)) && (
            <p className={`ll-verdict-line is-${worst.failed > nom.failed * total ? 'bad' : worst.failed ? 'warn' : 'good'}`} role="status" style={{ fontSize: '0.95rem', margin: '0.6rem 0' }}>
              <span className="ll-dot" />
              {nom.failed
                ? `As set up it doesn't settle or recover in this test either; ${worst.failed === total ? 'nor do any of' : `${total - worst.failed} of`} the ${total} drifted plants${worst.failed === total ? '' : ' do'}.`
                : worst.failed
                  ? `${worst.failed} of ${total} drifted plants never settled or recovered in this test.`
                  : `All ${total} drifted plants settled and recovered.`}
              {!done && ` (Stopped after ${total} of ${samplesNow}.)`}
              {steps && ` Worst overshoot ${pct(worst.overshoot)} (as set up ${pct(nom.overshoot)}).`}
              {upsets && ` Worst upset peak ${pct(worst.peak)} (as set up ${pct(nom.peak)}).`}
            </p>
          )}
          <div className="ll-table-wrap">
            <table className="ll-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  {proc.uncertain.map((u) => {
                    const spec = proc.params.find((s) => s.key === u.key);
                    return <th key={u.key} title={spec?.label}>{plainSymbol(spec?.symbol ?? u.key)}</th>;
                  })}
                  <th>IAE</th>
                  {steps && <><th>Overshoot</th><th>Settling</th></>}
                  {upsets && <><th>Peak</th><th>Recovery</th></>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>As set up</td>
                  {proc.uncertain.map((u) => <td key={u.key}>×1</td>)}
                  <td>{fmt(nom.iae, 3)}</td>
                  {steps && <><td>{pct(nom.overshoot)}</td><td>{time(nom.settling)}</td></>}
                  {upsets && <><td>{pct(nom.peak)}</td><td>{time(nom.recovery)}</td></>}
                </tr>
                {current.runs.map((r, i) => {
                  const w = worstOf([r.card]);
                  return (
                    <tr key={i} className={w.failed ? 'is-bad' : undefined}>
                      <td>{i + 1}</td>
                      {proc.uncertain.map((u) => <td key={u.key}>×{fmt(r.factors[u.key], 3)}</td>)}
                      <td>{fmt(w.iae, 3)}</td>
                      {steps && <><td>{pct(w.overshoot)}</td><td>{time(w.settling)}</td></>}
                      {upsets && <><td>{pct(w.peak)}</td><td>{time(w.recovery)}</td></>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
