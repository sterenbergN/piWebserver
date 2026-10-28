'use client';

import { useMemo, useState } from 'react';
import { MathText, Tex } from '@/components/daily/MathText';
import { PROCESS_CONTENT } from '@/lib/loop-lab/content';
import { linearPidAt } from '@/lib/loop-lab/controllers';
import { exportCode, exportReference, pidCompactParams } from '@/lib/loop-lab/export';
import { texNum } from './format';
import {
  analyzeLoop, closedLoop, isStable, linearizePlant, settleHorizon, stepResponse, timeConstants, approximate, type PlantModel,
} from '@/lib/loop-lab/linear';
import { cleanParams, nominalDisturbances, valveCharacteristic, VALVE_CHARS, type ProcessDef } from '@/lib/loop-lab/model';
import { flowAt } from '@/lib/loop-lab/processes/flow';
import { tankArea, tankVolume } from '@/lib/loop-lab/processes/tank';
import { findSteady, type Run } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import Chart, { fmt, type Series } from './Chart';
import { BlockDiagram, FlowSchematic, PAndId, TankSchematic, type ProbeKey } from './Drawings';
import { PALETTE } from './Results';

const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

// ─── Mechanical ─────────────────────────────────────────────────────────────

export function MechanicalView({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const p = useMemo(() => cleanParams(proc, exp.params), [proc, exp.params]);
  const d = useMemo(() => nominalDisturbances(proc), [proc]);
  const s = findSteady(proc, p, d, proc.nominalPv);
  const plots = useMemo(() => {
    const st = linspace(0, 100, 101);
    if (proc.id === 'flow') {
      const series: Series[] = VALVE_CHARS.map((c, i) => ({
        label: `${c.label}${c.value === p.valveChar ? ' (fitted)' : ''}`,
        color: PALETTE[i], width: c.value === p.valveChar ? 2.6 : 1.4,
        x: st, y: st.map((v) => flowAt(valveCharacteristic(c.value, v / 100), d.P0, { ...p, valveChar: c.value })),
      }));
      const inherent: Series = {
        label: 'Inherent (no line losses)', color: 'var(--muted)', dash: '4 4', width: 1.2,
        x: st, y: st.map((v) => valveCharacteristic(p.valveChar, v / 100) * flowAt(1, d.P0, p)),
      };
      return [{ title: 'Installed characteristic: flow vs stem position', series: [...series, inherent], x: 'Stem position (%)', y: 'Flow (m³/h)' }];
    }
    const hs = linspace(0.05, p.H, 80);
    const k = (p.Kout * (d.dOut / 100)) / 3600;
    return [
      {
        title: 'Cross-section and volume vs level', x: 'Level (m)', y: 'Area (m²) · volume (m³)',
        series: [
          { label: 'Area A(h)', color: PALETTE[0], x: hs, y: hs.map((h) => tankArea(h, p)) },
          { label: 'Volume V(h)', color: PALETTE[2], x: hs, y: hs.map((h) => tankVolume(h, p)) },
        ],
      },
      {
        title: 'How fast the level answers the valve, vs level', x: 'Level (m)', y: 'k′ (%/s per %)',
        series: [{ label: 'Integrating slope k′ = Qmax / (100·A)', color: PALETTE[1], x: hs, y: hs.map((h) => ((p.Qmax / 3600 / 100) / tankArea(h, p)) * (100 / p.H)) }],
        note: `Time constant 2A√h/k runs from ${fmt((2 * tankArea(proc.opPoints[0], p) * Math.sqrt(proc.opPoints[0])) / k / 60, 2)} min at ${proc.opPoints[0]} m to ${fmt((2 * tankArea(proc.opPoints[2], p) * Math.sqrt(proc.opPoints[2])) / k / 60, 2)} min at ${proc.opPoints[2]} m.`,
      },
    ];
  }, [proc, p, d]);
  const content = PROCESS_CONTENT[proc.id];
  return (
    <div>
      <div className="ll-card">
        {proc.id === 'flow'
          ? <FlowSchematic p={p} valve={s.valve} flow={s.pv} P0={d.P0} />
          : <TankSchematic p={p} level={s.pv} valve={s.valve} dOut={d.dOut} qIn={p.Qmax * valveCharacteristic(p.valveChar, s.valve / 100)} qOut={p.Kout * (d.dOut / 100) * Math.sqrt(s.pv)} />}
        <p className="ll-small" style={{ textAlign: 'center' }}>At steady state at {fmt(proc.nominalPv, 3)} {proc.pv.unit}, nominal disturbances.</p>
      </div>
      <div className="ll-card"><MathText className="ll-prose">{content.mechanical}</MathText></div>
      {plots.map((pl) => (
        <div className="ll-card" key={pl.title}>
          <div className="ll-chart-title">{pl.title}</div>
          <Chart label={pl.title} series={pl.series} x={{ label: pl.x }} y={{ label: pl.y }} height={230} />
          {'note' in pl && pl.note && <p className="ll-note">{pl.note}</p>}
        </div>
      ))}
      <div className="ll-card">
        <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Parameters</h3>
        <div className="ll-table-wrap">
          <table className="ll-table">
            <thead><tr><th>Parameter</th><th>Value</th><th style={{ textAlign: 'left' }}>Meaning</th></tr></thead>
            <tbody>
              {proc.params.map((sp) => (
                <tr key={sp.key}>
                  <td>{sp.label}{sp.symbol && <> (<Tex latex={sp.symbol} />)</>}</td>
                  <td>{sp.options ? sp.options.find((o) => o.value === p[sp.key])?.label : `${fmt(p[sp.key], 4)} ${sp.unit}`}</td>
                  <td style={{ textAlign: 'left', color: 'var(--muted)' }}>{sp.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Control ────────────────────────────────────────────────────────────────

function plantTex(m: PlantModel) {
  const factors = m.poles
    .filter((q) => q.im >= -1e-12)
    .map((q) => {
      if (Math.abs(q.im) < 1e-9) return `(${texNum(-1 / q.re)}\\,s + 1)`;
      const wn = Math.hypot(q.re, q.im), z = -q.re / wn;
      return `\\left(\\tfrac{s^2}{${texNum(wn * wn)}} + ${texNum((2 * z) / wn)}\\,s + 1\\right)`;
    });
  const delay = m.theta > 0 ? `\\,e^{-${texNum(m.theta)}s}` : '';
  return `G(s) = \\frac{${texNum(m.K)}${delay}}{${factors.join('')}}`;
}

const PROBE_LABEL: Record<string, string> = { sp: 'Setpoint', cv: 'Controller output', valve: 'Valve stem', pvTrue: 'PV (true)', pv: 'PV (measured)', P: 'P term', I: 'I term', D: 'D term', Kc: 'Scheduled Kc' };

export function ControlView({ proc, exp, runs }: { proc: ProcessDef; exp: Experiment; runs?: Run[] }) {
  const p = useMemo(() => cleanParams(proc, exp.params), [proc, exp.params]);
  const [opIndex, setOpIndex] = useState(1);
  const [allPoints, setAllPoints] = useState(true);
  const [probes, setProbes] = useState<ProbeKey[]>(['pvTrue', 'cv']);
  const [probeRun, setProbeRun] = useState(0);
  const [zoom, setZoom] = useState<'dominant' | 'all'>('dominant');
  const points = useMemo(() => linspace(proc.opPoints[0], proc.opPoints[proc.opPoints.length - 1], 5), [proc]);
  const pv = points[Math.min(opIndex * 2, points.length - 1)];
  const ops = [points[0], points[2], points[4]];

  const here = useMemo(() => analyzeLoop(proc, p, exp.controller, pv), [proc, p, exp.controller, pv]);
  const plant = here?.plant ?? linearizePlant(proc, p, pv);
  const cl = useMemo(() => (here ? closedLoop(here.plant, here.pid, here.delay) : null), [here]);

  const content = PROCESS_CONTENT[proc.id];
  const toggleProbe = (k: ProbeKey) => setProbes((ps) => (ps.includes(k) ? ps.filter((x) => x !== k) : [...ps, k]));
  const run = runs?.[Math.min(probeRun, (runs?.length ?? 1) - 1)];
  const long = run && run.scenario.duration > 600;
  const tAxis = run ? (long ? run.trace.t.map((v) => v / 60) : run.trace.t) : [];
  const probeSeries: Series[] = run ? probes.map((k, i) => {
    const y = k.startsWith('dist:') ? run.trace.dist[k.slice(5)] : run.trace[k as Exclude<ProbeKey, `dist:${string}`>];
    return { label: k.startsWith('dist:') ? proc.disturbances.find((d) => d.key === k.slice(5))?.label ?? k : PROBE_LABEL[k] ?? k, color: PALETTE[i % PALETTE.length], x: tAxis, y: y ?? [] };
  }) : [];

  const unitScale = (k: ProbeKey) => (['pvTrue', 'pv', 'sp'].includes(k) ? 'pv' : k === 'Kc' ? 'kc' : k.startsWith('dist:') ? 'dist' : 'pct');
  const groups = [...new Set(probes.map(unitScale))];

  return (
    <div>
      <div className="ll-card">
        <div className="ll-card-head">
          <h3>Block diagram</h3>
          <span className="ll-small">Click a wire label to plot that signal</span>
        </div>
        <BlockDiagram proc={proc} config={exp.controller} probes={probes} onProbe={toggleProbe} />
        {runs && runs.length > 0 && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
              <label className="ll-field" style={{ minWidth: '14rem' }}>
                <span>Probe during test</span>
                <select value={probeRun} onChange={(e) => setProbeRun(Number(e.target.value))}>
                  {runs.map((r, i) => <option key={r.scenario.id} value={i}>{r.scenario.name}</option>)}
                </select>
              </label>
            </div>
            {groups.map((g) => {
              const ss = probeSeries.filter((_, i) => unitScale(probes[i]) === g);
              return ss.length ? (
                <Chart key={g} label={`Probed signals (${g})`} series={ss} height={170}
                  x={{ label: `Time (${long ? 'min' : 's'})` }}
                  y={{ label: g === 'pv' ? `${proc.pv.label} (${proc.pv.unit})` : g === 'pct' ? '%' : g === 'kc' ? 'Kc' : 'Disturbance' }} />
              ) : null;
            })}
          </>
        )}
      </div>

      <div className="ll-card"><RangeTable proc={proc} exp={exp} /></div>

      <div className="ll-card">
        <div className="ll-card-head">
          <h3>Linear analysis at an operating point</h3>
          <div className="ll-seg" role="group" aria-label="Operating point">
            {ops.map((at, i) => <button key={at} aria-pressed={opIndex === i} onClick={() => setOpIndex(i)}>{fmt(at, 3)} {proc.pv.unit}</button>)}
          </div>
        </div>
        <div className="ll-tex-block"><Tex latex={plantTex(plant)} display /></div>
        <p className="ll-note">
          Time constants, slowest first: {timeConstants(plant).map((t) => `${fmt(t, 3)} s`).join(', ')} (process, actuator and transmitter lags); transport delay {fmt(plant.theta, 3)} s,
          plus {fmt(p.Ts / 2, 3)} s for the controller cycle (zero-order hold).
        </p>
        {!here ? (
          <p className="ll-note">On-off control has no linear model: it settles into a limit cycle instead of an equilibrium. See its behaviour in the tests and the live view.</p>
        ) : (
          <>
            <dl className="ll-kv" style={{ margin: '0.6rem 0' }}>
              <dt>Phase margin</dt><dd>{fmt(here.margins.pm, 3)}° at ωc = {fmt(here.margins.wc, 3)} rad/s</dd>
              <dt>Gain margin</dt><dd>{Number.isFinite(here.margins.gm) ? `${fmt(here.margins.gm, 3)} dB at ω180 = ${fmt(here.margins.w180, 3)} rad/s` : '∞ (phase never reaches −180°)'}</dd>
              <dt>Peak sensitivity Ms</dt><dd>{fmt(here.margins.ms, 3)} {here.margins.ms < 1.4 ? <span className="ll-badge is-good">robust</span> : here.margins.ms > 2 ? <span className="ll-badge is-bad">fragile</span> : <span className="ll-badge">moderate</span>}</dd>
              <dt>Delay margin</dt><dd>{fmt(here.margins.delayMargin, 3)} s of extra dead time before instability</dd>
              <dt>Closed loop</dt><dd>{cl && isStable(cl.poles) ? 'stable' : <span className="ll-badge is-bad">unstable</span>}</dd>
            </dl>
            <BodeCharts proc={proc} exp={exp} pv={pv} all={allPoints} ops={ops} />
            <label className="ll-check"><input type="checkbox" checked={allPoints} onChange={(e) => setAllPoints(e.target.checked)} /> Overlay the loop at all three operating points</label>
            {cl && <PoleMap cl={cl} plant={here.plant} zoom={zoom} setZoom={setZoom} />}
          </>
        )}
      </div>

      {exp.controller.kind !== 'onoff' && <div className="ll-card"><OperatingPointSteps proc={proc} exp={exp} /></div>}

      <div className="ll-card"><MathText className="ll-prose">{content.control}</MathText></div>
    </div>
  );
}

/** The plant linearized across the range, with the current controller's margins at each point. */
export function RangeTable({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const p = useMemo(() => cleanParams(proc, exp.params), [proc, exp.params]);
  const points = useMemo(() => linspace(proc.opPoints[0], proc.opPoints[proc.opPoints.length - 1], 5), [proc]);
  const across = useMemo(() => points.map((at) => {
    const m = linearizePlant(proc, p, at);
    const f = approximate(m, p.Ts / 2);
    const a = analyzeLoop(proc, p, exp.controller, at);
    return { at, m, f, a };
  }), [proc, p, exp.controller, points]);
  return (
    <>
        <div className="ll-card-head">
          <h3>The plant across the operating range</h3>
          <span className="ll-small">Linearized at steady state (Jacobian), first-order-plus-dead-time by the half rule</span>
        </div>
        <div className="ll-table-wrap">
          <table className="ll-table">
            <thead>
              <tr>
                <th>{proc.pv.label} ({proc.pv.unit})</th><th>Valve</th><th>K (%/%)</th><th>τ</th><th>θ eff.</th><th>k′ = K/τ</th>
                <th>PM</th><th>GM</th><th>Ms</th>
              </tr>
            </thead>
            <tbody>
              {across.map(({ at, m, f, a }) => (
                <tr key={at}>
                  <td>{fmt(at, 3)}{!m.reachable && <span className="ll-badge is-warn"> out of reach</span>}</td>
                  <td>{fmt(m.valve, 3)} %</td>
                  <td>{fmt(f.K, 3)}</td>
                  <td>{fmt(f.tau, 3)} s</td>
                  <td>{fmt(f.theta, 3)} s</td>
                  <td>{fmt(f.kPrime, 3)} /s</td>
                  <td className={a && a.margins.pm < 45 ? 'is-worst' : ''}>{a ? `${fmt(a.margins.pm, 3)}°` : '—'}</td>
                  <td className={a && a.margins.gm < 6 ? 'is-worst' : ''}>{a ? (Number.isFinite(a.margins.gm) ? `${fmt(a.margins.gm, 3)} dB` : '∞') : '—'}</td>
                  <td className={a && a.margins.ms > 2 ? 'is-worst' : ''}>{a ? fmt(a.margins.ms, 3) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ll-note">
          Margins are for the current controller at each point.
          {(() => {
            const ks = across.map((r) => r.f.kPrime).filter(Number.isFinite);
            const ratio = Math.max(...ks) / Math.min(...ks);
            return ratio > 1.5 ? ` The integrating slope k′ changes ${fmt(ratio, 2)}× across the range: one fixed tuning sees a different process at each end.` : ` The process barely changes across the range (k′ within ${fmt(ratio, 2)}×): one tuning fits everywhere.`;
          })()}
        </p>
    </>
  );
}

/** Linear setpoint and load step responses at the low, middle and high operating points. */
export function OperatingPointSteps({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const responses = useMemo(() => {
    if (exp.controller.kind === 'onoff') return null;
    const p = cleanParams(proc, exp.params);
    const ops = [proc.opPoints[0], proc.opPoints[Math.floor(proc.opPoints.length / 2)], proc.opPoints[proc.opPoints.length - 1]];
    const loops = ops.map((at) => {
      const a = analyzeLoop(proc, p, exp.controller, at)!;
      return { at, cl: closedLoop(a.plant, a.pid, a.delay) };
    });
    const horizon = Math.max(...loops.map((l) => settleHorizon(l.cl.poles, 60)));
    return loops.map((l) => ({ at: l.at, sp: stepResponse(l.cl, 0, horizon), load: stepResponse(l.cl, 1, horizon), stable: isStable(l.cl.poles) }));
  }, [proc, exp]);
  if (!responses) return null;
  return (
    <>
          <div className="ll-card-head">
            <h3>Linear step responses at each operating point</h3>
            <span className="ll-small">Same controller; what changes is the plant</span>
          </div>
          <div className="ll-split">
            <div>
              <div className="ll-chart-title">Setpoint step (true PV / step)</div>
              <Chart label="Setpoint step responses" height={200} x={{ label: 'Time (s)' }} y={{ label: 'y / r' }} hGuides={[{ at: 1 }]}
                series={responses.map((r, i) => ({ label: `${fmt(r.at, 3)} ${proc.pv.unit}${r.stable ? '' : ' (unstable)'}`, color: PALETTE[i], x: r.sp.t, y: r.sp.y }))} />
            </div>
            <div>
              <div className="ll-chart-title">Load step at the valve (true PV per % load)</div>
              <Chart label="Load step responses" height={200} x={{ label: 'Time (s)' }} y={{ label: '% of span per %' }} hGuides={[{ at: 0 }]}
                series={responses.map((r, i) => ({ label: `${fmt(r.at, 3)} ${proc.pv.unit}`, color: PALETTE[i], x: r.load.t, y: r.load.y }))} />
            </div>
          </div>
    </>
  );
}

function BodeCharts({ proc, exp, pv, all, ops }: { proc: ProcessDef; exp: Experiment; pv: number; all: boolean; ops: number[] }) {
  const data = useMemo(() => {
    const at = all ? ops : [pv];
    return at.map((x) => ({ at: x, a: analyzeLoop(proc, exp.params, exp.controller, x)! })).filter((d) => d.a);
  }, [proc, exp, pv, all, ops]);
  if (!data.length) return null;
  const sel = data.find((d) => d.at === pv) ?? data[0];
  const ws = (b: { w: number }[]) => b.map((q) => q.w);
  const mag: Series[] = data.flatMap((d, i) => [
    { label: `L at ${fmt(d.at, 3)} ${proc.pv.unit}`, color: PALETTE[all ? i : 0], x: ws(d.a.loop), y: d.a.loop.map((q) => q.mag), width: d.at === pv ? 2.4 : 1.4 },
  ]);
  mag.push({ label: 'Plant G', color: 'var(--muted)', x: ws(sel.a.plantBode), y: sel.a.plantBode.map((q) => q.mag), dash: '4 4', width: 1.2 });
  const phase: Series[] = data.map((d, i) => ({ label: `L at ${fmt(d.at, 3)}`, color: PALETTE[all ? i : 0], x: ws(d.a.loop), y: d.a.loop.map((q) => q.phase), width: d.at === pv ? 2.4 : 1.4, quiet: false }));
  const m = sel.a.margins;
  const v = [
    ...(Number.isFinite(m.wc) ? [{ at: m.wc, label: `ωc ${fmt(m.wc, 2)}` }] : []),
    ...(Number.isFinite(m.w180) ? [{ at: m.w180, label: `ω180 ${fmt(m.w180, 2)}` }] : []),
  ];
  return (
    <div>
      <div className="ll-chart-title">Bode: open loop L = C·G (selected point bold)</div>
      <Chart label="Bode magnitude" series={mag} x={{ log: true, label: 'Frequency (rad/s)' }} y={{ label: 'Magnitude (dB)', min: Math.max(-120, Math.min(...mag.flatMap((s) => Array.from(s.y))) - 5) }}
        hGuides={[{ at: 0, label: '0 dB' }]} vGuides={v} height={200} />
      <Chart label="Bode phase" series={phase} legend={false} x={{ log: true, label: 'Frequency (rad/s)' }}
        y={{ label: 'Phase (°)', min: Math.max(-540, Math.min(...phase.flatMap((ps) => Array.from(ps.y))) - 10), max: Math.max(0, ...phase.flatMap((ps) => Array.from(ps.y))) + 10 }}
        hGuides={[{ at: -180, label: '−180°' }]} vGuides={v} height={170} />
    </div>
  );
}

function PoleMap({ cl, plant, zoom, setZoom }: { cl: ReturnType<typeof closedLoop>; plant: PlantModel; zoom: 'dominant' | 'all'; setZoom: (z: 'dominant' | 'all') => void }) {
  const slow = Math.min(...cl.poles.map((q) => Math.hypot(q.re, q.im)).filter((v) => v > 1e-12));
  const lim = zoom === 'dominant' ? slow * 6 : Math.max(...cl.poles.map((q) => Math.hypot(q.re, q.im))) * 1.1;
  const inView = (q: { re: number; im: number }) => Math.abs(q.re) <= lim && Math.abs(q.im) <= lim;
  const markers = [
    ...plant.poles.filter(inView).map((q) => ({ x: q.re, y: q.im, color: 'var(--muted)', shape: 'x' as const })),
    ...cl.poles.filter(inView).map((q) => ({ x: q.re, y: q.im, color: 'var(--habit-2)', shape: 'x' as const })),
  ];
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <div className="ll-card-head">
        <div className="ll-chart-title">Poles: plant (grey) and closed loop (orange)</div>
        <div className="ll-seg" role="group" aria-label="Pole map zoom">
          <button aria-pressed={zoom === 'dominant'} onClick={() => setZoom('dominant')}>Dominant</button>
          <button aria-pressed={zoom === 'all'} onClick={() => setZoom('all')}>All</button>
        </div>
      </div>
      <Chart label="Pole map" series={[]} markers={markers} x={{ label: 'Real (1/s)', min: -lim, max: lim * 0.15 }} y={{ label: 'Imag (rad/s)', min: -lim * 0.6, max: lim * 0.6 }} vGuides={[{ at: 0 }]} hGuides={[{ at: 0 }]} height={220} legend={false} />
      <div className="ll-table-wrap">
        <table className="ll-table">
          <thead><tr><th>Closed-loop pole</th><th>Time constant / period</th><th>Damping ζ</th></tr></thead>
          <tbody>
            {cl.poles.filter((q) => q.im >= -1e-12).slice(0, 8).map((q, i) => {
              const wn = Math.hypot(q.re, q.im);
              return (
                <tr key={i}>
                  <td>{fmt(q.re, 3)}{Math.abs(q.im) > 1e-9 ? ` ± ${fmt(Math.abs(q.im), 3)}j` : ''}</td>
                  <td>{Math.abs(q.im) > 1e-9 ? `${fmt(1 / -q.re, 3)} s decay, ${fmt((2 * Math.PI) / Math.abs(q.im), 3)} s period` : `${fmt(-1 / q.re, 3)} s`}</td>
                  <td className={Math.abs(q.im) > 1e-9 && -q.re / wn < 0.4 ? 'is-worst' : ''}>{Math.abs(q.im) > 1e-9 ? fmt(-q.re / wn, 3) : '1 (real)'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ll-note">The transport and sampling delay is a second-order Padé approximation here (it adds a fast pole pair and a right-half-plane zero pair); the Bode plot uses the exact delay.</p>
    </div>
  );
}

// ─── Automation ─────────────────────────────────────────────────────────────

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ll-code">
      <pre aria-label={label}><code>{code}</code></pre>
      <button className="ll-btn is-small" onClick={async () => {
        try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export function CodeTabs({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const [tab, setTab] = useState<'scl' | 'st' | 'ref'>('scl');
  const p = cleanParams(proc, exp.params);
  const code = tab === 'ref' ? exportReference(exp.controller, p.Ts) : exportCode(proc, exp.controller, exp.params, tab);
  return (
    <div>
      <div className="ll-seg" role="tablist" aria-label="Code language" style={{ marginBottom: '0.6rem' }}>
        <button role="tab" aria-selected={tab === 'scl'} onClick={() => setTab('scl')}>TIA Portal SCL</button>
        <button role="tab" aria-selected={tab === 'st'} onClick={() => setTab('st')}>IEC Structured Text</button>
        <button role="tab" aria-selected={tab === 'ref'} onClick={() => setTab('ref')}>Reference (TypeScript)</button>
      </div>
      <CodeBlock code={code} label={`${tab} export`} />
    </div>
  );
}

export function AutomationView({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const rows = pidCompactParams(proc, exp.controller, exp.params);
  const content = PROCESS_CONTENT[proc.id];
  const model = cleanParams(proc, exp.params);
  const lin = exp.controller.kind !== 'onoff' ? linearPidAt(proc, exp.controller, model, proc.nominalPv, findSteady(proc, model, nominalDisturbances(proc), proc.nominalPv).valve) : null;
  return (
    <div>
      <div className="ll-card">
        <div className="ll-card-head"><h3>P&amp;ID</h3><span className="ll-small">ISA-5.1 tags</span></div>
        <PAndId proc={proc} />
      </div>
      <div className="ll-card"><MathText className="ll-prose">{content.automation}</MathText></div>
      <div className="ll-card">
        <div className="ll-card-head"><h3>Siemens PID_Compact settings</h3><span className="ll-small">for the current controller</span></div>
        {rows ? (
          <div className="ll-table-wrap">
            <table className="ll-table">
              <thead><tr><th>Parameter</th><th>Value</th><th style={{ textAlign: 'left' }}>Why</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}><td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}>{r.name}</td><td>{r.value}</td><td style={{ textAlign: 'left', color: 'var(--muted)' }}>{r.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="ll-note">On-off control doesn&apos;t use PID_Compact: a comparison with hysteresis (or an SR bistable) is all it takes. The code below shows it.</p>}
        {lin && lin.slope !== 1 && <p className="ll-note">The characterization changes the loop gain the PID sees by a factor of {fmt(lin.slope, 3)} at {fmt(proc.nominalPv, 3)} {proc.pv.unit}.</p>}
      </div>
      <div className="ll-card">
        <div className="ll-card-head"><h3>Code</h3><span className="ll-small">Generated from the current settings</span></div>
        <CodeTabs proc={proc} exp={exp} />
      </div>
      <div className="ll-card">
        <h3 style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>Commissioning checklist</h3>
        <ul className="ll-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
          {content.commissioning.map((c) => (
            <li key={c}><label className="ll-check" style={{ alignItems: 'flex-start' }}><input type="checkbox" style={{ marginTop: '0.25rem' }} /> <span>{c}</span></label></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
