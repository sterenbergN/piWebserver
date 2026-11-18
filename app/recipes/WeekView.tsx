'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExamHelpBanner from '@/components/study/ExamHelpBanner';
import { useWakeLock } from '@/components/useWakeLock';
import { addDays, localToday, type DateKey } from '@/lib/habits/dates';
import {
  DAY_NAMES,
  buildPrepSession,
  buildShoppingList,
  buildWeekKitchenChoresPayloads,
  currentWeek,
  dayInfo,
  filterNewChores,
  missingIngredients,
  weekLabel,
  type PlanEntry,
} from '@/lib/recipes/kitchen';
import { MAX_SERVINGS, buildSchedule, cookOrder, type Recipe, type UnitMode } from '@/lib/recipes/recipes';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import CookMode from './CookMode';
import { ChoreSyncNotice, fetchHouseholdChores, formatMinutes, saveHouseholdChore, useCookHistory, type ChoreSyncStatus } from './shared';
import type { Kitchen } from './useKitchen';
import type { RecipeTimers } from './useRecipeTimers';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const PREP_PREF = 'recipes:prep';
const RECIPE_MIME = 'application/x-pi-recipe';
const ENTRY_MIME = 'application/x-pi-plan-entry';

type TrayFilter = 'all' | 'rated' | 'fast' | 'have';
const TRAY_FILTERS: { id: TrayFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'rated', label: '★ Rated' },
  { id: 'fast', label: '⚡ Fast' },
  { id: 'have', label: 'Have ingredients' },
];

type DragPayload =
  | { kind: 'entry'; entryId: string; recipeId: string }
  | { kind: 'recipe'; recipeId: string; servings: number };

function hasDragType(e: React.DragEvent, mime: string): boolean {
  const types = e.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes(mime));
}

function parseDragJson<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readSavedPrep(): { week: DateKey; step: number } | null {
  try {
    const saved = JSON.parse(readPref(PREP_PREF) || 'null');
    return saved && typeof saved.week === 'string' && Number.isInteger(saved.step) ? saved : null;
  } catch {
    return null;
  }
}

