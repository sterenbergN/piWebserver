'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useKitchen } from '../recipes/useKitchen';
import type { DateKey } from '@/lib/habits/dates';
import { MOODS, promptFor, wordCount, writingStreak, type JournalEntry, type JournalSummary, type Mood } from '@/lib/journal/journal';
import { groceriesLeft, haveSet, mealsToday, missingIngredients } from '@/lib/recipes/kitchen';
import type { Recipe } from '@/lib/recipes/recipes';

const MOOD_NAMES = ['Rough', 'Meh', 'Okay', 'Good', 'Great'];

/** Today's journal entry: tap a mood right here, or open the page to write. */
export function JournalCard({ today, onWritten }: { today: DateKey; onWritten: (written: boolean) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [streak, setStreak] = useState(0);
  const [dates, setDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [one, all] = await Promise.all([
          fetch(`/api/journal?date=${today}`, { cache: 'no-store' }),
          fetch('/api/journal', { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (one.status === 401) { setState('signed-out'); return; }
        const [day, list] = await Promise.all([one.json(), all.json()]);
        if (cancelled) return;
        if (!day.success || !list.success) throw new Error('Not loaded');
        const written = new Set<string>((list.entries as JournalSummary[]).map((s) => s.date));
        setEntry(day.entry);
        setDates(written);
        setStreak(writingStreak(written, today));
        setState('ready');
        onWritten(!!day.entry);
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
    // onWritten only reports; it isn't a reason to load again.
  }, [today]);

  const setMood = async (value: Mood) => {
    const mood = entry?.mood === value ? null : value;
    const text = entry?.text ?? '';
    const previous = entry;
    const next = text || mood ? ({ ...(entry ?? {}), text, mood } as JournalEntry) : null;
    setEntry(next);
    onWritten(!!next);
    const res = await fetch('/api/journal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, text, mood, today }),
    }).catch(() => null);
    if (!res?.ok) {
      setEntry(previous);
      onWritten(!!previous);
      return;
    }
    const written = new Set(dates);
    if (next) written.add(today); else written.delete(today);
    setDates(written);
    setStreak(writingStreak(written, today));
  };

  const words = wordCount(entry?.text ?? '');

  return (
    <section className="td-card td-journal">
      <div className="td-card-head">
        <h2><span aria-hidden>📓</span> Journal</h2>
        {state === 'ready' && <span className={`td-chip${entry ? ' is-done' : ''}`}>🔥 {streak} day{streak === 1 ? '' : 's'}</span>}
      </div>
      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <><p className="hb-hint">Couldn’t open your journal.</p><Link className="btn btn-secondary" href="/journal">Open journal</Link></>}
      {state === 'signed-out' && (
        <>
          <p className="hb-hint">A private place to write, one entry a day. It’s kept in your account and only you can read it.</p>
          <button type="button" className="btn btn-secondary" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in to write</button>
        </>
      )}
      {state === 'ready' && (
        <>
          <div className="td-moods" role="radiogroup" aria-label="Today’s mood">
            {MOODS.map((face, i) => {
              const value = (i + 1) as Mood;
              return <button key={face} type="button" role="radio" aria-checked={entry?.mood === value} aria-label={MOOD_NAMES[i]} title={MOOD_NAMES[i]} onClick={() => setMood(value)}>{face}</button>;
            })}
          </div>
          {words > 0 ? (
            <>
              <p className="td-journal-preview">{entry?.text}</p>
              <Link className="btn btn-secondary" href="/journal">Keep writing · {words.toLocaleString()} word{words === 1 ? '' : 's'}</Link>
            </>
          ) : (
            <>
              <p className="hb-hint td-prompt">{promptFor(today)}</p>
              <Link className="btn btn-primary" href="/journal">Write today’s entry</Link>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** What's for dinner and what to buy: the kitchen, without leaving the day. */
export function KitchenCard({ today }: { today: DateKey }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newItem, setNewItem] = useState('');
  const kitchen = useKitchen(canEdit);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recipes').then((r) => r.json()).then((data) => {
      if (cancelled || !Array.isArray(data?.recipes)) return;
      setRecipes(data.recipes);
      setCanEdit(Boolean(data.canEdit));
    }).catch(() => { /* the card just shows the list */ }).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const { week, tonight, prep } = useMemo(() => mealsToday(recipes, kitchen.state, today), [recipes, kitchen.state, today]);
  const toBuy = useMemo(() => groceriesLeft(recipes, kitchen.state, week), [recipes, kitchen.state, week]);
  // Nothing planned: the recipe you're closest to having everything for.
  const idea = useMemo(() => {
    if (tonight.length || !recipes.length) return null;
    const have = haveSet(kitchen.state);
    const score = (r: Recipe) => missingIngredients(r, have).length - (r.rating ?? 0) / 10;
    return recipes.reduce((best, r) => (score(r) < score(best) ? r : best));
  }, [tonight.length, recipes, kitchen.state]);
  const ideaMissing = idea ? missingIngredients(idea, haveSet(kitchen.state)).length : 0;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    kitchen.addListItem(newItem);
    setNewItem('');
  };

  return (
    <section className="td-card td-kitchen">
      <div className="td-card-head">
        <h2><span aria-hidden>🍳</span> Kitchen</h2>
        {toBuy > 0 && <span className="td-chip">🛒 {toBuy} to buy</span>}
      </div>

      {!loaded ? <p className="hb-hint">Loading…</p> : tonight.length > 0 ? (
        <ul className="td-meals" aria-label="On the plan today">
          {tonight.map(({ entry, recipe }) => (
            <li key={entry.id} className={entry.cooked ? 'is-done' : ''}>
              <button type="button" className="td-meal-check" aria-pressed={!!entry.cooked} aria-label={entry.cooked ? `${recipe.title}: not cooked yet` : `${recipe.title}: cooked`}
                onClick={() => kitchen.updateEntry(week, entry.id, { cooked: !entry.cooked })}>{entry.cooked ? '✓' : ''}</button>
              <Link href={`/recipes?recipe=${encodeURIComponent(recipe.slug)}`}>{recipe.title}</Link>
              <small>serves {entry.servings}</small>
            </li>
          ))}
        </ul>
      ) : idea ? (
        <p className="hb-hint">Nothing planned today. How about <Link className="td-inline" href={`/recipes?recipe=${encodeURIComponent(idea.slug)}`}>{idea.title}</Link>{kitchen.state.have.length ? `? You’d need ${ideaMissing} more thing${ideaMissing === 1 ? '' : 's'}.` : '?'}</p>
      ) : <p className="hb-hint">Nothing planned today.</p>}
      {prep.length > 0 && <p className="hb-hint">Meal prep to cook this week: {prep.map((p) => p.recipe.title).join(', ')}</p>}

      <form className="td-add" onSubmit={add}>
        <input aria-label="Add to the grocery list" placeholder={(kitchen.household?.members.length ?? 0) > 1 ? 'Add to the shared grocery list…' : 'Add to the grocery list…'} maxLength={120} value={newItem} onChange={(e) => setNewItem(e.target.value)} enterKeyHint="done" />
        <button type="submit" className="btn btn-secondary" disabled={!newItem.trim()}>Add</button>
      </form>
      <div className="td-links">
        <Link href="/recipes?view=list">🛒 Grocery list{toBuy ? ` (${toBuy})` : ''}</Link>
        <Link href="/recipes?view=week">🗓️ Meal plan</Link>
        <Link href="/recipes">🍳 Recipes</Link>
      </div>
    </section>
  );
}
