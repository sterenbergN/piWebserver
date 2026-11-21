'use client';

import '@/components/food/food.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import AddFoodSheet from '@/components/food/AddFoodSheet';
import EntryEditSheet from '@/components/food/EntryEditSheet';
import FoodSettingsSheet from '@/components/food/FoodSettingsSheet';
import FoodSummary from '@/components/food/FoodSummary';
import FoodWeekView from '@/components/food/FoodWeekView';
import RecipeSheet from '@/components/food/RecipeSheet';
import PageHeader from '@/components/workout/PageHeader';
import Sheet from '@/components/workout/Sheet';
import { amountLabel, dayLabel, fmt, foodApi, FoodApiError, localDateKey, logChange, shiftKey, type DayData, type LogResponse } from '@/lib/food/client';
import { mealForTime } from '@/lib/food/log';
import { MEAL_LABELS, MEALS, type LogEntry, type Meal } from '@/lib/food/types';

// The food diary: one day at a time (meals, totals against targets), or the
// week. Adding is one sheet that stays open; targets follow the weight plan.

type Toast = { text: string; undo?: () => void };

function initialDate() {
  if (typeof window === 'undefined') return '';
  const fromUrl = new URLSearchParams(window.location.search).get('date');
  return fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) ? fromUrl : localDateKey();
}

