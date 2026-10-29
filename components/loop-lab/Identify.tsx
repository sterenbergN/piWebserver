'use client';

import { useMemo, useState } from 'react';
import { fitModel, parseTable, type IdentResult, type ModelType, type Table } from '@/lib/loop-lab/ident';
import { defaultParams } from '@/lib/loop-lab/model';
import { getProcess } from '@/lib/loop-lab/processes';
import { sampleTrend } from '@/lib/loop-lab/sample';
import { defaultController } from '@/lib/loop-lab/controllers';
import type { Experiment } from '@/lib/loop-lab/setup';
import { getRule } from '@/lib/loop-lab/tuning';
import Chart, { fmt } from './Chart';
import { PALETTE } from './Results';
import { NumField } from './Setup';

const TYPES: { id: ModelType; label: string }[] = [
  { id: 'fopdt', label: 'First order + dead time' },
  { id: 'sopdt', label: 'Second order + dead time' },
  { id: 'integrating', label: 'Integrator + dead time' },
];

type Kept = { label: string; at: number; r: IdentResult; span: number };

/** Pick likely columns: time first, then the one that moves in steps (the output), then the PV. */
function guessColumns(t: Table) {
  const n = t.columns.length;
  if (n < 2) return { time: 0, u: 0, y: 0 };
  const firstNumeric = t.columns.findIndex((_, c) => t.rows.some((r) => Number.isFinite(r[c])));
  const time = Math.max(0, firstNumeric);
  const others = t.columns.map((_, c) => c).filter((c) => c !== time && t.rows.some((r) => Number.isFinite(r[c])));
  // The controller output changes in a few big jumps; the PV changes a little every sample.
  const jumpiness = (c: number) => {
    let changes = 0;
    for (let i = 1; i < t.rows.length; i++) if (t.rows[i][c] !== t.rows[i - 1][c]) changes++;
    return changes / t.rows.length;
  };
  const sorted = [...others].sort((a, b) => jumpiness(a) - jumpiness(b));
  return { time, u: sorted[0] ?? time, y: sorted[1] ?? sorted[0] ?? time };
}

/**
 * Identify a model from a trend: paste or load a CSV (a TIA Portal trace, a
 * historian export), choose the columns and the window, fit, then use the
 * model as a process in the bench.
 */
