'use client';

import { useMemo, useState } from 'react';
import { MathText, Tex } from '@/components/daily/MathText';
import { PROCESS_CONTENT } from '@/lib/loop-lab/content';
import { linearPidAt } from '@/lib/loop-lab/controllers';
import { exportCode, exportReference, pidCompactParams } from '@/lib/loop-lab/export';
import { texNum } from './format';
import {
  analyzeLoop, closedLoop, isStable, linearizePlant, openLoopStep, pathModel, settleHorizon, stepResponse, timeConstants, approximate, worseMargins,
  type BodePoint, type LoopAnalysis, type PlantModel,
} from '@/lib/loop-lab/linear';
import { cleanParams, nominalDisturbances, valveCharacteristic, VALVE_CHARS, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { flowAt } from '@/lib/loop-lab/processes/flow';
import { steamFlow } from '@/lib/loop-lab/processes/hx';
import { RHO_CP_PER_M3H } from '@/lib/loop-lab/processes/stirred';
import { balancePoint, splitValves } from '@/lib/loop-lab/processes/jacket';
import { hotFraction } from '@/lib/loop-lab/processes/mixing';
import { mimoModel, rga11, steadyGains } from '@/lib/loop-lab/multivar';
import { tankArea, tankVolume } from '@/lib/loop-lab/processes/tank';
import { findSteady, steadyState, type Run } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import Chart, { fmt, type Series } from './Chart';
import { BlockDiagram, type ProbeKey } from './Drawings';
import PlantEditor from './PlantEditor';
import { PAndIdFor, ProcessDrawing } from './Schematics';
import { PALETTE } from './Results';

const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

// ─── Mechanical ─────────────────────────────────────────────────────────────

/** The plant as built. With `onParams`, its settings can be changed here too. */
export function MechanicalView({ proc, exp, onParams }: { proc: ProcessDef; exp: Experiment; onParams?: (p: Params) => void }) {
  const p = useMemo(() => cleanParams(proc, exp.params), [proc, exp.params]);
  const d = useMemo(() => nominalDisturbances(proc), [proc]);
  const s = useMemo(() => findSteady(proc, p, d, proc.nominalPv), [proc, p, d]);
  const plots = useMemo(() => mechanicalPlots(proc, p, d), [proc, p, d]);
  const content = PROCESS_CONTENT[proc.id];
  return (
    <MechanicalLayout proc={proc} p={p} d={d} x={steadyState(proc, s)} plots={plots} text={content.mechanical}
      editor={onParams ? <PlantEditor proc={proc} params={exp.params} onChange={onParams} /> : null} />
  );
}

type MechPlot = { title: string; series: Series[]; x: string; y: string; note?: string };

/** The characteristic plots for each process's mechanical view. */
function mechanicalPlots(proc: ProcessDef, p: Params, d: Params): MechPlot[] {
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
  if (proc.id === 'stirred') {
    return [{
      title: 'Steady temperature vs heating valve, at three throughputs', x: 'Valve (%)', y: 'Vessel temperature (°C)',
      series: [0.6, 1, 1.4].map((F, i) => ({ label: `${F} m³/h`, color: PALETTE[i], x: st, y: st.map((v) => d.Tin + (p.Qmax * valveCharacteristic(p.valveChar, v / 100)) / (RHO_CP_PER_M3H * F)) })),
      note: 'Each line is an energy balance: heat in = ρ·c_p·F·(T − T_in). The slope (the process gain) halves when the throughput doubles.',
    }];
  }
  if (proc.id === 'hx') {
    const pressures = [3, 4, 5];
    return [
      {
        title: 'Steam flow vs valve, at three supply pressures', x: 'Valve (%)', y: 'Steam flow (kg/h)',
        series: pressures.map((Ps, i) => ({ label: `${Ps} bar`, color: PALETTE[i], x: st, y: st.map((v) => steamFlow(valveCharacteristic(p.valveChar, v / 100), Ps, p)) })),
        note: 'Critical flow: steam flow is proportional to supply pressure at any valve position. A pressure drop is a steam-flow drop, long before the temperature shows it — what a flow loop in cascade catches.',
      },
      {
        title: 'Steady outlet temperature vs valve', x: 'Valve (%)', y: 'Outlet temperature (°C)',
        series: pressures.map((Ps, i) => ({ label: `${Ps} bar`, color: PALETTE[i], x: st, y: st.map((v) => d.Tin + (steamFlow(valveCharacteristic(p.valveChar, v / 100), Ps, p) * p.lambda) / 3600 / (RHO_CP_PER_M3H * d.F)) })),
      },
    ];
  }
  if (proc.id === 'jacket') {
    const Tj = proc.nominalPv - 5;
    const duty = (pp: Params) => st.map((v) => {
      const { cool, heat } = splitValves(v / 100, pp);
      return pp.Qhmax * heat - pp.Kcw * cool * Math.max(0, Tj - d.Tcw);
    });
    const b = balancePoint(p);
    const per = (lo: number, hi: number) => fmt((p.Kcw * (Tj - d.Tcw)) / lo, 2) + ' kW/% cooling, ' + fmt(p.Qhmax / (100 - hi), 2) + ' kW/% heating';
    return [{
      title: 'Heat into the jacket vs controller output', x: 'Controller output (%)', y: 'Net heat (kW, + heating)',
      series: [
        { label: `Split at ${fmt(p.split, 3)} %`, color: PALETTE[0], x: st, y: duty(p), width: 2.4 },
        { label: `Balanced split (${fmt(b, 3)} %)`, color: PALETTE[2], x: st, y: duty({ ...p, split: b, gap: 0 }), dash: '5 4' },
      ],
      note: `The slope of this line is the process gain. At ${fmt(p.split, 3)} %: ${per(p.split - p.gap / 2, p.split + p.gap / 2)}. Splitting at ${fmt(b, 3)} % gives the cooling side more of the range and makes both slopes equal. Jacket at about ${fmt(Tj, 3)} °C, cooling water at ${fmt(d.Tcw, 3)} °C.`,
    }];
  }
  if (proc.id === 'blend') {
    const fb = linspace(0, p.FBmax, 100);
    const rs = linspace(0, 0.5, 100);
    return [
      {
        title: 'Product concentration vs concentrate flow, at three rates', x: 'Concentrate flow F_B (m³/h)', y: 'Concentration (%)',
        series: [20, 40, 60].map((FA, i) => ({ label: `Diluent ${FA} m³/h`, color: PALETTE[i], x: fb, y: fb.map((v) => (v * d.cB) / (FA + v)) })),
        note: 'At a fixed concentrate flow, every change in the diluent rate moves the product. The slope (the gain a flow-based loop sees) is three times steeper at 20 m³/h than at 60.',
      },
      {
        title: 'Product concentration vs ratio F_B/F_A', x: 'Ratio R', y: 'Concentration (%)',
        series: [{ label: 'Any diluent rate', color: PALETTE[3], x: rs, y: rs.map((r) => (r * d.cB) / (1 + r)) }],
        note: `c = R·c_B/(1 + R): the rate has dropped out. Hold the ratio and the product holds, whatever upstream does; the trim only has to correct for the concentrate's strength (${fmt(d.cB, 3)} % here).`,
      },
    ];
  }
  if (proc.id === 'surge') {
    const imb = linspace(1, 40, 80);
    const room = (dh: number) => imb.map((q) => ((p.A * dh) / q) * 60);
    return [{
      title: 'How long the tank can absorb an imbalance', x: 'Inflow − outflow (m³/h)', y: 'Minutes until full or empty',
      series: [
        { label: `Up to the top (${fmt(p.H - proc.nominalPv, 2)} m of room)`, color: PALETTE[0], x: imb, y: room(p.H - proc.nominalPv) },
        { label: `Down to empty (${fmt(proc.nominalPv, 2)} m)`, color: PALETTE[2], x: imb, y: room(proc.nominalPv) },
      ],
      note: `Time = A·Δh/ΔQ. This is the volume the level controller is allowed to use. An upstream swing of ${fmt(d.Qin * 0.5, 2)} m³/h fills the room above the setpoint in ${fmt(((p.A * (p.H - proc.nominalPv)) / (d.Qin * 0.5)) * 60, 2)} min, so the controller has that long to bring the outflow round, and no reason to do it faster.`,
    }];
  }
  if (proc.id === 'feeder') {
    const ts = linspace(0, 6 * p.tauScrew + p.txDelay + 5 * p.txTau, 200);
    const dF = 0.1 * p.Fmax;
    const screw = ts.map((t) => dF * (1 - Math.exp(-t / p.tauScrew)));
    const lagged = (t: number) => {
      if (t <= 0) return 0;
      const a = p.tauScrew, b = p.txTau;
      return Math.abs(a - b) < 1e-6 ? dF * (1 - (1 + t / a) * Math.exp(-t / a)) : dF * (1 - (a * Math.exp(-t / a) - b * Math.exp(-t / b)) / (a - b));
    };
    return [{
      title: 'Response to a 10 % speed step', x: 'Time (s)', y: 'Feed rate change (t/h)',
      series: [
        { label: 'Leaving the screw', color: PALETTE[0], x: ts, y: screw },
        { label: 'On the scale (WT-701)', color: PALETTE[2], x: ts, y: ts.map((t) => lagged(t - p.txDelay)) },
      ],
      note: `The material takes ${fmt(p.txDelay, 3)} s to reach the scale. Feedback can't know about any change before then, whatever the tuning: the dead time sets the speed limit.`,
    }];
  }
  if (proc.id === 'drum') {
    const ts = linspace(0, 150, 200);
    const kInt = 1000 / 3.6 / (750 * p.A);
    const dq = 10;
    return [{
      title: 'Drum level after a 10 t/h step, valve fixed', x: 'Time (s)', y: 'Level change (mm)',
      series: [
        { label: '+10 t/h steam demand', color: PALETTE[3], x: ts, y: ts.map((t) => -kInt * dq * t + p.kSwell * dq * (1 - Math.exp(-t / p.tauSwell))) },
        { label: '+10 t/h feedwater', color: PALETTE[0], x: ts, y: ts.map((t) => kInt * dq * t - p.kShrink * dq * (1 - Math.exp(-t / p.tauShrink))) },
      ],
      note: `Both go the wrong way first. More steam drops the pressure, the water flashes and the bubbles swell the level by up to ${fmt(p.kSwell * dq, 3)} mm, though the drum is losing water. More (cold) feedwater collapses bubbles: the level shrinks by up to ${fmt(p.kShrink * dq, 3)} mm though the drum is gaining water. The feedwater step only has the level back where it started after about ${fmt(p.kShrink / kInt, 2)} s.`,
    }];
  }
  if (proc.id === 'mixing') {
    const Ts = linspace(d.Tc + 1, d.Th - 1, 100);
    const valves = (demand: number) => {
      const F = p.Kout * (demand / 100);
      return { hot: Ts.map((T) => (100 * hotFraction(T, d) * F) / p.Fhmax), cold: Ts.map((T) => (100 * (1 - hotFraction(T, d)) * F) / p.Fcmax) };
    };
    const now = valves(d.dOut), peak = valves(120);
    const mid = d.Tc + (d.Th - d.Tc) / 2;
    return [
      {
        title: 'Which valve should control the temperature? The relative gain', x: 'Temperature (°C)', y: 'Relative gain λ',
        series: [
          { label: `Temperature ← hot valve (λ₁₁)`, color: PALETTE[3], x: Ts, y: Ts.map((T) => (d.Th - T) / (d.Th - d.Tc)), width: 2.2 },
          { label: 'Temperature ← cold valve (1 − λ₁₁)', color: PALETTE[0], x: Ts, y: Ts.map((T) => (T - d.Tc) / (d.Th - d.Tc)), width: 2.2 },
          { label: '0.5: no pairing is better', color: 'var(--muted)', dash: '4 4', x: Ts, y: Ts.map(() => 0.5) },
        ],
        note: `With level on total flow and temperature on the mix, λ₁₁ = (T_h − T)/(T_h − T_c): the share of the inflow that is cold. Below ${fmt(mid, 3)} °C most of the water is cold and the hot valve is the better temperature handle; above it the pairing should cross. At exactly ${fmt(mid, 3)} °C both pairings are equally bad: each valve moves both variables as much.`,
      },
      {
        title: 'Valve positions to hold 1 m, vs temperature', x: 'Temperature (°C)', y: 'Valve (%)',
        series: [
          { label: `Hot, demand ${fmt(d.dOut, 3)} %`, color: PALETTE[3], x: Ts, y: now.hot, width: 2 },
          { label: `Cold, demand ${fmt(d.dOut, 3)} %`, color: PALETTE[0], x: Ts, y: now.cold, width: 2 },
          { label: 'Hot, demand 120 %', color: PALETTE[3], x: Ts, y: peak.hot, dash: '4 3' },
          { label: 'Cold, demand 120 %', color: PALETTE[0], x: Ts, y: peak.cold, dash: '4 3' },
        ],
        note: `Both valves together set the flow (the level) and the mix (the temperature). At 120 % demand the hot valve runs out above about ${fmt(d.Tc + (d.Th - d.Tc) * Math.min(1, p.Fhmax / (p.Kout * 1.2)), 3)} °C: past that, temperature and level can't both be held, and something has to give.`,
      },
    ];
  }
  if (proc.id === 'crane') {
    // The trolley accelerates to top speed and stops again, the load left to swing (no controller).
    const T = 30, n = 600, h = T / n;
    const xs: number[] = [], th: number[] = [], vs: number[] = [];
    let s = [0, 0, 0, 0];
    let flow = 0.5;
    for (let i = 0; i <= n; i++) {
      const t = i * h;
      xs.push(t); th.push((s[2] * 180) / Math.PI); vs.push(s[1]);
      // The drive's ramp limit (the stroking speed limit) sets how hard it accelerates.
      const target = t < 8 ? 1 : 0.5, step = (p.valveRate / 100) * h;
      flow += Math.max(-step, Math.min(step, target - flow));
      const f = (x: number[]) => proc.derivatives(x, flow, d, p);
      const k1 = f(s), k2 = f(s.map((v, j) => v + (h / 2) * k1[j])), k3 = f(s.map((v, j) => v + (h / 2) * k2[j])), k4 = f(s.map((v, j) => v + h * k3[j]));
      s = s.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    const ls = linspace(2, 30, 60);
    return [
      {
        title: 'Ramp to top speed, run, ramp down at 8 s: no controller', x: 'Time (s)', y: 'Sway (°) · trolley speed (m/s)',
        series: [
          { label: 'Sway angle', color: PALETTE[3], x: xs, y: th, width: 2.2 },
          { label: 'Trolley speed', color: PALETTE[0], x: xs, y: vs, dash: '4 3' },
        ],
        note: `Every speed change starts a swing, and with ζ = ${fmt(p.zs, 2)} it lasts for minutes. A good driver times the stop to a whole number of swings; a controller can do it every time, if it knows the swing.`,
      },
      {
        title: 'Sway period vs rope length', x: 'Rope length L (m)', y: 'Period 2π√(L/g) (s)',
        series: [{ label: 'Pendulum', color: PALETTE[1], x: ls, y: ls.map((L) => 2 * Math.PI * Math.sqrt(L / 9.81)) }],
        note: `The load's mass doesn't appear: only the rope length sets the swing. The hoist changes it on every lift, so an anti-sway controller has to know L (the hoist encoder) or be robust to it.`,
      },
    ];
  }
  if (proc.id === 'servo') {
    // A torque step with no controller: the roll follows the motor through the spring and rings.
    const T = 0.4, n = 800, h = T / n;
    const xs: number[] = [], wm: number[] = [], wl: number[] = [];
    const flow = 0.5 + 25 / p.Tmax;
    let s = proc.steady(0.5 + d.TL / (2 * p.Tmax), d, p) ?? [0, 0, 0];
    for (let i = 0; i <= n; i++) {
      xs.push(i * h); wm.push(s[0] * 60 / (2 * Math.PI)); wl.push(s[1] * 60 / (2 * Math.PI));
      const f = (x: number[]) => proc.derivatives(x, flow, d, p);
      const k1 = f(s), k2 = f(s.map((v, j) => v + (h / 2) * k1[j])), k3 = f(s.map((v, j) => v + (h / 2) * k2[j])), k4 = f(s.map((v, j) => v + h * k3[j]));
      s = s.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    const wr = Math.sqrt(p.k * (1 / p.Jm + 1 / p.JL)), wa = Math.sqrt(p.k / p.JL);
    return [{
      title: '50 N·m more torque, no controller', x: 'Time (s)', y: 'Speed (rpm)',
      series: [
        { label: 'Motor (ST-702)', color: PALETTE[0], x: xs, y: wm },
        { label: 'Roll (ST-701)', color: PALETTE[3], x: xs, y: wl, width: 2.2 },
      ],
      note: `Both speed up together, with the shaft winding up and springing back at ${fmt(wr / (2 * Math.PI), 3)} Hz (√(k(1/J_m + 1/J_L)) = ${fmt(wr, 3)} rad/s) on top. The motor's encoder also sees an anti-resonance at ${fmt(wa, 3)} rad/s (√(k/J_L)), where the roll swings and the motor nearly stands still: a loop on the motor speed barely notices the roll ringing there.`,
    }];
  }
  if (proc.id === 'maglev') {
    const gaps = linspace(4, 28, 80);
    const force = (x: number, i: number) => p.F1 * i * i * (10 / x) ** 2;
    return [
      {
        title: 'Magnet pull vs gap, at three currents', x: 'Gap (mm)', y: 'Pull (N)',
        series: [
          ...[0.5, 0.75, 1].map((f, i) => ({ label: `${fmt(f * p.Imax, 2)} A`, color: PALETTE[i], x: gaps, y: gaps.map((x) => force(x, f * p.Imax)) })),
          { label: `Weight (${fmt(p.m, 2)} kg)`, color: 'var(--muted)', dash: '4 4', x: gaps, y: gaps.map(() => p.m * 9.81) },
        ],
        note: 'Where a current line crosses the weight, the mass can hang still, but only just: a little further down the pull is weaker than the weight and it falls; a little closer, stronger, and it jumps to the magnet. Without control there is no stable gap.',
      },
      {
        title: 'Unstable pole and the current needed, vs gap', x: 'Gap (mm)', y: 'Pole (rad/s) · current (% of max)',
        series: [
          { label: 'Unstable pole √(2g/x)', color: PALETTE[3], x: gaps, y: gaps.map((x) => Math.sqrt((2 * 9.81) / (x / 1000))) },
          { label: 'Holding current', color: PALETTE[0], x: gaps, y: gaps.map((x) => (100 * Math.sqrt((p.m * 9.81) / (p.F1 * (10 / x) ** 2))) / p.Imax), dash: '4 3' },
        ],
        note: `The loop has to be faster than the pole (${fmt(Math.sqrt((2 * 9.81) / (proc.nominalPv / 1000)), 3)} rad/s at ${proc.nominalPv} mm) or the mass gets away from it. Closer to the magnet it is faster still and the gain per amp is higher: one tuning is too lively close in and too sluggish far out.`,
      },
    ];
  }
  if (proc.id === 'custom') {
    const m = linearizePlant(proc, p, proc.nominalPv);
    const pm = pathModel(m, m.C, m.theta);
    const horizon = 5 * Math.max(1, p.tau1 + p.tau2 + p.txDelay);
    const r = openLoopStep(pm.A, pm.B, pm.C, 0, horizon, 400);
    const t = r.t.map((v) => v + p.txDelay);
    return [{
      title: 'Open-loop response to a 10 % output step', x: 'Time (s)', y: 'PV change (% of span)',
      series: [{ label: 'Identified model', color: PALETTE[0], x: [0, p.txDelay, ...t], y: [0, 0, ...r.y.map((v) => v * 10)] }],
    }];
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
}

function MechanicalLayout({ proc, p, d, x, plots, text, editor }: {
  proc: ProcessDef; p: Params; d: Params; x: number[]; plots: MechPlot[]; text: string; editor: React.ReactNode;
}) {
  return (
    <div>
      <div className="ll-card">
        <ProcessDrawing proc={proc} p={p} d={d} x={x} />
        <p className="ll-small" style={{ textAlign: 'center' }}>At steady state at {fmt(proc.nominalPv, 3)} {proc.pv.unit}, nominal disturbances{editor ? ': it follows your settings' : ''}.</p>
      </div>
      {editor}
      <div className="ll-card"><MathText className="ll-prose">{text}</MathText></div>
      {plots.map((pl) => (
        <div className="ll-card" key={pl.title}>
          <div className="ll-chart-title">{pl.title}</div>
          <Chart label={pl.title} series={pl.series} x={{ label: pl.x }} y={{ label: pl.y }} height={230} />
          {pl.note && <p className="ll-note">{pl.note}</p>}
        </div>
      ))}
      {!editor && <div className="ll-card">
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
      </div>}
    </div>
  );
}

// ─── Control ────────────────────────────────────────────────────────────────

function plantTex(m: PlantModel) {
  // An integrator is a factor s, with the slope k′ (the low-frequency asymptote k′/s) as the gain.
  const scale = Math.max(1, ...m.poles.map((q) => Math.hypot(q.re, q.im)));
  const isInt = (q: { re: number; im: number }) => Math.hypot(q.re, q.im) < 1e-9 * scale;
  const ints = m.poles.filter(isInt).length;
  const factors = m.poles
    .filter((q) => q.im >= -1e-12 && !isInt(q))
    .map((q) => {
      if (Math.abs(q.im) < 1e-9) return `(${texNum(-1 / q.re)}\\,s + 1)`;
      const wn = Math.hypot(q.re, q.im), z = -q.re / wn;
      return `\\left(\\tfrac{s^2}{${texNum(wn * wn)}} + ${texNum((2 * z) / wn)}\\,s + 1\\right)`;
    });
  const delay = m.theta > 0 ? `\\,e^{-${texNum(m.theta)}s}` : '';
  const gain = ints ? approximate(m).kPrime : m.K;
  return `G(s) = \\frac{${texNum(gain)}${delay}}{${ints ? (ints > 1 ? `s^${ints}` : 's\\,') : ''}${factors.join('')}}`;
}

const PROBE_LABEL: Record<string, string> = {
  sp: 'Setpoint', cv: 'Controller output', valve: 'Valve stem', pvTrue: 'PV (true)', pv: 'PV (measured)', P: 'P term', I: 'I term', D: 'D term',
  Kc: 'Scheduled Kc', ff: 'Feedforward', sp2: 'Inner setpoint', pv2: 'Inner measurement', pred: 'PV predicted / estimated', alt: 'Override controller output',
  cv2: 'Second controller output', valve2: 'Second valve stem', pv2True: 'Second variable (true)',
};

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
  const full = here?.plant ?? linearizePlant(proc, p, pv);
  const plant = pathModel(full, full.C, full.theta);
  const cl = useMemo(() => (here ? closedLoop(here.plant, here.ctrl, here.delay) : null), [here]);

  const content = PROCESS_CONTENT[proc.id];
  const toggleProbe = (k: ProbeKey) => setProbes((ps) => (ps.includes(k) ? ps.filter((x) => x !== k) : [...ps, k]));
  const run = runs?.[Math.min(probeRun, (runs?.length ?? 1) - 1)];
  const long = run && run.scenario.duration > 600;
  const tAxis = run ? (long ? run.trace.t.map((v) => v / 60) : run.trace.t) : [];
  const probeSeries: Series[] = run ? probes.map((k, i) => {
    const y = k.startsWith('dist:') ? run.trace.dist[k.slice(5)] : run.trace[k as Exclude<ProbeKey, `dist:${string}`>];
    return { label: k.startsWith('dist:') ? proc.disturbances.find((d) => d.key === k.slice(5))?.label ?? k : PROBE_LABEL[k] ?? k, color: PALETTE[i % PALETTE.length], x: tAxis, y: y ?? [] };
  }) : [];

  const unitScale = (k: ProbeKey) => (['pvTrue', 'pv', 'sp', 'pred'].includes(k) ? 'pv' : ['sp2', 'pv2', 'pv2True'].includes(k) ? 'sec' : k === 'Kc' ? 'kc' : k.startsWith('dist:') ? 'dist' : 'pct');
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
                  y={{ label: g === 'pv' ? `${proc.pv.label} (${proc.pv.unit})` : g === 'sec' ? `${proc.secondary?.label ?? ''} (${proc.secondary?.unit ?? ''})` : g === 'pct' ? '%' : g === 'kc' ? 'Kc' : 'Disturbance' }} />
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
          Valve to {proc.tags.transmitter}. Time constants, slowest first: {timeConstants(plant).map((t) => `${fmt(t, 3)} s`).join(', ')} (process, actuator and transmitter lags); transport delay {fmt(plant.theta, 3)} s,
          plus {fmt(p.Ts / 2, 3)} s for the controller cycle (zero-order hold).
        </p>
        {!here ? (
          <p className="ll-note">{exp.controller.kind === 'mpc'
            ? 'MPC with its valve limits isn’t a linear controller: whenever a limit is active, it is a different controller. Margins and Bode plots don’t describe it; judge it on the tests, the model-mismatch test above all. (Without limits it would be a linear controller, much like state feedback with an observer.)'
            : 'On-off control has no linear model: it settles into a limit cycle instead of an equilibrium. See its behaviour in the tests and the live view.'}</p>
        ) : (
          <>
            <dl className="ll-kv" style={{ margin: '0.6rem 0' }}>
              <dt>Phase margin</dt><dd>{fmt(here.margins.pm, 3)}° at ωc = {fmt(here.margins.wc, 3)} rad/s</dd>
              <dt>Gain margin</dt><dd>{Number.isFinite(here.margins.gm) ? `${fmt(here.margins.gm, 3)} dB at ω180 = ${fmt(here.margins.w180, 3)} rad/s` : '∞ (phase never reaches −180°)'}</dd>
              <dt>Peak sensitivity Ms</dt><dd>{fmt(here.margins.ms, 3)} {here.margins.ms < 1.4 ? <span className="ll-badge is-good">robust</span> : here.margins.ms > 2 ? <span className="ll-badge is-bad">fragile</span> : <span className="ll-badge">moderate</span>}</dd>
              <dt>Delay margin</dt><dd>{fmt(here.margins.delayMargin, 3)} s of extra dead time before instability</dd>
              <dt>Closed loop</dt><dd>{cl && isStable(cl.poles) ? 'stable' : <span className="ll-badge is-bad">unstable</span>}</dd>
              {here.inner && (
                <>
                  <dt>Slave loop ({proc.secondary?.loopTag})</dt>
                  <dd>PM {fmt(here.inner.margins.pm, 3)}° at {fmt(here.inner.margins.wc, 3)} rad/s, GM {Number.isFinite(here.inner.margins.gm) ? `${fmt(here.inner.margins.gm, 3)} dB` : '∞'}, Ms {fmt(here.inner.margins.ms, 3)}
                    {' '}· {fmt(here.inner.margins.wc / here.margins.wc, 2)}× faster than the master {here.inner.margins.wc / here.margins.wc < 3 && <span className="ll-badge is-warn">aim for 3–5×</span>}</dd>
                </>
              )}
            </dl>
            {here.inner && <p className="ll-note">The master&apos;s margins above are with the slave loop closed: the master sees the slave as part of its process.</p>}
            <BodeCharts proc={proc} exp={exp} pv={pv} all={allPoints} ops={ops} />
            {here.inner && <InnerBode inner={here.inner} />}
            <label className="ll-check"><input type="checkbox" checked={allPoints} onChange={(e) => setAllPoints(e.target.checked)} /> Overlay the loop at all three operating points</label>
            {cl && <PoleMap cl={cl} plant={here.plant} zoom={zoom} setZoom={setZoom} />}
          </>
        )}
      </div>

      {exp.controller.kind !== 'onoff' && <div className="ll-card"><OperatingPointSteps proc={proc} exp={exp} /></div>}
      {here && here.ctrl.ff.length > 0 && <div className="ll-card"><FeedforwardResponse proc={proc} a={here} /></div>}

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
    const f = approximate(pathModel(m, m.C, m.theta), p.Ts / 2);
    const a = analyzeLoop(proc, p, exp.controller, at);
    // A 2×2 process: the relative gain for "main valve → PV" here.
    const lam = proc.mimo ? (() => { const mm = mimoModel(proc, p, at); return rga11(steadyGains(mm.m, mm.B2)); })() : NaN;
    return { at, m, f, lam, a: a ? { margins: worseMargins(a.margins, a.inner?.margins) } : null };
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
                <th>PM</th><th>GM</th><th>Ms</th>{proc.mimo && <th title="Relative gain for the main valve on the PV: near 1 good, below 0.5 cross the pairing">λ₁₁</th>}
              </tr>
            </thead>
            <tbody>
              {across.map(({ at, m, f, a, lam }) => (
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
                  {proc.mimo && <td className={lam < 0.5 ? 'is-worst' : ''}>{fmt(lam, 2)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ll-note">
          Margins are for the current controller at each point{exp.controller.kind === 'cascade' ? ' (the worse of master and slave)' : ''}.
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
    const loops = ops.flatMap((at) => {
      const a = analyzeLoop(proc, p, exp.controller, at);
      return a ? [{ at, cl: closedLoop(a.plant, a.ctrl, a.delay) }] : [];
    });
    if (!loops.length) return null;
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

/** Bode of the slave loop on its own (cascade). */
function InnerBode({ inner }: { inner: NonNullable<LoopAnalysis['inner']> }) {
  const ws = (b: BodePoint[]) => b.map((q) => q.w);
  const m = inner.margins;
  const v = Number.isFinite(m.wc) ? [{ at: m.wc, label: `ωc ${fmt(m.wc, 2)}` }] : [];
  return (
    <div>
      <div className="ll-chart-title">Bode: slave loop on its own</div>
      <Chart label="Slave loop Bode magnitude" height={170} x={{ log: true, label: 'Frequency (rad/s)' }} y={{ label: 'Magnitude (dB)', min: -80 }} hGuides={[{ at: 0, label: '0 dB' }]} vGuides={v}
        series={[
          { label: 'Slave L', color: PALETTE[3], x: ws(inner.loop), y: inner.loop.map((q) => q.mag), width: 2 },
          { label: 'Valve → inner measurement', color: 'var(--muted)', x: ws(inner.plantBode), y: inner.plantBode.map((q) => q.mag), dash: '4 4', width: 1.2 },
        ]} />
    </div>
  );
}

/** A measured disturbance step, linear, with and without the feedforward. */
function FeedforwardResponse({ proc, a }: { proc: ProcessDef; a: LoopAnalysis }) {
  const data = useMemo(() => a.ctrl.ff.map((t) => {
    const ds = proc.disturbances.find((d) => d.key === t.from)!;
    const step = (ds.max - ds.min) / 10;
    const withFf = closedLoop(a.plant, a.ctrl, a.delay, t.from);
    const without = closedLoop(a.plant, { ...a.ctrl, ff: [] }, a.delay, t.from);
    const horizon = Math.max(settleHorizon(withFf.poles, 60), settleHorizon(without.poles, 60));
    const span = (proc.pv.hi - proc.pv.lo) / 100;
    const w = stepResponse(withFf, 2, horizon), o = stepResponse(without, 2, horizon);
    return { ds, step, t: w.t, withFf: w.y.map((v) => v * step * span), without: o.y.map((v) => v * step * span) };
  }), [proc, a]);
  return (
    <>
      <div className="ll-card-head">
        <h3>Feedforward: a measured disturbance, with and without it</h3>
        <span className="ll-small">Linear, at this operating point</span>
      </div>
      <div className="ll-split">
        {data.map((d) => (
          <div key={d.ds.key}>
            <div className="ll-chart-title">{d.ds.label} +{fmt(d.step, 2)} {d.ds.unit}</div>
            <Chart label={`Response to ${d.ds.label}`} height={190} x={{ label: 'Time (s)' }} y={{ label: `${proc.pv.label} change (${proc.pv.unit})` }} hGuides={[{ at: 0 }]}
              series={[
                { label: 'Feedback only', color: PALETTE[1], x: d.t, y: d.without },
                { label: 'With feedforward', color: PALETTE[2], x: d.t, y: d.withFf, width: 2.2 },
              ]} />
          </div>
        ))}
      </div>
    </>
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
  const code = tab === 'ref' ? exportReference(exp.controller, p.Ts, proc, exp.params) : exportCode(proc, exp.controller, exp.params, tab);
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
        <PAndIdFor proc={proc} config={exp.controller} />
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
