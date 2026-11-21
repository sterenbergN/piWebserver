'use client';

import { useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { fmt, foodApi, type PlanInfo } from '@/lib/food/client';
import { KCAL_SOURCE_LABELS, type Targets } from '@/lib/food/targets';
import type { FoodSettings } from '@/lib/food/types';

const str = (n: number | undefined) => (n === undefined ? '' : String(n));

/**
 * Targets. Left blank, calories follow the weight plan (Calculators) and protein
 * follows your latest weigh-in, so they move as the plan and your weight do.
 */
export default function FoodSettingsSheet({ settings, targets, plan, latestWeight, onSaved, onClose }: {
  settings: FoodSettings;
  targets: Targets;
  plan: PlanInfo;
  latestWeight: number | null;
  onSaved: (settings: FoodSettings) => void;
  onClose: () => void;
}) {
  const [kcal, setKcal] = useState(str(settings.kcalTarget));
  const [protein, setProtein] = useState(str(settings.proteinTarget));
  const [carbs, setCarbs] = useState(str(settings.carbsTarget));
  const [fat, setFat] = useState(str(settings.fatTarget));
  const [perLb, setPerLb] = useState(String(settings.proteinPerLb));
  const [planTarget, setPlanTarget] = useState(settings.planTarget);
  const [addExercise, setAddExercise] = useState(settings.addExercise);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const autoKcal = planTarget === 'needed' && plan.neededKcal ? plan.neededKcal : plan.planKcal ?? 2000;
  const autoProtein = latestWeight ? Math.round(latestWeight * (Number(perLb) || 0.8)) : null;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await foodApi<{ settings: FoodSettings }>('/api/food/settings', {
        method: 'PUT',
        json: { settings: { kcalTarget: kcal, proteinTarget: protein, carbsTarget: carbs, fatTarget: fat, proteinPerLb: Number(perLb), planTarget, addExercise } },
      });
      onSaved(res.settings);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save.');
      setBusy(false);
    }
  }

  return (
    <Sheet title="Targets" subtitle={`Calories now from ${KCAL_SOURCE_LABELS[targets.kcalSource]}.`} onClose={onClose}
      footer={<button type="button" className="workout-btn-primary" style={{ marginTop: 0 }} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>}>
      {plan.hasPlan ? (
        <>
          <p className="workout-label">Weight plan</p>
          <div className="workout-segmented" role="group" aria-label="Which plan number" style={{ marginBottom: '0.4rem' }}>
            <button type="button" aria-pressed={planTarget === 'plan'} onClick={() => setPlanTarget('plan')}>Plan: {plan.planKcal ? fmt(plan.planKcal) : '—'}</button>
            <button type="button" aria-pressed={planTarget === 'needed'} disabled={!plan.neededKcal} onClick={() => setPlanTarget('needed')}>
              To finish on time: {plan.neededKcal ? fmt(plan.neededKcal) : '—'}
            </button>
          </div>
          <p className="workout-hint" style={{ marginTop: 0, marginBottom: '1rem' }}>Used when you don’t set your own calories below.</p>
        </>
      ) : (
        <p className="food-notice">No weight plan yet. Make one in <a href="/workout/calculators">Calculators</a> and calories follow it, or set your own below.</p>
      )}
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Calories (blank = {fmt(autoKcal)} automatic)</span>
        <input className="workout-input" inputMode="numeric" value={kcal} placeholder={String(autoKcal)} onChange={(e) => setKcal(e.target.value)} />
      </label>
      <div className="workout-grid-2 workout-field">
        <label>
          <span className="workout-label">Protein g{autoProtein ? ` (auto ${autoProtein})` : ''}</span>
          <input className="workout-input" inputMode="numeric" value={protein} placeholder={autoProtein ? String(autoProtein) : 'auto'} onChange={(e) => setProtein(e.target.value)} />
        </label>
        <label>
          <span className="workout-label">Auto protein, g per lb</span>
          <input className="workout-input" inputMode="decimal" value={perLb} onChange={(e) => setPerLb(e.target.value)} />
        </label>
      </div>
      <div className="workout-grid-2 workout-field">
        <label>
          <span className="workout-label">Carbs g (auto: the rest)</span>
          <input className="workout-input" inputMode="numeric" value={carbs} placeholder="auto" onChange={(e) => setCarbs(e.target.value)} />
        </label>
        <label>
          <span className="workout-label">Fat g (auto: 30%)</span>
          <input className="workout-input" inputMode="numeric" value={fat} placeholder="auto" onChange={(e) => setFat(e.target.value)} />
        </label>
      </div>
      <label className="workout-switch-row">
        <span>
          <strong style={{ display: 'block', fontSize: '0.9rem' }}>Add back exercise calories</strong>
          <span className="workout-hint">Adds the day’s active calories from Apple Health (or your logged workouts’ watch calories). Your plan’s activity level may already count them.</span>
        </span>
        <input type="checkbox" checked={addExercise} onChange={(e) => setAddExercise(e.target.checked)} />
      </label>
      {error && <p className="workout-error">{error}</p>}
    </Sheet>
  );
}
