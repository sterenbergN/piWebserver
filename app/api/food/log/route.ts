import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { generateId } from '@/lib/workout/data';
import { FoodInputError } from '@/lib/food/foods';
import { applyLogAction, dayTotals, isDateKey, isMeal, mealTotals, type LogAction } from '@/lib/food/log';
import { resolveItem, resolveItems, resolveRecipeLog, type ItemInput } from '@/lib/food/resolve';
import { updateFoodData } from '@/lib/food/store';

// Changes to the signed-in account's food diary: POST { action: { type, … } }.
// Foods are looked up here (not trusted from the browser) before the file is
// locked, so a slow source never holds the lock. Returns the changed day.
//
//   add          { date, meal, items: [{ foodId, servingId, amount, food?, snapshot? }] }
//   quick        { date, meal, name?, nutrients: { kcal, protein?, carbs?, fat? } }
//   edit         { date, id, amount?, meal?, moveTo?, foodId + servingId? }
//   remove       { date, ids }          restore { date, entries }
//   copy-meal    { fromDate, fromMeal, date, meal }
//   save-meal    { name, items }        save-meal-from { name, date, meal }
//   rename-meal  { id, name }           remove-meal { id }
//   recipe       { date, meal, recipeId, servings, use?: 'lines' | 'recipe', lines: [{ key, foodId, servingId, amount, changed? }] }
//                One entry for the dish, worked out here from its ingredients; changed lines are remembered.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

async function prepare(userId: string, raw: Record<string, any>): Promise<LogAction> {
  switch (raw.type) {
    case 'add':
      if (!isMeal(raw.meal)) throw new ApiError(400, 'Pick a meal.');
      return { type: 'add', date: raw.date, meal: raw.meal, items: await resolveItems(userId, raw.items) };
    case 'save-meal':
      return { type: 'save-meal', name: raw.name, items: await resolveItems(userId, raw.items) };
    case 'recipe':
      return resolveRecipeLog(userId, raw);
    case 'edit': {
      const action: Extract<LogAction, { type: 'edit' }> = { type: 'edit', date: raw.date, id: String(raw.id || ''), amount: raw.amount, meal: raw.meal, moveTo: raw.moveTo };
      if (typeof raw.servingId === 'string' && typeof raw.foodId === 'string') {
        // A different serving: find it on the food itself.
        const { item } = await resolveItem(userId, { foodId: raw.foodId, servingId: raw.servingId, amount: 1 } as ItemInput);
        if (item.servingId !== raw.servingId) throw new ApiError(400, 'That serving isn’t one this food has.');
        action.serving = { servingId: item.servingId, snapshot: item.snapshot };
      }
      return action;
    }
    case 'quick': case 'remove': case 'restore': case 'copy-meal': case 'save-meal-from': case 'rename-meal': case 'remove-meal':
      return raw as LogAction;
    default:
      throw new ApiError(400, 'Unknown change.');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const raw = body.action;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'Missing change.');
    const action = await prepare(userId, raw);
    const { data, result } = await updateFoodData(userId, (d) => {
      try {
        return applyLogAction(d, action, new Date(), generateId);
      } catch (error) {
        if (error instanceof FoodInputError) throw new ApiError(400, error.message);
        throw error;
      }
    });
    const date = 'date' in action && isDateKey(action.date) ? action.date : null;
    const entries = date ? data.days[date] ?? [] : [];
    return NextResponse.json({
      success: true,
      added: result,
      ...(date ? { date, entries, totals: dayTotals(entries), meals: mealTotals(entries) } : {}),
      savedMeals: data.meals,
    }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save food log failed');
  }
}
