'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { upsets, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { Loop, type Sample } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import Chart, { fmt } from './Chart';
import { ProcessDrawing } from './Schematics';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const SPEEDS = [1, 5, 20, 60, 300];
/** Drives and magnets run in milliseconds: slow motion. */
const SLOW_SPEEDS = [0.02, 0.05, 0.2, 1];

/** How much history the trend keeps (s of process time), and the speed it starts at. */
function pace(proc: ProcessDef, p: Params) {
  if (proc.timeScale) {
    const k = proc.timeScale(p);
    return { window: 30 * k, speed: k > 60 ? 20 : k > 10 ? 5 : 1 };
  }
  const table = { flow: [120, 1], tank: [3600, 60], stirred: [2400, 60], hx: [400, 5], surge: [3600, 60], feeder: [600, 5], drum: [900, 5], jacket: [2400, 20], blend: [900, 5], crane: [120, 1], servo: [4, 0.2], maglev: [2, 0.05], mixing: [1200, 20], batch: [3600, 60] } as Record<string, [number, number]>;
  const [window, speed] = table[proc.id] ?? [600, 5];
  return { window, speed };
}

type Buffer = { t: number[]; sp: number[]; pv: number[]; pvTrue: number[]; cv: number[]; valve: number[]; sp2: number[]; pv2: number[]; valve2: number[] };
const emptyBuffer = (): Buffer => ({ t: [], sp: [], pv: [], pvTrue: [], cv: [], valve: [], sp2: [], pv2: [], valve2: [] });

/** What the panel shows: a copy of the running loop's state, taken a few times a second. */
type View = {
  procId: ProcessDef['id'];
  t: number; sp: number; auto: boolean; manualOut: number; lastCv: number;
  /** 2×2 processes: the second setpoint and the second valve's manual value. */
  sp2: number; manualOut2: number;
  x: number[]; p: Params; d: Params; sample: Sample | null; trend: Buffer;
};

