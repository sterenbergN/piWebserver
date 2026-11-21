'use client';

import { useEffect, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { foodApi, logChange, type LogResponse } from '@/lib/food/client';
import { MEAL_LABELS, MEALS, type Food, type LogEntry, type Meal } from '@/lib/food/types';
import FoodPicker from './FoodPicker';

/** The entry's own food as a one-serving food, for when the real one can't be had (quick adds, a source gone). */
function foodFromEntry(entry: LogEntry): Food {
  const s = entry.snapshot;
  return {
    id: entry.foodId === 'quick' ? `custom:${entry.id}` : entry.foodId,
    source: s.source === 'quick' ? 'custom' : s.source,
    sourceId: entry.id,
    name: s.name,
    brand: s.brand,
    servings: [{ id: entry.servingId, label: s.servingLabel, grams: s.grams, ml: s.ml, nutrients: s.nutrients }],
  };
}

/** Change an entry's amount, serving or meal, or delete it. */
export default function EntryEditSheet({ entry, date, onChanged, onDelete, onClose }: {
  entry: LogEntry;
  date: string;
  onChanged: (res: LogResponse) => void;
  onDelete: (entry: LogEntry) => void;
  onClose: () => void;
}) {
  const [food, setFood] = useState<Food | null>(null);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    // Quick adds and recipes are only their snapshot: there's no food to fetch.
    if (entry.foodId === 'quick' || entry.snapshot.source === 'recipe') { setFood(foodFromEntry(entry)); return; }
    foodApi<{ food: Food }>(`/api/food/foods?id=${encodeURIComponent(entry.foodId)}`)
      .then((res) => {
        if (!live) return;
        // The entry's serving must be there to edit by it; otherwise edit the amount of what was logged.
        // Its numbers are the ones logged, even if the food has been updated since.
        const s = entry.snapshot;
        setFood(res.food.servings.some((x) => x.id === entry.servingId)
          ? { ...res.food, servings: res.food.servings.map((x) => (x.id === entry.servingId ? { ...x, label: s.servingLabel, nutrients: s.nutrients } : x)) }
          : foodFromEntry(entry));
      })
      .catch(() => live && setFood(foodFromEntry(entry)));
    return () => { live = false; };
  }, [entry]);

  async function save(servingId: string, amount: number) {
    setBusy(true);
    setError('');
    try {
      const res = await logChange({
        type: 'edit', date, id: entry.id, amount, meal,
        ...(servingId !== entry.servingId ? { foodId: entry.foodId, servingId } : {}),
      });
      onChanged(res);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that.');
      setBusy(false);
    }
  }

  return (
    <Sheet title="Edit entry" onClose={onClose}>
      <div className="workout-segmented" role="group" aria-label="Meal" style={{ marginBottom: '0.75rem' }}>
        {MEALS.map((m) => <button key={m} type="button" aria-pressed={meal === m} onClick={() => setMeal(m)}>{MEAL_LABELS[m]}</button>)}
      </div>
      {error && <p className="workout-error" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      {food ? (
        <FoodPicker food={food} servingId={entry.servingId} amount={entry.amount} busy={busy} confirmLabel="Save" onConfirm={(_, s, a) => void save(s, a)} />
      ) : <p className="workout-hint">Loading…</p>}
      <button type="button" className="workout-btn-danger" style={{ width: '100%', marginTop: '0.75rem' }} onClick={() => { onDelete(entry); onClose(); }}>Delete entry</button>
    </Sheet>
  );
}
