'use client';

import { useState } from 'react';
import { foodApi } from '@/lib/food/client';
import { kcalFromMacros } from '@/lib/food/nutrients';
import type { Food } from '@/lib/food/types';

const FIELDS = [
  ['kcal', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['fiber', 'Fiber', 'g'],
  ['sugar', 'Sugar', 'g'],
  ['satFat', 'Sat. fat', 'g'],
  ['sodium', 'Sodium', 'mg'],
] as const;

/**
 * Make a food from its nutrition label. It goes into the shared library, so it's
 * there next time (for everyone) whatever happens to the online sources.
 */
export default function CustomFoodForm({ barcode, initialName = '', onSaved, onBack }: {
  barcode?: string;
  initialName?: string;
  onSaved: (food: Food) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState('');
  const [servingLabel, setServingLabel] = useState('1 serving');
  const [servingSize, setServingSize] = useState('');
  const [unit, setUnit] = useState<'g' | 'ml'>('g');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const num = (k: string) => (values[k]?.trim() ? Number(values[k].replace(',', '.')) : undefined);
  const macros = kcalFromMacros({ protein: num('protein') ?? 0, carbs: num('carbs') ?? 0, fat: num('fat') ?? 0 });
  const kcal = num('kcal');
  // Labels round, but a big gap usually means a typo (or calories per 100 g against macros per serving).
  const mismatch = kcal !== undefined && macros > 20 && Math.abs(kcal - macros) / Math.max(kcal, macros) > 0.25;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const nutrients = Object.fromEntries(FIELDS.map(([k]) => [k, num(k)]).filter(([, v]) => v !== undefined && Number.isFinite(v)));
      const res = await foodApi<{ food: Food }>('/api/food/foods', {
        json: { action: 'custom', food: { name, brand, barcode, servingLabel, servingSize: servingSize ? Number(servingSize) : undefined, unit, nutrients } },
      });
      onSaved(res.food);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that food.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <button type="button" className="workout-text-btn food-back" onClick={onBack}>‹ Back</button>
      <p className="workout-hint" style={{ marginTop: 0 }}>Copy it from the Nutrition Facts label, per serving.{barcode ? ` Barcode ${barcode} is saved with it.` : ''}</p>
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Name</span>
        <input className="workout-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Brand (optional)</span>
        <input className="workout-input" value={brand} maxLength={80} onChange={(e) => setBrand(e.target.value)} />
      </label>
      <div className="workout-grid-2 workout-field">
        <label>
          <span className="workout-label">Serving</span>
          <input className="workout-input" value={servingLabel} maxLength={60} placeholder="1 bar" onChange={(e) => setServingLabel(e.target.value)} />
        </label>
        <label>
          <span className="workout-label">Serving size (optional)</span>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <input className="workout-input" inputMode="decimal" value={servingSize} placeholder="40" onChange={(e) => setServingSize(e.target.value)} />
            <select className="workout-input" style={{ width: '4.5rem' }} value={unit} onChange={(e) => setUnit(e.target.value as 'g' | 'ml')} aria-label="Unit">
              <option value="g">g</option>
              <option value="ml">ml</option>
            </select>
          </div>
        </label>
      </div>
      <div className="workout-grid-2">
        {FIELDS.map(([k, label, u]) => (
          <label key={k} className="workout-field" style={{ display: 'block', marginBottom: '0.5rem' }}>
            <span className="workout-label">{label} ({u}){k === 'kcal' ? ' *' : ''}</span>
            <input className="workout-input" inputMode="decimal" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} required={k === 'kcal'} />
          </label>
        ))}
      </div>
      {mismatch && <p className="workout-hint" style={{ color: 'var(--warning)' }}>Those macros add up to about {Math.round(macros)} kcal. Check the numbers are all per serving.</p>}
      <p className="workout-hint">With a serving size, you can also log it by weight.</p>
      {error && <p className="workout-error">{error}</p>}
      <button type="submit" className="workout-btn-primary" disabled={busy || !name.trim() || kcal === undefined}>{busy ? 'Saving…' : 'Save food'}</button>
    </form>
  );
}
