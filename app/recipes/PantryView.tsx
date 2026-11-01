'use client';

import { useMemo, useState } from 'react';
import { localToday } from '@/lib/habits/dates';
import {
  AISLES,
  aisleFor,
  canMakeNow,
  dayInfo,
  freshToUse,
  pantryChecks,
  pendingCooks,
} from '@/lib/recipes/kitchen';
import { parseIngredientLine, type Recipe, type UnitMode } from '@/lib/recipes/recipes';
import PantrySheet from './PantrySheet';
import { stockLabel } from './shared';
import type { Kitchen } from './useKitchen';

const MADE_SHELF = 'Made ahead';

/**
 * What's at home, as a set of shelves. It fills up as you mark things on recipes
 * and put the shopping away, so nothing has to be catalogued up front, and it
 * stays honest by asking about whatever's most likely wrong instead of relying
 * on every meal being logged.
 */
export default function PantryView({
  recipes,
  kitchen,
  unitMode,
  onOpenRecipe,
  onCooked,
  onShowList,
  onFlash,
}: {
  recipes: Recipe[];
  kitchen: Kitchen;
  unitMode: UnitMode;
  onOpenRecipe: (slug: string) => void;
  /** Cooked something off the plan: logs it and takes what it used off the shelf. */
  onCooked: (recipe: Recipe, servings: number) => void;
  onShowList: () => void;
  onFlash: (message: string) => void;
}) {
  const { state } = kitchen;
  const today = localToday();
  const [newItem, setNewItem] = useState('');
  const [query, setQuery] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [open, setOpen] = useState<{ key: string; name: string } | null>(null);
  const [cooking, setCooking] = useState(false);

  const checks = useMemo(() => pantryChecks(state, today).filter((c) => !skipped.includes(c.key)), [state, today, skipped]);
  const pending = useMemo(() => pendingCooks(recipes, state, today), [recipes, state, today]);
  const soon = useMemo(() => freshToUse(recipes, state, today), [recipes, state, today]);
  const ready = useMemo(() => canMakeNow(recipes, state).slice(0, 4), [recipes, state]);
  const recentCooks = useMemo(() => state.log.filter((e) => e.kind === 'cook').slice(-5).reverse(), [state.log]);

  const shelves = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = state.have.flatMap((key) => {
      const item = state.pantry[key];
      return item && (!q || item.name.toLowerCase().includes(q)) ? [{ key, ...item }] : [];
    });
    const shelfOf = (key: string, name: string) => (key.startsWith('made:') ? MADE_SHELF : aisleFor(name));
    return [MADE_SHELF, ...AISLES]
      .map((shelf) => ({ shelf, items: items.filter((i) => shelfOf(i.key, i.name) === shelf).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((s) => s.items.length);
  }, [state.have, state.pantry, query]);

  const ranOut = Object.entries(state.pantry).filter(([, item]) => item.out);
  const check = checks[0];

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    const { key, name, amount } = parseIngredientLine(text);
    if (key) kitchen.setPantry(key, name, { amount: amount ?? undefined, low: false });
    setNewItem('');
  };

  return (
    <>
      <form className="rc-add-pantry" onSubmit={add}>
        <input
          className="rc-input"
          placeholder="Add, e.g. 2 cups rice"
          aria-label="Add something you have"
          autoComplete="off"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={!newItem.trim()}>
          Add
        </button>
      </form>

      {pending.slice(0, 1).map(({ week, entry, recipe, date }) => (
        <section key={entry.id} className="rc-ask-card" aria-label="A meal on the plan">
          <p>
            <strong>Did you make {recipe.title}?</strong>
            <small>It was on the plan for {dayInfo(week, entry.day!, today).name}, {date.slice(5).replace('-', '/')}.</small>
          </p>
          <div className="rc-ask-actions">
            <button type="button" className="rc-paper-btn" onClick={() => kitchen.cook(recipe, entry.servings, { week, entry })}>
              Yes, I cooked it
            </button>
            <button type="button" className="rc-paper-btn" onClick={() => kitchen.removeEntry(week, entry.id)}>
              Skipped it
            </button>
          </div>
        </section>
      ))}

      {check && (
        <section className="rc-ask-card" aria-label="A quick pantry check">
          <p>
            <strong>Still got {check.name.toLowerCase()}?</strong>
            <small>
              {check.reason === 'used-up' ? 'By our count it should be used up.' : `It’s been ${check.days} days since anyone checked.`}
              {checks.length > 1 ? ` ${checks.length - 1} more after this.` : ''}
            </small>
          </p>
          <div className="rc-ask-actions">
            <button type="button" className="rc-paper-btn" onClick={() => kitchen.confirmPantry(check.key)}>
              Yes
            </button>
            <button type="button" className="rc-paper-btn" onClick={() => kitchen.setPantry(check.key, check.name, { low: true, ...(check.reason === 'used-up' ? { amount: null } : {}) })}>
              Running low
            </button>
            <button type="button" className="rc-paper-btn" onClick={() => kitchen.ranOut(check.key, check.name)}>
              Ran out
            </button>
          </div>
          <button type="button" className="rc-text-btn rc-muted-btn" onClick={() => setSkipped((prev) => [...prev, check.key])}>
            Not now
          </button>
        </section>
      )}

      {soon.length > 0 && (
        <section className="rc-pantry-note" aria-label="Use soon">
          <h3>Use soon</h3>
          <ul>
            {soon.slice(0, 4).map((item) => (
              <li key={item.key}>
                <span>
                  {item.name} <small>{item.days} days in</small>
                </span>
                {item.recipe && (
                  <button type="button" className="rc-link-small" onClick={() => onOpenRecipe(item.recipe!.slug)}>
                    {item.recipe.title}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready.length > 0 && (
        <section className="rc-pantry-note" aria-label="You could make">
          <h3>You could make right now</h3>
          <div className="rc-have-chips">
            {ready.map((recipe) => (
              <button key={recipe.id} type="button" className="rc-chip" onClick={() => onOpenRecipe(recipe.slug)}>
                {recipe.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {state.have.length > 12 && (
        <input
          type="search"
          className="rc-input rc-pantry-search"
          placeholder="Find something"
          aria-label="Find something in the pantry"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {state.have.length === 0 && ranOut.length === 0 && (
        <p className="rc-notepad-empty">
          Nothing on the shelves yet, and no need to list your whole kitchen. Tap what you have on any recipe, or put your shopping away, and it fills up on its own.
        </p>
      )}

      {shelves.map(({ shelf, items }) => (
        <section key={shelf} className="rc-shelf" aria-label={shelf}>
          <h3>{shelf}</h3>
          <div className="rc-shelf-items">
            {items.map((item) => {
              const gone = item.amount && [item.amount.usQty, item.amount.metricQty].every((q) => q === null || q <= 0);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`rc-jar${item.low ? ' is-low' : ''}${gone ? ' is-gone' : ''}`}
                  onClick={() => setOpen({ key: item.key, name: item.name })}
                >
                  <span>{item.name}</span>
                  {gone ? <small>probably used up</small> : item.low ? <small>running low</small> : item.amount ? <small>{stockLabel(item.amount, unitMode, item.estimated)}</small> : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {ranOut.length > 0 && (
        <details className="rc-details rc-have-box">
          <summary>Ran out ({ranOut.length})</summary>
          <p className="rc-meta">
            These are on your{' '}
            <button type="button" className="rc-link-small" onClick={onShowList}>
              shopping list
            </button>
            . Tap one if there’s some after all.
          </p>
          <div className="rc-have-chips">
            {ranOut.map(([key, item]) => (
              <button key={key} type="button" className="rc-chip" onClick={() => kitchen.confirmPantry(key)}>
                {item.name}
              </button>
            ))}
          </div>
        </details>
      )}

      <div className="rc-pantry-foot">
        <button type="button" className="rc-paper-btn" onClick={() => setCooking(true)}>
          I cooked something
        </button>
      </div>

      {recentCooks.length > 0 && (
        <details className="rc-details rc-have-box">
          <summary>Recent cooks</summary>
          <ul className="rc-recent-cooks">
            {recentCooks.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.title || 'A recipe'} <small>{entry.at.slice(5).replace('-', '/')}{entry.spent?.length ? `, took ${entry.spent.length} off the shelf` : ''}</small>
                </span>
                <button type="button" className="rc-text-btn" onClick={() => kitchen.undoCook(entry.id)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {open && <PantrySheet itemKey={open.key} name={open.name} kitchen={kitchen} unitMode={unitMode} onClose={() => setOpen(null)} onFlash={onFlash} />}

      {cooking && (
        <CookedSheet
          recipes={recipes}
          onClose={() => setCooking(false)}
          onDone={(recipe, servings) => {
            onCooked(recipe, servings);
            setCooking(false);
            onFlash(`Logged ${recipe.title}`);
          }}
        />
      )}
    </>
  );
}

/** Logging a meal after the fact, so the shelves catch up with what really happened. */
function CookedSheet({ recipes, onClose, onDone }: { recipes: Recipe[]; onClose: () => void; onDone: (recipe: Recipe, servings: number) => void }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Recipe | null>(null);
  const [servings, setServings] = useState(4);
  const matches = recipes.filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <div className="rc-sheet" role="dialog" aria-modal="true" aria-label="What did you cook?" onClick={(e) => e.stopPropagation()}>
        <div className="rc-sheet-head">
          <h2>{picked ? picked.title : 'What did you cook?'}</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {picked ? (
          <div className="rc-plan-body">
            <div className="rc-stepper" role="group" aria-label="Servings">
              <button type="button" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => setServings((s) => Math.max(1, s - 1))}>
                −
              </button>
              <span>
                {servings} {servings === 1 ? 'serving' : 'servings'}
              </span>
              <button type="button" aria-label="More servings" onClick={() => setServings((s) => Math.min(48, s + 1))}>
                +
              </button>
            </div>
            <div className="rc-sheet-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPicked(null)}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onDone(picked, servings)}>
                Log it
              </button>
            </div>
          </div>
        ) : (
          <>
            <input type="search" className="rc-input" placeholder="Search your recipes" aria-label="Search your recipes" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="rc-picker">
              {matches.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(recipe);
                      setServings(recipe.servings);
                    }}
                  >
                    <span className="rc-row-title">{recipe.title}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="rc-empty">No recipes match that.</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
