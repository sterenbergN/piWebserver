'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CONTROLLER_KINDS, defaultController, type ControllerConfig, type ControllerKind, type PidParams, type SchedulePoint,
} from '@/lib/loop-lab/controllers';
import { defaultParams, type ParamGroup, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { PROCESSES } from '@/lib/loop-lab/processes';
import { TUNING_RULES, getRule, tuningModel, type ControlType, type TuningRuleId } from '@/lib/loop-lab/tuning';
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

export function ProcessPicker({ value, onChange }: { value: ProcessDef['id']; onChange: (id: ProcessDef['id']) => void }) {
  return (
    <div className="ll-procs">
      {PROCESSES.map((p) => (
        <button key={p.id} className="ll-proc" aria-pressed={p.id === value} onClick={() => onChange(p.id)}>
          <strong>{p.icon} {p.name}</strong>
          <span>{p.family === 'pid-wins' ? 'Where PID is the answer' : 'Where PID falls short'}</span>
        </button>
      ))}
    </div>
  );
}

const GROUPS: { id: ParamGroup; label: string }[] = [
  { id: 'process', label: 'Process' },
  { id: 'valve', label: 'Control valve' },
  { id: 'transmitter', label: 'Transmitter' },
  { id: 'controller', label: 'Controller cycle' },
];

export function ParamEditor({ proc, params, onChange }: { proc: ProcessDef; params: Params; onChange: (p: Params) => void }) {
  const defaults = useMemo(() => defaultParams(proc), [proc]);
  const changed = proc.params.filter((s) => params[s.key] !== defaults[s.key]).length;
  return (
    <div>
      {GROUPS.map((g) => {
        const specs = proc.params.filter((s) => s.group === g.id);
        if (!specs.length) return null;
        return (
          <div key={g.id}>
            <div className="ll-sub">{g.label}</div>
            <div className="ll-fields">
              {specs.map((s) => s.options ? (
                <label key={s.key} className="ll-field is-wide" title={s.note}>
                  <span>{s.label}</span>
                  <select value={params[s.key]} onChange={(e) => onChange({ ...params, [s.key]: Number(e.target.value) })}>
                    {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ) : (
                <NumField key={s.key} label={s.symbol ? `${s.label} (${s.symbol})` : s.label} unit={s.unit} title={s.note}
                  value={params[s.key]} min={s.min} max={s.max} step={s.step} onChange={(v) => onChange({ ...params, [s.key]: v })} />
              ))}
            </div>
          </div>
        );
      })}
      <p className="ll-note">
        {changed ? `${changed} changed from the defaults. ` : 'All at their defaults. '}
        {changed > 0 && <button className="ll-link" onClick={() => onChange(defaults)}>Reset</button>}
      </p>
    </div>
  );
}

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
    if (kind === config.kind) return;
    const next = defaultController(kind, proc);
    // Carry the PID settings across where both have them.
    if (config.kind !== 'onoff' && next.kind !== 'onoff') next.pid = { ...config.pid };
    if (next.kind === 'schedule' && config.kind !== 'onoff') next.points = next.points.map((p) => ({ ...p, Kc: config.pid.Kc, Ti: config.pid.Ti, Td: config.pid.Td }));
    onChange(next);
  };
  return (
    <div>
      <div className="ll-seg" role="tablist" aria-label="Controller">
        {CONTROLLER_KINDS.map((k) => (
          <button key={k.kind} role="tab" aria-selected={config.kind === k.kind} onClick={() => switchKind(k.kind)}>{k.short}</button>
        ))}
      </div>
      <div style={{ marginTop: '0.7rem' }}>
        {config.kind === 'onoff' && (
          <div className="ll-fields is-3">
            <NumField label="Band" unit="% span" value={config.hyst} min={0} onChange={(v) => onChange({ ...config, hyst: v })} />
            <NumField label="On" unit="%" value={config.outOn} min={0} max={100} onChange={(v) => onChange({ ...config, outOn: v })} />
            <NumField label="Off" unit="%" value={config.outOff} min={0} max={100} onChange={(v) => onChange({ ...config, outOff: v })} />
          </div>
        )}
        {config.kind === 'pid' && <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />}
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

function TuningHelper({ proc, params, config, onChange }: { proc: ProcessDef; params: Params; config: ControllerConfig; onChange: (c: ControllerConfig) => void }) {
  const [pv, setPv] = useState(proc.opPoints[0]);
  const [ruleId, setRuleId] = useState<TuningRuleId>('simc');
  const [type, setType] = useState<ControlType>('PI');
  const [speedFactor, setSpeedFactor] = useState(3);
  useEffect(() => { setPv(proc.opPoints[0]); }, [proc]);
  const rule = getRule(ruleId);
  const types = rule.types;
  const t = types.includes(type) ? type : types[0];
  const model = useMemo(() => {
    try { return tuningModel(proc, params, config, pv); } catch { return null; }
  }, [proc, params, config, pv]);
  const tuneAt = (at: number) => {
    const m = tuningModel(proc, params, config, at);
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
    } else onChange({ ...config, pid: { ...config.pid, ...result } });
  };
  const tuneAll = () => {
    if (config.kind !== 'schedule') return;
    onChange({ ...config, points: config.points.map((p) => ({ ...p, ...(tuneAt(p.at) ?? {}) })) });
  };

  return (
    <details className="ll-tuner" style={{ marginTop: '0.8rem' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem' }}>Tune from the model</summary>
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
          <button className="ll-btn is-small is-primary" onClick={apply}>{config.kind === 'schedule' ? 'Apply at this point' : 'Apply'}</button>
          {config.kind === 'schedule' && <button className="ll-btn is-small" onClick={tuneAll}>Tune every breakpoint</button>}
        </div>
      ) : <p className="ll-note">This rule gives no usable tuning for this model.</p>}
    </details>
  );
}
