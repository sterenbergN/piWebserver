'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { RECIPES_COPY } from '@/lib/recipes/grocery-client';
import { currentWeek, groceriesLeft, pantryChecks, pendingCooks, planEntryFor, recipesFor } from '@/lib/recipes/kitchen';
import { madeKey, recipesUsing, type Recipe, type UnitMode } from '@/lib/recipes/recipes';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import AddRecipeSheet from './AddRecipeSheet';
import AiSheet from './AiSheet';
import HouseholdSheet, { HouseholdBar } from './HouseholdSheet';
import PantryView from './PantryView';
import PlanSheet from './PlanSheet';
import RecipeEditor, { emptyDraft, importedToDraft, recipeToDraft, type EditorDraft } from './RecipeEditor';
import RecipeList from './RecipeList';
import RecipeView from './RecipeView';
import ShoppingView from './ShoppingView';
import WeekView from './WeekView';
import { TimerAlerts, TimerPills } from './shared';
import { useKitchen } from './useKitchen';
import { useRecipeTimers } from './useRecipeTimers';
import './recipes.css';

const UNITS_PREF = 'recipes:units';

type View = 'recipes' | 'week' | 'list' | 'pantry';

const readView = (params: URLSearchParams): View => {
  const view = params.get('view');
  return view === 'week' || view === 'list' || view === 'pantry' ? view : 'recipes';
};

const BACK_LABELS: Record<View, string> = { recipes: 'Recipes', week: 'Week', list: 'Shopping', pantry: 'Pantry' };

export default function RecipesPage() {
  return (
    <Suspense fallback={<p className="rc-page rc-empty">Loading recipes…</p>}>
      <Recipes />
    </Suspense>
  );
}

