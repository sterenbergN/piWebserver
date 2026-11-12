'use client';

import { useMemo, useState } from 'react';
import { Tex } from '@/components/daily/MathText';
import { cleanParams, defaultParams, type ParamGroup, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import {
  GOALS, OTHER_EFFECTS, applyGoal, defaultSummary, describeEffect, plantSummary, settingEffects,
  type GoalId, type PlantSummary,
} from '@/lib/loop-lab/plant';
import { linearizePlant, pathModel, openLoopStep } from '@/lib/loop-lab/linear';
import Chart, { fmt, type Guide, type Marker, type Series } from './Chart';
import { texNum } from './format';
import { NumField } from './Setup';

const GROUPS: { id: ParamGroup; label: string; blurb: string }[] = [
  { id: 'process', label: 'The process', blurb: 'The physical plant: sizes, capacities, heat transfer.' },
  { id: 'valve', label: 'Control valve', blurb: 'What sits between the controller output and the process.' },
  { id: 'transmitter', label: 'Transmitter', blurb: 'How the measurement gets back to the controller.' },
  { id: 'controller', label: 'Controller cycle', blurb: 'How often the PLC runs the loop.' },
];

const SUB: Record<string, string> = {
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
};
/** A symbol like "K_st" as plain text "Kₛₜ" (subscript letters where Unicode has them). */
export const plainSymbol = (sym: string) => sym.replace(/_\{?([A-Za-z0-9]+)\}?/g, (_, sub: string) =>
  [...sub].every((c) => SUB[c]) ? [...sub].map((c) => SUB[c]).join('') : sub);

const changed = (a: number, b: number) => Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b));
const differs = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 0.03 * Math.abs(b);

/** Dead time, time constant, gain, controllability bar and live transfer function. */
export function PlantNow({ proc, now, was, isUnstable }: { proc: ProcessDef; now: PlantSummary | null; was: PlantSummary | null; isUnstable?: boolean }) {
  if (!now) return <p className="ll-note">This setting combination has no steady state at {fmt(proc.nominalPv, 3)} {proc.pv.unit}.</p>;
  const ratio = now.theta / Math.max(now.tau, 1e-9);

  let badgeText: string;
  let badgeTone: 'good' | 'warn' | 'bad';
  if (isUnstable) {
    badgeText = 'Open-loop unstable (RHP pole) — Requires derivative / state feedback';
    badgeTone = 'bad';
  } else if (now.integrating) {
    badgeText = 'Integrating (1/s) — Needs careful reset Ti';
    badgeTone = 'warn';
  } else if (ratio < 0.2) {
    badgeText = 'Lag-dominant (θ/τ < 0.2) — Easy for PI';
    badgeTone = 'good';
  } else if (ratio < 1.0) {
    badgeText = 'Balanced (0.2 ≤ θ/τ < 1) — Moderate';
    badgeTone = 'good';
  } else {
    badgeText = 'Dead-time dominant (θ/τ ≥ 1) — Hard: needs Smith/MPC';
    badgeTone = 'bad';
  }

  const delayFraction = now.integrating ? 0.05 : Math.min(1, Math.max(0, now.theta / (now.theta + Math.max(now.tau, 1e-9))));
  const pct = (delayFraction * 100).toFixed(1);

  const tfLatex = isUnstable
    ? `G(s) \\approx \\frac{${texNum(now.K)}${now.theta > 0.001 ? `\\,e^{-${texNum(now.theta)}s}` : ''}}{(${texNum(now.tau)}s - 1)(${texNum(now.tau)}s + 1)}`
    : now.integrating
    ? `G(s) \\approx \\frac{${texNum(now.kPrime)}${now.theta > 0.001 ? `\\,e^{-${texNum(now.theta)}s}` : ''}}{s}`
    : `G(s) \\approx \\frac{${texNum(now.K)}${now.theta > 0.001 ? `\\,e^{-${texNum(now.theta)}s}` : ''}}{${texNum(now.tau)}s + 1}`;

  const gain = now.integrating ? now.kPrime : now.K;
  const gainWas = was ? (was.integrating ? was.kPrime : was.K) : NaN;
  const tile = (title: string, value: string, before: string | null, sub: string) => (
    <div className="ll-stat">
      <span className="ll-stat-title">{title}</span>
      <strong>{value}</strong>
      <span className="ll-stat-sub">{before ? <><s>{before}</s> · </> : null}{sub}</span>
    </div>
  );

  return (
    <div>
      <div className="ll-stats">
        {tile('Dead time θ', `${fmt(now.theta, 3)} s`, was && differs(now.theta, was.theta) ? `${fmt(was.theta, 3)} s` : null, 'nothing happens for this long after the valve moves')}
        {tile('Time constant τ', now.integrating ? '—' : `${fmt(now.tau, 3)} s`, !now.integrating && was && differs(now.tau, was.tau) ? `${fmt(was.tau, 3)} s` : null, now.integrating ? 'no settling: it ramps' : 'then 63 % of the way in this long')}
        {tile(now.integrating ? 'Ramp rate k′' : 'Gain K', now.integrating ? `${fmt(gain, 3)} /s` : fmt(gain, 3), differs(gain, gainWas) ? fmt(gainWas, 3) : null, now.integrating ? '% of span per second, per % of valve' : '% of span the PV moves per % of valve')}
      </div>

      {/* Controllability & Dynamics Bar */}
      <div style={{ margin: '0.85rem 0 0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.35rem' }}>
          <span className={`ll-badge is-${badgeTone}`}>{badgeText}</span>
          <span className="ll-small" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {now.integrating ? 'Integrating process (no self-regulation)' : `Delay share: ${pct}% (θ/τ = ${fmt(ratio, 2)})`}
          </span>
        </div>
        <div
          style={{
            height: '8px',
            borderRadius: '6px',
            background: 'var(--input-bg)',
            border: '1px solid var(--surface-border)',
            overflow: 'hidden',
            position: 'relative',
          }}
          role="progressbar"
          aria-valuenow={Math.round(delayFraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Dead time to lag dynamics ratio"
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: now.integrating ? 'var(--warning)' : ratio < 0.2 ? 'var(--success)' : ratio < 1.0 ? 'var(--accent-light)' : 'var(--danger)',
              transition: 'width 0.15s ease',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
          <span>0% Pure lag (fast PI)</span>
          <span>50% Balanced</span>
          <span>100% Pure delay (needs Smith / MPC)</span>
        </div>
      </div>

      {/* Live Linearized Transfer Function */}
      <div style={{ marginTop: '0.65rem', padding: '0.45rem 0.75rem', borderRadius: '8px', background: 'var(--surface-hover)', border: '1px solid var(--surface-border)' }}>
        <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: '0.15rem' }}>
          Linearized model at {fmt(proc.nominalPv, 3)} {proc.pv.unit}:
        </div>
        <div className="ll-tex-block" style={{ fontSize: '1.02rem', margin: 0 }}>
          <Tex latex={tfLatex} display />
        </div>
      </div>
    </div>
  );
}

