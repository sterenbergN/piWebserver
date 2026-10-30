'use client';

import { useState } from 'react';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { dayInfo, weekLabel } from '@/lib/recipes/kitchen';
import type { Recipe } from '@/lib/recipes/recipes';
import type { Kitchen } from './useKitchen';

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Put a recipe on a day of the week, into the week's meal prep, or just on the shopping list. */
export default function PlanSheet({
  recipe,
  servings: initialServings,
  week: initialWeek,
  kitchen,
  onClose,
  onDone,
}: {
  recipe: Recipe;
  servings?: number;
  week: DateKey;
  kitchen: Kitchen;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [servings, setServings] = useState(initialServings ?? recipe.servings);
  const [week, setWeek] = useState(initialWeek);
  const [day, setDay] = useState<number | null>(null);

  const addToWeek = () => {
    kitchen.addToPlan(week, recipe.id, servings, day);
    onDone(day === null ? 'Added to meal prep' : `Added to ${dayInfo(week, day).name}`);
    onClose();
  };

  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <div className="rc-sheet" role="dialog" aria-modal="true" aria-label={`Plan ${recipe.title}`} onClick={(e) => e.stopPropagation()}>
        <div className="rc-sheet-head">
          <h2>{recipe.title}</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

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

          <div className="rc-week-nav">
            <button type="button" className="rc-icon-btn" aria-label="Previous week" onClick={() => setWeek((w) => addDays(w, -7))}>
              ‹
            </button>
            <span>{weekLabel(week)}</span>
            <button type="button" className="rc-icon-btn" aria-label="Next week" onClick={() => setWeek((w) => addDays(w, 7))}>
              ›
            </button>
          </div>

          <div className="rc-day-grid" role="group" aria-label="When">
            <button type="button" className={`rc-day-pick rc-day-prep${day === null ? ' is-active' : ''}`} aria-pressed={day === null} onClick={() => setDay(null)}>
              Meal prep <small>cook ahead for the week</small>
            </button>
            {DAYS.map((d) => {
              const info = dayInfo(week, d);
              return (
                <button key={d} type="button" className={`rc-day-pick${day === d ? ' is-active' : ''}`} aria-pressed={day === d} onClick={() => setDay(d)}>
                  {info.name}
                  <small>{info.date}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rc-sheet-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              kitchen.addListRecipe(recipe.id, servings);
              onDone('Added to shopping list');
              onClose();
            }}
          >
            List only
          </button>
          <button type="button" className="btn btn-primary" onClick={addToWeek}>
            Add to week
          </button>
        </div>
      </div>
    </div>
  );
}
