'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CONTROLLER_KINDS, defaultController, defaultInnerFeedforward, isAvailable,
  type ControllerConfig, type ControllerKind, type FeedforwardTerm, type PidParams, type SchedulePoint, type SmithModel,
} from '@/lib/loop-lab/controllers';
import { cleanParams, defaultParams, measuredDisturbances, type ParamGroup, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { designMpc, mimoModel, rga11, steadyGains } from '@/lib/loop-lab/multivar';
import { designStateFb } from '@/lib/loop-lab/statespace';
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
  smith: 'A PID that sees a prediction of the measurement, with the dead time taken out.',
  override: 'A normal controller and a limit controller on one valve; the higher (or lower) output wins.',
  ratio: 'The controlled flow follows the wild flow at a set ratio, trimmed by the main measurement.',
  statefb: 'Every state of the plant, estimated by an observer from the measurements, fed back with its own gain.',
  multiloop: 'A PID on each variable, each with its own valve, and optionally a decoupler between them.',
  mpc: 'Plans both valves a few moves ahead from a model, within their limits, and re-plans every cycle.',
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
    // Carry the PID settings across where both have them (a cascade master is tuned in other units, and a
    // Smith predictor's PID for a process without dead time, so those keep their own).
    const prev = config.kind === 'onoff' || config.kind === 'cascade' || config.kind === 'ratio' || config.kind === 'smith' || config.kind === 'statefb' || config.kind === 'mpc' ? null : config.pid;
    if (prev && next.kind !== 'onoff' && next.kind !== 'cascade' && next.kind !== 'ratio' && next.kind !== 'smith' && next.kind !== 'statefb' && next.kind !== 'mpc') next.pid = { ...prev };
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
            <FeedforwardEditor proc={proc} params={params} config={config} terms={config.ff} target="the valve output" onChange={(ff) => onChange({ ...config, ff })} />
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
            <FeedforwardEditor proc={proc} params={params} config={config} terms={config.ff} target={`the ${proc.secondary.label.toLowerCase()} setpoint's span`}
              onChange={(ff) => onChange({ ...config, ff })} suggest={defaultInnerFeedforward(proc)} />
          </>
        )}
        {config.kind === 'smith' && (
          <>
            <div className="ll-sub">The PID (for the process without its dead time)</div>
            <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />
            <div className="ll-sub">The model inside the predictor</div>
            <SmithModelEditor proc={proc} params={params} model={config.model} pid={config.pid} onChange={(model) => onChange({ ...config, model })} />
          </>
        )}
        {config.kind === 'override' && <OverrideFields proc={proc} config={config} onChange={onChange} />}
        {config.kind === 'ratio' && <RatioFields proc={proc} config={config} onChange={onChange} />}
        {config.kind === 'statefb' && <StateFbFields proc={proc} params={params} config={config} onChange={onChange} />}
        {config.kind === 'multiloop' && <MultiloopFields proc={proc} params={params} config={config} onChange={onChange} />}
        {config.kind === 'mpc' && <MpcFields proc={proc} params={params} config={config} onChange={onChange} />}
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
      {config.kind !== 'onoff' && config.kind !== 'statefb' && config.kind !== 'multiloop' && config.kind !== 'mpc' && <TuningHelper proc={proc} params={params} config={config} onChange={onChange} />}
    </div>
  );
}

