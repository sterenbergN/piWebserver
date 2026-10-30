'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import type { Recipe, UnitMode } from '@/lib/recipes/recipes';
import RecipeEditor, { emptyDraft, recipeToDraft, type EditorDraft } from './RecipeEditor';
import RecipeList from './RecipeList';
import RecipeView from './RecipeView';
import { useRecipeTimers } from './useRecipeTimers';
import './recipes.css';

const UNITS_PREF = 'recipes:units';
const CART_PREF = 'recipes:cart';

function readCart(): string[] {
  try {
    const saved = JSON.parse(readPref(CART_PREF) || '[]');
    return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export default function RecipesPage() {
  const { confirm, showAlert, popup } = useSitePopup();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [canEdit, setCanEdit] = useState(false);
  const [deletableIds, setDeletableIds] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [unitMode, setUnitMode] = useState<UnitMode>('us');
  const [cartIds, setCartIds] = useState<string[]>([]);
  /** The last cook logged here, so a mistaken tap can be taken back for a few seconds. */
  const [lastCook, setLastCook] = useState<{ id: string; previous?: string } | null>(null);
  const timers = useRecipeTimers();

  // Load recipes and this device's settings, and follow ?recipe= (the phone's back button included).
  useEffect(() => {
    const syncFromUrl = () => setSelectedSlug(new URLSearchParams(window.location.search).get('recipe'));
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    if (readPref(UNITS_PREF) === 'metric') setUnitMode('metric');
    setCartIds(readCart());

    fetch('/api/recipes')
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data?.recipes)) throw new Error('No recipes');
        setRecipes(data.recipes);
        setCanEdit(Boolean(data.canEdit));
        setDeletableIds(Array.isArray(data.deletableIds) ? data.deletableIds : []);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  useEffect(() => {
    if (!lastCook) return;
    const handle = window.setTimeout(() => setLastCook(null), 10_000);
    return () => window.clearTimeout(handle);
  }, [lastCook]);

  const openRecipe = useCallback((slug: string | null) => {
    setSelectedSlug(slug);
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('recipe', slug);
    else url.searchParams.delete('recipe');
    window.history.pushState({}, '', url.toString());
    window.scrollTo(0, 0);
  }, []);

  const changeUnits = (mode: UnitMode) => {
    setUnitMode(mode);
    savePref(UNITS_PREF, mode);
  };

  const changeCart = (ids: string[]) => {
    setCartIds(ids);
    savePref(CART_PREF, JSON.stringify(ids));
  };

  const activeRecipe = useMemo(
    () => (selectedSlug ? recipes.find((r) => r.slug === selectedSlug || r.id === selectedSlug) || null : null),
    [recipes, selectedSlug],
  );

  const logCook = async (recipe: Recipe, undo = false) => {
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          undo
            ? { type: 'uncooked', id: recipe.id, previousLastCookedAt: lastCook?.previous }
            : { type: 'cooked', id: recipe.id },
        ),
      });
      const data = await res.json();
      if (!res.ok || !data?.recipe) {
        await showAlert(data?.message || 'Could not update the cook log.');
        return;
      }
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? data.recipe : r)));
      setLastCook(undo ? null : { id: recipe.id, previous: recipe.lastCookedAt });
    } catch {
      await showAlert('Could not update the cook log.');
    }
  };

  const deleteRecipe = async (recipe: Recipe) => {
    const ok = await confirm({
      title: 'Delete recipe',
      message: `Delete "${recipe.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'delete', id: recipe.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        await showAlert(d?.message || 'Delete failed.');
        return;
      }
      setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
      changeCart(cartIds.filter((id) => id !== recipe.id));
      openRecipe(null);
    } catch {
      await showAlert('Delete failed.');
    }
  };

  const handleSaved = (saved: Recipe, canDelete: boolean) => {
    setRecipes((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev]));
    if (canDelete) setDeletableIds((prev) => (prev.includes(saved.id) ? prev : [...prev, saved.id]));
    setDraft(null);
    openRecipe(saved.slug);
  };

  if (loadState === 'loading') {
    return <p className="rc-page rc-empty">Loading recipes…</p>;
  }

  if (draft) {
    return (
      <>
        {popup}
        <RecipeEditor initial={draft} timers={timers} onCancel={() => setDraft(null)} onSaved={handleSaved} showAlert={showAlert} />
      </>
    );
  }

  if (activeRecipe) {
    return (
      <>
        {popup}
        <RecipeView
          key={activeRecipe.id}
          recipe={activeRecipe}
          canEdit={canEdit}
          canDelete={deletableIds.includes(activeRecipe.id)}
          inCart={cartIds.includes(activeRecipe.id)}
          unitMode={unitMode}
          timers={timers}
          cookLogged={lastCook?.id === activeRecipe.id}
          onUnitMode={changeUnits}
          onToggleCart={() =>
            changeCart(cartIds.includes(activeRecipe.id) ? cartIds.filter((id) => id !== activeRecipe.id) : [...cartIds, activeRecipe.id])
          }
          onBack={() => openRecipe(null)}
          onOpenRecipe={openRecipe}
          onEdit={() => setDraft(recipeToDraft(activeRecipe))}
          onDelete={() => deleteRecipe(activeRecipe)}
          onLogCook={(undo) => logCook(activeRecipe, undo)}
          showAlert={showAlert}
        />
      </>
    );
  }

  return (
    <>
      {popup}
      <RecipeList
        recipes={recipes}
        loadState={loadState}
        notFound={Boolean(selectedSlug) && loadState === 'ready'}
        canEdit={canEdit}
        unitMode={unitMode}
        cartIds={cartIds}
        onCartChange={changeCart}
        timers={timers}
        onOpen={openRecipe}
        onNew={() => setDraft(emptyDraft())}
        onDismissNotFound={() => openRecipe(null)}
        showAlert={showAlert}
      />
    </>
  );
}