/**
 * Change the plant: what it is now, "make it…" goals, live open-loop step bump preview,
 * and every setting with its physical slider and measured effect on gain, speed and dead time.
 */
export default function PlantEditor({ proc, params, onChange }: { proc: ProcessDef; params: Params; onChange: (p: Params) => void }) {
  const defaults = useMemo(() => defaultParams(proc), [proc]);
  const was = useMemo(() => defaultSummary(proc), [proc]);
  const now = useMemo(() => plantSummary(proc, params), [proc, params]);
  const effects = useMemo(() => settingEffects(proc, params), [proc, params]);
  const [last, setLast] = useState<{ text: string; undo: Params } | null>(null);
  const nChanged = proc.params.filter((s) => changed(params[s.key], defaults[s.key])).length;

  const goal = (id: GoalId) => {
    const r = applyGoal(proc, params, id);
    if (!r) { setLast({ text: 'Nothing on this process does that noticeably.', undo: params }); return; }
    const what = r.changes.map((c) => `${c.label} ${fmt(c.from, 3)} → ${fmt(c.to, 3)}${c.unit ? ` ${c.unit}` : ''}`).join('; ');
    const moved: string[] = [];
    if (r.before && r.after) {
      if (differs(r.after.tau, r.before.tau)) moved.push(`τ ${fmt(r.before.tau, 3)} → ${fmt(r.after.tau, 3)} s`);
      if (differs(r.after.theta, r.before.theta)) moved.push(`θ ${fmt(r.before.theta, 3)} → ${fmt(r.after.theta, 3)} s`);
      if (differs(r.after.K, r.before.K)) moved.push(`K ${fmt(r.before.K, 3)} → ${fmt(r.after.K, 3)}`);
    }
    setLast({ text: `${what}${moved.length ? ` (${moved.join(', ')})` : ''}.`, undo: params });
    onChange(r.params);
  };

  // Live Open-Loop Bump Test (+10% Valve Step)
  const stepData = useMemo(() => {
    try {
      const calc = (p: Params) => {
        const cleanP = cleanParams(proc, p);
        const m = linearizePlant(proc, cleanP, proc.nominalPv);
        const pm = pathModel(m, m.C, cleanP.txDelay);
        const sum = plantSummary(proc, cleanP);
        const theta = cleanP.txDelay;
        const tau = sum ? Math.max(0.05, sum.tau) : 10;
        const isUnstable = m.poles.some((q) => q.re > 1e-6);
        let horizon: number;
        if (isUnstable) {
          const rhpPoles = m.poles.filter((q) => q.re > 1e-6).map((q) => q.re);
          const maxRhp = rhpPoles.length > 0 ? Math.max(...rhpPoles) : 0.5;
          horizon = Math.min(20, 3.5 / Math.max(1e-4, maxRhp));
        } else {
          horizon = Math.min(6000, Math.max(5, 5 * (sum?.integrating ? 25 : (tau + theta))));
        }
        const r = openLoopStep(pm.A, pm.B, pm.C, 0, horizon, 300);
        const tShifted = r.t.map((t) => t + theta);
        const xs = [0, theta, ...tShifted];
        const ys = [0, 0, ...r.y.map((v) => Math.max(-500, Math.min(500, v * 10)))];
        return { xs, ys, theta, tau, K: sum?.K ?? 1, kPrime: sum?.kPrime ?? 0, integrating: !!sum?.integrating, horizon, isUnstable };
      };

      const cur = calc(params);
      const def = nChanged > 0 ? calc(defaults) : null;
      return { cur, def, isUnstable: cur.isUnstable };
    } catch {
      return null;
    }
  }, [proc, params, defaults, nChanged]);

  let yAtTau = 0;
  if (stepData?.cur) {
    const targetT = stepData.cur.theta + stepData.cur.tau;
    const xs = stepData.cur.xs;
    const ys = stepData.cur.ys;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - targetT);
      if (d < minDiff) {
        minDiff = d;
        closestIdx = i;
      }
    }
    yAtTau = ys[closestIdx];
  }

  const stepSeries: Series[] = useMemo(() => {
    if (!stepData?.cur) return [];
    const list: Series[] = [
      {
        label: 'Current plant (+10% step)',
        color: 'var(--habit-1)',
        x: stepData.cur.xs,
        y: stepData.cur.ys,
        width: 2.2,
      },
    ];
    if (stepData.def) {
      list.push({
        label: 'Default plant',
        color: 'var(--muted)',
        x: stepData.def.xs,
        y: stepData.def.ys,
        dash: '4 4',
        width: 1.8,
      });
    }
    return list;
  }, [stepData]);

  const vGuides: Guide[] = useMemo(() => {
    if (!stepData?.cur) return [];
    const c = stepData.cur;
    const gds: Guide[] = [
      { at: c.theta, label: 'θ dead time', color: 'var(--muted)', dash: '3 3' },
    ];
    if (!c.integrating && !c.isUnstable) {
      gds.push({ at: c.theta + c.tau, label: 'θ + τ (63%)', color: 'var(--muted)', dash: '3 3' });
    }
    return gds;
  }, [stepData]);

  const markers: Marker[] = useMemo(() => {
    if (!stepData?.cur) return [];
    const c = stepData.cur;
    const mks: Marker[] = [
      { x: c.theta, y: 0, color: 'var(--habit-1)', shape: 'dot' },
    ];
    if (!c.integrating && !c.isUnstable) {
      mks.push({ x: c.theta + c.tau, y: yAtTau, color: 'var(--habit-1)', shape: 'dot' });
    }
    return mks;
  }, [stepData, yAtTau]);

  return (
    <div>
      <div className="ll-card">
        <div className="ll-card-head">
          <h3>The plant now</h3>
          {nChanged > 0 && <button className="ll-link" onClick={() => { onChange(defaults); setLast(null); }}>Reset all {nChanged} change{nChanged > 1 ? 's' : ''}</button>}
        </div>
        <PlantNow proc={proc} now={now} was={nChanged ? was : null} isUnstable={stepData?.isUnstable} />
        <div className="ll-sub">Make it…</div>
        <div className="ll-goals">
          {GOALS.map((g) => <button key={g.id} className="ll-btn is-small" title={g.hint} onClick={() => goal(g.id)}>{g.label}</button>)}
        </div>
        {last && (
          <p className="ll-goal-result">
            {last.text}{' '}
            <button className="ll-link" onClick={() => { onChange(last.undo); setLast(null); }}>Undo</button>
            <span className="ll-small"> The controller is unchanged: press Auto-tune again to retune for the new plant, or keep the old tuning to see what the change does to it.</span>
          </p>
        )}

        {/* Live Open-Loop Bump Test Preview */}
        {stepSeries.length > 0 && (
          <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--ll-line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ fontSize: '0.88rem', fontWeight: 650, margin: 0 }}>Open-Loop Step Response (+10% Valve Bump)</h4>
                {stepData?.isUnstable && (
                  <span
                    className="ll-badge"
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      borderColor: 'rgba(245, 158, 11, 0.4)',
                      color: '#fbbf24',
                      fontSize: '0.72rem',
                    }}
                  >
                    Open-loop unstable (RHP pole) — runs away without closed-loop feedback
                  </span>
                )}
              </div>
              <span className="ll-small">Simulated from steady state at nominal PV</span>
            </div>
            <Chart
              label="Open-loop step response"
              series={stepSeries}
              x={{ label: 'Time (s)', min: 0 }}
              y={{ label: 'PV change (% of span)' }}
              height={220}
              vGuides={vGuides}
              markers={markers}
              legend={stepSeries.length > 1}
            />
          </div>
        )}
      </div>

      {GROUPS.map((g) => {
        const specs = proc.params.filter((s) => s.group === g.id);
        if (!specs.length) return null;
        return (
          <div className="ll-card" key={g.id}>
            <div className="ll-card-head"><h3>{g.label}</h3><span className="ll-small">{g.blurb}</span></div>
            <div className="ll-settings">
              {specs.map((s) => {
                const isChanged = changed(params[s.key], defaults[s.key]);
                const effect = OTHER_EFFECTS[s.key] && s.key !== 'Ts' ? OTHER_EFFECTS[s.key] : describeEffect(effects[s.key]);
                const raising = !OTHER_EFFECTS[s.key] || s.key === 'Ts';
                const eff = effects[s.key];
                const badges: { text: string; title: string; color: string }[] = [];
                if (eff) {
                  if (Math.abs(eff.dTau) >= 0.03) {
                    badges.push({
                      text: `τ ${eff.dTau > 0 ? '↑' : '↓'}`,
                      title: `Time constant ${eff.dTau > 0 ? 'increases (slower)' : 'decreases (faster)'}`,
                      color: eff.dTau > 0 ? 'var(--warning)' : 'var(--success)',
                    });
                  }
                  if (Math.abs(eff.dK) >= 0.03) {
                    badges.push({
                      text: `K ${eff.dK > 0 ? '↑' : '↓'}`,
                      title: `Process gain ${eff.dK > 0 ? 'increases' : 'decreases'}`,
                      color: eff.dK > 0 ? 'var(--habit-2)' : 'var(--habit-3)',
                    });
                  }
                  if (Math.abs(eff.dTheta) >= 0.03) {
                    badges.push({
                      text: `θ ${eff.dTheta > 0 ? '↑' : '↓'}`,
                      title: `Dead time ${eff.dTheta > 0 ? 'increases' : 'decreases'}`,
                      color: eff.dTheta > 0 ? 'var(--danger)' : 'var(--success)',
                    });
                  }
                }

                return (
                  <div key={s.key} className={`ll-setting${isChanged ? ' is-changed' : ''}`}>
                    <div className="ll-setting-input">
                      {s.options ? (
                        <label className="ll-field">
                          <span>{s.label}</span>
                          <select value={params[s.key]} onChange={(e) => onChange({ ...params, [s.key]: Number(e.target.value) })}>
                            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                      ) : (
                        <>
                          <NumField
                            label={s.symbol ? `${s.label} (${plainSymbol(s.symbol)})` : s.label}
                            unit={s.unit}
                            value={params[s.key]}
                            min={s.min}
                            max={s.max}
                            step={s.step}
                            onChange={(v) => onChange({ ...params, [s.key]: v })}
                          />
                          {s.min !== undefined && s.max !== undefined && (
                            <input
                              type="range"
                              min={s.min}
                              max={s.max}
                              step={s.step ?? (s.max - s.min) / 200}
                              value={params[s.key] ?? defaults[s.key]}
                              onChange={(e) => onChange({ ...params, [s.key]: Number(e.target.value) })}
                              style={{ width: '100%', marginTop: '0.2rem' }}
                              aria-label={`${s.label} slider`}
                            />
                          )}
                        </>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                        {badges.map((b) => (
                          <span
                            key={b.text}
                            className="ll-badge"
                            style={{ fontSize: '0.7rem', padding: '0.05rem 0.35rem', borderColor: b.color, color: b.color }}
                            title={b.title}
                          >
                            {b.text}
                          </span>
                        ))}
                        {isChanged && (
                          <button
                            className="ll-link ll-setting-reset"
                            title={`Back to ${fmt(defaults[s.key], 4)} ${s.unit}`}
                            onClick={() => onChange({ ...params, [s.key]: defaults[s.key] })}
                          >
                            ↺ {s.options ? s.options.find((o) => o.value === defaults[s.key])?.label : `${fmt(defaults[s.key], 4)} ${s.unit}`}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="ll-setting-text">
                      {s.note && <p>{s.note}</p>}
                      <p className="ll-setting-effect">
                        {raising
                          ? (effect ? <><strong>Raising it:</strong> {effect}.</> : <>Little effect on how the plant responds at {fmt(proc.nominalPv, 3)} {proc.pv.unit}.</>)
                          : effect}
                        {s.key === 'Ts' && <> {OTHER_EFFECTS.Ts}</>}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
