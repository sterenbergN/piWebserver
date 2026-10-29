'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Params, ProcessDef } from '@/lib/loop-lab/model';
import { Loop, type Sample } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import Chart, { fmt } from './Chart';
import { ProcessDrawing } from './Schematics';

const SPEEDS = [1, 5, 20, 60, 300];

/** How much history the trend keeps (s of process time), and the speed it starts at. */
function pace(proc: ProcessDef, p: Params) {
  if (proc.timeScale) {
    const k = proc.timeScale(p);
    return { window: 30 * k, speed: k > 60 ? 20 : k > 10 ? 5 : 1 };
  }
  const table = { flow: [120, 1], tank: [3600, 60], stirred: [2400, 60], hx: [400, 5], surge: [3600, 60], feeder: [600, 5], drum: [900, 5], jacket: [2400, 20], blend: [900, 5] } as Record<string, [number, number]>;
  const [window, speed] = table[proc.id] ?? [600, 5];
  return { window, speed };
}

type Buffer = { t: number[]; sp: number[]; pv: number[]; pvTrue: number[]; cv: number[]; valve: number[] };
const emptyBuffer = (): Buffer => ({ t: [], sp: [], pv: [], pvTrue: [], cv: [], valve: [] });

/** What the panel shows: a copy of the running loop's state, taken a few times a second. */
type View = {
  t: number; sp: number; auto: boolean; manualOut: number; lastCv: number;
  x: number[]; p: Params; d: Params; sample: Sample | null; trend: Buffer;
};

function snapshot(loop: Loop, sample: Sample | null, buf: Buffer): View {
  return {
    t: loop.t, sp: loop.sp, auto: loop.auto, manualOut: loop.manualOut, lastCv: loop.lastCv,
    x: loop.x.slice(), p: { ...loop.p }, d: { ...loop.d }, sample,
    trend: { t: buf.t.slice(), sp: buf.sp.slice(), pv: buf.pv.slice(), pvTrue: buf.pvTrue.slice(), cv: buf.cv.slice(), valve: buf.valve.slice() },
  };
}

/**
 * The loop running live, driven from an operator faceplate: setpoint, auto /
 * manual, manual output and the process disturbances, with the process drawing
 * and a trend. Changing settings carries on from the current state.
 */
