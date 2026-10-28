'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CONTROLLER_KINDS, defaultController, defaultInnerFeedforward, isAvailable,
  type ControllerConfig, type ControllerKind, type FeedforwardTerm, type PidParams, type SchedulePoint,
} from '@/lib/loop-lab/controllers';
import { defaultParams, measuredDisturbances, type ParamGroup, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { PROCESSES } from '@/lib/loop-lab/processes';
import { TUNING_RULES, autoTune, feedforwardDesign, getRule, tuningModel, type ControlType, type TuningLoop, type TuningRuleId } from '@/lib/loop-lab/tuning';
import { fmt } from './Chart';

/** A number input that lets you type freely and reports only valid numbers. */
export function NumField({ value, onChange, min, max, step, label, unit, title }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; unit?: string; title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    // Follow outside changes, but don't fight the user mid-edit ("0." is still 0).
    setText((t) => (Number(t) === value ? t : String(Number(value.toPrecision(6)))));
  }, [value]);
  return (
    <label className="ll-field" title={title}>
      <span>{label}{unit && <em>{unit}</em>}</span>
      <input type="number" inputMode="decimal" value={text} min={min} max={max} step={step ?? 'any'}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)) : n);
        }}
        onBlur={() => setText(String(Number(value.toPrecision(6))))} />
    </label>
  );
}

