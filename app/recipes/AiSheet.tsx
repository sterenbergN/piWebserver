'use client';

import { useMemo, useRef, useState } from 'react';
import { addDays, daysBetween, localToday, type DateKey } from '@/lib/habits/dates';
import { AiReplyError, buildRecipePrompt, buildWeekPrompt, categoryLabel, parseAiReply, type AiReply } from '@/lib/recipes/ai';
import { currentWeek, dayInfo, weekLabel } from '@/lib/recipes/kitchen';
import { buildSchedule, extractIngredients, resolveRecipes, type Recipe } from '@/lib/recipes/recipes';
import { formatMinutes } from './shared';
import type { Kitchen } from './useKitchen';

function Stepper({ label, unit, value, min, max, onChange }: { label: string; unit: [string, string]; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="rc-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${unit[1]}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span>
        {value} {value === 1 ? unit[0] : unit[1]}
      </span>
      <button type="button" aria-label={`More ${unit[1]}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

/** Copy a prompt into any AI, paste back what it wrote, check it over, and it's in the recipe box and on the week. */
export default function AiSheet({
  mode: initialMode,
  recipes,
  kitchen,
  week: initialWeek,
  onClose,
  onSaved,
  onCheckOne,
}: {
  mode: 'recipes' | 'week';
  /** As stored, not resolved. */
  recipes: Recipe[];
  kitchen: Kitchen;
  week: DateKey;
  onClose: () => void;
  onSaved: (saved: Recipe[], message: string) => void;
  /** One recipe and no plan: open it in the editor to read over. */
  onCheckOne: (recipe: Recipe) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [ask, setAsk] = useState('');
  const [count, setCount] = useState(1);
  const [meals, setMeals] = useState(5);
  const [prep, setPrep] = useState(0);
  const [servings, setServings] = useState(4);
  const [usePantry, setUsePantry] = useState(true);
  const [useMine, setUseMine] = useState(true);
  // Late in the week, "this week" is mostly gone, so planning starts from the next one.
  const [week, setWeek] = useState(() => {
    const now = currentWeek();
    if (initialWeek > now) return initialWeek;
    return daysBetween(now, localToday()) >= 5 ? addDays(now, 7) : now;
  });

  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showPrompt, setShowPrompt] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const [replyText, setReplyText] = useState('');
  const [reply, setReply] = useState<AiReply | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const prompt = useMemo(() => {
    const options = { ask, servings, usePantry, useMine };
    return mode === 'recipes'
      ? buildRecipePrompt({ ...options, count }, kitchen.state, recipes)
      : buildWeekPrompt({ ...options, meals, prep, weekLabel: weekLabel(week) }, kitchen.state, recipes);
  }, [mode, ask, servings, usePantry, useMine, count, meals, prep, week, kitchen.state, recipes]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      // Some phones refuse the clipboard: show it, selected, to copy by hand.
      setShowPrompt(true);
      setCopied('failed');
      window.setTimeout(() => {
        promptBox.current?.focus();
        promptBox.current?.select();
      }, 0);
    }
  };

  const read = () => {
    setError('');
    try {
      const parsed = parseAiReply(replyText, recipes, servings);
      const singleToCheck = parsed.recipes.length === 1 && !parsed.plan.length && !parsed.recipes[0].sections.some((s) => s.sub);
      if (singleToCheck) onCheckOne(parsed.recipes[0]);
      else setReply(parsed);
    } catch (err) {
      setError(err instanceof AiReplyError ? err.message : 'I couldn’t read that. Ask the AI to send it again as one JSON code block.');
    }
  };

  // How each new recipe comes out, linked parts included, so the check-over is honest.
  const previews = useMemo(() => {
    if (!reply) return [];
    const all = resolveRecipes([...recipes, ...reply.recipes]);
    return reply.recipes.map((recipe) => {
      const full = all.find((r) => r.id === recipe.id) ?? recipe;
      return { recipe, ingredients: extractIngredients(full).length, minutes: buildSchedule(full).totalMinutes };
    });
  }, [reply, recipes]);

  const save = async () => {
    if (!reply) return;
    setSaving(true);
    setError('');
    const saved: Recipe[] = [];
    try {
      for (const recipe of reply.recipes.filter((r) => !skipped.includes(r.id))) {
        const res = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'save', recipe }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.recipe) throw new Error(data?.message || `Couldn’t save ${recipe.title}.`);
        saved.push(data.recipe);
      }
      const planned = reply.plan.filter((p) => !skipped.includes(p.recipeId));
      for (const entry of planned) kitchen.addToPlan(week, entry.recipeId, entry.servings, entry.day);
      const parts = [
        saved.length ? `${saved.length} ${saved.length === 1 ? 'recipe' : 'recipes'} added` : '',
        planned.length ? `${planned.length} ${planned.length === 1 ? 'meal' : 'meals'} planned` : '',
      ].filter(Boolean);
      onSaved(saved, parts.join(', ') || 'Nothing to add');
    } catch (err) {
      // Whatever got saved stays saved; saving again only sends the rest.
      if (saved.length) {
        setReply({ ...reply, recipes: reply.recipes.filter((r) => !saved.some((s) => s.id === r.id)) });
        onSaved(saved, '');
      }
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const dayName = (day: number | null) => (day === null ? 'Meal prep' : dayInfo(week, day).name);

  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <div className="rc-sheet rc-ai-sheet" role="dialog" aria-modal="true" aria-label="Use your AI" onClick={(e) => e.stopPropagation()}>
        <div className="rc-sheet-head">
          <h2>{reply ? 'Check it over' : mode === 'week' ? 'Plan a week with your AI' : 'Write recipes with your AI'}</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="rc-ai-body">
          {error && <p className="rc-sheet-error" role="alert">{error}</p>}

          {reply ? (
            <>
              {reply.notes.length > 0 && (
                <ul className="rc-ai-notes">
                  {reply.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
              {previews.length > 0 && (
                <>
                  <h3 className="rc-ai-head">New recipes</h3>
                  <ul className="rc-ai-list">
                    {previews.map(({ recipe, ingredients, minutes }) => {
                      const off = skipped.includes(recipe.id);
                      return (
                        <li key={recipe.id}>
                          <label className="rc-toggle">
                            <input type="checkbox" checked={!off} onChange={() => setSkipped((prev) => (off ? prev.filter((id) => id !== recipe.id) : [...prev, recipe.id]))} />
                            <span>
                              {recipe.title}
                              <small>
                                {categoryLabel(recipe)} · {formatMinutes(minutes)} · {ingredients} ingredients · serves {recipe.servings}
                              </small>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="rc-meta">They’re saved as private, so only people signed in can see them. AI recipes can be wrong about times and temperatures, so read each one before you cook it.</p>
                </>
              )}
              {reply.plan.length > 0 && (
                <>
                  <div className="rc-ai-week">
                    <h3 className="rc-ai-head">{weekLabel(week)}</h3>
                    <button type="button" className="rc-link-small" onClick={() => setWeek(week === currentWeek() ? addDays(currentWeek(), 7) : currentWeek())}>
                      {week === currentWeek() ? 'Use next week' : 'Use this week'}
                    </button>
                  </div>
                  <ul className="rc-ai-plan">
                    {reply.plan.filter((p) => !skipped.includes(p.recipeId)).map((p, i) => (
                      <li key={i}>
                        <strong>{dayName(p.day)}</strong> {p.title} <small>· {p.servings}</small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <>
              <div className="rc-seg rc-seg-wide" role="group" aria-label="What to ask for">
                <button type="button" className={mode === 'recipes' ? 'is-active' : ''} aria-pressed={mode === 'recipes'} onClick={() => setMode('recipes')}>
                  Recipes
                </button>
                <button type="button" className={mode === 'week' ? 'is-active' : ''} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>
                  A week’s meals
                </button>
              </div>

              <label className="rc-field">
                What are you after?
                <textarea
                  className="rc-input"
                  rows={2}
                  placeholder={mode === 'week' ? 'High protein, no mushrooms, quick on Tuesday and Thursday' : 'A Greek beef bowl with homemade tzatziki'}
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                />
              </label>

              {mode === 'week' && (
                <div className="rc-ai-week">
                  <h3 className="rc-ai-head">{weekLabel(week)}</h3>
                  <button type="button" className="rc-link-small" onClick={() => setWeek(week === currentWeek() ? addDays(currentWeek(), 7) : currentWeek())}>
                    {week === currentWeek() ? 'Use next week' : 'Use this week'}
                  </button>
                </div>
              )}

              <div className="rc-ai-steppers">
                {mode === 'recipes' ? (
                  <Stepper label="How many recipes" unit={['recipe', 'recipes']} value={count} min={1} max={10} onChange={setCount} />
                ) : (
                  <>
                    <Stepper label="How many meals" unit={['meal', 'meals']} value={meals} min={1} max={21} onChange={setMeals} />
                    <Stepper label="How many of them are meal prep" unit={['meal prep', 'meal prep']} value={prep} min={0} max={Math.min(5, meals)} onChange={setPrep} />
                  </>
                )}
                <Stepper label="Servings" unit={['serving', 'servings']} value={servings} min={1} max={48} onChange={setServings} />
              </div>

              <label className="rc-toggle">
                <input type="checkbox" checked={usePantry} onChange={(e) => setUsePantry(e.target.checked)} />
                <span>
                  Tell it what’s in my pantry
                  <small>{kitchen.state.have.length ? `${kitchen.state.have.length} things, so it can use them up` : 'Nothing marked yet'}</small>
                </span>
              </label>
              <label className="rc-toggle">
                <input type="checkbox" checked={useMine} onChange={(e) => setUseMine(e.target.checked)} />
                <span>
                  Tell it the recipes I have
                  <small>{mode === 'week' ? 'So it mixes them in instead of rewriting them' : 'So it doesn’t write them again'}</small>
                </span>
              </label>

              <section className={`rc-ai-step${copied === 'copied' ? ' is-done' : ''}`}>
                <h3>
                  <span className="rc-ai-num">{copied === 'copied' ? '✓' : 1}</span> Copy this into your AI
                </h3>
                <div className="rc-ai-actions">
                  <button type="button" className={`btn ${copied === 'copied' ? 'btn-secondary' : 'btn-primary'}`} onClick={copy}>
                    {copied === 'copied' ? 'Copied' : 'Copy prompt'}
                  </button>
                  <button type="button" className="rc-text-btn" aria-expanded={showPrompt} onClick={() => setShowPrompt((v) => !v)}>
                    {showPrompt ? 'Hide the prompt' : 'Read the prompt'}
                  </button>
                </div>
                {copied === 'failed' && <p className="rc-sheet-error">Couldn’t reach the clipboard. It’s selected below, so copy it from there.</p>}
                {showPrompt && <textarea ref={promptBox} className="rc-input rc-ai-prompt" readOnly rows={7} value={prompt} aria-label="The prompt to copy" />}
              </section>

              <section className="rc-ai-step">
                <h3>
                  <span className="rc-ai-num">2</span> Paste what it wrote
                </h3>
                <textarea
                  className="rc-input"
                  rows={replyText ? 6 : 3}
                  placeholder="Paste the whole reply here"
                  aria-label="The AI’s reply"
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    setError('');
                  }}
                />
              </section>
            </>
          )}
        </div>

        <div className="rc-sheet-actions">
          {reply ? (
            <>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setReply(null)}>
                Back
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : reply.plan.length ? 'Add to my week' : 'Save recipes'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={!replyText.trim()} onClick={read}>
                Read the reply
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