export default function IdentifyPanel({ onUse }: { onUse: (e: Experiment) => void }) {
  const [text, setText] = useState('');
  const [cols, setCols] = useState({ time: 0, u: 1, y: 2 });
  const [range, setRange] = useState({ lo: NaN, hi: NaN });
  const [win, setWin] = useState({ from: 0, to: 100 });
  const [type, setType] = useState<ModelType>('fopdt');
  const [kept, setKept] = useState<Kept[]>([]);

  const table = useMemo(() => parseTable(text), [text]);
  const load = (t: string) => {
    setText(t);
    const tb = parseTable(t);
    const g = guessColumns(tb);
    setCols(g);
    const ys = tb.rows.map((r) => r[g.y]).filter(Number.isFinite);
    setRange(ys.length ? { lo: Math.floor(Math.min(...ys)), hi: Math.ceil(Math.max(...ys)) } : { lo: NaN, hi: NaN });
    setWin({ from: 0, to: 100 });
  };

  const data = useMemo(() => {
    if (table.rows.length < 10) return null;
    const raw = table.rows.map((r) => [r[cols.time], r[cols.u], r[cols.y]]).filter((r) => r.every(Number.isFinite));
    if (raw.length < 10) return null;
    const t0 = raw[0][0];
    const all = raw.map(([t, u, y]) => ({ t: t - t0, u, y }));
    const T = all[all.length - 1].t;
    const sel = all.filter((p) => p.t >= (win.from / 100) * T && p.t <= (win.to / 100) * T);
    return { all, sel, T };
  }, [table, cols, win]);

  const fit = useMemo(() => {
    if (!data || data.sel.length < 10) return null;
    const ts = data.sel.map((p) => p.t);
    return fitModel(ts.map((t) => t - ts[0]), data.sel.map((p) => p.u), data.sel.map((p) => p.y), type);
  }, [data, type]);

  const span = Number.isFinite(range.hi - range.lo) && range.hi > range.lo ? range.hi - range.lo : NaN;
  const pct = (v: number) => (v / span) * 100;
  const Kpct = fit ? pct(fit.type === 'integrating' ? fit.kPrime : fit.K) : NaN;
  const experiment = (): Experiment | null => {
    if (!fit || !Number.isFinite(span)) return null;
    const proc = getProcess('custom');
    const integ = fit.type === 'integrating';
    // Integrating: the custom plant ramps at K/τ1, so fix τ1 and put the slope in K.
    const tau1 = integ ? 100 : Math.max(fit.tau1, 0.1);
    const K = integ ? Kpct * tau1 : Kpct;
    const y0 = ((fit.y0 - range.lo) / span) * 100;
    const params = {
      ...defaultParams(proc),
      integrating: integ ? 1 : 0,
      K: Number(K.toPrecision(4)),
      tau1: Number(tau1.toPrecision(4)),
      tau2: integ ? Number(fit.tau1.toPrecision(4)) : Number(fit.tau2.toPrecision(4)),
      txDelay: Number(fit.theta.toPrecision(3)),
      bias: Number((y0 - K * fit.u0).toPrecision(4)),
      u0: Number(fit.u0.toPrecision(4)),
      txNoise: Number(Math.min(5, pct(fit.noise)).toPrecision(2)),
      Ts: Math.min(10, Math.max(0.05, Number(fit.dt.toPrecision(2)))),
    };
    const exp: Experiment = { process: 'custom', params, controller: defaultController('pid', proc) };
    // Start from a SIMC PI on the identified model.
    const lagged = integ ? fit.tau1 : fit.tau2 / 2;
    const m = { K: Math.abs(integ ? Kpct * 1e4 : Kpct), tau: integ ? 1e4 : fit.tau1 + fit.tau2 / 2, theta: fit.theta + lagged + params.Ts / 2, tau1: fit.tau1, tau2: fit.tau2, theta2: fit.theta, kPrime: Kpct, integrating: integ };
    const pi = getRule('simc').tune(m, 'PI', 2 * m.theta);
    if (pi && exp.controller.kind === 'pid') exp.controller = { kind: 'pid', pid: { ...exp.controller.pid, ...pi, invert: Kpct < 0 } };
    return exp;
  };

  const gainSpread = kept.length > 1 ? Math.max(...kept.map((k) => Math.abs(k.r.type === 'integrating' ? k.r.kPrime : k.r.K))) / Math.min(...kept.map((k) => Math.abs(k.r.type === 'integrating' ? k.r.kPrime : k.r.K))) : NaN;

  return (
    <div>
      <div className="ll-card">
        <div className="ll-card-head">
          <h3>Load a trend</h3>
          <span className="ll-small">CSV: a TIA Portal trace, a historian export, a spreadsheet</span>
        </div>
        <p className="ll-small" style={{ marginTop: 0 }}>
          Best data: the loop in manual, steady, then one or two output steps of 5–10 %, recorded until the PV settles.
          Semicolons, commas or tabs; decimal commas; timestamps or seconds. The first samples are taken as the operating point.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
          <label className="ll-btn is-small">
            📂 Open a file
            <input type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) load(await f.text());
            }} />
          </label>
          <button className="ll-btn is-small" onClick={() => load(sampleTrend())}>Use a sample bump test</button>
          {text && <button className="ll-btn is-small" onClick={() => load('')}>Clear</button>}
        </div>
        <textarea rows={4} placeholder="…or paste the CSV here" style={{ marginTop: '0.5rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}
          value={text.length > 20000 ? `${text.slice(0, 20000)}\n…` : text} onChange={(e) => load(e.target.value)} aria-label="CSV data" />
        {text && <p className="ll-note">{table.rows.length} rows, {table.columns.length} columns.</p>}
      </div>

      {table.rows.length >= 10 && (
        <div className="ll-card">
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Columns and window</h3>
          <div className="ll-fields is-3">
            {(['time', 'u', 'y'] as const).map((k) => (
              <label key={k} className="ll-field">
                <span>{k === 'time' ? 'Time' : k === 'u' ? 'Controller output (%)' : 'Process value'}</span>
                <select value={cols[k]} onChange={(e) => setCols({ ...cols, [k]: Number(e.target.value) })}>
                  {table.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="ll-fields" style={{ marginTop: '0.5rem' }}>
            <NumField label="Transmitter range low" value={Number.isFinite(range.lo) ? range.lo : 0} onChange={(v) => setRange({ ...range, lo: v })} title="Transmitter range, to express the model in % of span" />
            <NumField label="Transmitter range high" value={Number.isFinite(range.hi) ? range.hi : 100} onChange={(v) => setRange({ ...range, hi: v })} />
            <label className="ll-field">
              <span>Fit from<em>{fmt(((data?.T ?? 0) * win.from) / 100, 3)} s</em></span>
              <input type="range" min={0} max={95} value={win.from} onChange={(e) => setWin({ ...win, from: Math.min(Number(e.target.value), win.to - 5) })} />
            </label>
            <label className="ll-field">
              <span>Fit to<em>{fmt(((data?.T ?? 0) * win.to) / 100, 3)} s</em></span>
              <input type="range" min={5} max={100} value={win.to} onChange={(e) => setWin({ ...win, to: Math.max(Number(e.target.value), win.from + 5) })} />
            </label>
          </div>
          <p className="ll-note">Set the PV range to the transmitter&apos;s range (it starts at the data&apos;s minimum and maximum): the gain in % of span, and everything tuned from it, depends on it.</p>
          <div className="ll-seg" role="group" aria-label="Model type" style={{ marginTop: '0.6rem' }}>
            {TYPES.map((m) => <button key={m.id} aria-pressed={type === m.id} onClick={() => setType(m.id)}>{m.label}</button>)}
          </div>
        </div>
      )}

      {data && fit && (
        <div className="ll-card">
          <div className="ll-card-head">
            <h3>Fitted model</h3>
            <span className={`ll-badge${fit.fit > 85 ? ' is-good' : fit.fit > 60 ? '' : ' is-bad'}`}>fit {fmt(fit.fit, 3)} %</span>
          </div>
          <dl className="ll-kv">
            {fit.type === 'integrating'
              ? <><dt>Slope k′</dt><dd>{fmt(fit.kPrime, 3)} per s per % ({fmt(Kpct, 3)} % of span per s per %)</dd></>
              : <><dt>Gain K</dt><dd>{fmt(fit.K, 3)} per % ({fmt(Kpct, 3)} % of span per %)</dd></>}
            <dt>Time constant{fit.type === 'sopdt' ? 's' : ''}</dt><dd>{fit.tau1 > 0 ? `${fmt(fit.tau1, 3)} s` : 'none'}{fit.type === 'sopdt' ? `, ${fmt(fit.tau2, 3)} s` : ''}</dd>
            <dt>Dead time θ</dt><dd>{fmt(fit.theta, 3)} s</dd>
            <dt>Residual (noise + misfit)</dt><dd>{fmt(fit.noise, 3)} ({fmt(pct(fit.noise), 2)} % of span)</dd>
            <dt>Operating point</dt><dd>output {fmt(fit.u0, 3)} %, PV {fmt(fit.y0, 4)}</dd>
          </dl>
          <Chart label="Measured and model PV" height={210} x={{ label: 'Time (s)' }} y={{ label: table.columns[cols.y] }}
            series={[
              { label: 'Measured', color: 'var(--muted)', x: fit.t, y: fit.y, width: 1 },
              { label: 'Model', color: PALETTE[0], x: fit.t, y: fit.yhat, width: 2.2 },
            ]} />
          <Chart label="Controller output" height={120} x={{ label: 'Time (s)' }} y={{ label: 'Output (%)' }}
            series={[{ label: table.columns[cols.u], color: 'var(--ll-cv)', x: fit.t, y: fit.u, width: 1.6 }]} />
          <Chart label="Residual" height={110} x={{ label: 'Time (s)' }} y={{ label: 'Residual' }} hGuides={[{ at: 0 }]}
            series={[{ label: 'Measured − model', color: PALETTE[1], x: fit.t, y: fit.y.map((v, i) => v - fit.yhat[i]), width: 1 }]} />
          <p className="ll-note">
            {fit.fit < 60 ? 'A poor fit: check the columns, narrow the window to one clean step, or try another model type.' :
              'A residual that wanders slowly means unmodelled dynamics or a disturbance during the test; one that looks like noise means the model has what there is to find.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            <button className="ll-btn is-primary" disabled={!Number.isFinite(span)} onClick={() => { const e = experiment(); if (e) onUse(e); }}>Use as a process in the bench</button>
            <button className="ll-btn" onClick={() => setKept([...kept, { label: `PV ≈ ${fmt(fit.y0, 3)}`, at: fit.y0, r: fit, span }])}>Keep this fit</button>
          </div>
        </div>
      )}

      {kept.length > 0 && (
        <div className="ll-card">
          <div className="ll-card-head"><h3>Fits at different operating points</h3><button className="ll-link" onClick={() => setKept([])}>Clear</button></div>
          <div className="ll-table-wrap">
            <table className="ll-table">
              <thead><tr><th>Operating point</th><th>Gain (% of span per %)</th><th>τ</th><th>θ</th><th>Fit</th></tr></thead>
              <tbody>
                {kept.map((k, i) => (
                  <tr key={i}>
                    <td>{k.label}</td>
                    <td>{fmt(((k.r.type === 'integrating' ? k.r.kPrime : k.r.K) / k.span) * 100, 3)}{k.r.type === 'integrating' ? ' /s' : ''}</td>
                    <td>{fmt(k.r.tau1, 3)} s</td><td>{fmt(k.r.theta, 3)} s</td><td>{fmt(k.r.fit, 3)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Number.isFinite(gainSpread) && (
            <p className="ll-note">
              The gain varies {fmt(gainSpread, 2)}× across these points.{' '}
              {gainSpread < 2 ? 'Within about 2:1 one PI tuning will do.' : 'Beyond about 2:1, schedule the gains (or characterize, if you know why the gain changes): see the conical tank case study.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