export default function LivePanel({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const loopRef = useRef<Loop | null>(null);
  const buf = useRef<Buffer>(emptyBuffer());
  const every = useRef(1);
  const counter = useRef(0);
  const last = useRef<Sample | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [running, setRunning] = useState(true);
  const { window: windowS, speed: startSpeed } = pace(proc, exp.params);
  const [speed, setSpeed] = useState(startSpeed);
  const [shownProc, setShownProc] = useState(proc.id);
  if (shownProc !== proc.id) {
    // A different process starts at its own sensible speed.
    setShownProc(proc.id);
    setSpeed(startSpeed);
  }

  const publish = useCallback(() => {
    const loop = loopRef.current;
    if (loop) setView(snapshot(loop, last.current, buf.current));
  }, []);
  /** Change the running loop from the faceplate, then show the result. */
  const act = (fn: (loop: Loop) => void) => {
    if (loopRef.current) fn(loopRef.current);
    publish();
  };

  // A new loop for each setup; carry on from the old one if it's the same process.
  useEffect(() => {
    const prev = loopRef.current;
    const loop = new Loop(proc, { params: exp.params, controller: exp.controller, seed: Math.floor(Math.random() * 1e9) }, { sp: proc.nominalPv });
    if (prev && prev.proc.id === proc.id) loop.adopt(prev);
    else buf.current = emptyBuffer();
    every.current = Math.max(1, Math.ceil(windowS / loop.Ts / 2500));
    loopRef.current = loop;
    last.current = null;
    publish();
  }, [proc, exp, publish, windowS]);

  useEffect(() => {
    if (!running) return;
    let raf = 0, prevNow = performance.now(), acc = 0, lastDraw = 0;
    const frame = (now: number) => {
      const loop = loopRef.current;
      if (loop) {
        acc += Math.min(0.1, (now - prevNow) / 1000) * speed;
        let n = 0;
        while (acc >= loop.Ts && n < 50000) {
          const s = loop.step();
          last.current = s;
          if (counter.current++ % every.current === 0) {
            const b = buf.current;
            b.t.push(s.t); b.sp.push(s.sp); b.pv.push(s.pv); b.pvTrue.push(s.pvTrue); b.cv.push(s.cv); b.valve.push(s.valve);
            // Trim in batches, not every sample.
            const cut = b.t.findIndex((t) => t >= s.t - windowS);
            if (cut > 500) for (const k of Object.keys(b) as (keyof Buffer)[]) b[k].splice(0, cut);
          }
          acc -= loop.Ts;
          n++;
        }
      }
      prevNow = now;
      if (now - lastDraw > 120) { lastDraw = now; publish(); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, windowS, publish]);

  if (!view) return null;
  const s = view.sample;
  const pvShown = s?.pv ?? view.sp;
  const span = proc.pv.hi - proc.pv.lo;
  const pctOf = (v: number) => Math.max(0, Math.min(100, ((v - proc.pv.lo) / span) * 100));
  const b = view.trend;
  const minutes = windowS > 900;
  const tx = minutes ? b.t.map((t) => t / 60) : b.t;

  const { p, d } = view;
  const drawing = <ProcessDrawing proc={proc} p={p} d={d} x={view.x} />;
  const sec = proc.secondary;
  const cascade = exp.controller.kind === 'cascade' && sec;

  return (
    <div>
      <div className="ll-live">
        <div className="ll-face" aria-label={`${proc.tags.loop} faceplate`}>
          <div className="ll-face-tag">{proc.tags.loop}<span>{view.auto ? 'AUTO' : 'MANUAL'}</span></div>
          <div className="ll-face-bars">
            <div className="ll-face-bar">
              PV
              <div className="ll-bar">
                <b style={{ height: `${pctOf(pvShown)}%`, background: 'var(--ll-pv)' }} />
                <i style={{ bottom: `${pctOf(view.sp)}%` }} title="Setpoint" />
              </div>
              <strong>{pvShown.toFixed(proc.pv.decimals)}</strong>
              <span>{proc.pv.unit}</span>
            </div>
            <div className="ll-face-bar">
              OUT
              <div className="ll-bar"><b style={{ height: `${view.lastCv}%`, background: 'var(--ll-cv)' }} /></div>
              <strong>{view.lastCv.toFixed(1)}</strong>
              <span>%</span>
            </div>
          </div>
          <label className="ll-field">
            <span>Setpoint<em>{proc.pv.unit}</em></span>
            <input type="range" min={proc.pv.lo} max={proc.pv.hi} step={span / 400} value={view.sp}
              onChange={(e) => act((l) => { l.sp = Number(e.target.value); })} aria-label="Setpoint" />
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)' }}>{view.sp.toFixed(proc.pv.decimals)} {proc.pv.unit}</span>
          </label>
          <div className="ll-face-mode">
            <button className={`ll-btn is-small${view.auto ? ' is-primary' : ''}`} onClick={() => act((l) => l.setMode(true))}>Auto</button>
            <button className={`ll-btn is-small${!view.auto ? ' is-primary' : ''}`} onClick={() => act((l) => l.setMode(false))}>Manual</button>
          </div>
          <label className="ll-field">
            <span>Manual output<em>%</em></span>
            <input type="range" min={0} max={100} step={0.5} value={view.auto ? view.lastCv : view.manualOut} disabled={view.auto}
              onChange={(e) => act((l) => { l.manualOut = Number(e.target.value); })} aria-label="Manual output" />
          </label>
          {s && exp.controller.kind !== 'onoff' && (
            <dl className="ll-kv" style={{ fontSize: '0.78rem' }}>
              <dt>P</dt><dd>{fmt(s.P, 3)} %</dd>
              <dt>I</dt><dd>{fmt(s.I, 3)} %</dd>
              <dt>D</dt><dd>{fmt(s.D, 3)} %</dd>
              {exp.controller.kind === 'schedule' && <><dt>Kc now</dt><dd>{fmt(s.Kc, 3)}</dd></>}
              {(exp.controller.kind === 'feedforward' || exp.controller.kind === 'cascade') && exp.controller.ff.length > 0 && <><dt>FF</dt><dd>{fmt(s.ff, 3)} %</dd></>}
              {cascade && <><dt>{sec.loopTag} SP</dt><dd>{fmt(s.sp2, 4)} {sec.unit}</dd><dt>{sec.loopTag} PV</dt><dd>{fmt(s.pv2, 4)} {sec.unit}</dd></>}
            </dl>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          {drawing}
          <div className="ll-speed">
            <button className="ll-btn is-small" onClick={() => setRunning((r) => !r)}>{running ? '⏸ Pause' : '▶ Run'}</button>
            Speed
            {SPEEDS.map((v) => (
              <button key={v} className={`ll-btn is-small${speed === v ? ' is-primary' : ''}`} onClick={() => setSpeed(v)}>×{v}</button>
            ))}
            <span>t = {minutes ? `${fmt(view.t / 60, 4)} min` : `${fmt(view.t, 4)} s`}</span>
          </div>
        </div>
      </div>
      <div className="ll-dists">
        {proc.disturbances.map((ds) => (
          <label key={ds.key} className="ll-field" title={ds.note}>
            <span>{ds.label}<em>{fmt(d[ds.key], 3)} {ds.unit}</em></span>
            <input type="range" min={ds.min} max={ds.max} step={(ds.max - ds.min) / 200} value={d[ds.key]}
              onChange={(e) => act((l) => { l.d[ds.key] = Number(e.target.value); })} />
          </label>
        ))}
      </div>
      <Chart label="Live trend: process value" height={200}
        series={[
          { label: 'Setpoint', color: 'var(--ll-sp)', x: tx, y: b.sp, dash: '5 4', width: 1.4 },
          { label: 'Measured', color: 'var(--muted)', x: tx, y: b.pv, width: 1 },
          { label: `${proc.pv.label} (true)`, color: 'var(--ll-pv)', x: tx, y: b.pvTrue, width: 2 },
        ]}
        x={{ label: `Time (${minutes ? 'min' : 's'})` }} y={{ label: `${proc.pv.label} (${proc.pv.unit})` }} />
      <Chart label="Live trend: output" height={130}
        series={[
          { label: 'Controller output', color: 'var(--ll-cv)', x: tx, y: b.cv, width: 1.2 },
          { label: 'Valve stem', color: 'var(--ll-valve)', x: tx, y: b.valve, width: 1.8 },
        ]}
        x={{ label: `Time (${minutes ? 'min' : 's'})` }} y={{ label: 'Output (%)', min: -2, max: 102 }} />
    </div>
  );
}
