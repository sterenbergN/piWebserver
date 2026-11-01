'use client';

import { useMemo, useState } from 'react';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { buildShoppingList, currentWeek, restockKey, weekLabel, type PutAwayItem, type ShoppingItem } from '@/lib/recipes/kitchen';
import { canonicalIngredientKey, formatBomAmount, parseIngredientLine, type Recipe, type UnitMode } from '@/lib/recipes/recipes';
import { stockLabel } from './shared';
import type { Kitchen } from './useKitchen';

/** Plan items are checked off per week, so buying beef this week doesn't tick next week's. */
const gotKey = (week: DateKey, key: string) => `${week}|${key}`;

function sharedAcross(item: ShoppingItem) {
  if (item.sources.length <= 1) return item.sources[0] || '';
  return `${item.sources.length} recipes`;
}

/** The list as a notepad: by aisle, without what you already have. */
export default function ShoppingView({
  recipes,
  kitchen,
  week,
  unitMode,
  onWeek,
  onShowWeek,
  onShowPantry,
  onConfirm,
  onFlash,
}: {
  recipes: Recipe[];
  kitchen: Kitchen;
  week: DateKey;
  unitMode: UnitMode;
  onWeek: (week: DateKey) => void;
  onShowWeek: () => void;
  onShowPantry: () => void;
  onConfirm: (message: string) => Promise<boolean>;
  onFlash: (message: string) => void;
}) {
  const { state, household } = kitchen;
  const [newItem, setNewItem] = useState('');
  /** Who else put something on the list. */
  const addedBy = (id?: string) => (id && id !== household?.me ? household?.members.find((m) => m.id === id)?.name : undefined);
  const list = useMemo(() => buildShoppingList(recipes, state, week), [recipes, state, week]);

  const got = useMemo(() => new Set(state.got), [state.got]);
  const planCount = (state.plans[week] || []).filter((e) => !e.cooked).length;
  const oneOffs = state.listRecipes.flatMap((r) => {
    const recipe = recipes.find((x) => x.id === r.recipeId);
    return recipe ? [{ recipe, servings: r.servings }] : [];
  });

  const total = list.need.length + list.restock.length + state.listItems.length;
  const done =
    list.need.filter((i) => got.has(gotKey(week, i.key))).length +
    list.restock.filter((i) => got.has(restockKey(i.key))).length +
    state.listItems.filter((i) => got.has(i.id)).length;

  // Home from the store: everything ticked goes on the shelf and comes off the list.
  const putAway = () => {
    const bought = list.need.filter((i) => got.has(gotKey(week, i.key)));
    const restocked = list.restock.filter((i) => got.has(restockKey(i.key)));
    const typed = state.listItems.filter((i) => got.has(i.id));
    const items: PutAwayItem[] = [
      ...bought.map(({ key, name, usQty, usUnit, metricQty, metricUnit }) => ({ key, name, amount: { usQty, usUnit, metricQty, metricUnit } })),
      ...restocked.map(({ key, name }) => ({ key, name })),
      ...typed.flatMap((i) => {
        const { key, name, amount } = parseIngredientLine(i.text);
        return key ? [{ key, name, amount }] : [];
      }),
    ];
    kitchen.putAway(items, [...bought.map((i) => gotKey(week, i.key)), ...restocked.map((i) => restockKey(i.key))], typed.map((i) => i.id));
    onFlash(`Put away ${items.length} ${items.length === 1 ? 'thing' : 'things'}`);
  };

  const listText = () => {
    const lines: string[] = [`Shopping list (${weekLabel(week)})`];
    for (const group of list.groups) {
      const left = group.items.filter((i) => !got.has(gotKey(week, i.key)));
      if (!left.length) continue;
      lines.push('', group.aisle);
      for (const item of left) {
        const amount = formatBomAmount(item, 1, unitMode);
        lines.push(`- [ ] ${amount ? `${amount} ` : ''}${item.name}`);
      }
    }
    const restock = list.restock.filter((i) => !got.has(restockKey(i.key)));
    if (restock.length) {
      lines.push('', 'Restock');
      for (const item of restock) lines.push(`- [ ] ${item.name}`);
    }
    const extras = state.listItems.filter((i) => !got.has(i.id));
    if (extras.length) {
      lines.push('', 'Also');
      for (const item of extras) lines.push(`- [ ] ${item.text}`);
    }
    return lines.join('\n');
  };

  const shareOrCopy = async () => {
    const text = listText();
    try {
      if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Shopping list', text });
        return;
      }
      await navigator.clipboard.writeText(text);
      onFlash('Copied the list');
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') onFlash('Couldn’t copy the list');
    }
  };

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    kitchen.addListItem(newItem);
    setNewItem('');
  };

  return (
    <>
      <div className="rc-week-nav rc-week-head">
        <button type="button" className="rc-icon-btn" aria-label="Previous week" onClick={() => onWeek(addDays(week, -7))}>
          ‹
        </button>
        <div>
          <strong>{weekLabel(week)}</strong>
          {week !== currentWeek() && (
            <button type="button" className="rc-link-small" onClick={() => onWeek(currentWeek())}>
              Back to this week
            </button>
          )}
        </div>
        <button type="button" className="rc-icon-btn" aria-label="Next week" onClick={() => onWeek(addDays(week, 7))}>
          ›
        </button>
      </div>

      <div className="rc-notepad">
        <div className="rc-notepad-binding" aria-hidden="true" />
        <div className="rc-notepad-head">
          <h2>Shopping list</h2>
          <span className="rc-meta">{total ? `${done} of ${total}` : ''}</span>
        </div>
        <div className="rc-notepad-sources">
          {planCount > 0 && (
            <button type="button" className="rc-source-chip" onClick={onShowWeek}>
              Week’s plan · {planCount} {planCount === 1 ? 'meal' : 'meals'}
            </button>
          )}
          {oneOffs.map(({ recipe, servings }) => (
            <span key={recipe.id} className="rc-source-chip">
              {recipe.title} · {servings}
              <button type="button" aria-label={`Take ${recipe.title} off the list`} onClick={() => kitchen.removeListRecipe(recipe.id)}>
                ×
              </button>
            </span>
          ))}
        </div>

        {total === 0 && (
          <p className="rc-notepad-empty">
            {list.have.length
              ? 'You have everything for this. Nice.'
              : 'Nothing yet. Plan some meals for the week, or add a recipe’s missing ingredients from its page.'}
          </p>
        )}

        {list.groups.map((group) => (
          <section key={group.aisle} className="rc-aisle">
            <h3>{group.aisle}</h3>
            <ul>
              {group.items.map((item) => {
                const key = gotKey(week, item.key);
                const isGot = got.has(key);
                return (
                  <li key={item.key} className={`rc-shop-row${isGot ? ' is-done' : ''}`}>
                    <button type="button" className="rc-shop-main" aria-pressed={isGot} onClick={() => kitchen.toggleGot(key)}>
                      <span className="rc-check" aria-hidden="true">{isGot ? '✓' : ''}</span>
                      <span className="rc-shop-text">
                        <span>
                          <strong className="rc-amt">{formatBomAmount(item, 1, unitMode)}</strong> {item.name}
                        </span>
                        <small>
                          {sharedAcross(item)}
                          {item.inStock ? ` · on top of ${stockLabel(item.inStock, unitMode, state.pantry[item.key]?.estimated)} at home` : ''}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rc-have-btn"
                      onClick={() => kitchen.setPantry(item.key, item.name, { amount: null, low: false })}
                      title="There's enough at home: take it off the list"
                    >
                      Have it
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {list.restock.length > 0 && (
          <section className="rc-aisle">
            <h3>Restock</h3>
            <ul>
              {list.restock.map((item) => {
                const key = restockKey(item.key);
                const isGot = got.has(key);
                return (
                  <li key={item.key} className={`rc-shop-row${isGot ? ' is-done' : ''}`}>
                    <button type="button" className="rc-shop-main" aria-pressed={isGot} onClick={() => kitchen.toggleGot(key)}>
                      <span className="rc-check" aria-hidden="true">{isGot ? '✓' : ''}</span>
                      <span className="rc-shop-text">
                        <span>{item.name}</span>
                        <small>{item.low ? 'Running low' : 'Ran out'}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rc-icon-btn"
                      aria-label={item.low ? `${item.name} can wait` : `Don’t need ${item.name}`}
                      title={item.low ? 'It can wait' : 'Don’t need it'}
                      onClick={() => (item.low ? kitchen.setPantry(item.key, item.name, { low: false }) : kitchen.forgetPantry(item.key))}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {state.listItems.length > 0 && (
          <section className="rc-aisle">
            <h3>Also</h3>
            <ul>
              {state.listItems.map((item) => {
                const isGot = got.has(item.id);
                const from = addedBy(item.by);
                const atHome = state.have.includes(canonicalIngredientKey(item.text));
                return (
                  <li key={item.id} className={`rc-shop-row${isGot ? ' is-done' : ''}`}>
                    <button type="button" className="rc-shop-main" aria-pressed={isGot} onClick={() => kitchen.toggleGot(item.id)}>
                      <span className="rc-check" aria-hidden="true">{isGot ? '✓' : ''}</span>
                      <span className="rc-shop-text">
                        <span>{item.text}</span>
                        {(from || atHome) && <small>{[from && `from ${from}`, atHome && 'the pantry says there’s some at home'].filter(Boolean).join(' · ')}</small>}
                      </span>
                    </button>
                    <button type="button" className="rc-icon-btn" aria-label={`Remove ${item.text}`} onClick={() => kitchen.removeListItem(item.id)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <form className="rc-add-item" onSubmit={addItem}>
          <input
            className="rc-paper-input"
            placeholder="Add something else…"
            aria-label="Add something else to the list"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
          />
          {newItem.trim() && (
            <button type="submit" className="rc-text-btn">
              Add
            </button>
          )}
        </form>
      </div>

      {total > 0 && (
        <div className="rc-shop-actions">
          <button
            type="button"
            className="rc-text-btn rc-muted-btn"
            onClick={async () => {
              if (await onConfirm('Clear the ticks, typed items and one-off recipes? The week’s plan stays.')) kitchen.finishShopping();
            }}
          >
            Start over
          </button>
          <div className="rc-shop-main-actions">
            <button type="button" className={`btn ${done ? 'btn-secondary' : 'btn-primary'}`} onClick={shareOrCopy}>
              Share list
            </button>
            {done > 0 && (
              <button type="button" className="btn btn-primary" onClick={putAway}>
                Put away {done}
              </button>
            )}
          </div>
        </div>
      )}

      {list.have.length > 0 && (
        <details className="rc-details rc-have-box" open={list.have.length <= 6}>
          <summary>Already at home ({list.have.length})</summary>
          <p className="rc-meta">Tap one to put it back on the list.</p>
          <div className="rc-have-chips">
            {list.have.map((item) => (
              <button key={item.key} type="button" className="rc-chip" onClick={() => kitchen.toggleHave(item.key, item.name)}>
                {item.name} ×
              </button>
            ))}
          </div>
        </details>
      )}

      <button type="button" className="rc-week-summary rc-to-pantry" onClick={onShowPantry}>
        <span>Pantry</span>
        <strong>
          {state.have.length} at home <span aria-hidden="true">›</span>
        </strong>
      </button>
    </>
  );
}