/** Feedforward terms: one per measured disturbance, each a gain and a lead-lag, with a design-from-the-model button. */
function FeedforwardEditor({ proc, params, config, terms, target, onChange, suggest }: {
  proc: ProcessDef; params: Params; config: ControllerConfig; terms: FeedforwardTerm[];
  /** What the feedforward adds to, for the gain's unit ("the valve output"). */
  target: string;
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
    // A lead and lag this close cancel each other: a plain gain does the same, more simply.
    const cancel = r.lead > 0 && r.lag > 0 && Math.abs(r.lead - r.lag) <= 0.15 * Math.max(r.lead, r.lag);
    set(i, cancel ? { gain: round(r.gain), lead: 0, lag: 0 } : { gain: round(r.gain), lead: round(r.lead), lag: round(r.lag) });
    setNotes({
      ...notes,
      [t.from]: `From the model: valve → PV K ${round(r.u.K)}, τ ${round(r.u.tau)} s, θ ${round(r.u.theta)} s; disturbance → PV K ${round(r.d.K)}, τ ${round(r.d.tau)} s, θ ${round(r.d.theta)} s.`
        + (cancel ? ` The two time constants are nearly equal (${round(r.lead)} and ${round(r.lag)} s), so the lead-lag would cancel itself: a static gain does the job.` : '')
        + (r.note ? ` ${r.note}` : ''),
    });
  };
  return (
    <div>
      {!terms.length && <p className="ll-note" style={{ marginTop: 0 }}>None yet: feedback only.</p>}
      {terms.map((t, i) => {
        const d = proc.disturbances.find((x) => x.key === t.from);
        return (
          <div key={t.from} className="ll-ff-term">
            <div className="ll-ff-head">
              <strong>{d?.label}</strong>
              <button className="ll-link" aria-label={`Remove feedforward from ${d?.label}`} title="Remove" onClick={() => onChange(terms.filter((_, j) => j !== i))}>✕</button>
            </div>
            <div className="ll-ff-head">
              <span className="ll-small">measured by {d?.measured}</span>
              <button className="ll-link" onClick={() => design(i)}>✨ Design from model</button>
            </div>
            <div className="ll-fields is-3">
              <NumField label="Gain" unit={gainUnit(d?.unit ?? '')} value={t.gain} onChange={(v) => set(i, { gain: v })}
                title={`Added to ${target}, in %, per ${d?.unit ?? 'unit'} the ${d?.label.toLowerCase() ?? 'disturbance'} changes`} />
              <NumField label="Lead" unit="s" value={t.lead} min={0} onChange={(v) => set(i, { lead: v })} />
              <NumField label="Lag" unit="s" value={t.lag} min={0} onChange={(v) => set(i, { lag: v })} />
            </div>
            <p className="ll-note" style={{ marginTop: '0.3rem' }}>
              {notes[t.from] ?? `Gain: % of ${target} per ${d?.unit}. Lead and lag shape the timing; 0 and 0 is a plain gain.`}
            </p>
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

/** Override: the normal controller, then the limit controller, its measurement, limit and selector. */
function OverrideFields({ proc, config, onChange }: { proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'override' }>; onChange: (c: ControllerConfig) => void }) {
  const on = config.on === 'pv2' && proc.secondary ? proc.secondary : proc.pv;
  return (
    <>
      <div className="ll-sub">Normal: {proc.tags.loop} ({proc.pv.label.toLowerCase()})</div>
      <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />
      <div className="ll-sub">Override: the limit</div>
      <div className="ll-fields is-3">
        {proc.secondary && (
          <label className="ll-field">
            <span>On</span>
            <select value={config.on} onChange={(e) => {
              const v = e.target.value === 'pv2' ? 'pv2' : 'pv';
              const range = v === 'pv2' ? proc.secondary! : proc.pv;
              onChange({ ...config, on: v, limit: range.lo + 0.8 * (range.hi - range.lo) });
            }}>
              <option value="pv">{proc.pv.label}</option>
              <option value="pv2">{proc.secondary.label}</option>
            </select>
          </label>
        )}
        <NumField label="Limit" unit={on.unit} value={config.limit} min={on.lo} max={on.hi} onChange={(limit) => onChange({ ...config, limit })}
          title="The override controller's setpoint: the value it holds once it has the valve" />
        <label className="ll-field">
          <span>Selector</span>
          <select value={config.select} onChange={(e) => onChange({ ...config, select: e.target.value === 'min' ? 'min' : 'max' })}>
            <option value="max">High (MAX)</option>
            <option value="min">Low (MIN)</option>
          </select>
        </label>
      </div>
      <label className="ll-check" style={{ marginTop: '0.4rem' }}>
        <input type="checkbox" checked={config.tracking} onChange={(e) => onChange({ ...config, tracking: e.target.checked })} />
        Tracking (external reset): the controller not in charge follows the valve
      </label>
      <div className="ll-sub">Override controller</div>
      <PidFields pid={config.ovr} onChange={(ovr) => onChange({ ...config, ovr })} />
      <p className="ll-note" style={{ marginTop: '0.3rem' }}>
        {config.select === 'max' ? 'The higher' : 'The lower'} of the two outputs drives the valve. Pick the selector so the override wins exactly when {on.label.toLowerCase()} is past its limit.
      </p>
    </>
  );
}

/** Ratio: fixed or trimmed, the trim's range, and the two controllers. */
function RatioFields({ proc, config, onChange }: { proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'ratio' }>; onChange: (c: ControllerConfig) => void }) {
  const sec = proc.secondary!;
  const wild = proc.disturbances.find((d) => d.key === proc.ratio?.from);
  return (
    <>
      <p className="ll-note" style={{ marginTop: 0 }}>
        {sec.loopTag} setpoint = R × {wild?.label.toLowerCase()} ({wild?.measured}). R is {sec.label.toLowerCase()} per {wild?.label.toLowerCase()}, both in {sec.unit}.
      </p>
      <label className="ll-check">
        <input type="checkbox" checked={config.trim} onChange={(e) => onChange({ ...config, trim: e.target.checked })} />
        Trim the ratio from {proc.tags.transmitter} ({proc.pv.label.toLowerCase()})
      </label>
      {config.trim ? (
        <>
          <div className="ll-fields is-3" style={{ marginTop: '0.4rem' }}>
            <NumField label="R at 0 %" value={config.rLo} min={0} onChange={(rLo) => onChange({ ...config, rLo: Math.min(rLo, config.rHi - 1e-3) })} title="Ratio when the trim's output is 0 %" />
            <NumField label="R at 100 %" value={config.rHi} min={0} onChange={(rHi) => onChange({ ...config, rHi: Math.max(rHi, config.rLo + 1e-3) })} title="Ratio when the trim's output is 100 %" />
          </div>
          <div className="ll-sub">Trim: {proc.tags.loop} ({proc.pv.label.toLowerCase()})</div>
          <PidFields pid={config.outer} onChange={(outer) => onChange({ ...config, outer })} />
        </>
      ) : (
        <div className="ll-fields is-3" style={{ marginTop: '0.4rem' }}>
          <NumField label="Ratio R" value={config.ratio} min={0} onChange={(ratio) => onChange({ ...config, ratio })} title="From the recipe: the mass balance" />
        </div>
      )}
      <div className="ll-sub">Flow loop: {sec.loopTag} ({sec.label.toLowerCase()})</div>
      <PidFields pid={config.inner} onChange={(inner) => onChange({ ...config, inner })} />
    </>
  );
}

const poleText = (p: { re: number; im: number }) => (Math.abs(p.im) < 1e-6 * Math.max(1, Math.abs(p.re)) ? fmt(p.re, 3) : `${fmt(p.re, 3)} ± ${fmt(Math.abs(p.im), 3)}j`);
/** Each pole once (a pair shown as ±), slowest first. */
const uniquePoles = (ps: { re: number; im: number }[]) => ps.filter((p) => p.im >= -1e-9).sort((a, b) => Math.hypot(a.re, a.im) - Math.hypot(b.re, b.im));

/** State feedback: how K is designed, how offset is removed, the observer, what it measures, and what came out. */
function StateFbFields({ proc, params, config, onChange }: { proc: ProcessDef; params: Params; config: Extract<ControllerConfig, { kind: 'statefb' }>; onChange: (c: ControllerConfig) => void }) {
  const des = useMemo(() => designStateFb(proc, config, cleanParams(proc, params)), [proc, config, params]);
  const sec = proc.secondary;
  const set = <K extends keyof typeof config>(k: K) => (v: (typeof config)[K]) => onChange({ ...config, [k]: v });
  return (
    <>
      <div className="ll-fields is-3">
        <label className="ll-field">
          <span>Gains from</span>
          <select value={config.design} onChange={(e) => set('design')(e.target.value === 'lqr' ? 'lqr' : 'poles')}>
            <option value="poles">Pole placement</option>
            <option value="lqr">LQR (weights)</option>
          </select>
        </label>
        <label className="ll-field">
          <span>No offset by</span>
          <select value={config.integral} onChange={(e) => set('integral')(e.target.value as typeof config.integral)}>
            <option value="dist">Estimating the upset</option>
            <option value="error">Integral of the error</option>
            <option value="none">Nothing</option>
          </select>
        </label>
        {sec && (
          <label className="ll-field">
            <span>Measures</span>
            <select value={config.measure} onChange={(e) => set('measure')(e.target.value as typeof config.measure)}>
              <option value="both">{proc.tags.transmitter} + {sec.tag}</option>
              <option value="pv">{proc.tags.transmitter} only</option>
              <option value="pv2">{sec.tag} only</option>
            </select>
          </label>
        )}
      </div>
      {config.design === 'poles' ? (
        <div className="ll-fields is-3" style={{ marginTop: '0.5rem' }}>
          <NumField label="ω_n" unit="rad/s" value={config.wn} min={1e-4} onChange={set('wn')} title="Natural frequency of the dominant pole pair: how fast the closed loop is" />
          <NumField label="ζ" value={config.zeta} min={0.1} max={3} step={0.05} onChange={set('zeta')} title="Damping of the dominant pair (0.7–1: little or no overshoot)" />
        </div>
      ) : (
        <div className="ll-fields is-3" style={{ marginTop: '0.5rem' }}>
          <NumField label="q_y" value={config.qy} min={0} onChange={set('qy')} title={`Weight on ${proc.pv.label.toLowerCase()} error (per % of span, squared), against 1 on the output (per %, squared)`} />
          {sec && <NumField label="q₂" value={config.q2} min={0} onChange={set('q2')} title={`Weight on ${sec.label.toLowerCase()} (per % of its span, squared)`} />}
          {config.integral === 'error' && <NumField label="q_i" value={config.qi} min={0} onChange={set('qi')} title="Weight on the integral of the error: bigger removes offset faster and overshoots more" />}
        </div>
      )}
      <div className="ll-fields is-3" style={{ marginTop: '0.5rem' }}>
        <label className="ll-field">
          <span>Observer</span>
          <select value={config.observer} onChange={(e) => set('observer')(e.target.value === 'poles' ? 'poles' : 'kalman')}>
            <option value="kalman">Kalman filter</option>
            <option value="poles">Pole placement</option>
          </select>
        </label>
        {config.observer === 'kalman'
          ? <NumField label="Upsets" value={config.qw} min={1e-4} onChange={set('qw')} title="How much the filter expects the plant to be pushed around, against the transmitter noise: bigger trusts the measurement more, follows faster and passes more noise" />
          : <NumField label="Speed" unit="× regulator" value={config.obsSpeed} min={1} max={20} step={0.5} onChange={set('obsSpeed')} title="Observer poles at this multiple of the regulator's" />}
      </div>
      <div className="ll-sub">What came out</div>
      {des.ok ? (
        <>
          <div className="ll-table-wrap">
            <table className="ll-table">
              <thead><tr><th style={{ textAlign: 'left' }}>Estimated state</th><th>Gain</th></tr></thead>
              <tbody>
                {des.states.map((st, i) => (
                  <tr key={st}><td style={{ textAlign: 'left' }}>{st} <span className="ll-small">({des.units[i]})</span></td><td>{fmt(i < des.n ? -des.K[i] : des.ctrl.C[i], 3)}</td></tr>
                ))}
                <tr><td style={{ textAlign: 'left' }}>Setpoint (N_r)</td><td>{fmt(des.Nr, 3)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="ll-note" style={{ marginTop: '0.3rem' }}>
            Output change, %, per unit of each estimate, away from the design point ({fmt(proc.nominalPv, 3)} {proc.pv.unit}).
            Closed-loop poles: {uniquePoles(des.poles).map(poleText).join(', ')} rad/s. Observer: {uniquePoles(des.obsPoles).map(poleText).join(', ')} rad/s.
          </p>
        </>
      ) : <p className="ll-note">⚠️ {des.error}</p>}
    </>
  );
}

/** Two loops: the pairing (with the relative gain that judges it), the decoupler, and the two PIDs. */
function MultiloopFields({ proc, params, config, onChange }: { proc: ProcessDef; params: Params; config: Extract<ControllerConfig, { kind: 'multiloop' }>; onChange: (c: ControllerConfig) => void }) {
  const sec = proc.secondary!, mimo = proc.mimo!;
  const rgas = useMemo(() => proc.opPoints.map((at) => {
    const { m, B2 } = mimoModel(proc, cleanParams(proc, params), at);
    return { at, lam: rga11(steadyGains(m, B2)) };
  }), [proc, params]);
  const direct = config.pairing === 'direct';
  const v1 = direct ? proc.tags.valve : mimo.valve, v2 = direct ? mimo.valve : proc.tags.valve;
  return (
    <>
      <div className="ll-fields is-3">
        <label className="ll-field is-wide">
          <span>Pairing</span>
          <select value={config.pairing} onChange={(e) => onChange({ ...config, pairing: e.target.value === 'crossed' ? 'crossed' : 'direct' })}>
            <option value="direct">{proc.pv.label} ← {proc.tags.valve}, {sec.label.toLowerCase()} ← {mimo.valve}</option>
            <option value="crossed">{proc.pv.label} ← {mimo.valve}, {sec.label.toLowerCase()} ← {proc.tags.valve}</option>
          </select>
        </label>
      </div>
      <p className="ll-note" style={{ marginTop: '0.3rem' }}>
        Relative gain for this pairing: {rgas.map((r) => `${fmt(direct ? r.lam : 1 - r.lam, 2)} at ${fmt(r.at, 3)} ${proc.pv.unit}`).join(', ')}.
        Near 1 the loops hardly notice each other; towards 0.5 they fight; below 0.5 the other pairing is better.
      </p>
      <label className="ll-check">
        <input type="checkbox" checked={config.decouple} onChange={(e) => onChange({ ...config, decouple: e.target.checked })} />
        Static decoupler: each loop also moves the other valve, to cancel its steady effect on the other variable
      </label>
      <div className="ll-sub">{proc.tags.loop}: {proc.pv.label.toLowerCase()} → {v1}</div>
      <PidFields pid={config.pid} onChange={(pid) => onChange({ ...config, pid })} />
      <div className="ll-sub">{mimo.loop2}: {sec.label.toLowerCase()} → {v2}</div>
      <PidFields pid={config.pid2} onChange={(pid2) => onChange({ ...config, pid2 })} />
    </>
  );
}

/** MPC: horizon, moves, weights and the observer, and what the design point looks like. */
function MpcFields({ proc, params, config, onChange }: { proc: ProcessDef; params: Params; config: Extract<ControllerConfig, { kind: 'mpc' }>; onChange: (c: ControllerConfig) => void }) {
  const sec = proc.secondary!;
  const p = cleanParams(proc, params);
  const des = useMemo(() => designMpc(proc, config, p), [proc, config, p]);
  const set = <K extends keyof typeof config>(k: K) => (v: (typeof config)[K]) => onChange({ ...config, [k]: v });
  return (
    <>
      <div className="ll-fields is-3">
        <NumField label="Horizon P" unit={`× ${fmt(p.Ts, 3)} s`} value={config.P} min={5} max={300} step={1} onChange={(v) => set('P')(Math.round(v))}
          title="How many cycles ahead it predicts: long enough to see where each move leads" />
        <NumField label="Moves M" value={config.M} min={1} max={20} step={1} onChange={(v) => set('M')(Math.round(Math.min(v, config.P)))}
          title="How many moves of each valve it plans; after that it assumes they stay put" />
        <NumField label="Move weight r" value={config.r} min={1e-6} onChange={set('r')} title="Cost of moving a valve 1 %, against 1 % of error: bigger = gentler" />
        <NumField label={`q ${proc.pv.label.toLowerCase()}`} value={config.q1} min={0} onChange={set('q1')} title={`Weight on ${proc.pv.label.toLowerCase()} error, per % of span (squared)`} />
        <NumField label={`q ${sec.label.toLowerCase()}`} value={config.q2} min={0} onChange={set('q2')} title={`Weight on ${sec.label.toLowerCase()} error, per % of span (squared)`} />
        <NumField label="Upsets" value={config.qw} min={1e-4} onChange={set('qw')} title="Kalman filter: how much it expects the loads at the valves to move, against the transmitter noise" />
      </div>
      <p className="ll-note" style={{ marginTop: '0.3rem' }}>
        {des.ok
          ? `Plans ${config.M} moves of both valves over ${fmt(config.P * p.Ts, 3)} s, within 0–100 %, ${des.lo.length} numbers per cycle. No pairing: it moves both valves together (λ₁₁ is ${fmt(des.lambda, 2)} here, for comparison).`
          : `⚠️ ${des.error}`}
      </p>
    </>
  );
}

/** The Smith predictor's process model, with a button to copy it from the plant's step response. */
function SmithModelEditor({ proc, params, model, pid, onChange }: {
  proc: ProcessDef; params: Params; model: SmithModel; pid: PidParams; onChange: (m: SmithModel) => void;
}) {
  const [note, setNote] = useState('');
  const fill = () => {
    const m = tuningModel(proc, params, { kind: 'pid', pid }, proc.nominalPv);
    const round = (v: number) => Number(v.toPrecision(3));
    onChange({ K: round((m.negative ? -1 : 1) * m.K), tau: round(m.tau), theta: round(m.theta) });
    setNote(m.integrating
      ? 'The plant integrates: a first-order model only matches it for a while. Smith predictors on integrating plants need a modified structure.'
      : `From the plant at ${fmt(proc.nominalPv, 3)} ${proc.pv.unit}. Change the plant (or the dead time here) to see what a wrong model does.`);
  };
  const set = (k: keyof SmithModel) => (v: number) => onChange({ ...model, [k]: v });
  return (
    <div>
      <div className="ll-fields is-3">
        <NumField label="Gain K" unit="%/%" value={model.K} onChange={set('K')} title="% of span the measurement moves per % of output, in the end" />
        <NumField label="Lag τ" unit="s" value={model.tau} min={0.01} onChange={set('tau')} title="Time constant of the process without its dead time" />
        <NumField label="Dead time θ" unit="s" value={model.theta} min={0} onChange={set('theta')} title="The whole dead time the loop sees, half a controller cycle included" />
      </div>
      <div className="ll-ff-head" style={{ marginTop: '0.3rem' }}>
        <span className="ll-small">K·e<sup>−θs</sup>/(τs + 1), from output to measurement.</span>
        <button className="ll-link" onClick={fill}>✨ Fill from the plant</button>
      </div>
      {note && <p className="ll-note" style={{ marginTop: '0.3rem' }}>{note}</p>}
    </div>
  );
}

/** "%/°C", or "%/(m³/h)" when the unit is itself a ratio. */
const gainUnit = (u: string) => `%/${u.includes('/') ? `(${u})` : u}`;

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
      <span className="ll-small">{note || (config.kind === 'mpc' ? 'A horizon from the plant’s slowest response, to start from. MPC has no tuning rule: then the weights.' : config.kind === 'multiloop' ? 'SIMC on each pair with the other loop open, and the relative gain for the pairing.' : config.kind === 'statefb' ? 'The fastest design that keeps the loop robust (Ms ≤ 1.6) at the design point. Then adjust by hand and compare.' : 'A robust starting point (SIMC) from the process model. Then adjust by hand and compare.')}</span>
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
  const loop: TuningLoop = config.kind === 'cascade' || config.kind === 'ratio' ? loopSel : 'main';
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
    if (!result || config.kind === 'onoff' || config.kind === 'statefb' || config.kind === 'multiloop' || config.kind === 'mpc') return;
    if (config.kind === 'schedule') {
      const i = config.points.findIndex((p) => Math.abs(p.at - pv) < 1e-9);
      const points = i >= 0
        ? config.points.map((p, j) => (j === i ? { ...p, ...result } : p))
        : [...config.points, { at: pv, ...result }].sort((a, b) => a.at - b.at);
      onChange({ ...config, points });
    } else if (config.kind === 'cascade' || config.kind === 'ratio') {
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
      {(config.kind === 'cascade' || config.kind === 'ratio') && (
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
          {config.kind === 'smith' && <> · what the PID sees: the predictor takes its model&apos;s {fmt(config.model.theta, 3)} s of dead time out (any error in it stays)</>}
        </p>
      )}
      <div className="ll-seg" style={{ marginTop: '0.5rem' }} role="group" aria-label="Controller type">
        {(['P', 'PI', 'PID'] as ControlType[]).map((k) => (
          <button key={k} aria-pressed={t === k} disabled={!types.includes(k)} onClick={() => setType(k)}>{k}</button>
        ))}
      </div>
      {rule.usesSpeed && model && (
        <label className="ll-field" style={{ marginTop: '0.5rem' }}>
          <span>{ruleId === 'simc' ? 'τc' : 'λ'} = {fmt(speedFactor, 2)} × θ = {fmt(model.theta * speedFactor, 3)} s<em>{speedFactor <= 1 ? 'fast' : speedFactor >= 10 ? 'smooth' : ''}</em></span>
          <input type="range" min={-1} max={Math.log2(ruleId === 'averaging' ? 2000 : 200)} step={0.05} value={Math.log2(speedFactor)} onChange={(e) => setSpeedFactor(2 ** Number(e.target.value))} />
        </label>
      )}
      <p className="ll-note">{rule.assumptions}</p>
      {result ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.88rem' }}>
            Kc {fmt(result.Kc, 3)} · Ti {result.Ti ? `${fmt(result.Ti, 3)} s` : 'off'} · Td {result.Td ? `${fmt(result.Td, 3)} s` : 'off'}
          </span>
          <button className="ll-btn is-small is-primary" onClick={apply}>{config.kind === 'schedule' ? 'Apply at this point' : config.kind === 'cascade' || config.kind === 'ratio' ? `Apply to the ${loop === 'inner' ? 'slave' : 'master'}` : config.kind === 'override' ? 'Apply to the normal controller' : 'Apply'}</button>
          {config.kind === 'schedule' && <button className="ll-btn is-small" onClick={tuneAll}>Tune every breakpoint</button>}
        </div>
      ) : <p className="ll-note">This rule gives no usable tuning for this model.</p>}
    </details>
  );
}
