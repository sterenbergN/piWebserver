'use client';

import { useEffect, useMemo, useState } from 'react';
import StepperInput from '@/components/workout/StepperInput';
import { amountLabel, foodApi, fmt } from '@/lib/food/client';
import { roundNutrients, scaleNutrients } from '@/lib/food/nutrients';
import { SOURCE_LABELS, type Food, type Serving } from '@/lib/food/types';

/** Servings measured in single grams or millilitres step in tens; the rest in quarters. */
const isUnitServing = (s?: Serving) => s?.grams === 1 || s?.ml === 1;

/**
 * Choose a serving and how many, see what it comes to, and confirm. A partial
 * search result (FatSecret Basic) is fetched in full first.
 */
export default function FoodPicker({ food: initial, servingId: initialServing, amount: initialAmount = 1, confirmLabel, busy, onConfirm, onBack }: {
  food: Food;
  servingId?: string;
  amount?: number;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (food: Food, servingId: string, amount: number) => void;
  onBack?: () => void;
}) {
  const [food, setFood] = useState(initial);
  const [loading, setLoading] = useState(!!initial.partial);
  const [error, setError] = useState('');
  const [servingId, setServingId] = useState(initialServing ?? initial.servings[0]?.id ?? '');
  const [amount, setAmount] = useState(initialAmount);

  useEffect(() => {
    if (!initial.partial) return;
    let live = true;
    foodApi<{ food: Food }>(`/api/food/foods?id=${encodeURIComponent(initial.id)}`)
      .then((res) => {
        if (!live) return;
        setFood(res.food);
        setServingId((current) => (res.food.servings.some((s) => s.id === current) ? current : res.food.servings[0]?.id ?? ''));
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t load that food.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [initial]);

  const serving = food.servings.find((s) => s.id === servingId) ?? food.servings[0];
  const unit = isUnitServing(serving);
  const total = useMemo(() => (serving ? roundNutrients(scaleNutrients(serving.nutrients, amount)) : null), [serving, amount]);
  const chips = unit ? [50, 100, 150, 200, 250] : [0.5, 1, 1.5, 2, 3];

  const changeServing = (id: string) => {
    const next = food.servings.find((s) => s.id === id);
    // Switching between "1 g" and "1 cup" keeps roughly the same amount of food.
    if (next && serving) {
      const fromWeight = (serving.grams ?? serving.ml ?? 0) * amount;
      const perNext = next.grams ?? next.ml ?? 0;
      if (fromWeight > 0 && perNext > 0) setAmount(Math.max(0.25, Math.round((fromWeight / perNext) * (isUnitServing(next) ? 1 : 4)) / (isUnitServing(next) ? 1 : 4)));
      else if (isUnitServing(next) !== unit) setAmount(isUnitServing(next) ? 100 : 1);
    }
    setServingId(id);
  };

  return (
    <div>
      {onBack && <button type="button" className="workout-text-btn food-back" onClick={onBack}>‹ Back</button>}
      <h3 style={{ margin: '0 0 0.15rem', fontSize: '1.1rem' }}>{food.name}</h3>
      <p className="workout-hint" style={{ margin: 0 }}>
        {food.brand ? `${food.brand} · ` : ''}{SOURCE_LABELS[food.source]}{food.category ? ` · ${food.category}` : ''}
      </p>
      {loading && <p className="workout-hint">Loading servings…</p>}
      {error && <p className="workout-error">{error}</p>}
      {total && (
        <div className="food-picker-nutrients" aria-live="polite">
          <div><strong>{fmt(total.kcal)}</strong><span>kcal</span></div>
          <div><strong>{Math.round(total.protein)}</strong><span>protein g</span></div>
          <div><strong>{Math.round(total.carbs)}</strong><span>carbs g</span></div>
          <div><strong>{Math.round(total.fat)}</strong><span>fat g</span></div>
        </div>
      )}
      {total && (total.fiber !== undefined || total.sugar !== undefined || total.sodium !== undefined) && (
        <p className="food-extra">
          {[total.fiber !== undefined && `Fiber ${total.fiber} g`, total.sugar !== undefined && `Sugar ${total.sugar} g`, total.sodium !== undefined && `Sodium ${fmt(total.sodium)} mg`, total.satFat !== undefined && `Sat. fat ${total.satFat} g`].filter(Boolean).join(' · ')}
        </p>
      )}
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Serving</span>
        <select className="workout-input" value={serving?.id ?? ''} onChange={(e) => changeServing(e.target.value)} disabled={loading}>
          {food.servings.map((s) => <option key={s.id} value={s.id}>{s.label} — {fmt(s.nutrients.kcal)} kcal</option>)}
        </select>
      </label>
      <StepperInput
        label={unit ? (serving?.grams ? 'Grams' : 'Millilitres') : 'Servings'}
        value={amount}
        decimal
        onChange={(v) => setAmount(v > 0 ? v : amount)}
        onStep={(d) => setAmount((a) => Math.max(unit ? 5 : 0.25, Math.round((a + d * (unit ? 10 : 0.25)) * 100) / 100))}
      />
      <div className="food-amount-chips" role="group" aria-label="Common amounts">
        {chips.map((c) => <button key={c} type="button" aria-pressed={amount === c} onClick={() => setAmount(c)}>{c}{unit ? (serving?.grams ? ' g' : ' ml') : '×'}</button>)}
      </div>
      {serving && <p className="workout-hint" style={{ marginTop: '-0.4rem' }}>{amountLabel(amount, serving.label)}</p>}
      <button type="button" className="workout-btn-primary" disabled={busy || loading || !serving || !(amount > 0)} onClick={() => serving && onConfirm(food, serving.id, amount)}>
        {busy ? 'Saving…' : confirmLabel}
      </button>
    </div>
  );
}
