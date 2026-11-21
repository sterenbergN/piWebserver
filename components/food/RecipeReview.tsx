'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import StepperInput from '@/components/workout/StepperInput';
import { fmt, foodApi, type SearchResult } from '@/lib/food/client';
import { lineNutrients, recipeTotals, type RecipeMatch, type RecipeSummary } from '@/lib/food/recipe-match';
import { MEAL_LABELS, type Food, type Meal } from '@/lib/food/types';
import { mediaSrc } from '@/lib/media-url';
import FoodPicker from './FoodPicker';
import { isCounted, lineAmountLabel, matchRecipe, recipeLogAction, servingsText, startingAmount, type EditLine } from './recipe-client';

const STATUS_BADGE: Record<EditLine['status'], [string, string] | null> = {
  good: null,
  guessed: ['Check', 'is-guessed'],
  none: ['No match', 'is-none'],
  skipped: ['Not counted', 'is-skipped'],
};

export function RecipeThumb({ recipe }: { recipe: Pick<RecipeSummary, 'photo' | 'emoji'> }) {
  return recipe.photo
    ? <img className="food-recipe-thumb" src={mediaSrc(recipe.photo, 400)} alt="" loading="lazy" decoding="async" />
    : <span className="food-recipe-thumb" aria-hidden>{recipe.emoji}</span>;
}

/**
 * A recipe's ingredients matched to foods, how many servings were eaten, and
 * what that comes to. Guessed and unmatched lines stand out; tapping a line
 * picks another food or changes its amount, and those changes are remembered.
 */
