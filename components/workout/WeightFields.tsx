'use client';

import { useState } from 'react';
import type { Station } from '@/lib/workout/types';
import { getAdditionalWeights } from '@/lib/workout/equipment';
import { describeWeightRange, formatWeight, weightRange } from '@/lib/workout/station-summary';

// Touch-friendly editors for a station's weights. They edit arrays directly
// (no comma-separated typing) and are shared by the station form and the
// "check every station's weights" screen.

const parse = (text: string) => { const n = parseFloat(text); return Number.isFinite(n) ? n : undefined; };
const sortAsc = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

type NumberFieldProps = {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
};

/** Labelled number box that keeps what you type (e.g. "2.") until it parses. */
export function NumberField({ label, value, onChange, placeholder }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  return (
    <label className="workout-field" style={{ display: 'block' }}>
      <span className="workout-label">{label}</span>
      <input
        className="workout-input"
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }}
      />
    </label>
  );
}

const STANDARD_PLATES = [45, 35, 25, 10, 5, 2.5];

/** Plates available for ONE side, as a − count + stepper per plate size. */
export function PlateCounter({ plates, onChange }: { plates: number[]; onChange: (plates: number[]) => void }) {
  const [custom, setCustom] = useState('');
  const sizes = [...new Set([...STANDARD_PLATES, ...plates])].sort((a, b) => b - a);
  const count = (size: number) => plates.filter((p) => p === size).length;
  const set = (next: number[]) => onChange([...next].sort((a, b) => b - a));
  const add = (size: number) => set([...plates, size]);
  const remove = (size: number) => {
    const i = plates.indexOf(size);
    if (i !== -1) set([...plates.slice(0, i), ...plates.slice(i + 1)]);
  };
  const addCustom = () => {
    const size = parse(custom);
    if (size && size > 0) add(size);
    setCustom('');
  };

  return (
    <div className="workout-field">
      <span className="workout-label">Plates per side</span>
      <div className="workout-plate-grid">
        {sizes.map((size) => {
          const n = count(size);
          return (
            <div key={size} className={`workout-plate${n ? ' has-count' : ''}`}>
              <div className="workout-plate-weight">{formatWeight(size)} <small>lb</small></div>
              <div className="workout-stepper">
                <button type="button" aria-label={`One fewer ${formatWeight(size)} lb plate`} disabled={n === 0} onClick={() => remove(size)}>−</button>
                <output aria-live="polite">{n}</output>
                <button type="button" aria-label={`One more ${formatWeight(size)} lb plate`} disabled={n >= 12} onClick={() => add(size)}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="workout-inline-add">
        <input className="workout-input" inputMode="decimal" placeholder="Other plate size, e.g. 1.25" value={custom}
          onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <button type="button" className="workout-button" disabled={!parse(custom)} onClick={addCustom}>Add</button>
      </div>
    </div>
  );
}

type WeightChipsProps = {
  label: string;
  values: number[];
  onChange: (values: number[]) => void;
  /** Common values offered as one-tap chips. */
  suggestions?: number[];
  placeholder?: string;
  hint?: string;
};

/** A set of weights as removable chips, with quick suggestions and a box to add one. */
export function WeightChips({ label, values, onChange, suggestions = [], placeholder = 'Add a weight', hint }: WeightChipsProps) {
  const [text, setText] = useState('');
  const sorted = sortAsc(values);
  const missing = suggestions.filter((s) => !sorted.includes(s));
  const add = (value: number | undefined) => { if (value && value > 0) onChange(sortAsc([...values, value])); };
  const submit = () => { add(parse(text)); setText(''); };

  return (
    <div className="workout-field">
      <span className="workout-label">{label}</span>
      {sorted.length > 0 ? (
        <div className="workout-chip-list">
          {sorted.map((v) => (
            <span key={v} className="workout-chip-x">
              {formatWeight(v)}
              <button type="button" aria-label={`Remove ${formatWeight(v)}`} onClick={() => onChange(sorted.filter((x) => x !== v))}>✕</button>
            </span>
          ))}
        </div>
      ) : hint ? <div className="workout-hint">{hint}</div> : null}
      {missing.length > 0 && (
        <div className="workout-chip-list" style={{ marginTop: '0.45rem' }}>
          {missing.map((s) => (
            <button key={s} type="button" className="workout-toggle-chip" onClick={() => add(s)}>+ {formatWeight(s)}</button>
          ))}
        </div>
      )}
      <div className="workout-inline-add">
        <input className="workout-input" inputMode="decimal" placeholder={placeholder} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        <button type="button" className="workout-button" disabled={!parse(text)} onClick={submit}>Add</button>
      </div>
    </div>
  );
}

/** Dumbbell pairs: fill a whole rack from a range, then add/remove single pairs. */
export function DumbbellEditor({ pairs, onChange }: { pairs: number[]; onChange: (pairs: number[]) => void }) {
  const sorted = sortAsc(pairs);
  const [from, setFrom] = useState<number | undefined>(sorted[0] ?? 5);
  const [to, setTo] = useState<number | undefined>(sorted[sorted.length - 1] ?? 50);
  const [step, setStep] = useState<number | undefined>(sorted.length > 1 ? sorted[1] - sorted[0] : 5);
  const fill = weightRange(from ?? NaN, to ?? NaN, step ?? NaN);

  return (
    <>
      <div className="workout-preview" style={{ marginTop: 0, marginBottom: '1rem' }}>
        <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Fill the rack</strong>
        <div className="workout-grid-3">
          <NumberField label="From" value={from} onChange={setFrom} />
          <NumberField label="To" value={to} onChange={setTo} />
          <NumberField label="Every" value={step} onChange={setStep} />
        </div>
        <button type="button" className="workout-button is-block" disabled={fill.length === 0} onClick={() => onChange(fill)}>
          {fill.length ? `Use ${fill.length} pairs (${formatWeight(fill[0])}–${formatWeight(fill[fill.length - 1])} lb)` : 'Enter a range'}
        </button>
      </div>
      <WeightChips label="Pairs in this gym (lb)" values={sorted} onChange={onChange} placeholder="Add one pair, e.g. 52.5" hint="None yet — fill the rack above or add pairs one at a time." />
    </>
  );
}

/** The weight settings for whatever type the station is, plus a live preview. */
export function StationWeightFields({ station, onChange }: { station: Partial<Station>; onChange: (patch: Partial<Station>) => void }) {
  return (
    <>
      {station.type === 'plates' && (<>
        <NumberField label="Bar / sled weight (lb)" placeholder="45" value={station.baseWeight} onChange={(baseWeight) => onChange({ baseWeight })} />
        <PlateCounter plates={station.plateSets || []} onChange={(plateSets) => onChange({ plateSets })} />
      </>)}

      {(station.type === 'stack' || station.type === 'cable') && (<>
        <div className="workout-grid-3">
          <NumberField label="Lightest" placeholder="10" value={station.minWeight} onChange={(minWeight) => onChange({ minWeight })} />
          <NumberField label="Heaviest" placeholder="200" value={station.maxWeight} onChange={(maxWeight) => onChange({ maxWeight })} />
          <NumberField label="Step" placeholder="10" value={station.increment} onChange={(increment) => onChange({ increment })} />
        </div>
        <WeightChips
          label="Add-on weights (optional)"
          values={getAdditionalWeights(station)}
          onChange={(additionalWeights) => onChange({ additionalWeights, additionalWeight: undefined })}
          suggestions={[2.5, 5]}
          placeholder="e.g. 2.5"
          hint="Small magnets or pins that sit on top of the stack."
        />
      </>)}

      {station.type === 'dumbbells' && (
        <DumbbellEditor pairs={station.dumbbellPairs || []} onChange={(dumbbellPairs) => onChange({ dumbbellPairs })} />
      )}

      {station.type === 'bodyweight' && (
        <WeightChips
          label="Added weight options (optional)"
          values={station.bodyWeightAdditions || []}
          onChange={(bodyWeightAdditions) => onChange({ bodyWeightAdditions })}
          suggestions={[10, 25, 45]}
          placeholder="e.g. 35"
          hint="Belt or vest weights. Leave empty for bodyweight only."
        />
      )}

      <div className="workout-preview">
        <span className="workout-hint" style={{ display: 'block' }}>The tracker will offer</span>
        <strong>{describeWeightRange(station)}</strong>
      </div>
    </>
  );
}
