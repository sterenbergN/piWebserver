'use client';

import { useMemo, useState } from 'react';
import { haveSet, missingIngredients } from '@/lib/recipes/kitchen';
import { mediaSrc } from '@/lib/media-url';
import {
  CATEGORY_LABELS,
  RECIPE_CATEGORIES,
  buildSchedule,
  extractIngredients,
  type Recipe,
  type RecipeCategory,
} from '@/lib/recipes/recipes';
import { formatMinutes, readSavedCook } from './shared';
import type { Kitchen } from './useKitchen';

type SortMode = 'rating' | 'fastest' | 'fewest_ing' | 'most_cooked' | 'protein_efficiency' | 'newest';

const QUICK_FILTERS = [
  { id: 'ready', label: 'Have it all' },
  { id: 'almost', label: 'Missing 1–2' },
  { id: 'fast', label: 'Under 25 min' },
  { id: 'one-pan', label: 'One pan' },
  { id: 'high-protein', label: 'High protein' },
  { id: 'untried', label: 'Not cooked yet' },
];

// A hand-filed look: each card sits a touch off square, the same way every time.
const TILTS = [-0.5, 0.35, -0.2, 0.55, -0.4, 0.2];

/** The recipe box: a card for each recipe. */
export default function RecipeList({
  recipes,
  loadState,
  notFound,
  canEdit,
  kitchen,
  onOpen,
  onAdd,
  onPlan,
  onDismissNotFound,
}: {
  recipes: Recipe[];
  loadState: 'ready' | 'error';
  notFound: boolean;
  canEdit: boolean;
  kitchen: Kitchen;
  onOpen: (slug: string) => void;
  onAdd: () => void;
  onPlan: (recipe: Recipe) => void;
  onDismissNotFound: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<RecipeCategory | 'all'>('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('rating');
  const [showFilters, setShowFilters] = useState(false);
  const [savedCook] = useState(readSavedCook);

  const have = useMemo(() => haveSet(kitchen.state), [kitchen.state]);
  const tracksHave = kitchen.state.have.length > 0;

  const enriched = useMemo(
    () =>
      recipes.map((recipe) => {
        const proteinEfficiency =
          recipe.macros?.protein && recipe.macros?.calories ? (recipe.macros.protein * 100) / recipe.macros.calories : 0;
        return {
          recipe,
          bom: extractIngredients(recipe),
          schedule: buildSchedule(recipe),
          missing: missingIngredients(recipe, have),
          proteinEfficiency,
        };
      }),
    [recipes, have],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = enriched.filter(({ recipe, bom, schedule, missing }) => {
      if (categoryFilter !== 'all' && recipe.category !== categoryFilter) return false;
      if (quickFilter === 'ready' && missing.length > 0) return false;
      if (quickFilter === 'almost' && (missing.length === 0 || missing.length > 2)) return false;
      if (quickFilter === 'fast' && schedule.totalMinutes > 25) return false;
      if (quickFilter === 'one-pan' && !recipe.equipment.some((e) => /one-pan|one-pot|sheet pan/i.test(e))) return false;
      if (quickFilter === 'high-protein' && (recipe.macros?.protein || 0) < 30) return false;
      if (quickFilter === 'untried' && recipe.timesCooked > 0) return false;
      if (!q) return true;
      const hay = [recipe.title, recipe.summary, recipe.category, ...recipe.equipment, ...recipe.tags, ...bom.map((b) => b.name)]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
    return list.sort((a, b) => {
      if (sortMode === 'fastest') return a.schedule.totalMinutes - b.schedule.totalMinutes;
      if (sortMode === 'fewest_ing') return a.bom.length - b.bom.length;
      if (sortMode === 'most_cooked') return (b.recipe.timesCooked || 0) - (a.recipe.timesCooked || 0);
      if (sortMode === 'protein_efficiency') return b.proteinEfficiency - a.proteinEfficiency;
      if (sortMode === 'newest') return b.recipe.createdAt.localeCompare(a.recipe.createdAt);
      return (b.recipe.rating || 0) - (a.recipe.rating || 0);
    });
  }, [enriched, searchQuery, categoryFilter, quickFilter, sortMode]);

  // Only categories that have something in them are worth a chip.
  const categories = RECIPE_CATEGORIES.filter((c) => recipes.some((r) => r.category === c));
  const resumable = savedCook && savedCook.step > 0 && recipes.some((r) => r.slug === savedCook.slug) ? savedCook : null;
  const activeFilterCount = (quickFilter ? 1 : 0) + (sortMode !== 'rating' ? 1 : 0);

  return (
    <>
      {notFound && (
        <div className="rc-notice">
          That recipe wasn’t found. It may have been renamed or deleted{canEdit ? '' : ', or you may need to sign in to see it'}.
          <button type="button" className="rc-text-btn" onClick={onDismissNotFound}>
            OK
          </button>
        </div>
      )}

      {resumable && (
        <button type="button" className="rc-resume" onClick={() => onOpen(resumable.slug)}>
          <span>
            <span className="rc-meta">Continue cooking · step {resumable.step + 1}</span>
            <span className="rc-row-title">{resumable.title}</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}

      <div className="rc-search">
        <input
          type="search"
          className="rc-input"
          placeholder="Search recipes"
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
        {canEdit && (
          <button type="button" className="btn btn-primary rc-new-btn" onClick={onAdd}>
            + Add
          </button>
        )}
      </div>

      {showFilters && (
        <div className="rc-filters">
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
          {!tracksHave && <p className="rc-meta">Mark what you already have on any recipe, and “Have it all” finds what you can make right now.</p>}
          <label className="rc-field">
            Sort by
            <select className="rc-input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="rating">Highest rated</option>
              <option value="newest">Newest</option>
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
          {recipes.length === 0 ? (canEdit ? 'No recipes yet. Add the first one with + Add.' : 'No recipes yet.') : 'No recipes match that.'}
        </p>
      )}

      <ul className="rc-cards">
        {filtered.map(({ recipe, bom, schedule, missing }, index) => (
          <li key={recipe.id} className="rc-card" style={{ '--rc-tilt': `${TILTS[index % TILTS.length]}deg` } as React.CSSProperties}>
            <a
              className="rc-card-link"
              href={`/recipes?recipe=${encodeURIComponent(recipe.slug)}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return; // leave "open in a new tab" alone
                e.preventDefault();
                onOpen(recipe.slug);
              }}
            >
              <span className="rc-card-head">
                <span className="rc-card-category">{CATEGORY_LABELS[recipe.category]?.label}</span>
                {recipe.rating ? <span className="rc-card-rating">★ {recipe.rating.toFixed(1)}</span> : null}
              </span>
              <span className="rc-card-title">{recipe.title}</span>
              <span className="rc-card-line">
                {formatMinutes(schedule.totalMinutes)} · serves {recipe.servings}
              </span>
              <span className={`rc-card-line${tracksHave && missing.length === 0 ? ' is-ready' : ''}`}>
                {tracksHave
                  ? missing.length === 0
                    ? '✓ You have everything'
                    : `Need ${missing.length} of ${bom.length} ingredients`
                  : `${bom.length} ingredients`}
              </span>
              <span className="rc-card-line rc-card-foot">
                {recipe.macros?.protein !== undefined ? `${recipe.macros.protein} g protein` : ''}
                {recipe.macros?.protein !== undefined && recipe.timesCooked > 0 ? ' · ' : ''}
                {recipe.timesCooked > 0 ? `Made ${recipe.timesCooked}×` : ''}
                {recipe.private ? ' · Private' : ''}
              </span>
              <span className="rc-snapshot" aria-hidden="true">
                {recipe.photo ? (
                  <img src={mediaSrc(recipe.photo, 400)} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="rc-snapshot-blank">{CATEGORY_LABELS[recipe.category]?.emoji}</span>
                )}
              </span>
            </a>
            <button
              type="button"
              className="rc-card-add"
              aria-label={`Plan ${recipe.title}`}
              title="Add to your week or shopping list"
              onClick={() => onPlan(recipe)}
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