export default function RecipeReview({ recipe: summary, servings: initialServings, date, meal, busy, onLog, onBack }: {
  recipe: RecipeSummary;
  date: string;
  servings: number;
  meal: Meal;
  busy?: boolean;
  onLog: (action: Record<string, unknown>, what: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const [match, setMatch] = useState<RecipeMatch | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [error, setError] = useState('');
  const [eaten, setEaten] = useState(initialServings);
  const [use, setUse] = useState<'lines' | 'recipe'>('lines');
  const [editing, setEditing] = useState<number | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    matchRecipe(summary.id)
      .then((res) => { if (live) { setMatch(res); setLines(res.lines); } })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t match that recipe.'));
    return () => { live = false; };
  }, [summary.id]);

  // A new view starts at its top, not wherever the list was scrolled to.
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }); }, [editing]);

  const recipe = match?.recipe ?? { ...summary, macros: null };
  const totals = useMemo(() => recipeTotals(lines, recipe.servings), [lines, recipe.servings]);
  const own = recipe.macros;
  const chosen = use === 'recipe' && own ? own : totals.perServing;
  const toCheck = lines.filter((l) => l.status === 'guessed' || l.status === 'none').length;

  if (editing !== null && lines[editing]) {
    return (
      <div ref={top}>
        <LineEditor line={lines[editing]} date={date}
          onCancel={() => setEditing(null)}
          onSave={(line) => { setLines((ls) => ls.map((l, i) => (i === editing ? line : l))); setEditing(null); }} />
      </div>
    );
  }

  async function log() {
    if (!match) return;
    await onLog(recipeLogAction({ date, meal, recipeId: recipe.id, servings: eaten, use: use === 'recipe' && own ? 'recipe' : 'lines', lines }), recipe.title);
  }

  return (
    <div ref={top}>
      <button type="button" className="workout-text-btn food-back" onClick={onBack}>‹ Recipes</button>
      <div className="food-recipe-head">
        <RecipeThumb recipe={recipe} />
        <div style={{ minWidth: 0 }}>
          <h3>{recipe.title}</h3>
          <p className="workout-hint" style={{ margin: 0 }}>Makes {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}</p>
        </div>
      </div>
      {error && <p className="workout-error">{error}</p>}

      <StepperInput label="Servings eaten" value={eaten} decimal
        onChange={(v) => setEaten(v > 0 ? Math.min(v, 100) : eaten)}
        onStep={(d) => setEaten((s) => Math.max(0.5, Math.min(100, Math.round((s + d * 0.5) * 2) / 2)))} />
      <p className="workout-hint" style={{ marginTop: '-0.4rem' }}>I ate {servingsText(eaten)} of {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}.</p>

      {!match && !error && <p className="workout-hint">Matching ingredients…</p>}
      {match && (
        <>
          {own && (
            <div className="workout-segmented food-recipe-use" role="group" aria-label="Which numbers to log">
              <button type="button" aria-pressed={use === 'lines'} onClick={() => setUse('lines')}>
                From ingredients<small>{fmt(totals.perServing.kcal)} kcal</small>
              </button>
              <button type="button" aria-pressed={use === 'recipe'} onClick={() => setUse('recipe')}>
                Recipe says<small>{fmt(own.kcal)} kcal</small>
              </button>
            </div>
          )}
          <p className="workout-label" style={{ margin: '0.75rem 0 0' }}>Per serving</p>
          <div className="food-picker-nutrients" style={{ marginTop: '0.35rem' }}>
            <div><strong>{fmt(chosen.kcal)}</strong><span>kcal</span></div>
            <div><strong>{Math.round(chosen.protein)}</strong><span>protein g</span></div>
            <div><strong>{Math.round(chosen.carbs)}</strong><span>carbs g</span></div>
            <div><strong>{Math.round(chosen.fat)}</strong><span>fat g</span></div>
          </div>
          {own && use === 'lines' && <p className="food-extra">Recipe says {fmt(own.kcal)} kcal a serving.</p>}

          <h4 className="workout-section-title">
            <span>Ingredients</span>
            {toCheck > 0 && <small className="food-recipe-check">{toCheck} to check</small>}
          </h4>
          {!lines.length && <p className="food-empty">This recipe has no ingredients in its steps. Use “Recipe says”, or log it with Quick add.</p>}
          <ul className="food-list">
            {lines.map((line, i) => {
              const badge = STATUS_BADGE[line.status];
              const counted = isCounted(line);
              return (
                <li key={line.key} className={`food-recipe-line is-${line.status}`}>
                  <button type="button" className="food-result-main" onClick={() => setEditing(i)}>
                    <span className="food-entry-name">
                      <strong>{line.name}{badge && <span className={`food-badge ${badge[1]}`}>{badge[0]}</span>}</strong>
                      <small>{line.amountText}{line.amountText && ' → '}{line.food ? line.food.name : 'Pick a food'}</small>
                      {(counted || line.note) && <small>{[counted ? lineAmountLabel(line) : '', line.note].filter(Boolean).join(' · ')}</small>}
                    </span>
                    <span className="food-entry-kcal">{counted ? fmt(lineNutrients(line.food!, line.servingId, line.amount).kcal) : '–'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="workout-hint">Whole recipe, from ingredients: {fmt(totals.total.kcal)} kcal. Changes you make are remembered for next time.</p>

          <div className="food-recipe-go">
            <button type="button" className="workout-btn-primary" disabled={busy || !(eaten > 0) || (use === 'lines' && totals.total.kcal <= 0)} onClick={() => void log()}>
              {busy ? 'Saving…' : `Add ${fmt(chosen.kcal * eaten)} kcal to ${MEAL_LABELS[meal].toLowerCase()}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** One ingredient: another food from a search, its serving and amount, or left out. */
function LineEditor({ line, date, onSave, onCancel }: { line: EditLine; date: string; onSave: (line: EditLine) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<{ food: Food; servingId?: string; amount?: number } | null>(
    line.food ? { food: line.food, servingId: line.servingId, amount: line.amount || undefined } : null,
  );
  const [query, setQuery] = useState(line.food ? '' : line.name);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { abortRef.current?.abort(); setResults(null); setSearching(false); return; }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      foodApi<{ results: SearchResult[] }>(`/api/food/search?q=${encodeURIComponent(q)}&date=${date}`, { signal: controller.signal })
        .then((res) => !controller.signal.aborted && setResults(res.results))
        .catch(() => !controller.signal.aborted && setResults([]))
        .finally(() => !controller.signal.aborted && setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [query, date]);

  const pick = (food: Food) => {
    setPicked({ food, ...startingAmount(line, food) });
    setQuery('');
  };

  return (
    <div>
      <button type="button" className="workout-text-btn food-back" onClick={onCancel}>‹ Back to the recipe</button>
      <h3 style={{ margin: '0 0 0.15rem', fontSize: '1.1rem' }}>{line.name}</h3>
      <p className="workout-hint" style={{ marginTop: 0 }}>
        {line.amountText ? `The recipe uses ${line.amountText}.` : 'The recipe gives no amount.'}{line.note ? ` ${line.note}.` : ''}
      </p>

      <div className="food-search">
        <input className="workout-input" type="search" placeholder={picked ? 'Search for a different food' : 'Search foods'} value={query}
          enterKeyHint="search" aria-label="Search foods" onChange={(e) => setQuery(e.target.value)} />
      </div>
      {results !== null && (
        <>
          {searching && !results.length && <p className="workout-hint">Searching…</p>}
          {!searching && !results.length && <p className="food-empty">Nothing found. Try fewer words.</p>}
          <ul className="food-list" aria-busy={searching} style={{ marginBottom: '0.75rem' }}>
            {results.slice(0, 12).map(({ food }) => (
              <li key={food.id} className="food-result">
                <button type="button" className="food-result-main" onClick={() => pick(food)}>
                  <span className="food-entry-name">
                    <strong>{food.name}</strong>
                    <small>{food.brand ? `${food.brand} · ` : ''}{food.servings[0]?.label}</small>
                  </span>
                  <span className="food-entry-kcal">{food.servings[0] ? fmt(food.servings[0].nutrients.kcal) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {picked && results === null && (
        <FoodPicker key={`${picked.food.id}-${picked.servingId ?? ''}`} food={picked.food} servingId={picked.servingId} amount={picked.amount ?? 1}
          confirmLabel="Use this"
          onConfirm={(food, servingId, amount) => onSave({ ...line, food, servingId, amount, status: 'good', note: undefined, changed: true })} />
      )}
      {line.status !== 'skipped' && (
        <button type="button" className="food-more" onClick={() => onSave({ ...line, status: 'skipped', amount: 0, note: 'Left out' })}>Leave it out</button>
      )}
    </div>
  );
}