export default function FoodPage() {
  const [date, setDate] = useState('');
  const [tab, setTab] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState<DayData | null>(null);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [fromRecipe, setFromRecipe] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingMeal, setSavingMeal] = useState<Meal | null>(null);
  const [mealName, setMealName] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);

  // The day on screen: a slow answer for a day already stepped past is dropped.
  const shownDate = useRef('');

  useEffect(() => { setDate(initialDate()); }, []);

  const load = useCallback(async (key: string) => {
    try {
      const res = await foodApi<DayData>(`/api/food/day?date=${key}`);
      if (shownDate.current !== key) return;
      setDay(res);
      setError('');
    } catch (e) {
      if (e instanceof FoodApiError && e.status === 401) setSignedOut(true);
      else setError(e instanceof Error ? e.message : 'Couldn’t load the day.');
    }
  }, []);

  useEffect(() => {
    if (!date) return;
    shownDate.current = date;
    setDay((d) => (d && d.date === date ? d : null));
    void load(date);
    // Keep the day in the address so a refresh (or the home-screen app reopening) lands on it.
    const url = new URL(window.location.href);
    if (date === localDateKey()) url.searchParams.delete('date'); else url.searchParams.set('date', date);
    window.history.replaceState(null, '', url);
  }, [date, load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Apply what a change returned right away, then refresh lists (recent, saved meals) quietly. */
  const applied = useCallback((res: LogResponse) => {
    if (res.date && res.entries) {
      setDay((d) => (d && d.date === res.date ? { ...d, entries: res.entries!, totals: res.totals!, meals: res.meals!, savedMeals: res.savedMeals } : d));
    }
    void load(date);
  }, [date, load]);

  async function remove(entry: LogEntry) {
    try {
      const res = await logChange({ type: 'remove', date, ids: [entry.id] });
      applied(res);
      setToast({
        text: `Deleted ${entry.snapshot.name}.`,
        undo: () => void logChange({ type: 'restore', date, entries: [entry] }).then(applied).catch(() => setError('Couldn’t put it back.')),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete that.');
    }
  }

  async function saveMeal() {
    if (!savingMeal || !mealName.trim()) return;
    try {
      const res = await logChange({ type: 'save-meal-from', name: mealName.trim(), date, meal: savingMeal });
      setDay((d) => (d ? { ...d, savedMeals: res.savedMeals } : d));
      setToast({ text: `Saved “${mealName.trim()}”. Find it under Meals when adding food.` });
      setSavingMeal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the meal.');
    }
  }

  async function copyMeal(fromMeal: Meal) {
    if (!day) return;
    try {
      applied(await logChange({ type: 'copy-meal', fromDate: day.previous.date, fromMeal, date, meal: fromMeal }));
      setToast({ text: `Copied ${dayLabel(day.previous.date).toLowerCase()}’s ${MEAL_LABELS[fromMeal].toLowerCase()}.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t copy that meal.');
    }
  }

  const today = localDateKey();
  const header = (
    <PageHeader
      title="Food"
      subtitle="Calories and macros, with targets from your weight plan."
      actions={day && <button type="button" className="workout-icon-btn" aria-label="Targets" onClick={() => setSettingsOpen(true)}>⚙️</button>}
    />
  );

  if (signedOut) {
    return (
      <>
        {header}
        <div className="workout-tile">
          <p style={{ marginTop: 0 }}>Sign in to log food. Your diary is kept on your account.</p>
          <a className="workout-btn-primary" style={{ display: 'block', textDecoration: 'none' }} href="/workout">Sign in</a>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="food-datebar">
        <button type="button" className="workout-icon-btn" aria-label="Previous day" onClick={() => setDate((d) => shiftKey(d, -1))}>‹</button>
        <button type="button" className="food-date-label" onClick={() => setDate(today)} title="Go to today">{date ? dayLabel(date, today) : ''}</button>
        <button type="button" className="workout-icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => shiftKey(d, 1))}>›</button>
      </div>
      <div className="workout-segmented food-tabs" role="group" aria-label="View">
        <button type="button" aria-pressed={tab === 'day'} onClick={() => setTab('day')}>Day</button>
        <button type="button" aria-pressed={tab === 'week'} onClick={() => setTab('week')}>Trends</button>
      </div>
      {error && <p className="workout-error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

      {tab === 'week' && date && <FoodWeekView end={date} onPickDay={(d) => { setDate(d); setTab('day'); }} />}

      {tab === 'day' && !day && !error && <p className="workout-hint">Loading…</p>}
      {tab === 'day' && day && (
        <>
          <FoodSummary totals={day.totals} targets={day.targets} exerciseKcal={day.exerciseKcal} addExercise={day.settings.addExercise} />
          <div className="food-add-row">
            <button type="button" className="workout-btn-primary" onClick={() => setAdding(date === today ? mealForTime(new Date()) : 'snack')}>
              + Add food
            </button>
            <button type="button" className="food-recipe-btn" onClick={() => setFromRecipe(date === today ? mealForTime(new Date()) : 'snack')}>
              <span aria-hidden>🍳</span> From a recipe
            </button>
          </div>
          {MEALS.map((meal) => {
            const entries = day.entries.filter((e) => e.meal === meal);
            const kcal = day.meals[meal]?.kcal ?? 0;
            return (
              <section key={meal} className="workout-tile food-meal" aria-label={MEAL_LABELS[meal]}>
                <div className="food-meal-head">
                  <h3>{MEAL_LABELS[meal]}{entries.length > 0 && <small>{fmt(kcal)} kcal</small>}</h3>
                  <div className="food-meal-actions">
                    {entries.length > 0 && (
                      <button type="button" className="workout-text-btn" aria-label={`Save ${MEAL_LABELS[meal]} as a meal`} onClick={() => { setMealName(''); setSavingMeal(meal); }}>⋯ Save</button>
                    )}
                    <button type="button" className="food-add-btn" onClick={() => setAdding(meal)}>+ Add</button>
                  </div>
                </div>
                {entries.length > 0 ? (
                  <ul className="food-entries">
                    {entries.map((e) => (
                      <li key={e.id} className="food-entry">
                        <button type="button" className="food-entry-main" onClick={() => setEditing(e)}>
                          <span className="food-entry-name">
                            <strong>{e.snapshot.name}</strong>
                            <small>{e.snapshot.brand ? `${e.snapshot.brand} · ` : ''}{amountLabel(e.amount, e.snapshot.servingLabel)} · {Math.round(e.snapshot.nutrients.protein * e.amount)} g protein</small>
                          </span>
                          <span className="food-entry-kcal">{fmt(e.snapshot.nutrients.kcal * e.amount)}</span>
                        </button>
                        <button type="button" className="food-entry-del" aria-label={`Delete ${e.snapshot.name}`} onClick={() => void remove(e)}>✕</button>
                      </li>
                    ))}
                  </ul>
                ) : day.previous.meals.includes(meal) ? (
                  <button type="button" className="food-copy-chip" onClick={() => void copyMeal(meal)}>⧉ Copy {dayLabel(day.previous.date, today).toLowerCase()}’s {MEAL_LABELS[meal].toLowerCase()}</button>
                ) : null}
              </section>
            );
          })}
        </>
      )}

      {adding && day && (
        <AddFoodSheet date={date} meal={adding} day={day} onChanged={applied} onClose={() => setAdding(null)} />
      )}
      {fromRecipe && day && (
        <RecipeSheet date={date} meal={fromRecipe} onChanged={applied} onDone={(text) => setToast({ text })} onClose={() => setFromRecipe(null)} />
      )}
      {editing && (
        <EntryEditSheet entry={editing} date={date} onChanged={applied} onDelete={(e) => void remove(e)} onClose={() => setEditing(null)} />
      )}
      {settingsOpen && day && (
        <FoodSettingsSheet settings={day.settings} targets={day.targets} plan={day.plan} latestWeight={day.latestWeight}
          onSaved={() => void load(date)} onClose={() => setSettingsOpen(false)} />
      )}
      {savingMeal && (
        <Sheet title={`Save ${MEAL_LABELS[savingMeal].toLowerCase()} as a meal`} subtitle="Then add it any day in one tap." onClose={() => setSavingMeal(null)}
          footer={<button type="button" className="workout-btn-primary" style={{ marginTop: 0 }} disabled={!mealName.trim()} onClick={() => void saveMeal()}>Save meal</button>}>
          <form onSubmit={(e) => { e.preventDefault(); void saveMeal(); }}>
            <label className="workout-field" style={{ display: 'block' }}>
              <span className="workout-label">Name</span>
              <input className="workout-input" value={mealName} maxLength={60} placeholder="Usual breakfast" autoFocus onChange={(e) => setMealName(e.target.value)} />
            </label>
            <p className="workout-hint">A meal with the same name is replaced.</p>
          </form>
        </Sheet>
      )}
      {toast && (
        <div className="food-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
        </div>
      )}
    </>
  );
}