/** The process, as one menu grouped by what it teaches. */
export function ProcessPicker({ value, onChange }: { value: ProcessDef['id']; onChange: (id: ProcessDef['id']) => void }) {
  const groups = [
    { label: 'Where PID is the answer', list: PROCESSES.filter((p) => p.family === 'pid-wins') },
    { label: 'Where PID falls short', list: PROCESSES.filter((p) => p.family === 'escalation' && p.id !== 'custom') },
    { label: 'Your own data', list: PROCESSES.filter((p) => p.id === 'custom') },
  ];
  return (
    <select className="ll-big-select" value={value} onChange={(e) => onChange(e.target.value as ProcessDef['id'])} aria-label="Process">
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.list.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** What each controller does, in a line. */
const KIND_HINT: Record<ControllerKind, string> = {
  onoff: 'Fully on below the setpoint, off above it.',
  pid: 'Proportional, integral and derivative action: the default.',
  schedule: 'A PID whose gains change with the operating point.',
  characterized: 'A PID on a straightened-out measurement or output.',
  feedforward: 'A PID plus action on measured disturbances, before they arrive.',
  cascade: 'A fast inner loop inside the main one.',
};

function PidFields({ pid, onChange, gains = true }: { pid: PidParams; onChange: (p: PidParams) => void; gains?: boolean }) {
  const set = (k: keyof PidParams) => (v: number) => onChange({ ...pid, [k]: v });
  return (
    <>
      {gains && (
        <div className="ll-fields is-3">
          <NumField label="Kc" unit="%/%" value={pid.Kc} min={0} onChange={set('Kc')} title="Proportional gain, % output per % of span" />
          <NumField label="Ti" unit="s" value={pid.Ti} min={0} onChange={set('Ti')} title="Integral time (0 = off)" />
          <NumField label="Td" unit="s" value={pid.Td} min={0} onChange={set('Td')} title="Derivative time (0 = off)" />
        </div>
      )}
      <details style={{ marginTop: '0.5rem' }}>
        <summary className="ll-small" style={{ cursor: 'pointer' }}>Weights, filter, limits, anti-windup</summary>
        <div className="ll-fields is-3" style={{ marginTop: '0.5rem' }}>
          <NumField label="b" value={pid.b} min={0} max={1} step={0.1} onChange={set('b')} title="Setpoint weight on P (PWeighting)" />
          <NumField label="c" value={pid.c} min={0} max={1} step={0.1} onChange={set('c')} title="Setpoint weight on D (DWeighting)" />
          <NumField label="a" value={pid.a} min={0.01} max={1} step={0.05} onChange={set('a')} title="Derivative filter ratio (TdFiltRatio)" />
          <NumField label="Out low" unit="%" value={pid.outLo} onChange={set('outLo')} />
          <NumField label="Out high" unit="%" value={pid.outHi} onChange={set('outHi')} />
          <label className="ll-field">
            <span>Anti-windup</span>
            <select value={pid.antiWindup} onChange={(e) => onChange({ ...pid, antiWindup: e.target.value as PidParams['antiWindup'] })}>
              <option value="clamp">Clamping</option>
              <option value="backcalc">Back-calc.</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
        <label className="ll-check" style={{ marginTop: '0.4rem' }}>
          <input type="checkbox" checked={pid.invert} onChange={(e) => onChange({ ...pid, invert: e.target.checked })} />
          Invert control (more output lowers the PV)
        </label>
      </details>
    </>
  );
}

function ScheduleTable({ proc, points, onChange }: { proc: ProcessDef; points: SchedulePoint[]; onChange: (p: SchedulePoint[]) => void }) {
  const set = (i: number, k: keyof SchedulePoint, v: number) => onChange(points.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const num = (i: number, k: keyof SchedulePoint) => (
    <input type="number" step="any" aria-label={`${k} at breakpoint ${i + 1}`} value={Number(points[i][k].toPrecision(5))}
      onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= 0) set(i, k, n); }} />
  );
  return (
    <div className="ll-table-wrap">
      <table className="ll-table">
        <thead><tr><th>At ({proc.pv.unit})</th><th>Kc</th><th>Ti (s)</th><th>Td (s)</th><th /></tr></thead>
        <tbody>
          {points.map((_, i) => (
            <tr key={i}>
              <td>{num(i, 'at')}</td><td>{num(i, 'Kc')}</td><td>{num(i, 'Ti')}</td><td>{num(i, 'Td')}</td>
              <td>{points.length > 2 && <button className="ll-link" aria-label="Remove breakpoint" onClick={() => onChange(points.filter((__, j) => j !== i))}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {points.length < 8 && (
        <button className="ll-link" style={{ marginTop: '0.35rem' }} onClick={() => {
          const last = points[points.length - 1];
          onChange([...points, { ...last, at: Math.min(proc.pv.hi, last.at + (proc.pv.hi - proc.pv.lo) / 10) }]);
        }}>+ Add breakpoint</button>
      )}
    </div>
  );
}

export function ControllerEditor({ proc, params, config, onChange }: {
  proc: ProcessDef; params: Params; config: ControllerConfig; onChange: (c: ControllerConfig) => void;
}) {
  const switchKind = (kind: ControllerKind) => {
    if (kind === config.kind || !isAvailable(proc, kind)) return;
    const next = defaultController(kind, proc);
    // Carry the PID settings across where both have them (a cascade master is tuned in other units, so it keeps its own).
    const prev = config.kind === 'onoff' || config.kind === 'cascade' ? null : config.pid;
    if (prev && next.kind !== 'onoff' && next.kind !== 'cascade') next.pid = { ...prev };
    if (prev && next.kind === 'schedule') next.points = next.points.map((p) => ({ ...p, Kc: prev.Kc, Ti: prev.Ti, Td: prev.Td }));
    onChange(next);
  };
  return (
    <div>
      <div className="ll-seg" role="tablist" aria-label="Controller">
        {CONTROLLER_KINDS.filter((k) => isAvailable(proc, k.kind)).map((k) => (
          <button key={k.kind} role="tab" aria-selected={config.kind === k.kind} onClick={() => switchKind(k.kind)} title={k.name}>
            {k.short}
          </button>
        ))}
      </div>
      <p className="ll-note" style={{ marginTop: '0.4rem' }}>{KIND_HINT[config.kind]}</p>
      {config.kind !== 'onoff' && <AutoTune proc={proc} params={params} config={config} onChange={onChange} />}
      <div style={{ marginTop: '0.7rem' }}>
        {config.kind === 'onoff' && (
          <div className="ll-fields is-3">
            <NumField label="Band" unit="% span" value={config.hyst} min={0} onChange={(v) => onChange({ ...config, hyst: v })} />
            <NumField label="On" unit="%" value={config.outOn} min={0} max={100} onChange={(v) => onChange({ ...config, outOn: v })} />
            <NumField label="Off" unit="%" value={config.outOff} min={0} max={100} onChange={(v) => onChange({ ...config, outOff: v })} />
          </div>
        )}
        {config.kind === 'pid' && <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />}
        {config.kind === 'feedforward' && (
          <>
            <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />
            <div className="ll-sub">Feedforward to the valve</div>
            <FeedforwardEditor proc={proc} params={params} config={config} terms={config.ff} unit="% output" onChange={(ff) => onChange({ ...config, ff })} />
          </>
        )}
        {config.kind === 'cascade' && proc.secondary && (
          <>
            <div className="ll-sub">Master: {proc.tags.loop} ({proc.pv.label.toLowerCase()})</div>
            <PidFields pid={config.outer} onChange={(outer) => onChange({ ...config, outer })} />
            <p className="ll-note" style={{ marginTop: '0.3rem' }}>Its output is the {proc.secondary.label.toLowerCase()} setpoint, 0–100 % of {proc.secondary.lo}–{proc.secondary.hi} {proc.secondary.unit}.</p>
            <div className="ll-sub">Slave: {proc.secondary.loopTag} ({proc.secondary.label.toLowerCase()})</div>
            <PidFields pid={config.inner} onChange={(inner) => onChange({ ...config, inner })} />
            <div className="ll-sub">Feedforward into the slave setpoint</div>
            <FeedforwardEditor proc={proc} params={params} config={config} terms={config.ff} unit={`% of ${proc.secondary.label.toLowerCase()}`}
              onChange={(ff) => onChange({ ...config, ff })} suggest={defaultInnerFeedforward(proc)} />
          </>
        )}
        {config.kind === 'characterized' && (
          <>
            <label className="ll-field is-wide" style={{ marginBottom: '0.5rem' }}>
              <span>Characterization</span>
              <select value={config.char} onChange={(e) => onChange({ ...config, char: e.target.value })}>
                {proc.characterizations.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <p className="ll-note" style={{ marginTop: 0, marginBottom: '0.5rem' }}>{proc.characterizations.find((c) => c.id === config.char)?.note}</p>
            <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />
          </>
        )}
        {config.kind === 'schedule' && (
          <>
            <label className="ll-field is-wide" style={{ marginBottom: '0.5rem' }}>
              <span>Schedule on</span>
              <select value={config.on} onChange={(e) => onChange({ ...config, on: e.target.value === 'sp' ? 'sp' : 'pv' })}>
                <option value="pv">Process value (PV)</option>
                <option value="sp">Setpoint (SP)</option>
              </select>
            </label>
            <ScheduleTable proc={proc} points={config.points} onChange={(points) => onChange({ ...config, points })} />
            <PidFields pid={config.pid} gains={false} onChange={(pid) => onChange({ ...config, pid })} />
          </>
        )}
      </div>
      {config.kind !== 'onoff' && <TuningHelper proc={proc} params={params} config={config} onChange={onChange} />}
    </div>
  );
}

/** Feedforward terms: one per measured disturbance, each a gain and a lead-lag, with a design-from-the-model button. */
function FeedforwardEditor({ proc, params, config, terms, unit, onChange, suggest }: {
  proc: ProcessDef; params: Params; config: ControllerConfig; terms: FeedforwardTerm[]; unit: string;
  onChange: (t: FeedforwardTerm[]) => void; suggest?: FeedforwardTerm[];
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const measured = measuredDisturbances(proc);
  const unused = measured.filter((d) => !terms.some((t) => t.from === d.key));
  const set = (i: number, patch: Partial<FeedforwardTerm>) => onChange(terms.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const design = (i: number) => {
    const t = terms[i];
    const r = feedforwardDesign(proc, params, config, proc.nominalPv, t.from);
    if (!r) { setNotes({ ...notes, [t.from]: 'No usable model for this path.' }); return; }
    const round = (v: number) => Number(v.toPrecision(3));
    set(i, { gain: round(r.gain), lead: round(r.lead), lag: round(r.lag) });
    setNotes({ ...notes, [t.from]: `Valve path K ${round(r.u.K)}, τ ${round(r.u.tau)} s, θ ${round(r.u.theta)} s; disturbance path K ${round(r.d.K)}, τ ${round(r.d.tau)} s, θ ${round(r.d.theta)} s. ${r.note ?? ''}` });
  };
  return (
    <div>
      {!terms.length && <p className="ll-note" style={{ marginTop: 0 }}>None yet: feedback only.</p>}
      {terms.map((t, i) => {
        const d = proc.disturbances.find((x) => x.key === t.from);
        return (
          <div key={t.from} style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '0.4rem', marginTop: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
              <strong style={{ fontSize: '0.85rem' }}>{d?.label} <span className="ll-small">({d?.measured})</span></strong>
              <span style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="ll-link" onClick={() => design(i)}>Design from model</button>
                <button className="ll-link" aria-label={`Remove feedforward from ${d?.label}`} onClick={() => onChange(terms.filter((_, j) => j !== i))}>✕</button>
              </span>
            </div>
            <div className="ll-fields is-3" style={{ marginTop: '0.3rem' }}>
              <NumField label="Gain" unit={`${unit}/${d?.unit ?? ''}`} value={t.gain} onChange={(v) => set(i, { gain: v })} title="Output change per unit change of the disturbance" />
              <NumField label="Lead" unit="s" value={t.lead} min={0} onChange={(v) => set(i, { lead: v })} />
              <NumField label="Lag" unit="s" value={t.lag} min={0} onChange={(v) => set(i, { lag: v })} />
            </div>
            {notes[t.from] && <p className="ll-note">{notes[t.from]}</p>}
          </div>
        );
      })}
      {unused.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
          {unused.map((d) => (
            <button key={d.key} className="ll-btn is-small" onClick={() => onChange([...terms, suggest?.find((x) => x.from === d.key) ?? { from: d.key, gain: 0, lead: 0, lag: 0 }])}>
              + From {d.label.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One button: a robust starting tuning from the process model. */
function AutoTune({ proc, params, config, onChange }: { proc: ProcessDef; params: Params; config: ControllerConfig; onChange: (c: ControllerConfig) => void }) {
  // The explanation belongs to the tuning it produced: once anything changes, it goes.
  const [tuned, setTuned] = useState<{ key: string; note: string } | null>(null);
  const note = tuned && tuned.key === JSON.stringify([proc.id, params, config]) ? tuned.note : '';
  return (
    <div className="ll-autotune">
      <button className="ll-btn is-primary" onClick={() => {
        const r = autoTune(proc, params, config);
        if (r) {
          onChange(r.config);
          setTuned({ key: JSON.stringify([proc.id, params, r.config]), note: r.note });
        }
      }}>✨ Auto-tune</button>
      <span className="ll-small">{note || 'A robust starting point (SIMC) from the process model. Then adjust by hand and compare.'}</span>
    </div>
  );
}

function TuningHelper({ proc, params, config, onChange }: { proc: ProcessDef; params: Params; config: ControllerConfig; onChange: (c: ControllerConfig) => void }) {
  const [pv, setPv] = useState(proc.opPoints[0]);
  const [ruleId, setRuleId] = useState<TuningRuleId>('simc');
  const [type, setType] = useState<ControlType>('PI');
  const [speedFactor, setSpeedFactor] = useState(3);
  const [loopSel, setLoopSel] = useState<TuningLoop>('outer');
  useEffect(() => { setPv(proc.opPoints[0]); }, [proc]);
  const loop: TuningLoop = config.kind === 'cascade' ? loopSel : 'main';
  const rule = getRule(ruleId);
  const types = rule.types;
  const t = types.includes(type) ? type : types[0];
  const model = useMemo(() => {
    try { return tuningModel(proc, params, config, pv, loop); } catch { return null; }
  }, [proc, params, config, pv, loop]);
  const tuneAt = (at: number) => {
    const m = tuningModel(proc, params, config, at, loop);
    return rule.tune(m, t, m.theta * speedFactor);
  };
  const result = model ? rule.tune(model, t, model.theta * speedFactor) : null;
  const apply = () => {
    if (!result || config.kind === 'onoff') return;
    if (config.kind === 'schedule') {
      const i = config.points.findIndex((p) => Math.abs(p.at - pv) < 1e-9);
      const points = i >= 0
        ? config.points.map((p, j) => (j === i ? { ...p, ...result } : p))
        : [...config.points, { at: pv, ...result }].sort((a, b) => a.at - b.at);
      onChange({ ...config, points });
    } else if (config.kind === 'cascade') {
      onChange(loop === 'inner' ? { ...config, inner: { ...config.inner, ...result } } : { ...config, outer: { ...config.outer, ...result } });
    } else onChange({ ...config, pid: { ...config.pid, ...result } });
  };
  const tuneAll = () => {
    if (config.kind !== 'schedule') return;
    onChange({ ...config, points: config.points.map((p) => ({ ...p, ...(tuneAt(p.at) ?? {}) })) });
  };

  return (
    <details className="ll-tuner" style={{ marginTop: '0.8rem' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Tune by hand: rule, operating point, speed</summary>
      {config.kind === 'cascade' && (
        <div className="ll-seg" role="group" aria-label="Which loop" style={{ marginTop: '0.6rem' }}>
          <button aria-pressed={loop === 'inner'} onClick={() => setLoopSel('inner')}>Slave (inner) first</button>
          <button aria-pressed={loop === 'outer'} onClick={() => setLoopSel('outer')}>Then the master</button>
        </div>
      )}
      <div className="ll-fields" style={{ marginTop: '0.6rem' }}>
        <label className="ll-field">
          <span>Operating point</span>
          <select value={pv} onChange={(e) => setPv(Number(e.target.value))}>
            {[...new Set([...proc.opPoints, ...(config.kind === 'schedule' ? config.points.map((p) => p.at) : [])])].sort((a, b) => a - b)
              .map((v) => <option key={v} value={v}>{fmt(v, 3)} {proc.pv.unit}</option>)}
          </select>
        </label>
        <label className="ll-field">
          <span>Rule</span>
          <select value={ruleId} onChange={(e) => setRuleId(e.target.value as TuningRuleId)}>
            {TUNING_RULES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>
      {model && (
        <p className="ll-note">
          Model here{model.slope !== 1 ? ' (as the controller sees it)' : ''}: K = {fmt(model.K, 3)}, τ = {fmt(model.tau, 3)} s, θ = {fmt(model.theta, 3)} s
          {model.integrating && <> · acts as an integrator: k′ = {fmt(model.kPrime, 3)} /s</>}
          {!model.reachable && <> · <span className="ll-badge is-warn">not reachable</span></>}
          {model.negative && <> · <span className="ll-badge is-warn">negative gain: tick Invert</span></>}
          {loop === 'outer' && <> · the inner loop is closed with its present tuning</>}
        </p>
      )}
      <div className="ll-seg" style={{ marginTop: '0.5rem' }} role="group" aria-label="Controller type">
        {(['P', 'PI', 'PID'] as ControlType[]).map((k) => (
          <button key={k} aria-pressed={t === k} disabled={!types.includes(k)} onClick={() => setType(k)}>{k}</button>
        ))}
      </div>
      {rule.usesSpeed && model && (
        <label className="ll-field" style={{ marginTop: '0.5rem' }}>
          <span>{ruleId === 'lambda' ? 'λ' : 'τc'} = {fmt(speedFactor, 2)} × θ = {fmt(model.theta * speedFactor, 3)} s<em>{speedFactor <= 1 ? 'fast' : speedFactor >= 10 ? 'smooth' : ''}</em></span>
          <input type="range" min={-1} max={Math.log2(200)} step={0.05} value={Math.log2(speedFactor)} onChange={(e) => setSpeedFactor(2 ** Number(e.target.value))} />
        </label>
      )}
      <p className="ll-note">{rule.assumptions}</p>
      {result ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.88rem' }}>
            Kc {fmt(result.Kc, 3)} · Ti {result.Ti ? `${fmt(result.Ti, 3)} s` : 'off'} · Td {result.Td ? `${fmt(result.Td, 3)} s` : 'off'}
          </span>
          <button className="ll-btn is-small is-primary" onClick={apply}>{config.kind === 'schedule' ? 'Apply at this point' : config.kind === 'cascade' ? `Apply to the ${loop === 'inner' ? 'slave' : 'master'}` : 'Apply'}</button>
          {config.kind === 'schedule' && <button className="ll-btn is-small" onClick={tuneAll}>Tune every breakpoint</button>}
        </div>
      ) : <p className="ll-note">This rule gives no usable tuning for this model.</p>}
    </details>
  );
}
