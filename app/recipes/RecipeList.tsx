'use client';

import { useMemo, useState } from 'react';
import { mediaSrc } from '@/lib/media-url';
import {
  CATEGORY_LABELS,
  RECIPE_CATEGORIES,
  buildSchedule,
  extractIngredients,
  formatBomAmount,
  matchPantry,
  type Recipe,
  type RecipeCategory,
  type UnitMode,
} from '@/lib/recipes/recipes';
import { TimerPills, copyShoppingList } from './shared';
import type { RecipeTimers } from './useRecipeTimers';

type SortMode = 'rating' | 'fastest' | 'fewest_ing' | 'most_cooked' | 'protein_efficiency';

const QUICK_FILTERS = [
  { id: 'fast', label: 'Under 25 min' },
  { id: 'one-pan', label: 'One pan' },
  { id: 'high-protein', label: 'High protein' },
  { id: 'cast-iron', label: 'Cast iron' },
  { id: 'sheet-pan', label: 'Sheet pan' },
];

export default function RecipeList({
  recipes,
  loadState,
  notFound,
  canEdit,
  unitMode,
  cartIds,
  onCartChange,
  timers,
  onOpen,
  onNew,
  onDismissNotFound,
  showAlert,
}: {
  recipes: Recipe[];
  loadState: 'ready' | 'error';
  notFound: boolean;
  canEdit: boolean;
  unitMode: UnitMode;
  cartIds: string[];
  onCartChange: (ids: string[]) => void;
  timers: RecipeTimers;
  onOpen: (slug: string) => void;
  onNew: () => void;
  onDismissNotFound: () => void;
  showAlert: (message: string) => Promise<void> | void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [pantryQuery, setPantryQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<RecipeCategory | 'all'>('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('rating');
  const [showFilters, setShowFilters] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [gotItems, setGotItems] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  // Precompute ingredients, schedule and pantry match for every recipe.
  const enriched = useMemo(
    () =>
      recipes.map((recipe) => {
        const proteinEfficiency =
          recipe.macros?.protein && recipe.macros?.calories ? (recipe.macros.protein * 100) / recipe.macros.calories : 0;
        return {
          recipe,
          bom: extractIngredients(recipe),
          schedule: buildSchedule(recipe),
          pantry: matchPantry(recipe, pantryQuery),
          proteinEfficiency,
        };
      }),
    [recipes, pantryQuery],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = enriched.filter(({ recipe, bom, schedule }) => {
      if (categoryFilter !== 'all' && recipe.category !== categoryFilter) return false;
      if (quickFilter === 'fast' && schedule.totalMinutes > 25) return false;
      if (quickFilter === 'one-pan' && !recipe.equipment.some((e) => /one-pan|one-pot|sheet pan/i.test(e))) return false;
      if (quickFilter === 'high-protein' && (recipe.macros?.protein || 0) < 30) return false;
      if (quickFilter === 'cast-iron' && !recipe.equipment.some((e) => /cast iron/i.test(e))) return false;
      if (quickFilter === 'sheet-pan' && !recipe.equipment.some((e) => /sheet pan/i.test(e))) return false;
      if (!q) return true;
      const hay = [recipe.title, recipe.summary, recipe.category, ...recipe.equipment, ...recipe.tags, ...bom.map((b) => b.name)]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
    return list.sort((a, b) => {
      if (pantryQuery.trim() && b.pantry.ratio !== a.pantry.ratio) return b.pantry.ratio - a.pantry.ratio;
      if (sortMode === 'fastest') return a.schedule.totalMinutes - b.schedule.totalMinutes;
      if (sortMode === 'fewest_ing') return a.bom.length - b.bom.length;
      if (sortMode === 'most_cooked') return (b.recipe.timesCooked || 0) - (a.recipe.timesCooked || 0);
      if (sortMode === 'protein_efficiency') return b.proteinEfficiency - a.proteinEfficiency;
      return (b.recipe.rating || 0) - (a.recipe.rating || 0);
    });
  }, [enriched, searchQuery, categoryFilter, quickFilter, sortMode, pantryQuery]);

  // Only categories that have something in them are worth a chip.
  const categories = RECIPE_CATEGORIES.filter((c) => recipes.some((r) => r.category === c));

  // Every picked recipe's ingredients, merged.
  const cartBom = useMemo(() => {
    const selected = recipes.filter((r) => cartIds.includes(r.id));
    return selected.length ? extractIngredients({ sections: selected.flatMap((r) => r.sections.map(({ name, steps }) => ({ name, steps }))) }) : [];
  }, [recipes, cartIds]);
  const cartCount = recipes.filter((r) => cartIds.includes(r.id)).length;

  const activeFilterCount = (quickFilter ? 1 : 0) + (pantryQuery.trim() ? 1 : 0) + (sortMode !== 'rating' ? 1 : 0);

  const handleCopy = async () => {
    const ok = await copyShoppingList(cartBom, 1, unitMode, `Grocery list (${cartCount} recipes)`);
    if (!ok) {
      await showAlert('Could not access the clipboard.');
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rc-page rc-narrow">
      <header className="rc-list-head">
        <h1>Recipes</h1>
        {canEdit && (
          <button type="button" className="rc-text-btn" onClick={onNew}>
            + New
          </button>
        )}
      </header>

      {notFound && (
        <div className="rc-notice">
          That recipe wasn’t found. It may have been renamed or deleted.
          <button type="button" className="rc-text-btn" onClick={onDismissNotFound}>
            OK
          </button>
        </div>
      )}

      <div className="rc-search">
        <input
          type="search"
          className="rc-input"
          placeholder="Search recipes or ingredients"
          aria-label="Search recipes or ingredients"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          type="button"
          className={`rc-filter-btn${showFilters || activeFilterCount ? ' is-active' : ''}`}
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="rc-filters">
          <label className="rc-field">
            What’s in your kitchen?
            <input
              className="rc-input"
              placeholder="chicken, rice, garlic"
              value={pantryQuery}
              onChange={(e) => setPantryQuery(e.target.value)}
            />
          </label>
          <div className="rc-chips rc-chips-wrap">
            {QUICK_FILTERS.map((qf) => (
              <button
                key={qf.id}
                type="button"
                className={`rc-chip${quickFilter === qf.id ? ' is-active' : ''}`}
                aria-pressed={quickFilter === qf.id}
                onClick={() => setQuickFilter(quickFilter === qf.id ? null : qf.id)}
              >
                {qf.label}
              </button>
            ))}
          </div>
          <label className="rc-field">
            Sort by
            <select className="rc-input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="rating">Highest rated</option>
              <option value="fastest">Fastest</option>
              <option value="fewest_ing">Fewest ingredients</option>
              <option value="protein_efficiency">Most protein per calorie</option>
              <option value="most_cooked">Most cooked</option>
            </select>
          </label>
        </div>
      )}

      {categories.length > 1 && (
        <div className="rc-chips">
          <button
            type="button"
            className={`rc-chip${categoryFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`rc-chip${categoryFilter === cat ? ' is-active' : ''}`}
              aria-pressed={categoryFilter === cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
            >
              {CATEGORY_LABELS[cat].label}
            </button>
          ))}
        </div>
      )}

      {loadState === 'error' && <div className="rc-notice">Couldn’t load the recipes. Try refreshing the page.</div>}
      {loadState === 'ready' && filtered.length === 0 && (
        <p className="rc-empty">
          {recipes.length === 0 ? (canEdit ? 'No recipes yet. Add the first one with + New.' : 'No recipes yet.') : 'No recipes match that.'}
        </p>
      )}

      <ul className="rc-list">
        {filtered.map(({ recipe, bom, schedule, pantry }) => {
          const inCart = cartIds.includes(recipe.id);
          return (
            <li key={recipe.id} className="rc-row">
              <a
                className="rc-row-main"
                href={`/recipes?recipe=${encodeURIComponent(recipe.slug)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return; // leave "open in a new tab" alone
                  e.preventDefault();
                  onOpen(recipe.slug);
                }}
              >
                {recipe.photo && (
                  <img src={mediaSrc(recipe.photo, 400)} alt="" className="rc-row-photo" loading="lazy" decoding="async" />
                )}
                <span className="rc-row-text">
                  <span className="rc-row-title">{recipe.title}</span>
                  <span className="rc-meta">
                    {schedule.totalMinutes} min · {bom.length} {bom.length === 1 ? 'ingredient' : 'ingredients'}
                    {recipe.rating ? ` · ★ ${recipe.rating.toFixed(1)}` : ''}
                  </span>
                  {pantryQuery.trim() && (
                    <span className="rc-meta rc-row-pantry">
                      {pantry.missing.length === 0
                        ? 'You have everything'
                        : `Need ${pantry.missing.slice(0, 3).join(', ').toLowerCase()}${pantry.missing.length > 3 ? ` +${pantry.missing.length - 3}` : ''}`}
                    </span>
                  )}
                </span>
              </a>
              <button
                type="button"
                className={`rc-add${inCart ? ' is-active' : ''}`}
                aria-pressed={inCart}
                aria-label={inCart ? `Remove ${recipe.title} from grocery list` : `Add ${recipe.title} to grocery list`}
                title={inCart ? 'On your grocery list' : 'Add to grocery list'}
                onClick={() => onCartChange(inCart ? cartIds.filter((id) => id !== recipe.id) : [...cartIds, recipe.id])}
              >
                {inCart ? '✓' : '+'}
              </button>
            </li>
          );
        })}
      </ul>

      {(timers.hasTimers || cartCount > 0) && (
        <div className="rc-dock">
          <TimerPills timers={timers} onOpenRecipe={onOpen} />
          {cartCount > 0 && (
            <button type="button" className="btn btn-primary rc-dock-main" onClick={() => setShowCart(true)}>
              Grocery list · {cartBom.length} items
            </button>
          )}
        </div>
      )}

      {showCart && cartCount > 0 && (
        <div className="rc-sheet-backdrop" onClick={() => setShowCart(false)}>
          <div
            className="rc-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Grocery list"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rc-sheet-head">
              <h2>Grocery list</h2>
              <button type="button" className="rc-icon-btn" onClick={() => setShowCart(false)} aria-label="Close">
                ×
              </button>
            </div>
            <p className="rc-meta">
              {cartCount} {cartCount === 1 ? 'recipe' : 'recipes'}, at their usual servings
            </p>
            <ul className="rc-ingredients">
              {cartBom.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`rc-ing-row${gotItems[item.key] ? ' is-done' : ''}`}
                    aria-pressed={Boolean(gotItems[item.key])}
                    onClick={() => setGotItems((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                  >
                    <span className="rc-check" aria-hidden="true">{gotItems[item.key] ? '✓' : ''}</span>
                    <span className="rc-ing-amt">{formatBomAmount(item, 1, unitMode)}</span>
                    <span>{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="rc-sheet-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onCartChange([]);
                  setGotItems({});
                  setShowCart(false);
                }}
              >
                Clear
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy list'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