function snapshot(loop: Loop, sample: Sample | null, buf: Buffer): View {
  return {
    procId: loop.proc.id,
    t: loop.t, sp: loop.sp, auto: loop.auto, manualOut: loop.manualOut, lastCv: loop.lastCv, sp2: loop.sp2, manualOut2: loop.manualOut2,
    x: loop.x.slice(), p: { ...loop.p }, d: { ...loop.d }, sample,
    trend: Object.fromEntries(Object.entries(buf).map(([k, v]) => [k, v.slice()])) as Buffer,
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
  const [hoverX, setHoverX] = useState<number | null>(null);
  const sync = useMemo(() => ({ x: hoverX, set: setHoverX }), [hoverX]);
  const [fullRange, setFullRange] = useState(false);
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

  const resetSteady = () => {
    const cur = loopRef.current;
    const curSp = cur?.sp ?? proc.nominalPv;
    const curSp2 = cur?.sp2;
    const curD = cur?.d;
    const loop = new Loop(
      proc,
      { params: exp.params, controller: exp.controller, seed: Math.floor(Math.random() * 1e9) },
      { sp: curSp, sp2: curSp2, d: curD, plantParams: exp.params }
    );
    loopRef.current = loop;
    buf.current = emptyBuffer();
    last.current = null;
    counter.current = 0;
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
            b.sp2.push(s.sp2); b.pv2.push(s.pv2True); b.valve2.push(s.valve2);
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

  if (!view || view.procId !== proc.id) return null;
  const s = view.sample;
  const pvShown = s?.pv ?? view.sp;
  const span = proc.pv.hi - proc.pv.lo;
  const pctOf = (v: number) => Math.max(0, Math.min(100, ((v - proc.pv.lo) / span) * 100));
  const b = view.trend;
  const minutes = windowS > 900;
  const tx = minutes ? b.t.map((t) => t / 60) : b.t;

  const bumpSp = (frac: number) => {
    act((l) => {
      const next = clamp(l.sp + frac * span, proc.pv.lo, proc.pv.hi);
      l.sp = Number(next.toFixed(Math.max(2, proc.pv.decimals + 1)));
    });
  };

  const bumpManualOut = (delta: number) => {
    act((l) => {
      l.manualOut = clamp(Number((l.manualOut + delta).toFixed(1)), 0, 100);
    });
  };

  const bumpSp2 = (frac: number) => {
    if (!proc.secondary) return;
    act((l) => {
      const s2 = proc.secondary!.hi - proc.secondary!.lo;
      const next = clamp(l.sp2 + frac * s2, proc.secondary!.lo, proc.secondary!.hi);
      l.sp2 = Number(next.toFixed(Math.max(2, proc.secondary!.decimals + 1)));
    });
  };

  const bumpManualOut2 = (delta: number) => {
    act((l) => {
      l.manualOut2 = clamp(Number((l.manualOut2 + delta).toFixed(1)), 0, 100);
    });
  };

  const pvYAxis = (() => {
    const label = `${proc.pv.label} (${proc.pv.unit})`;
    if (fullRange) {
      return { label, min: proc.pv.lo, max: proc.pv.hi, decimals: proc.pv.decimals };
    }
    let lo = Infinity;
    let hi = -Infinity;
    const tr = view.trend;
    if (tr.pv.length > 0) {
      const n = tr.pv.length;
      for (let i = 0; i < n; i++) {
        const vPv = tr.pv[i];
        const vTrue = tr.pvTrue[i];
        const vSp = tr.sp[i];
        if (Number.isFinite(vPv)) { if (vPv < lo) lo = vPv; if (vPv > hi) hi = vPv; }
        if (Number.isFinite(vTrue)) { if (vTrue < lo) lo = vTrue; if (vTrue > hi) hi = vTrue; }
        if (Number.isFinite(vSp)) { if (vSp < lo) lo = vSp; if (vSp > hi) hi = vSp; }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = view.sp;
      hi = view.sp;
    }
    const minSpan = 0.1 * span;
    const mid = (lo + hi) / 2;
    const currentSpan = Math.max(hi - lo, minSpan);
    const half = (currentSpan / 2) * 1.05;
    return {
      label,
      min: mid - half,
      max: mid + half,
      decimals: proc.pv.decimals,
    };
  })();

  const cvVal = s?.cv ?? view.lastCv;
  const isSat = cvVal <= 0.1 || cvVal >= 99.9;

  const { p, d } = view;
  const drawing = <ProcessDrawing proc={proc} p={p} d={d} x={view.x} />;
  const sec = proc.secondary;
  const cascade = exp.controller.kind === 'cascade' && sec;
  const mimo = proc.mimo && sec ? { ...proc.mimo, sec } : null;
  const twoLoop = Boolean(proc.mimo && (exp.controller.kind === 'multiloop' || exp.controller.kind === 'mpc' || exp.controller.kind === 'custom'));
  const crossed = exp.controller.kind === 'multiloop' && exp.controller.pairing === 'crossed';
  const valveDesc = proc.id === 'mixing' ? 'Hot water valve' : ((proc.tags as { valveNote?: string }).valveNote || 'Control valve');
  const mimoLoop = (proc.mimo as { loop?: string; loop2?: string } | undefined)?.loop ?? proc.mimo?.loop2 ?? sec?.loopTag ?? 'LIC-902';

  const out1 = s?.cv ?? view.lastCv;
  const out2 = Number.isFinite(s?.cv2) ? s!.cv2 : (proc.mimo ? (view.auto ? d[proc.mimo.input] : view.manualOut2) : view.manualOut2);
  const span2 = sec ? sec.hi - sec.lo : 1;
  const pctOf2 = (v: number) => (sec ? Math.max(0, Math.min(100, ((v - sec.lo) / span2) * 100)) : 0);
  const pv2Shown = Number.isFinite(s?.pv2) ? s!.pv2 : (Number.isFinite(s?.pv2True) ? s!.pv2True : (sec ? view.x[1] ?? view.sp2 : 0));

  return (
    <div>
      <div className="ll-live">
        <div className="ll-face ll-fp" aria-label={`${proc.tags.loop} faceplate`}>
          <div className="ll-face-tag">
            {proc.tags.loop}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              {isSat && (
                <span className="ll-badge is-warn" style={{ fontSize: '0.68rem', padding: '0.05rem 0.35rem' }}>
                  {cvVal >= 99.9 ? 'SAT HIGH' : 'SAT LOW'}
                </span>
              )}
              <span>{view.auto ? 'AUTO' : 'MANUAL'}</span>
            </span>
          </div>
          {mimo && sec ? (
            <div className="ll-face-bars" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.35rem' }}>
              <div className="ll-face-bar" title={`${proc.pv.label} (${(proc.tags as { pv?: string }).pv ?? proc.tags.transmitter})`}>
                <span style={{ fontSize: '0.72rem' }}>{(proc.tags as { pv?: string }).pv ?? proc.tags.transmitter}</span>
                <div className="ll-bar">
                  <b style={{ height: `${pctOf(pvShown)}%`, background: 'var(--ll-pv)' }} />
                  <i style={{ bottom: `${pctOf(view.sp)}%` }} title={`${proc.tags.loop} setpoint`} />
                </div>
                <strong style={{ fontSize: '0.82rem' }}>{pvShown.toFixed(proc.pv.decimals)}</strong>
                <span style={{ fontSize: '0.7rem' }}>{proc.pv.unit}</span>
              </div>
              <div className="ll-face-bar" title={`${valveDesc} (${proc.tags.valve})`}>
                <span style={{ fontSize: '0.72rem' }}>{proc.tags.valve}</span>
                <div className="ll-bar">
                  <b style={{ height: `${clamp(out1, 0, 100)}%`, background: 'var(--ll-cv)' }} />
                </div>
                <strong style={{ fontSize: '0.82rem' }}>{out1.toFixed(1)}</strong>
                <span style={{ fontSize: '0.7rem' }}>%</span>
              </div>
              <div className="ll-face-bar" title={`${sec.label} (${(proc.tags as { secondary?: string }).secondary ?? sec.tag})`}>
                <span style={{ fontSize: '0.72rem' }}>{(proc.tags as { secondary?: string }).secondary ?? sec.tag}</span>
                <div className="ll-bar">
                  <b style={{ height: `${pctOf2(pv2Shown)}%`, background: 'var(--habit-3)' }} />
                  {twoLoop && <i style={{ bottom: `${pctOf2(view.sp2)}%` }} title={`${mimoLoop} setpoint`} />}
                </div>
                <strong style={{ fontSize: '0.82rem' }}>{pv2Shown.toFixed(sec.decimals)}</strong>
                <span style={{ fontSize: '0.7rem' }}>{sec.unit}</span>
              </div>
              <div className="ll-face-bar" title={`${mimo.valveLabel} (${mimo.valve})`}>
                <span style={{ fontSize: '0.72rem' }}>{mimo.valve}</span>
                <div className="ll-bar">
                  <b style={{ height: `${clamp(out2, 0, 100)}%`, background: 'var(--ll-valve)' }} />
                </div>
                <strong style={{ fontSize: '0.82rem' }}>{out2.toFixed(1)}</strong>
                <span style={{ fontSize: '0.7rem' }}>%</span>
              </div>
            </div>
          ) : (
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
          )}
          {mimo && (
            <div style={{
              padding: '0.45rem 0.6rem',
              background: 'var(--surface)',
              border: '1px solid var(--surface-border)',
              borderRadius: '6px',
              fontSize: '0.72rem',
              lineHeight: 1.35,
              color: 'var(--muted)',
            }}>
              {!twoLoop ? (
                <>
                  <strong style={{ color: 'var(--foreground)' }}>Single-loop mode:</strong>{' '}
                  {proc.tags.loop} regulates {proc.pv.label.toLowerCase()} via {proc.tags.valve} ({valveDesc.toLowerCase()}).{' '}
                  {mimo.valve} ({mimo.valveLabel.toLowerCase()}) is operated by hand.
                </>
              ) : !crossed ? (
                <>
                  <strong style={{ color: 'var(--foreground)' }}>2×2 MIMO mode:</strong>{' '}
                  {proc.tags.loop} → {proc.tags.valve} ({valveDesc.toLowerCase()}) · {mimoLoop} → {mimo.valve} ({mimo.valveLabel.toLowerCase()}).
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--foreground)' }}>2×2 Crossed pairing:</strong>{' '}
                  {proc.tags.loop} → {mimo.valve} ({mimo.valveLabel.toLowerCase()}) · {mimoLoop} → {proc.tags.valve} ({valveDesc.toLowerCase()}).
                </>
              )}
            </div>
          )}
          <div className="ll-field">
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>{proc.tags.loop} setpoint ({proc.pv.label.toLowerCase()})</span>
              <b style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)' }}>{view.sp.toFixed(proc.pv.decimals)} {proc.pv.unit}</b>
            </span>
            <input type="range" min={proc.pv.lo} max={proc.pv.hi} step={span / 400} value={view.sp}
              onChange={(e) => act((l) => { l.sp = Number(e.target.value); })} aria-label={`${proc.tags.loop} setpoint`} />
            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
              <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp(-0.1)}>−10%</button>
              <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp(-0.05)}>−5%</button>
              <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp(0.05)}>+5%</button>
              <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp(0.1)}>+10%</button>
            </div>
          </div>
          <div className="ll-face-mode">
            <button className={`ll-btn is-small${view.auto ? ' is-primary' : ''}`} onClick={() => act((l) => l.setMode(true))}>Auto</button>
            <button className={`ll-btn is-small${!view.auto ? ' is-primary' : ''}`} onClick={() => act((l) => l.setMode(false))}>Manual</button>
          </div>
          <div className="ll-field" title={view.auto ? 'Switch mode to Manual above to adjust this valve' : undefined}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>
                {proc.tags.valve} manual ({valveDesc.toLowerCase()})
                {view.auto && <em style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: '0.35rem', fontStyle: 'normal' }}>(switch to Manual)</em>}
              </span>
              <b style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)' }}>
                {(view.auto ? out1 : view.manualOut).toFixed(1)} %
              </b>
            </span>
            <input type="range" min={0} max={100} step={0.5} value={view.auto ? out1 : view.manualOut} disabled={view.auto}
              onChange={(e) => act((l) => { l.manualOut = Number(e.target.value); })} aria-label={`${proc.tags.valve} manual output`} />
            {!view.auto && (
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut(-10)}>−10%</button>
                <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut(-5)}>−5%</button>
                <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut(5)}>+5%</button>
                <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut(10)}>+10%</button>
              </div>
            )}
          </div>
          {mimo && sec && (
            <>
              {twoLoop && (
                <div className="ll-field">
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>{mimoLoop} setpoint ({sec.label.toLowerCase()})</span>
                    <b style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)' }}>
                      {view.sp2.toFixed(sec.decimals)} {sec.unit}
                    </b>
                  </span>
                  <input
                    type="range"
                    min={sec.lo}
                    max={sec.hi}
                    step={(sec.hi - sec.lo) / 400}
                    value={view.sp2}
                    onChange={(e) => act((l) => { l.sp2 = Number(e.target.value); })}
                    aria-label={`${sec.label} setpoint`}
                  />
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp2(-0.1)}>−10%</button>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp2(-0.05)}>−5%</button>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp2(0.05)}>+5%</button>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpSp2(0.1)}>+10%</button>
                  </div>
                </div>
              )}
              <div
                className="ll-field"
                title={twoLoop && view.auto ? 'Switch mode to Manual above to adjust this valve' : undefined}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>
                    {!twoLoop
                      ? `${mimo.valve} manual (${mimo.valveLabel.toLowerCase()}, by hand)`
                      : `${mimo.valve} manual (${mimo.valveLabel.toLowerCase()})`}
                    {twoLoop && view.auto && (
                      <em style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: '0.35rem', fontStyle: 'normal' }}>
                        (switch to Manual)
                      </em>
                    )}
                  </span>
                  <b style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)' }}>
                    {(!twoLoop ? view.manualOut2 : (view.auto ? out2 : view.manualOut2)).toFixed(1)} %
                  </b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={!twoLoop ? view.manualOut2 : (view.auto ? out2 : view.manualOut2)}
                  disabled={twoLoop && view.auto}
                  onChange={(e) => act((l) => { l.manualOut2 = Number(e.target.value); })}
                  aria-label={`${mimo.valveLabel} manual output`}
                />
                {(!twoLoop || !view.auto) && (
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut2(-10)}>−10%</button>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut2(-5)}>−5%</button>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut2(5)}>+5%</button>
                    <button type="button" className="ll-btn is-small" style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.74rem' }} onClick={() => bumpManualOut2(10)}>+10%</button>
                  </div>
                )}
              </div>
            </>
          )}
          {s && exp.controller.kind !== 'onoff' && (() => {
            const pidMax = Math.max(10, Math.abs(s.P), Math.abs(s.I), Math.abs(s.D));
            const renderBar = (val: number, color: string) => {
              const isPos = val >= 0;
              const mag = Math.min(50, (Math.abs(val) / pidMax) * 50);
              return (
                <div style={{ position: 'relative', height: '4px', background: 'var(--surface-border)', borderRadius: '2px', overflow: 'hidden', marginTop: '2px' }}>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'var(--muted)', opacity: 0.5 }} />
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    ...(isPos ? { left: '50%', width: `${mag}%` } : { right: '50%', width: `${mag}%` }),
                    background: color,
                    borderRadius: '2px',
                  }} />
                </div>
              );
            };
            return (
              <dl className="ll-kv" style={{ fontSize: '0.78rem' }}>
                <dt>P</dt>
                <dd>
                  <span>{fmt(s.P, 3)} %</span>
                  {renderBar(s.P, 'var(--ll-pv)')}
                </dd>
                <dt>I</dt>
                <dd>
                  <span>{fmt(s.I, 3)} %</span>
                  {renderBar(s.I, 'var(--ll-cv)')}
                </dd>
                <dt>D</dt>
                <dd>
                  <span>{fmt(s.D, 3)} %</span>
                  {renderBar(s.D, 'var(--ll-valve)')}
                </dd>
                {exp.controller.kind === 'schedule' && <><dt>Kc now</dt><dd>{fmt(s.Kc, 3)}</dd></>}
                {(exp.controller.kind === 'feedforward' || exp.controller.kind === 'cascade') && exp.controller.ff.length > 0 && <><dt>FF</dt><dd>{fmt(s.ff, 3)} %</dd></>}
                {cascade && <><dt>{sec.loopTag} SP</dt><dd>{fmt(s.sp2, 4)} {sec.unit}</dd><dt>{sec.loopTag} PV</dt><dd>{fmt(s.pv2, 4)} {sec.unit}</dd></>}
                {mimo && <><dt>{mimo.sec.label}</dt><dd>{fmt(s.pv2, 4)} {mimo.sec.unit}</dd><dt>{mimo.valve}</dt><dd>{fmt(s.cv2, 3)} %</dd></>}
              </dl>
            );
          })()}
        </div>
        <div style={{ minWidth: 0 }}>
          {drawing}
          <div className="ll-speed">
            <button className="ll-btn is-small" onClick={() => setRunning((r) => !r)}>{running ? '⏸ Pause' : '▶ Run'}</button>
            <button className="ll-btn is-small" onClick={resetSteady} title="Re-initialize loop at steady state">↺ Reset steady</button>
            <button className={`ll-btn is-small${fullRange ? ' is-primary' : ''}`} onClick={() => setFullRange((f) => !f)} title={fullRange ? 'Switch to auto-zoom' : 'Switch to full scale'}>{fullRange ? 'Full scale' : 'Auto-zoom'}</button>
            <span>Speed</span>
            {(startSpeed < 1 ? SLOW_SPEEDS : SPEEDS).map((v) => (
              <button key={v} className={`ll-btn is-small${speed === v ? ' is-primary' : ''}`} onClick={() => setSpeed(v)}>×{v}</button>
            ))}
            <span>t = {minutes ? `${fmt(view.t / 60, 4)} min` : `${fmt(view.t, 4)} s`}</span>
          </div>
        </div>
      </div>
      <div className="ll-dists ll-live-dists">
        {upsets(proc).map((ds) => {
          const curVal = d[ds.key];
          const isNominal = Math.abs(curVal - ds.nominal) < 1e-4;
          return (
            <div key={ds.key} className="ll-field" title={ds.note}>
              <span>
                <span>{ds.label}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  {!isNominal && (
                    <button
                      type="button"
                      className="ll-link"
                      style={{ fontSize: '0.72rem' }}
                      onClick={() => act((l) => { l.d[ds.key] = ds.nominal; })}
                      title={`Reset to nominal (${ds.nominal} ${ds.unit})`}
                    >
                      ↺ Nominal ({fmt(ds.nominal, 3)} {ds.unit})
                    </button>
                  )}
                  <em>{fmt(curVal, 3)} {ds.unit}</em>
                </span>
              </span>
              <input
                type="range"
                min={ds.min}
                max={ds.max}
                step={(ds.max - ds.min) / 200}
                value={curVal}
                onChange={(e) => act((l) => { l.d[ds.key] = Number(e.target.value); })}
                aria-label={ds.label}
              />
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.2rem' }}>
                <button
                  type="button"
                  className="ll-btn is-small"
                  style={{ flex: 1, padding: '0.05rem 0.3rem', fontSize: '0.72rem', minHeight: '22px' }}
                  onClick={() => {
                    const step = (ds.max - ds.min) * 0.1;
                    act((l) => { l.d[ds.key] = clamp(Number((l.d[ds.key] - step).toFixed(4)), ds.min, ds.max); });
                  }}
                  title="Step down by 10% of span"
                >
                  −10%
                </button>
                <button
                  type="button"
                  className="ll-btn is-small"
                  style={{ flex: 1, padding: '0.05rem 0.3rem', fontSize: '0.72rem', minHeight: '22px' }}
                  onClick={() => {
                    const step = (ds.max - ds.min) * 0.1;
                    act((l) => { l.d[ds.key] = clamp(Number((l.d[ds.key] + step).toFixed(4)), ds.min, ds.max); });
                  }}
                  title="Step up by 10% of span"
                >
                  +10%
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <Chart
        sync={sync}
        label="Live trend: process value"
        height={200}
        series={[
          { label: 'Setpoint', color: 'var(--ll-sp)', x: tx, y: b.sp, dash: '5 4', width: 1.4 },
          { label: 'Measured', color: 'var(--muted)', x: tx, y: b.pv, width: 1 },
          { label: `${proc.pv.label} (true)`, color: 'var(--ll-pv)', x: tx, y: b.pvTrue, width: 2 },
        ]}
        x={{ label: `Time (${minutes ? 'min' : 's'})` }}
        y={pvYAxis}
      />
      {mimo && (
        <Chart
          sync={sync}
          label={`Live trend: ${mimo.sec.label.toLowerCase()}`}
          height={160}
          series={[
            { label: 'Setpoint', color: 'var(--ll-sp)', x: tx, y: b.sp2, dash: '5 4', width: 1.4 },
            { label: `${mimo.sec.label} (true)`, color: 'var(--habit-3)', x: tx, y: b.pv2, width: 2 },
          ]}
          x={{ label: `Time (${minutes ? 'min' : 's'})` }}
          y={{ label: `${mimo.sec.label} (${mimo.sec.unit})`, decimals: mimo.sec.decimals }}
        />
      )}
      <Chart
        sync={sync}
        label="Live trend: output"
        height={130}
        series={[
          { label: 'Controller output', color: 'var(--ll-cv)', x: tx, y: b.cv, width: 1.2 },
          { label: mimo ? `${proc.tags.valve} stem` : 'Valve stem', color: 'var(--ll-valve)', x: tx, y: b.valve, width: 1.8 },
          ...(mimo ? [{ label: `${mimo.valve} stem`, color: 'var(--habit-3)', x: tx, y: b.valve2, width: 1.8 }] : []),
        ]}
        x={{ label: `Time (${minutes ? 'min' : 's'})` }}
        y={{ label: 'Output (%)', min: -2, max: 102 }}
      />
    </div>
  );
}