function Recipes() {
  const { confirm, showAlert, popup } = useSitePopup();
  const searchParams = useSearchParams();

  /** As stored: linked parts are still links. Everything but the editor reads `cookable`. */
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [canEdit, setCanEdit] = useState(false);
  const [deletableIds, setDeletableIds] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [view, setView] = useState<View>('recipes');
  const [week, setWeek] = useState(() => currentWeek());
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showHousehold, setShowHousehold] = useState(false);
  const [aiMode, setAiMode] = useState<'recipes' | 'week' | null>(null);
  const [planning, setPlanning] = useState<{ recipe: Recipe; servings?: number } | null>(null);
  const [openServings, setOpenServings] = useState<number | undefined>();
  const [unitMode, setUnitMode] = useState<UnitMode>('us');
  const [flash, setFlash] = useState('');
  /** The last cook logged here, so a mistaken tap can be taken back for a few seconds. */
  const [lastCook, setLastCook] = useState<{ id: string; previous?: string; kitchenId: string } | null>(null);
  const timers = useRecipeTimers();
  const kitchen = useKitchen(canEdit);

  // Load recipes and this device's settings, and follow the URL (the phone's back button included).
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedSlug(params.get('recipe'));
      setView(readView(params));
    };
    window.addEventListener('popstate', syncFromUrl);
    if (readPref(UNITS_PREF) === 'metric') setUnitMode('metric');

    fetch('/api/recipes')
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data?.recipes)) throw new Error('No recipes');
        setRecipes(data.recipes);
        setCanEdit(Boolean(data.canEdit));
        setDeletableIds(Array.isArray(data.deletableIds) ? data.deletableIds : []);
        setLoadState('ready');
        savePref(RECIPES_COPY, JSON.stringify({ recipes: data.recipes, canEdit: Boolean(data.canEdit) }));
      })
      .catch(() => {
        try {
          const copy = JSON.parse(readPref(RECIPES_COPY) || 'null');
          if (!Array.isArray(copy?.recipes)) throw new Error('No copy');
          setRecipes(copy.recipes);
          setCanEdit(Boolean(copy.canEdit));
          setLoadState('ready');
          setFlash('Offline: showing your saved recipes');
        } catch {
          setLoadState('error');
        }
      });
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // A link to another view from outside the page (the launcher, search) lands here too.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    setSelectedSlug(params.get('recipe'));
    setView(readView(params));
  }, [searchParams]);

  useEffect(() => {
    if (!lastCook) return;
    const handle = window.setTimeout(() => setLastCook(null), 10_000);
    return () => window.clearTimeout(handle);
  }, [lastCook]);

  useEffect(() => {
    if (!flash) return;
    const handle = window.setTimeout(() => setFlash(''), 2500);
    return () => window.clearTimeout(handle);
  }, [flash]);

  const go = useCallback((next: { recipe?: string | null; view?: View }) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('recipe');
    url.searchParams.delete('view');
    if (next.recipe) url.searchParams.set('recipe', next.recipe);
    if (next.view && next.view !== 'recipes') url.searchParams.set('view', next.view);
    window.history.pushState({}, '', url.toString());
    setSelectedSlug(next.recipe ?? null);
    setView(next.view ?? 'recipes');
    window.scrollTo(0, 0);
  }, []);

  const openRecipe = useCallback(
    (slug: string | null, servings?: number) => {
      setOpenServings(servings);
      go({ recipe: slug, view });
    },
    [go, view],
  );

  const changeUnits = (mode: UnitMode) => {
    setUnitMode(mode);
    savePref(UNITS_PREF, mode);
  };

  const cookable = useMemo(() => recipesFor(recipes, kitchen.state), [recipes, kitchen.state]);

  const activeRecipe = useMemo(
    () => (selectedSlug ? cookable.find((r) => r.slug === selectedSlug || r.id === selectedSlug) || null : null),
    [cookable, selectedSlug],
  );

  const toBuy = useMemo(() => groceriesLeft(cookable, kitchen.state, week), [cookable, kitchen.state, week]);
  const toCheck = useMemo(() => pantryChecks(kitchen.state).length + pendingCooks(cookable, kitchen.state).length, [cookable, kitchen.state]);

  const postRecipe = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json().catch(() => ({})) };
  };

  // The count on the recipe is shared; what it took off the shelf is this household's.
  const logCook = async (recipe: Recipe, undo = false, servings?: number) => {
    try {
      if (canEdit) {
        const { res, data } = await postRecipe(
          undo ? { type: 'uncooked', id: recipe.id, previousLastCookedAt: lastCook?.previous } : { type: 'cooked', id: recipe.id },
        );
        if (!res.ok || !data?.recipe) {
          await showAlert(data?.message || 'Could not update the cook log.');
          return;
        }
        setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? data.recipe : r)));
      }
      if (undo) {
        if (lastCook) kitchen.undoCook(lastCook.kitchenId);
        setLastCook(null);
      } else {
        const plan = planEntryFor(kitchen.state, recipe.id);
        const kitchenId = kitchen.cook(recipe, servings ?? plan?.entry.servings ?? recipe.servings, plan ?? undefined);
        setLastCook({ id: recipe.id, previous: recipe.lastCookedAt, kitchenId });
      }
    } catch {
      await showAlert('Could not update the cook log.');
    }
  };

  const rateRecipe = async (recipe: Recipe, rating: number) => {
    try {
      const { res, data } = await postRecipe({ type: 'rate', id: recipe.id, rating });
      if (res.ok && data?.recipe) setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? data.recipe : r)));
    } catch {
      /* the rating just doesn't stick */
    }
  };

  const deleteRecipe = async (recipe: Recipe) => {
    const parents = recipesUsing(recipe.id, recipes);
    const ok = await confirm({
      title: 'Delete recipe',
      message: `Delete "${recipe.title}"? This cannot be undone.${parents.length ? ` ${parents.map((p) => p.title).join(', ')} will keep a copy of its steps.` : ''}`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const { res, data } = await postRecipe({ type: 'delete', id: recipe.id });
      if (!res.ok) {
        await showAlert(data?.message || 'Delete failed.');
        return;
      }
      // Reloaded rather than filtered: anything that used this one has just changed.
      const fresh = await fetch('/api/recipes').then((r) => r.json()).catch(() => null);
      setRecipes((prev) => (Array.isArray(fresh?.recipes) ? fresh.recipes : prev.filter((r) => r.id !== recipe.id)));
      kitchen.removeListRecipe(recipe.id);
      if (kitchen.state.pantry[madeKey(recipe.id)]) kitchen.forgetPantry(madeKey(recipe.id));
      go({ view });
    } catch {
      await showAlert('Delete failed.');
    }
  };

  const keepRecipe = (saved: Recipe, canDelete: boolean) => {
    setRecipes((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev]));
    if (canDelete) setDeletableIds((prev) => (prev.includes(saved.id) ? prev : [...prev, saved.id]));
  };

  const handleSaved = (saved: Recipe, canDelete: boolean) => {
    keepRecipe(saved, canDelete);
    setDraft(null);
    setOpenServings(undefined);
    go({ recipe: saved.slug, view });
  };

  const sheets = (
    <>
      {popup}
      <TimerAlerts timers={timers} />
      {flash && <div className="rc-flash" role="status">{flash}</div>}
      {planning && (
        <PlanSheet
          recipe={planning.recipe}
          servings={planning.servings}
          week={week}
          kitchen={kitchen}
          onClose={() => setPlanning(null)}
          onDone={setFlash}
        />
      )}
      {aiMode && (
        <AiSheet
          mode={aiMode}
          recipes={recipes}
          kitchen={kitchen}
          week={week}
          onClose={() => setAiMode(null)}
          onSaved={(saved, message) => {
            // Yours to delete: you added them, whatever wrote them.
            for (const recipe of saved) keepRecipe(recipe, true);
            if (!message) return; // saved some, and the sheet is showing what went wrong with the rest
            setAiMode(null);
            setFlash(message);
          }}
          onCheckOne={(recipe) => {
            setAiMode(null);
            setDraft({ ...recipeToDraft(recipe), id: undefined, isPrivate: true });
          }}
        />
      )}
    </>
  );

  if (loadState === 'loading') {
    return <p className="rc-page rc-empty">Loading recipes…</p>;
  }

  if (draft) {
    return (
      <>
        {sheets}
        <RecipeEditor
          initial={draft}
          recipes={recipes}
          timers={timers}
          onCancel={() => setDraft(null)}
          onSaved={handleSaved}
          onCreatedPart={keepRecipe}
          showAlert={showAlert}
        />
      </>
    );
  }

  if (activeRecipe) {
    return (
      <>
        {sheets}
        <RecipeView
          key={activeRecipe.id}
          recipe={activeRecipe}
          initialServings={openServings}
          canEdit={canEdit}
          canDelete={deletableIds.includes(activeRecipe.id)}
          kitchen={kitchen}
          usedBy={recipesUsing(activeRecipe.id, recipes)}
          unitMode={unitMode}
          timers={timers}
          cookLogged={lastCook?.id === activeRecipe.id}
          backLabel={BACK_LABELS[view]}
          onUnitMode={changeUnits}
          onBack={() => go({ view })}
          onOpenRecipe={openRecipe}
          onPlan={(servings) => setPlanning({ recipe: activeRecipe, servings })}
          onEdit={() => setDraft(recipeToDraft(recipes.find((r) => r.id === activeRecipe.id) ?? activeRecipe))}
          onDelete={() => deleteRecipe(activeRecipe)}
          onLogCook={(undo, servings) => logCook(activeRecipe, undo, servings)}
          onRate={(rating) => rateRecipe(activeRecipe, rating)}
          onFlash={setFlash}
          showAlert={showAlert}
        />
      </>
    );
  }

  return (
    <>
      {sheets}
      <div className={`rc-page${view === 'recipes' ? '' : ' rc-narrow'}`}>
        {/* Dividers in the recipe box. */}
        <nav className="rc-dividers" aria-label="Recipes sections">
          <button type="button" className={view === 'recipes' ? 'is-active' : ''} aria-current={view === 'recipes' ? 'page' : undefined} onClick={() => go({ view: 'recipes' })}>
            Recipes
          </button>
          <button type="button" className={view === 'week' ? 'is-active' : ''} aria-current={view === 'week' ? 'page' : undefined} onClick={() => go({ view: 'week' })}>
            Week
          </button>
          <button type="button" className={view === 'list' ? 'is-active' : ''} aria-current={view === 'list' ? 'page' : undefined} onClick={() => go({ view: 'list' })}>
            Shopping{toBuy ? <span className="rc-divider-count">{toBuy}</span> : null}
          </button>
          <button type="button" className={view === 'pantry' ? 'is-active' : ''} aria-current={view === 'pantry' ? 'page' : undefined} onClick={() => go({ view: 'pantry' })}>
            Pantry{toCheck ? <span className="rc-divider-count">{toCheck}</span> : null}
          </button>
        </nav>

        <div className="rc-divider-page">
          {view !== 'recipes' && <HouseholdBar kitchen={kitchen} canEdit={canEdit} onOpen={() => setShowHousehold(true)} />}
          {view === 'recipes' && (
            <RecipeList
              recipes={cookable}
              loadState={loadState}
              notFound={Boolean(selectedSlug)}
              canEdit={canEdit}
              kitchen={kitchen}
              onOpen={(slug) => openRecipe(slug)}
              onAdd={() => setShowAddSheet(true)}
              onPlan={(recipe) => setPlanning({ recipe })}
              onDismissNotFound={() => go({ view: 'recipes' })}
            />
          )}
          {view === 'week' && (
            <WeekView
              recipes={cookable}
              kitchen={kitchen}
              week={week}
              unitMode={unitMode}
              timers={timers}
              onWeek={setWeek}
              onOpenRecipe={openRecipe}
              onShowList={() => go({ view: 'list' })}
              onPlanWithAi={canEdit ? () => setAiMode('week') : undefined}
            />
          )}
          {view === 'pantry' && (
            <PantryView
              recipes={cookable}
              kitchen={kitchen}
              unitMode={unitMode}
              onOpenRecipe={(slug) => openRecipe(slug)}
              onCooked={(recipe, servings) => logCook(recipe, false, servings)}
              onShowList={() => go({ view: 'list' })}
              onFlash={setFlash}
            />
          )}
          {view === 'list' && (
            <ShoppingView
              recipes={cookable}
              kitchen={kitchen}
              week={week}
              unitMode={unitMode}
              onWeek={setWeek}
              onShowWeek={() => go({ view: 'week' })}
              onShowPantry={() => go({ view: 'pantry' })}
              onConfirm={(message) => confirm({ title: 'Start over', message, confirmLabel: 'Clear' })}
              onFlash={setFlash}
            />
          )}
        </div>

        {timers.hasTimers && (
          <div className="rc-dock">
            <TimerPills timers={timers} onOpenRecipe={(slug) => openRecipe(slug)} />
          </div>
        )}
      </div>

      {showHousehold && <HouseholdSheet kitchen={kitchen} confirm={confirm} onClose={() => setShowHousehold(false)} />}

      {showAddSheet && (
        <AddRecipeSheet
          onClose={() => setShowAddSheet(false)}
          onAi={() => {
            setShowAddSheet(false);
            setAiMode('recipes');
          }}
          onBlank={() => {
            setShowAddSheet(false);
            setDraft(emptyDraft());
          }}
          onImported={(recipe) => {
            setShowAddSheet(false);
            setDraft(importedToDraft(recipe));
          }}
        />
      )}
    </>
  );
}
