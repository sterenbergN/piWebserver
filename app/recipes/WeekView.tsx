'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWakeLock } from '@/components/useWakeLock';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { buildPrepSession, buildShoppingList, currentWeek, dayInfo, haveSet, missingIngredients, weekLabel, type PlanEntry } from '@/lib/recipes/kitchen';
import { buildSchedule, cookOrder, type Recipe, type UnitMode } from '@/lib/recipes/recipes';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import CookMode from './CookMode';
import { formatMinutes, useCookHistory } from './shared';
import type { Kitchen } from './useKitchen';
import type { RecipeTimers } from './useRecipeTimers';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const PREP_PREF = 'recipes:prep';

function PlanRow({
  entry,
  recipe,
  week,
  kitchen,
  onOpen,
}: {
  entry: PlanEntry;
  recipe: Recipe | undefined;
  week: DateKey;
  kitchen: Kitchen;
  onOpen: (slug: string, servings: number) => void;
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
    <li className={`rc-plan-row${entry.cooked ? ' is-done' : ''}`}>
      <button
        type="button"
        className="rc-check-btn"
        aria-pressed={Boolean(entry.cooked)}
        aria-label={entry.cooked ? `${recipe.title}: not cooked yet` : `${recipe.title}: cooked`}
        onClick={() => kitchen.updateEntry(week, entry.id, { cooked: !entry.cooked })}
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
        <button type="button" aria-label="More servings" onClick={() => kitchen.updateEntry(week, entry.id, { servings: Math.min(48, entry.servings + 1) })}>
          +
        </button>
      </div>
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
}: {
  recipes: Recipe[];
  kitchen: Kitchen;
  week: DateKey;
  unitMode: UnitMode;
  timers: RecipeTimers;
  onWeek: (week: DateKey) => void;
  onOpenRecipe: (slug: string, servings: number) => void;
  onShowList: () => void;
}) {
  const [pickerDay, setPickerDay] = useState<number | null | 'closed'>('closed');
  const [pickerQuery, setPickerQuery] = useState('');
  const [sessionStep, setSessionStep] = useState<number | null>(null);

  const entries = useMemo(() => kitchen.state.plans[week] || [], [kitchen.state.plans, week]);
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const prepEntries = useMemo(() => entries.filter((e) => e.day === null), [entries]);
  const previous = addDays(week, -7);
  const canCopyLast = !entries.length && (kitchen.state.plans[previous] || []).length > 0;

  const list = useMemo(() => buildShoppingList(recipes, kitchen.state, week), [recipes, kitchen.state, week]);
  const have = useMemo(() => haveSet(kitchen.state), [kitchen.state]);

  const servingsTotal = entries.reduce((sum, e) => sum + e.servings, 0);

  // Meal prep: everything cooked ahead, merged into one order.
  const prepToCook = useMemo(() => prepEntries.filter((e) => !e.cooked), [prepEntries]);
  const session = useMemo(() => (prepToCook.length ? buildPrepSession(prepToCook, recipes, week) : null), [prepToCook, recipes, week]);
  const sessionOrder = useMemo(() => (session ? cookOrder(session.schedule) : []), [session]);

  useWakeLock(sessionStep !== null);
  const closeSession = useCookHistory(sessionStep !== null, useCallback(() => setSessionStep(null), []));

  // A prep session can run for an hour: a reload picks up where it was.
  useEffect(() => {
    try {
      const saved = JSON.parse(readPref(PREP_PREF) || 'null');
      if (saved?.week === week && Number.isInteger(saved.step)) setSessionStep(saved.step);
    } catch {
      /* start fresh */
    }
    // Only when arriving on a week.
  }, [week]);
  useEffect(() => {
    savePref(PREP_PREF, JSON.stringify(sessionStep === null ? null : { week, step: sessionStep }));
  }, [sessionStep, week]);

  const pickerRecipes = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return recipes
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => missingIngredients(a, have).length - missingIngredients(b, have).length || (b.rating || 0) - (a.rating || 0));
  }, [recipes, pickerQuery, have]);

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

      {canCopyLast && (
        <button type="button" className="rc-chip rc-copy-week" onClick={() => kitchen.copyWeek(previous, week)}>
          Copy last week’s plan
        </button>
      )}

      <section className="rc-prep-card" aria-label="Meal prep">
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
              <PlanRow key={entry.id} entry={entry} recipe={byId.get(entry.recipeId)} week={week} kitchen={kitchen} onOpen={onOpenRecipe} />
            ))}
          </ul>
        )}
        {session && session.recipeCount > 0 && (
          <div className="rc-prep-go">
            <p className="rc-meta">
              {session.recipeCount > 1 ? `All ${session.recipeCount} merged into one order: ` : ''}
              {formatMinutes(session.schedule.totalMinutes)}, {formatMinutes(session.schedule.activeMinutes)} hands-on
            </p>
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
            <li key={d} className={`rc-day${info.isToday ? ' is-today' : ''}${info.isPast ? ' is-past' : ''}`}>
              <div className="rc-day-tab">
                <span>{info.name}</span>
                <strong>{info.date}</strong>
              </div>
              <div className="rc-day-body">
                {dayEntries.length > 0 && (
                  <ul className="rc-plan-rows">
                    {dayEntries.map((entry) => (
                      <PlanRow key={entry.id} entry={entry} recipe={byId.get(entry.recipeId)} week={week} kitchen={kitchen} onOpen={onOpenRecipe} />
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
                const missing = missingIngredients(recipe, have).length;
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
            if (sessionStep >= sessionOrder.length) kitchen.markCooked(week, prepToCook.map((e) => e.id));
            closeSession();
          }}
          onLogCook={() => {}}
        />
      )}
    </>
  );
}
