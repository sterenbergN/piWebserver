'use client';

import { useMemo, useState } from 'react';
import { defaultParams, type ParamGroup, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import {
  GOALS, OTHER_EFFECTS, applyGoal, defaultSummary, describeEffect, plantSummary, settingEffects,
  type GoalId, type PlantSummary,
} from '@/lib/loop-lab/plant';
import { fmt } from './Chart';
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
const plainSymbol = (sym: string) => sym.replace(/_\{?([A-Za-z0-9]+)\}?/g, (_, sub: string) =>
  [...sub].every((c) => SUB[c]) ? [...sub].map((c) => SUB[c]).join('') : sub);

const changed = (a: number, b: number) => Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b));
const differs = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 0.03 * Math.abs(b);

/** Dead time, time constant and gain in plain words, against the defaults. */
export function PlantNow({ proc, now, was }: { proc: ProcessDef; now: PlantSummary | null; was: PlantSummary | null }) {
  if (!now) return <p className="ll-note">This setting combination has no steady state at {fmt(proc.nominalPv, 3)} {proc.pv.unit}.</p>;
  const ratio = now.theta / Math.max(now.tau, 1e-9);
  const character = now.integrating ? 'Integrating: with the valve fixed it ramps instead of settling.'
    : ratio < 0.2 ? 'Lag-dominant: dead time is short next to the time constant, so it can be controlled tightly.'
    : ratio < 1 ? 'Balanced: dead time and lag both matter.'
    : 'Dead-time dominant: the controller waits a long time for any answer. The hardest kind to control.';
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
      <p className="ll-note">{character} Seen from the valve to the transmitter at {fmt(proc.nominalPv, 3)} {proc.pv.unit}, with the instruments and half a controller cycle included.</p>
    </div>
  );
}

/**
 * Change the plant: what it is now, "make it…" goals, and every setting with
 * its physical meaning and its measured effect on gain, speed and dead time.
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

  return (
    <div>
      <div className="ll-card">
        <div className="ll-card-head">
          <h3>The plant now</h3>
          {nChanged > 0 && <button className="ll-link" onClick={() => { onChange(defaults); setLast(null); }}>Reset all {nChanged} change{nChanged > 1 ? 's' : ''}</button>}
        </div>
        <PlantNow proc={proc} now={now} was={nChanged ? was : null} />
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
                        <NumField label={s.symbol ? `${s.label} (${plainSymbol(s.symbol)})` : s.label} unit={s.unit} value={params[s.key]} min={s.min} max={s.max} step={s.step}
                          onChange={(v) => onChange({ ...params, [s.key]: v })} />
                      )}
                      {isChanged && (
                        <button className="ll-link ll-setting-reset" title={`Back to ${fmt(defaults[s.key], 4)} ${s.unit}`} onClick={() => onChange({ ...params, [s.key]: defaults[s.key] })}>
                          ↺ {s.options ? s.options.find((o) => o.value === defaults[s.key])?.label : `${fmt(defaults[s.key], 4)} ${s.unit}`}
                        </button>
                      )}
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
