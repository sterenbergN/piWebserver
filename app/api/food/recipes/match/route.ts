import { NextResponse } from 'next/server';
import { handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { usageStats } from '@/lib/food/log';
import { macrosNutrients, type RecipeMatch } from '@/lib/food/recipe-match';
import { loadRecipe, matchRecipe, recipeSummary } from '@/lib/food/resolve';
import { loadFoodData } from '@/lib/food/store';

// A recipe's ingredients matched to foods for the review screen: POST { recipeId }.
// Each line has its food, serving and amount for the whole recipe, and how sure
// the match is. Only the library and the bundled USDA foods are searched, and
// this account's earlier corrections come first. Nothing is saved here.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const [recipe, data] = await Promise.all([loadRecipe(userId, body.recipeId), loadFoodData(userId)]);
    const result: RecipeMatch = {
      recipe: { ...recipeSummary(recipe, usageStats(data)), macros: macrosNutrients(recipe.macros) },
      lines: await matchRecipe(recipe, data),
    };
    return NextResponse.json({ success: true, ...result }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Match recipe failed');
  }
}
