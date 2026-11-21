'use client';

import { useEffect, useMemo, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { dayLabel, fmt, logChange, type LogResponse } from '@/lib/food/client';
import type { RecipeSummary } from '@/lib/food/recipe-match';
import { MEAL_LABELS, MEALS, type Meal } from '@/lib/food/types';
import RecipeReview, { RecipeThumb } from './RecipeReview';
import { loadRecipeList, type RecipeList } from './recipe-client';

/**
 * Logging a meal from a recipe, inside any sheet: this week's planned meals
 * first (today's at the top), then every recipe with a search, then the
 * review screen for the one picked.
 */
export function RecipeImport({ date, meal, busy, onLog, onBack }: {
  date: string;
  meal: Meal;
  busy?: boolean;
  /** Post the change; true when it went in. */
  onLog: (action: Record<string, unknown>, what: string) => Promise<boolean>;
  onBack?: () => void;
}) {
  const [picked, setPicked] = useState<{ recipe: RecipeSummary; servings: number } | null>(null);
  if (picked) {
    return <RecipeReview key={picked.recipe.id} recipe={picked.recipe} servings={picked.servings} date={date} meal={meal} busy={busy} onLog={onLog} onBack={() => setPicked(null)} />;
  }
  return <RecipePicker date={date} onBack={onBack} onPick={(recipe, servings) => setPicked({ recipe, servings })} />;
}

// The list barely changes while the sheet is open, so going back to it doesn't fetch it again.
let cached: { date: string; list: RecipeList } | null = null;

function RecipePicker({ date, onPick, onBack }: { date: string; onPick: (recipe: RecipeSummary, servings: number) => void; onBack?: () => void }) {
  const [list, setList] = useState<RecipeList | null>(cached?.date === date ? cached.list : null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    loadRecipeList(date)
      .then((res) => { cached = { date, list: res }; if (live) setList(res); })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t load recipes.'));
    return () => { live = false; };
  }, [date]);

  const byId = useMemo(() => new Map((list?.recipes ?? []).map((r) => [r.id, r])), [list]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (list?.recipes ?? []).filter((r) => words.every((w) => r.title.toLowerCase().includes(w)));
  }, [list, query]);

  const row = (recipe: RecipeSummary, key: string, sub: string, servings: number, day?: { label: string; today: boolean }) => (
    <li key={key} className="food-result">
      <button type="button" className="food-result-main food-recipe-row" onClick={() => onPick(recipe, servings)}>
        <RecipeThumb recipe={recipe} />
        <span className="food-entry-name">
          <strong>{day && <span className={`food-recipe-day${day.today ? ' is-today' : ''}`}>{day.label}</span>}{recipe.title}</strong>
          <small>{sub}</small>
        </span>
        {recipe.kcal !== undefined && <span className="food-entry-kcal">{fmt(recipe.kcal)}</span>}
      </button>
    </li>
  );

  return (
    <div>
      {onBack && <button type="button" className="workout-text-btn food-back" onClick={onBack}>‹ Back</button>}
      {error && <p className="workout-error">{error}</p>}
      {!list && !error && <p className="workout-hint">Loading recipes…</p>}
      {list && (
        <>
          {list.plan.length > 0 && !query.trim() && (
            <>
              <h4 className="workout-section-title" style={{ marginTop: 0 }}><span>This week’s meals</span></h4>
              <ul className="food-list" style={{ marginBottom: '0.75rem' }}>
                {list.plan.map((p) => {
                  const recipe = byId.get(p.recipeId);
                  if (!recipe) return null;
                  const sub = `${p.servings} ${p.servings === 1 ? 'serving' : 'servings'} planned${p.cooked ? ' · cooked' : ''}`;
                  return row(recipe, `plan-${p.id}`, sub, p.suggested, { label: p.label, today: p.isToday });
                })}
              </ul>
            </>
          )}
          <div className="food-search">
            <input className="workout-input" type="search" placeholder="Search recipes" value={query} enterKeyHint="search"
              aria-label="Search recipes" onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!list.recipes.length && (
            <p className="food-empty">No recipes yet. Add some in <a href="/recipes">Recipes</a>, then log them from here.</p>
          )}
          {list.recipes.length > 0 && !shown.length && <p className="food-empty">No recipe called that.</p>}
          <ul className="food-list">
            {shown.map((r) => row(r, r.id, [`${r.servings} ${r.servings === 1 ? 'serving' : 'servings'}`, r.logged ? `logged ${r.logged}×` : ''].filter(Boolean).join(' · '), 1))}
          </ul>
          {list.recipes.some((r) => r.kcal !== undefined) && <p className="workout-hint">Numbers on the right are what each recipe says a serving has.</p>}
        </>
      )}
    </div>
  );
}

/** "From a recipe" on its own, from the Food page: pick the meal, pick the recipe, check it, log it. */
export default function RecipeSheet({ date, meal: initialMeal, onChanged, onDone, onClose }: {
  date: string;
  meal: Meal;
  onChanged: (res: LogResponse) => void;
  /** After logging: a line to show the user. */
  onDone: (text: string) => void;
  onClose: () => void;
}) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function log(action: Record<string, unknown>, what: string) {
    setBusy(true);
    setError('');
    try {
      onChanged(await logChange(action));
      onDone(`Added ${what} to ${MEAL_LABELS[meal].toLowerCase()}.`);
      onClose();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add that.');
      setBusy(false);
      return false;
    }
  }

  return (
    <Sheet title="From a recipe" subtitle={dayLabel(date)} onClose={onClose}>
      <div className="workout-segmented" role="group" aria-label="Meal" style={{ marginBottom: '0.75rem' }}>
        {MEALS.map((m) => <button key={m} type="button" aria-pressed={meal === m} onClick={() => setMeal(m)}>{MEAL_LABELS[m]}</button>)}
      </div>
      {error && <p className="workout-error" style={{ marginBottom: '0.6rem' }}>{error}</p>}
      <RecipeImport date={date} meal={meal} busy={busy} onLog={log} />
    </Sheet>
  );
}
