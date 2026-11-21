import { fmt } from '@/lib/food/client';
import type { Targets } from '@/lib/food/targets';
import type { Nutrients } from '@/lib/food/types';

const pct = (value: number, target: number) => (target > 0 ? Math.min(100, (value / target) * 100) : 0);

function MacroBar({ label, kind, value, target }: { label: string; kind: string; value: number; target: number }) {
  const over = target > 0 && value > target * 1.05;
  return (
    <div>
      <div className="food-macro-head">
        <span>{label}</span>
        <span>{Math.round(value)} / {Math.round(target)} g</span>
      </div>
      <div className={`food-bar is-${kind}${over ? ' is-over' : ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemax={Math.round(target)}>
        <span style={{ width: `${pct(value, target)}%` }} />
      </div>
    </div>
  );
}

/** Calories as a ring against the target, and protein / carbs / fat as bars. */
export default function FoodSummary({ totals, targets, exerciseKcal, addExercise }: {
  totals: Nutrients;
  targets: Targets;
  /** The day's active calories, shown even when they aren't added to the target. */
  exerciseKcal: number | null;
  addExercise: boolean;
}) {
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const share = targets.kcal > 0 ? Math.min(totals.kcal / targets.kcal, 1) : 0;
  const left = targets.kcal - totals.kcal;
  return (
    <section className="workout-tile" aria-label="Today’s totals">
      <div className="food-summary">
        <div className={`food-ring${left < 0 ? ' is-over' : ''}`}>
          <svg viewBox="0 0 116 116" aria-hidden>
            <circle className="food-ring-track" cx="58" cy="58" r={r} fill="none" strokeWidth="11" />
            <circle className="food-ring-fill" cx="58" cy="58" r={r} fill="none" strokeWidth="11" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} />
          </svg>
          <div className="food-ring-text">
            <strong>{fmt(Math.abs(left))}</strong>
            <span>{left >= 0 ? 'kcal left' : 'kcal over'}</span>
          </div>
        </div>
        <div className="food-macros">
          <div className="food-macro-head" style={{ fontSize: '0.9rem' }}>
            <strong>{fmt(totals.kcal)} kcal</strong>
            <span>of {fmt(targets.kcal)}</span>
          </div>
          <MacroBar label="Protein" kind="protein" value={totals.protein} target={targets.protein} />
          <MacroBar label="Carbs" kind="carbs" value={totals.carbs} target={targets.carbs} />
          <MacroBar label="Fat" kind="fat" value={totals.fat} target={targets.fat} />
        </div>
      </div>
      <div className="food-summary-foot">
        {exerciseKcal ? (
          <span>🔥 {fmt(exerciseKcal)} active kcal{addExercise ? (targets.exerciseKcal ? ` (+${fmt(targets.exerciseKcal)} added)` : '') : ' (not added)'}</span>
        ) : <span />}
        {(totals.fiber !== undefined || totals.sodium !== undefined) && (
          <span>
            {totals.fiber !== undefined ? `Fiber ${Math.round(totals.fiber)} g` : ''}
            {totals.fiber !== undefined && totals.sodium !== undefined ? ' · ' : ''}
            {totals.sodium !== undefined ? `Sodium ${fmt(totals.sodium)} mg` : ''}
          </span>
        )}
      </div>
    </section>
  );
}
