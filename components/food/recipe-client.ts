// Browser-side helpers for logging a meal from a recipe: the API calls, and
// the line maths the review screen redoes as amounts change. The server works
// the numbers out again when the meal is logged.

import { foodApi } from '@/lib/food/client';
import { round } from '@/lib/food/nutrients';
import { lineWeight, weightServing, type MatchLine, type PlanMeal, type RecipeMatch, type RecipeSummary } from '@/lib/food/recipe-match';
import type { Food, Meal } from '@/lib/food/types';

export type RecipeList = { plan: PlanMeal[]; recipes: RecipeSummary[]; householdSize: number; week: { start: string; end: string } };

/** A line on the review screen: what the server matched, plus whether it was changed here. */
export type EditLine = MatchLine & { changed?: boolean };

export const loadRecipeList = (date: string) => foodApi<RecipeList>(`/api/food/recipes?date=${date}`);

export const matchRecipe = (recipeId: string) => foodApi<RecipeMatch>('/api/food/recipes/match', { json: { recipeId } });

/** Whether a line adds to the totals. */
export const isCounted = (line: MatchLine) => line.status !== 'skipped' && !!line.food && !!line.amount && line.amount > 0;

/** The log API's change for a recipe: the lines as settled here, which the server works out again. */
export function recipeLogAction(args: { date: string; meal: Meal; recipeId: string; servings: number; use: 'lines' | 'recipe'; lines: EditLine[] }) {
  return {
    type: 'recipe',
    date: args.date,
    meal: args.meal,
    recipeId: args.recipeId,
    servings: args.servings,
    use: args.use,
    lines: args.lines.filter(isCounted).map((l) => ({ key: l.key, foodId: l.food!.id, servingId: l.servingId, amount: l.amount, changed: !!l.changed })),
  };
}

/** "900 g" or "2 × 1 large (50 g) · 100 g", for a line. */
export function lineAmountLabel(line: MatchLine): string {
  if (!line.food || !line.amount) return '';
  const serving = line.food.servings.find((s) => s.id === line.servingId);
  const weight = lineWeight(line.food, line.servingId, line.amount);
  const w = weight ? `${weight.qty >= 10 ? Math.round(weight.qty) : round(weight.qty)} ${weight.unit}` : '';
  if (serving && (serving.grams === 1 || serving.ml === 1)) return w;
  const count = `${round(line.amount, 2)} × ${serving?.label ?? ''}`;
  return w ? `${count} · ${w}` : count;
}

/**
 * Where a newly picked food starts: the same weight as the line had, in the
 * new food's own weighed serving, so swapping "chicken" for another keeps 900 g.
 */
export function startingAmount(line: MatchLine, food: Food): { servingId: string; amount: number } | undefined {
  const weight = line.food ? lineWeight(line.food, line.servingId, line.amount) : null;
  const serving = weightServing(food);
  if (!weight || !serving) return undefined;
  const size = weight.unit === 'g' ? serving.grams : serving.ml;
  return size ? { servingId: serving.id, amount: Math.round((weight.qty / size) * 100) / 100 } : undefined;
}

/** 1.5 → "1½", for "I ate 1½ of 4 servings". */
export function servingsText(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const rest = Math.round((n - whole) * 100) / 100;
  const frac: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  if (!rest) return String(whole);
  if (frac[rest]) return whole ? `${whole}${frac[rest]}` : frac[rest];
  return String(round(n, 2));
}