function PlanRow({
  entry,
  recipe,
  week,
  kitchen,
  isDropBefore,
  onOpen,
  onDragStartEntry,
  onDragEndAny,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
}: {
  entry: PlanEntry;
  recipe: Recipe | undefined;
  week: DateKey;
  kitchen: Kitchen;
  isDropBefore: boolean;
  onOpen: (slug: string, servings: number) => void;
  onDragStartEntry: (entry: PlanEntry) => void;
  onDragEndAny: () => void;
  onDragOverRow: (e: React.DragEvent, entry: PlanEntry) => void;
  onDragLeaveRow: (e: React.DragEvent, entryId: string) => void;
  onDropRow: (e: React.DragEvent, entry: PlanEntry) => void;
}) {
  if (!recipe) {
    return (
      <li className="rc-plan-row">
        <span className="rc-plan-name rc-meta">A recipe that’s been removed</span>
        <button type="button" className="rc-icon-btn" aria-label="Remove from plan" onClick={() => kitchen.removeEntry(week, entry.id)}>
          ×
        </button>
      </li>
    );
  }
  return (
    <li
      className={`rc-plan-row${entry.cooked ? ' is-done' : ''}${isDropBefore ? ' is-drop-before' : ''}`}
      draggable={true}
      onDragStart={(e) => {
        if ((e.target as HTMLElement | null)?.closest('select, input, textarea')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(ENTRY_MIME, JSON.stringify({ entryId: entry.id, recipeId: entry.recipeId }));
        onDragStartEntry(entry);
      }}
      onDragEnd={onDragEndAny}
      onDragOver={(e) => onDragOverRow(e, entry)}
      onDragLeave={(e) => onDragLeaveRow(e, entry.id)}
      onDrop={(e) => onDropRow(e, entry)}
    >
      <span className="rc-drag-handle" aria-hidden="true" title="Drag to move or reorder">
        ⋮⋮
      </span>
      <button
        type="button"
        className="rc-check-btn"
        aria-pressed={Boolean(entry.cooked)}
        aria-label={entry.cooked ? `${recipe.title}: not cooked yet` : `${recipe.title}: cooked`}
        onClick={() => {
          if (entry.cooked) kitchen.uncookEntry(week, entry);
          else kitchen.cook(recipe, entry.servings, { week, entry });
        }}
      >
        <span className="rc-check" aria-hidden="true">{entry.cooked ? '✓' : ''}</span>
      </button>
      <button type="button" className="rc-plan-name" onClick={() => onOpen(recipe.slug, entry.servings)}>
        {recipe.title}
      </button>
      <div className="rc-mini-stepper" role="group" aria-label={`Servings of ${recipe.title}`}>
        <button type="button" aria-label="Fewer servings" disabled={entry.servings <= 1} onClick={() => kitchen.updateEntry(week, entry.id, { servings: entry.servings - 1 })}>
          −
        </button>
        <span>{entry.servings}</span>
        <button type="button" aria-label="More servings" disabled={entry.servings >= MAX_SERVINGS} onClick={() => kitchen.updateEntry(week, entry.id, { servings: Math.min(MAX_SERVINGS, entry.servings + 1) })}>
          +
        </button>
      </div>
      <select
        className="rc-day-move-select"
        aria-label={`Move ${recipe.title} to another day`}
        value={entry.day === null ? 'prep' : String(entry.day)}
        onChange={(e) => {
          const val = e.target.value;
          const targetDay = val === 'prep' ? null : Number(val);
          if (targetDay !== entry.day) kitchen.movePlanEntry(week, entry.id, targetDay);
        }}
      >
        <option value="prep">Prep</option>
        {DAYS.map((d) => (
          <option key={d} value={String(d)}>
            {DAY_NAMES[d]}
          </option>
        ))}
      </select>
      <button type="button" className="rc-icon-btn rc-plan-remove" aria-label={`Remove ${recipe.title} from plan`} onClick={() => kitchen.removeEntry(week, entry.id)}>
        ×
      </button>
    </li>
  );
}

/** The week as a planner: meal prep to cook ahead, then a card per day. */
export default function WeekView({
  recipes,
  kitchen,
  week,
  unitMode,
  timers,
  onWeek,
  onOpenRecipe,
  onShowList,
  onPlanWithAi,
}: {
  recipes: Recipe[];
  kitchen: Kitchen;
  week: DateKey;
  unitMode: UnitMode;
  timers: RecipeTimers;
  onWeek: (week: DateKey) => void;
  onOpenRecipe: (slug: string, servings: number) => void;
  onShowList: () => void;
  /** Signed in only: AI-written recipes have to be saved. */
  onPlanWithAi?: () => void;
}) {
  const [pickerDay, setPickerDay] = useState<number | null | 'closed'>('closed');
  // For an exam week: the fastest meals in the box.
  const quickMeals = useMemo(() => recipes
    .map((recipe) => ({ title: recipe.title, total: buildSchedule(recipe).totalMinutes }))
    .filter((meal) => meal.total > 0)
    .sort((a, b) => a.total - b.total)
    .slice(0, 3)
    .map((meal) => ({ title: meal.title, minutes: formatMinutes(meal.total) })), [recipes]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [showTray, setShowTray] = useState(false);
  const [trayQuery, setTrayQuery] = useState('');
  const [trayFilter, setTrayFilter] = useState<TrayFilter>('all');
  const [dropTarget, setDropTarget] = useState<'prep' | number | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  const dragRef = useRef<DragPayload | null>(null);
  const [sessionStep, setSessionStep] = useState<number | null>(null);
  const [choreStatus, setChoreStatus] = useState<ChoreSyncStatus>({ kind: 'idle' });
  useEffect(() => {
    setChoreStatus({ kind: 'idle' });
  }, [week]);

  const entries = useMemo(() => kitchen.state.plans[week] || [], [kitchen.state.plans, week]);
  const weekChores = useMemo(() => buildWeekKitchenChoresPayloads(recipes, kitchen.state, week, localToday()), [recipes, kitchen.state, week]);

  const syncToChores = async () => {
    if (!weekChores.length || choreStatus.kind === 'syncing') return;
    setChoreStatus({ kind: 'syncing' });
    const today = localToday();
    const candidates = buildWeekKitchenChoresPayloads(recipes, kitchen.state, week, today);
    const loaded = await fetchHouseholdChores(today);
    if (!loaded.ok) {
      setChoreStatus(loaded.signedOut ? { kind: 'signed-out' } : { kind: 'error', message: loaded.message });
      return;
    }
    const toCreate = filterNewChores(candidates, loaded.chores);
    for (const action of toCreate) {
      const saved = await saveHouseholdChore(action, today);
      if (!saved.ok) {
        setChoreStatus(saved.signedOut ? { kind: 'signed-out' } : { kind: 'error', message: saved.message });
        return;
      }
    }
    setChoreStatus({
      kind: 'synced',
      message: `✓ Synced ${toCreate.length} ${toCreate.length === 1 ? 'chore' : 'chores'}`,
    });
  };
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const prepEntries = useMemo(() => entries.filter((e) => e.day === null), [entries]);
  const previous = addDays(week, -7);
  const canCopyLast = !entries.length && (kitchen.state.plans[previous] || []).length > 0;

  const list = useMemo(() => buildShoppingList(recipes, kitchen.state, week), [recipes, kitchen.state, week]);

  const servingsTotal = entries.reduce((sum, e) => sum + e.servings, 0);

  // Meal prep: everything cooked ahead, merged into one order.
  const prepToCook = useMemo(() => prepEntries.filter((e) => !e.cooked), [prepEntries]);
  const session = useMemo(() => (prepToCook.length ? buildPrepSession(prepToCook, recipes, week) : null), [prepToCook, recipes, week]);
  const sessionOrder = useMemo(() => (session ? cookOrder(session.schedule) : []), [session]);

  useWakeLock(sessionStep !== null);
  const closeSession = useCookHistory(sessionStep !== null, useCallback(() => setSessionStep(null), []));

  const loadedWeekRef = useRef<DateKey | null>(null);

  useEffect(() => {
    if (loadedWeekRef.current !== week) return;
    if (sessionStep !== null) {
      savePref(PREP_PREF, JSON.stringify({ week, step: sessionStep }));
    } else if (readSavedPrep()?.week === week) {
      // Only clear PREP_PREF when leaving an active session on this same week.
      savePref(PREP_PREF, 'null');
    }
  }, [sessionStep, week]);

  // A prep session can run for an hour: a reload picks up where it was.
  useEffect(() => {
    const saved = readSavedPrep();
    setSessionStep(saved?.week === week ? saved.step : null);
    loadedWeekRef.current = week;
    return () => {
      loadedWeekRef.current = null;
    };
  }, [week]);

  const pickerRecipes = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return recipes
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => missingIngredients(a, kitchen.state).length - missingIngredients(b, kitchen.state).length || (b.rating || 0) - (a.rating || 0));
  }, [recipes, pickerQuery, kitchen.state]);

  const trayRecipes = useMemo(() => {
    const q = trayQuery.trim().toLowerCase();
    return recipes
      .filter((r) => {
        if (q && !r.title.toLowerCase().includes(q) && !r.tags.some((t) => t.toLowerCase().includes(q))) return false;
        if (trayFilter === 'rated' && !(r.rating && r.rating > 0)) return false;
        if (trayFilter === 'fast') {
          const mins = buildSchedule(r).totalMinutes;
          if (mins <= 0 || mins > 30) return false;
        }
        if (trayFilter === 'have' && missingIngredients(r, kitchen.state).length > 0) return false;
        return true;
      })
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || missingIngredients(a, kitchen.state).length - missingIngredients(b, kitchen.state).length);
  }, [recipes, trayQuery, trayFilter, kitchen.state]);

  const clearDragState = useCallback(() => {
    dragRef.current = null;
    setDropTarget(null);
    setDropBeforeId(null);
  }, []);

  const readEntryPayload = useCallback((e: React.DragEvent) => {
    const parsed = parseDragJson<{ entryId?: string; recipeId?: string }>(e.dataTransfer.getData(ENTRY_MIME));
    if (parsed?.entryId) return { entryId: parsed.entryId, recipeId: parsed.recipeId || '' };
    return dragRef.current?.kind === 'entry' ? dragRef.current : null;
  }, []);

  const readRecipePayload = useCallback((e: React.DragEvent) => {
    const parsed = parseDragJson<{ recipeId?: string; servings?: number }>(e.dataTransfer.getData(RECIPE_MIME));
    if (parsed?.recipeId) return { recipeId: parsed.recipeId, servings: Number(parsed.servings) || 4 };
    return dragRef.current?.kind === 'recipe' ? dragRef.current : null;
  }, []);

  const handleContainerDragOver = useCallback((e: React.DragEvent, target: 'prep' | number) => {
    const isEntry = hasDragType(e, ENTRY_MIME) || dragRef.current?.kind === 'entry';
    const isRecipe = hasDragType(e, RECIPE_MIME) || dragRef.current?.kind === 'recipe';
    if (!isEntry && !isRecipe) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isRecipe ? 'copy' : 'move';
    setDropBeforeId(null);
    setDropTarget(target);
  }, []);

  const handleContainerDragLeave = useCallback((e: React.DragEvent, target: 'prep' | number) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropTarget((cur) => (cur === target ? null : cur));
    }
  }, []);

  const handleContainerDrop = useCallback(
    (e: React.DragEvent, targetDay: number | null) => {
      e.preventDefault();
      const entryPayload = readEntryPayload(e);
      const recipePayload = readRecipePayload(e);
      clearDragState();
      if (entryPayload?.entryId) {
        kitchen.movePlanEntry(week, entryPayload.entryId, targetDay);
        return;
      }
      if (recipePayload?.recipeId) {
        kitchen.addToPlan(week, recipePayload.recipeId, recipePayload.servings, targetDay);
      }
    },
    [readEntryPayload, readRecipePayload, clearDragState, kitchen, week],
  );

  const handleRowDragOver = useCallback((e: React.DragEvent, rowEntry: PlanEntry) => {
    const isEntry = hasDragType(e, ENTRY_MIME) || dragRef.current?.kind === 'entry';
    if (!isEntry) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(null);
    const selfId = dragRef.current?.kind === 'entry' ? dragRef.current.entryId : null;
    setDropBeforeId(selfId === rowEntry.id ? null : rowEntry.id);
  }, []);

  const handleRowDragLeave = useCallback((e: React.DragEvent, entryId: string) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropBeforeId((cur) => (cur === entryId ? null : cur));
    }
  }, []);

  const handleRowDrop = useCallback(
    (e: React.DragEvent, rowEntry: PlanEntry) => {
      const entryPayload = readEntryPayload(e);
      if (entryPayload?.entryId) {
        e.preventDefault();
        e.stopPropagation();
        clearDragState();
        if (entryPayload.entryId !== rowEntry.id) {
          kitchen.movePlanEntry(week, entryPayload.entryId, rowEntry.day, rowEntry.id);
        }
        return;
      }
      const recipePayload = readRecipePayload(e);
      if (recipePayload?.recipeId) {
        e.preventDefault();
        e.stopPropagation();
        clearDragState();
        kitchen.addToPlan(week, recipePayload.recipeId, recipePayload.servings, rowEntry.day);
      }
    },
    [readEntryPayload, readRecipePayload, clearDragState, kitchen, week],
  );

  const dayCalories = (dayEntries: PlanEntry[]) => {
    const known = dayEntries.flatMap((e) => {
      const macros = byId.get(e.recipeId)?.macros;
      return macros?.calories ? [macros] : [];
    });
    if (!known.length) return '';
    const kcal = known.reduce((s, m) => s + (m.calories || 0), 0);
    const protein = known.reduce((s, m) => s + (m.protein || 0), 0);
    return `${kcal} kcal${protein ? ` · ${protein} g protein` : ''} a serving each`;
  };

  return (
    <>
      <ExamHelpBanner quickMeals={quickMeals} />
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

      <button type="button" className="rc-week-summary" onClick={onShowList}>
        <span>
          {entries.length ? (
            <>
              {entries.length} {entries.length === 1 ? 'meal' : 'meals'}, {servingsTotal} servings
            </>
          ) : (
            'Nothing planned yet'
          )}
        </span>
        <strong>
          {list.need.length} to buy <span aria-hidden="true">›</span>
        </strong>
      </button>

      <div className="rc-week-tools">
        <button
          type="button"
          className={`rc-chip rc-copy-week${showTray ? ' is-active' : ''}`}
          aria-expanded={showTray}
          onClick={() => setShowTray((v) => !v)}
        >
          🧲 Quick-add &amp; drag recipes
        </button>
        {canCopyLast && (
          <button type="button" className="rc-chip rc-copy-week" onClick={() => kitchen.copyWeek(previous, week)}>
            Copy last week’s plan
          </button>
        )}
        {onPlanWithAi && (
          <button type="button" className="rc-chip rc-copy-week" onClick={onPlanWithAi}>
            Plan it with your AI
          </button>
        )}
        {weekChores.length > 0 && (
          <button
            type="button"
            className="rc-chip rc-copy-week"
            disabled={choreStatus.kind === 'syncing'}
            onClick={syncToChores}
          >
            {choreStatus.kind === 'syncing' ? 'Syncing…' : '🧹 Sync Prep & Cooks to Chores'}
          </button>
        )}
        <ChoreSyncNotice status={choreStatus} />
      </div>

      {showTray && (
        <section className="rc-week-tray" aria-label="Drag recipes onto week">
          <div className="rc-tray-head">
            <strong>Drag recipes onto week</strong>
            <span className="rc-meta">Drag any card onto a day or Meal prep, or pick a day</span>
          </div>
          <input
            type="search"
            className="rc-input"
            placeholder="Filter recipes…"
            aria-label="Filter recipes to drag onto week"
            value={trayQuery}
            onChange={(e) => setTrayQuery(e.target.value)}
          />
          <div className="rc-chips rc-chips-wrap" role="group" aria-label="Quick recipe filters">
            {TRAY_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`rc-chip${trayFilter === f.id ? ' is-active' : ''}`}
                aria-pressed={trayFilter === f.id}
                onClick={() => setTrayFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="rc-tray-list">
            {trayRecipes.map((recipe) => {
              const total = buildSchedule(recipe).totalMinutes;
              return (
                <div
                  key={recipe.id}
                  className="rc-tray-chip"
                  draggable={true}
                  onDragStart={(e) => {
                    if ((e.target as HTMLElement | null)?.closest('select, input, textarea')) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData(RECIPE_MIME, JSON.stringify({ recipeId: recipe.id, servings: recipe.servings }));
                    dragRef.current = { kind: 'recipe', recipeId: recipe.id, servings: recipe.servings };
                  }}
                  onDragEnd={clearDragState}
                >
                  <span className="rc-drag-handle" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="rc-tray-chip-title">{recipe.title}</span>
                  {total > 0 && <small className="rc-meta">{formatMinutes(total)}</small>}
                  <select
                    className="rc-day-move-select"
                    aria-label={`Add ${recipe.title} to a day`}
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      kitchen.addToPlan(week, recipe.id, recipe.servings, val === 'prep' ? null : Number(val));
                    }}
                  >
                    <option value="">+</option>
                    <option value="prep">Prep</option>
                    {DAYS.map((d) => (
                      <option key={d} value={String(d)}>
                        {DAY_NAMES[d]}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            {trayRecipes.length === 0 && <p className="rc-meta">No recipes match that filter.</p>}
          </div>
        </section>
      )}

      <section
        className={`rc-prep-card${dropTarget === 'prep' ? ' is-drop-target' : ''}`}
        aria-label="Meal prep"
        onDragOver={(e) => handleContainerDragOver(e, 'prep')}
        onDragLeave={(e) => handleContainerDragLeave(e, 'prep')}
        onDrop={(e) => handleContainerDrop(e, null)}
      >
        <div className="rc-prep-head">
          <div>
            <h2>Meal prep</h2>
            <p className="rc-meta">Cook once, eat through the week</p>
          </div>
          <button type="button" className="rc-add-pill" onClick={() => setPickerDay(null)}>
            + Add
          </button>
        </div>
        {prepEntries.length > 0 && (
          <ul className="rc-plan-rows">
            {prepEntries.map((entry) => (
              <PlanRow
                key={entry.id}
                entry={entry}
                recipe={byId.get(entry.recipeId)}
                week={week}
                kitchen={kitchen}
                isDropBefore={dropBeforeId === entry.id}
                onOpen={onOpenRecipe}
                onDragStartEntry={(ent) => {
                  dragRef.current = { kind: 'entry', entryId: ent.id, recipeId: ent.recipeId };
                }}
                onDragEndAny={clearDragState}
                onDragOverRow={handleRowDragOver}
                onDragLeaveRow={handleRowDragLeave}
                onDropRow={handleRowDrop}
              />
            ))}
          </ul>
        )}
        {session && session.recipeCount > 0 && (
          <div className="rc-prep-go">
            <p className="rc-meta">
              {session.recipeCount > 1 ? `All ${session.recipeCount} merged into one order: ` : ''}
              {formatMinutes(session.schedule.totalMinutes)}, {formatMinutes(session.schedule.activeMinutes)} hands-on
            </p>
            {session.ovenClash.length > 0 && (
              <p className="rc-meta">One oven, different temperatures: {session.ovenClash.map((t) => `${t}°F`).join(' and ')}. Plan which goes in first.</p>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setSessionStep(0)}>
              Start prep session
            </button>
          </div>
        )}
      </section>

      <ol className="rc-days">
        {DAYS.map((d) => {
          const info = dayInfo(week, d);
          const dayEntries = entries.filter((e) => e.day === d);
          const totals = dayCalories(dayEntries);
          return (
            <li
              key={d}
              className={`rc-day${info.isToday ? ' is-today' : ''}${info.isPast ? ' is-past' : ''}${dropTarget === d ? ' is-drop-target' : ''}`}
              onDragOver={(e) => handleContainerDragOver(e, d)}
              onDragLeave={(e) => handleContainerDragLeave(e, d)}
              onDrop={(e) => handleContainerDrop(e, d)}
            >
              <div className="rc-day-tab">
                <span>{info.name}</span>
                <strong>{info.date}</strong>
              </div>
              <div className="rc-day-body">
                {dayEntries.length > 0 && (
                  <ul className="rc-plan-rows">
                    {dayEntries.map((entry) => (
                      <PlanRow
                        key={entry.id}
                        entry={entry}
                        recipe={byId.get(entry.recipeId)}
                        week={week}
                        kitchen={kitchen}
                        isDropBefore={dropBeforeId === entry.id}
                        onOpen={onOpenRecipe}
                        onDragStartEntry={(ent) => {
                          dragRef.current = { kind: 'entry', entryId: ent.id, recipeId: ent.recipeId };
                        }}
                        onDragEndAny={clearDragState}
                        onDragOverRow={handleRowDragOver}
                        onDragLeaveRow={handleRowDragLeave}
                        onDropRow={handleRowDrop}
                      />
                    ))}
                  </ul>
                )}
                {totals && <p className="rc-meta rc-day-totals">{totals}</p>}
                <button type="button" className="rc-day-add" onClick={() => setPickerDay(d)}>
                  + Add a meal
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {pickerDay !== 'closed' && (
        <div className="rc-sheet-backdrop" onClick={() => setPickerDay('closed')}>
          <div className="rc-sheet" role="dialog" aria-modal="true" aria-label="Choose a recipe" onClick={(e) => e.stopPropagation()}>
            <div className="rc-sheet-head">
              <h2>{pickerDay === null ? 'Add to meal prep' : `Add to ${dayInfo(week, pickerDay).name}`}</h2>
              <button type="button" className="rc-icon-btn" onClick={() => setPickerDay('closed')} aria-label="Close">
                ×
              </button>
            </div>
            <input
              type="search"
              className="rc-input"
              placeholder="Search your recipes"
              aria-label="Search your recipes"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <ul className="rc-picker">
              {pickerRecipes.map((recipe) => {
                const missing = missingIngredients(recipe, kitchen.state).length;
                return (
                  <li key={recipe.id}>
                    <button
                      type="button"
                      onClick={() => {
                        kitchen.addToPlan(week, recipe.id, recipe.servings, pickerDay);
                        setPickerDay('closed');
                        setPickerQuery('');
                      }}
                    >
                      <span className="rc-row-title">{recipe.title}</span>
                      <span className="rc-meta">
                        {formatMinutes(buildSchedule(recipe).totalMinutes)} · serves {recipe.servings}
                        {kitchen.state.have.length ? ` · need ${missing}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
              {pickerRecipes.length === 0 && <li className="rc-empty">No recipes match that.</li>}
            </ul>
          </div>
        </div>
      )}

      {sessionStep !== null && session && (
        <CookMode
          recipe={session.recipe}
          order={sessionOrder}
          bom={session.bom}
          sectionScales={session.sectionScales}
          step={Math.min(sessionStep, sessionOrder.length)}
          scale={1}
          unitMode={unitMode}
          timers={timers}
          canLog={false}
          cookLogged={false}
          onStep={(next) => setSessionStep(Math.max(0, Math.min(next, sessionOrder.length)))}
          onClose={() => {
            if (sessionStep >= sessionOrder.length) {
              for (const entry of prepToCook) {
                const recipe = byId.get(entry.recipeId);
                if (recipe) kitchen.cook(recipe, entry.servings, { week, entry });
              }
            }
            closeSession();
          }}
          onLogCook={() => {}}
          kitchen={kitchen}
        />
      )}
    </>
  );
}
