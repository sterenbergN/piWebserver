'use client';

import { useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import Sheet from '@/components/workout/Sheet';
import { amountLabel, dayLabel, fmt, foodApi, itemFor, itemFromRecent, logChange, type DayData, type LogResponse, type RecentFood, type SearchResult } from '@/lib/food/client';
import { scaleNutrients, sumNutrients } from '@/lib/food/nutrients';
import { MEAL_LABELS, MEALS, type Food, type Meal, type SavedMeal } from '@/lib/food/types';
import BarcodeEntry from './BarcodeEntry';
import CustomFoodForm from './CustomFoodForm';
import FoodPicker from './FoodPicker';
import QuickAddForm from './QuickAddForm';

type View =
  | { kind: 'home' }
  | { kind: 'pick'; food: Food; servingId?: string; amount?: number }
  | { kind: 'barcode' }
  | { kind: 'quick' }
  | { kind: 'custom'; barcode?: string; name?: string };

const BADGE: Record<SearchResult['source'], [string, string]> = {
  library: ['Mine', ''], usda: ['USDA', 'is-usda'], fatsecret: ['FatSecret', ''], off: ['OFF', 'is-off'],
};

/**
 * Everything for adding food, in one sheet that stays open so several things
 * can go in at once: one search over every source, recent and frequent foods
 * (with a one-tap "+"), saved meals, copying yesterday's meal, quick calories,
 * barcodes and foods from a label.
 */
export default function AddFoodSheet({ date, meal: initialMeal, day, onChanged, onClose }: {
  date: string;
  meal: Meal;
  day: Pick<DayData, 'recent' | 'frequent' | 'savedMeals' | 'previous'>;
  /** After each change: the server's view of the day. */
  onChanged: (res: LogResponse) => void;
  onClose: () => void;
}) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [list, setList] = useState<'recent' | 'frequent' | 'meals'>('recent');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [canMore, setCanMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');
  const [savedMeals, setSavedMeals] = useState<SavedMeal[]>(day.savedMeals);
  const abortRef = useRef<AbortController | null>(null);
  const { confirm, popup } = useSitePopup();

  async function search(q: string, more = false) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    try {
      const res = await foodApi<{ results: SearchResult[]; notices: string[]; canSearchMore: boolean }>(
        `/api/food/search?q=${encodeURIComponent(q)}&date=${date}${more ? '&more=1' : ''}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(res.results);
      setNotices(res.notices);
      setCanMore(res.canSearchMore);
    } catch (e) {
      if (controller.signal.aborted) return;
      setNotices([e instanceof Error ? e.message : 'Search failed.']);
      setResults([]);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  // Search as you type, once typing pauses.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { abortRef.current?.abort(); setResults(null); setNotices([]); setSearching(false); return; }
    const timer = setTimeout(() => void search(q), 350);
    return () => clearTimeout(timer);
  }, [query]);

  async function run(action: Record<string, unknown>, what: string) {
    setBusy(true);
    setError('');
    try {
      const res = await logChange(action);
      if (res.savedMeals) setSavedMeals(res.savedMeals);
      onChanged(res);
      setAdded(`Added ${what} to ${MEAL_LABELS[meal].toLowerCase()}.`);
      setView({ kind: 'home' });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add that.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const addFood = (food: Food, servingId: string, amount: number) =>
    run({ type: 'add', date, meal, items: [itemFor(food, servingId, amount)] }, food.name);
  const addRecent = (r: RecentFood) => run({ type: 'add', date, meal, items: [itemFromRecent(r)] }, r.snapshot.name);
  const addMeal = (m: SavedMeal) => run({ type: 'add', date, meal, items: m.items.map(itemFromRecent) }, m.name);

  async function removeMeal(m: SavedMeal) {
    if (!(await confirm({ title: 'Remove saved meal?', message: `“${m.name}” goes from your saved meals. Anything already logged stays.`, confirmLabel: 'Remove', danger: true }))) return;
    try {
      const res = await logChange({ type: 'remove-meal', id: m.id });
      setSavedMeals(res.savedMeals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t remove it.');
    }
  }

  /** A recent food as a pickable food: its last serving, from the snapshot. */
  async function openRecent(r: RecentFood) {
    setError('');
    try {
      const res = await foodApi<{ food: Food }>(`/api/food/foods?id=${encodeURIComponent(r.foodId)}`);
      setView({ kind: 'pick', food: res.food, servingId: r.servingId, amount: r.amount });
    } catch {
      // The source is gone: the snapshot still logs exactly as before.
      const s = r.snapshot;
      const food: Food = { id: r.foodId, source: s.source === 'quick' ? 'custom' : s.source, sourceId: r.foodId.split(':')[1] ?? '', name: s.name, brand: s.brand, servings: [{ id: r.servingId, label: s.servingLabel, grams: s.grams, ml: s.ml, nutrients: s.nutrients }] };
      setView({ kind: 'pick', food, servingId: r.servingId, amount: r.amount });
    }
  }

  const title = view.kind === 'barcode' ? 'Barcode' : view.kind === 'quick' ? 'Quick add' : view.kind === 'custom' ? 'New food' : `Add to ${MEAL_LABELS[meal]}`;
  const back = () => { setError(''); setView({ kind: 'home' }); };

  const recentRow = (r: RecentFood) => (
    <li key={`${r.foodId}-${r.date}`} className="food-result">
      <button type="button" className="food-result-main" onClick={() => void openRecent(r)}>
        <span className="food-entry-name">
          <strong>{r.snapshot.name}</strong>
          <small>{r.snapshot.brand ? `${r.snapshot.brand} · ` : ''}{amountLabel(r.amount, r.snapshot.servingLabel)}{list === 'frequent' ? ` · ${r.count}×` : ''}</small>
        </span>
        <span className="food-entry-kcal">{fmt(r.snapshot.nutrients.kcal * r.amount)}</span>
      </button>
      <button type="button" className="food-result-quick" aria-label={`Add ${r.snapshot.name}`} disabled={busy} onClick={() => void addRecent(r)}>+</button>
    </li>
  );

  return (
    <Sheet title={title} subtitle={view.kind === 'home' ? dayLabel(date) : undefined} onClose={onClose}>
      {popup}
      {view.kind !== 'custom' && view.kind !== 'barcode' && (
        <div className="workout-segmented" role="group" aria-label="Meal" style={{ marginBottom: '0.75rem' }}>
          {MEALS.map((m) => <button key={m} type="button" aria-pressed={meal === m} onClick={() => setMeal(m)}>{MEAL_LABELS[m]}</button>)}
        </div>
      )}
      {error && <p className="workout-error" style={{ marginBottom: '0.6rem' }}>{error}</p>}

      {view.kind === 'pick' && (
        <FoodPicker key={view.food.id} food={view.food} servingId={view.servingId} amount={view.amount} busy={busy}
          confirmLabel={`Add to ${MEAL_LABELS[meal].toLowerCase()}`} onConfirm={(f, s, a) => void addFood(f, s, a)} onBack={back} />
      )}
      {view.kind === 'barcode' && (
        <BarcodeEntry onBack={back} onFound={(food) => setView({ kind: 'pick', food })} onNotFound={(barcode) => setView({ kind: 'custom', barcode })} />
      )}
      {view.kind === 'quick' && (
        <QuickAddForm busy={busy} onBack={back} onAdd={({ name, nutrients }) => void run({ type: 'quick', date, meal, name, nutrients }, `${Math.round(nutrients.kcal)} kcal`)} />
      )}
      {view.kind === 'custom' && (
        <CustomFoodForm barcode={view.barcode} initialName={view.name} onBack={back} onSaved={(food) => setView({ kind: 'pick', food })} />
      )}

      {view.kind === 'home' && (
        <>
          <div className="food-search">
            <input className="workout-input" type="search" placeholder="Search foods" value={query} enterKeyHint="search"
              onChange={(e) => { setQuery(e.target.value); setAdded(''); }} aria-label="Search foods" />
          </div>
          {added && <p className="food-notice" role="status">✓ {added}</p>}

          {results === null ? (
            <>
              <div className="food-tools">
                <button type="button" className="food-tool" onClick={() => setView({ kind: 'barcode' })}><span aria-hidden>🔢</span><span>Barcode</span></button>
                <button type="button" className="food-tool" onClick={() => setView({ kind: 'quick' })}><span aria-hidden>⚡</span><span>Quick add</span></button>
                <button type="button" className="food-tool" onClick={() => setView({ kind: 'custom' })}><span aria-hidden>🏷️</span><span>From a label</span></button>
              </div>
              {day.previous.meals.length > 0 && (
                <div className="workout-chip-list" style={{ marginBottom: '0.75rem' }}>
                  {day.previous.meals.map((m) => (
                    <button key={m} type="button" className="food-copy-chip" style={{ marginTop: 0 }} disabled={busy}
                      onClick={() => void run({ type: 'copy-meal', fromDate: day.previous.date, fromMeal: m, date, meal }, `${dayLabel(day.previous.date).toLowerCase()}’s ${MEAL_LABELS[m].toLowerCase()}`)}>
                      ⧉ Copy {dayLabel(day.previous.date).toLowerCase()}’s {MEAL_LABELS[m].toLowerCase()}
                    </button>
                  ))}
                </div>
              )}
              <div className="workout-segmented" role="group" aria-label="Lists" style={{ marginBottom: '0.6rem' }}>
                <button type="button" aria-pressed={list === 'recent'} onClick={() => setList('recent')}>Recent</button>
                <button type="button" aria-pressed={list === 'frequent'} onClick={() => setList('frequent')}>Frequent</button>
                <button type="button" aria-pressed={list === 'meals'} onClick={() => setList('meals')}>Meals</button>
              </div>
              {list === 'recent' && (day.recent.length ? <ul className="food-list">{day.recent.map(recentRow)}</ul> : <p className="food-empty">Foods you log show up here for one-tap adding.</p>)}
              {list === 'frequent' && (day.frequent.length ? <ul className="food-list">{day.frequent.map(recentRow)}</ul> : <p className="food-empty">Foods you log often (the last two months) show up here.</p>)}
              {list === 'meals' && (savedMeals.length ? (
                <ul className="food-list">
                  {savedMeals.map((m) => {
                    const kcal = sumNutrients(m.items.map((i) => scaleNutrients(i.snapshot.nutrients, i.amount))).kcal;
                    return (
                      <li key={m.id} className="food-result">
                        <button type="button" className="food-result-main" disabled={busy} onClick={() => void addMeal(m)}>
                          <span className="food-entry-name">
                            <strong>{m.name}</strong>
                            <small>{m.items.map((i) => i.snapshot.name).join(', ')}</small>
                          </span>
                          <span className="food-entry-kcal">{fmt(kcal)}</span>
                        </button>
                        <button type="button" className="food-entry-del" aria-label={`Remove saved meal ${m.name}`} onClick={() => void removeMeal(m)}>✕</button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="food-empty">Save a meal from its ⋯ menu on the day view, then add it here in one tap.</p>)}
            </>
          ) : (
            <>
              {notices.map((n) => <p key={n} className="food-notice">{n}</p>)}
              {searching && !results.length && <p className="workout-hint">Searching…</p>}
              {!searching && !results.length && (
                <p className="food-empty">
                  Nothing found.{' '}
                  <button type="button" className="workout-text-btn" onClick={() => setView({ kind: 'custom', name: query.trim() })}>Add “{query.trim()}” from its label</button>
                </p>
              )}
              <ul className="food-list" aria-busy={searching}>
                {results.map(({ food, source }) => {
                  const s = food.servings[0];
                  const [badge, cls] = BADGE[source] ?? ['', ''];
                  return (
                    <li key={food.id} className="food-result">
                      <button type="button" className="food-result-main" onClick={() => setView({ kind: 'pick', food })}>
                        <span className="food-entry-name">
                          <strong>{food.name}{badge && <span className={`food-badge ${cls}`}>{badge}</span>}</strong>
                          <small>{food.brand ? `${food.brand} · ` : ''}{s?.label}</small>
                        </span>
                        <span className="food-entry-kcal">{s ? fmt(s.nutrients.kcal) : ''}</span>
                      </button>
                      {!food.partial && s && (
                        <button type="button" className="food-result-quick" aria-label={`Add ${food.name}, ${s.label}`} disabled={busy} onClick={() => void addFood(food, s.id, 1)}>+</button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {canMore && !searching && (
                <button type="button" className="food-more" onClick={() => void search(query.trim(), true)}>Search more (Open Food Facts)</button>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
