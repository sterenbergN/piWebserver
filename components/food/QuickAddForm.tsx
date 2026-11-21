'use client';

import { useState } from 'react';

/** Calories (and macros if you know them) without picking a food: a restaurant meal, a guess. */
export default function QuickAddForm({ busy, onAdd, onBack }: {
  busy: boolean;
  onAdd: (entry: { name: string; nutrients: { kcal: number; protein?: number; carbs?: number; fat?: number } }) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const n = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : undefined);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const k = n(kcal);
      if (!k || k <= 0) return;
      onAdd({ name: name.trim(), nutrients: { kcal: k, protein: n(protein), carbs: n(carbs), fat: n(fat) } });
    }}>
      <button type="button" className="workout-text-btn food-back" onClick={onBack}>‹ Back</button>
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Calories</span>
        <input className="workout-input" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} required autoFocus placeholder="650" />
      </label>
      <div className="workout-grid-3 workout-field">
        <label><span className="workout-label">Protein g</span><input className="workout-input" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
        <label><span className="workout-label">Carbs g</span><input className="workout-input" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></label>
        <label><span className="workout-label">Fat g</span><input className="workout-input" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></label>
      </div>
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">What was it? (optional)</span>
        <input className="workout-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Quick add" />
      </label>
      <button type="submit" className="workout-btn-primary" disabled={busy || !(Number(kcal) > 0)}>{busy ? 'Adding…' : 'Add calories'}</button>
    </form>
  );
}
