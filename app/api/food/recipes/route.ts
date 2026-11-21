import { NextResponse } from 'next/server';
import { readJson } from '@/lib/json-store';
import { findHousehold } from '@/lib/chores/households';
import { addDays, daysBetween, weekStart } from '@/lib/habits/dates';
import { DAY_NAMES, normalizeKitchen, type KitchenState } from '@/lib/recipes/kitchen';
import { householdKitchenFile, personalKitchenFile } from '@/lib/recipes/kitchen-store';
import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { usageStats } from '@/lib/food/log';
import { orderPlan, suggestedServings, type PlanMeal } from '@/lib/food/recipe-match';
import { dateParam, recipeSummary, visibleRecipes } from '@/lib/food/resolve';
import { loadFoodData } from '@/lib/food/store';

// Recipes to log a meal from (?date=YYYY-MM-DD, the day being logged): this
// week's meal plan from the household's kitchen, today's first, then every
// recipe this account can see, the ones it logs most at the top. The kitchen
// is only read here; /api/recipes/kitchen looks after it.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

async function readKitchen(userId: string, today: string): Promise<{ kitchen: KitchenState | null; householdSize: number }> {
  const household = await findHousehold(userId);
  // No household yet: a kitchen from before they were shared is still under the account.
  const file = household ? householdKitchenFile(household.id) : personalKitchenFile(userId);
  const raw = await readJson<KitchenState | null>(file, null);
  return { kitchen: raw ? normalizeKitchen(raw, today) : null, householdSize: household?.members.length ?? 1 };
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const today = dateParam(new URL(request.url).searchParams.get('date'));
    const [recipes, data, { kitchen, householdSize }] = await Promise.all([
      visibleRecipes(userId),
      loadFoodData(userId),
      readKitchen(userId, today),
    ]);
    const usage = usageStats(data);
    const byId = new Map(recipes.map((r) => [r.id, r]));

    const week = weekStart(today);
    const todayIndex = daysBetween(week, today);
    const planned = (kitchen?.plans[week] ?? []).filter((e) => byId.has(e.recipeId));
    const plan: PlanMeal[] = orderPlan(planned, todayIndex).map((e) => {
      const isToday = e.day === todayIndex;
      return {
        id: e.id,
        recipeId: e.recipeId,
        label: e.day === null ? 'Meal prep' : isToday ? 'Today' : DAY_NAMES[e.day] ?? '',
        isToday,
        day: e.day,
        servings: e.servings,
        cooked: !!e.cooked,
        // Meal prep is spread over the week, so a share of it isn't obvious.
        suggested: e.day === null ? 1 : suggestedServings(e.servings, householdSize),
      };
    });

    const list = recipes
      .map((r) => recipeSummary(r, usage))
      .sort((a, b) => (b.logged ?? 0) - (a.logged ?? 0) || a.title.localeCompare(b.title));
    return NextResponse.json({
      success: true,
      week: { start: week, end: addDays(week, 6) },
      plan,
      recipes: list,
      householdSize,
    }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load recipes for food failed');
  }
}
