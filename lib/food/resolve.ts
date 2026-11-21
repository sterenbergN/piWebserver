import path from 'path';
import { readJson } from '@/lib/json-store';
import { extractIngredients, formatBomAmount, normalizeRecipesData, publicRecipe, recipeEmoji, resolveRecipes, type BomItem, type Recipe, type RecipesData } from '@/lib/recipes/recipes';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { ApiError } from '@/lib/workout/api';
import { cleanFood, parseFoodId } from './foods';
import { cleanAmount, cleanSnapshot, isDateKey, isMeal, MAX_AMOUNT, snapshotFor, usageStats, type LogAction, type ResolvedItem } from './log';
import { addNutrients, scaleNutrients, zeroNutrients } from './nutrients';
import {
  lineNutrients, macrosNutrients, matchIngredients, neverCounted, prefFor, recipeFoodId, recipeSnapshot, type FoodLookup, type MatchLine, type RecipeSummary,
} from './recipe-match';
import { mergeResults, type Usage } from './search';
import { getFoodSettings } from './settings';
import { getFood, keepInLibrary } from './sources';
import { getLibraryFood, searchLibrary } from './sources/library';
import { searchUsda, usdaSource } from './sources/usda';
import type { Food, FoodUserData, RecipeMatchPref } from './types';

// Turning what the page sends ("this food, this serving, this many") into a
// log-ready item. The server finds the food itself where it can, so nutrition
// comes from the source, not the browser; when nobody has the food any more
// (FatSecret gone, say), re-logging falls back to the snapshot of the last time.

export type ItemInput = { foodId?: unknown; servingId?: unknown; amount?: unknown; food?: unknown; snapshot?: unknown };

/** Today's date as the browser sees it (it knows the user's time zone), or the server's. */
export function dateParam(value: unknown): string {
  if (isDateKey(value)) return value;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function resolveItem(userId: string, input: ItemInput): Promise<{ item: ResolvedItem; food: Food | null }> {
  const foodId = typeof input.foodId === 'string' ? input.foodId : '';
  const parsed = parseFoodId(foodId);
  if (!parsed || parsed.source === 'quick') throw new ApiError(400, 'Unknown food.');
  const amount = cleanAmount(input.amount);
  if (!amount) throw new ApiError(400, `Amounts go from a little over 0 to ${MAX_AMOUNT}.`);
  const servingId = typeof input.servingId === 'string' ? input.servingId.slice(0, 40) : '';

  // A recipe logged again (recent foods, a saved meal): its numbers are the ones worked out
  // when it was first logged, cleaned like any snapshot the browser sends.
  if (parsed.source === 'recipe') {
    // From the food picker it comes as a one-serving food built from that snapshot.
    const sent = input.food && typeof input.food === 'object' ? (input.food as { name?: unknown; servings?: unknown }) : null;
    const serving = sent && Array.isArray(sent.servings) ? (sent.servings[0] as Record<string, unknown> | undefined) : undefined;
    const snapshot = cleanSnapshot(input.snapshot)
      ?? (serving ? cleanSnapshot({ name: sent!.name, source: 'recipe', servingLabel: serving.label, nutrients: serving.nutrients, grams: serving.grams }) : null);
    if (!snapshot) throw new ApiError(400, 'Log the recipe from “From a recipe” first.');
    return { item: { foodId, servingId: 's', amount, snapshot: { ...snapshot, source: 'recipe' } }, food: null };
  }

  let { food } = await getFood(foodId, userId);
  // A remote result the server no longer has cached, and its source can't be reached: take the
  // browser's copy (it came from our own search). Your own foods must already be in the library.
  if (!food && input.food && parsed.source !== 'custom' && parsed.source !== 'usda') {
    try {
      const sent = cleanFood(input.food);
      if (sent.id === foodId && !sent.partial) food = sent;
    } catch { /* fall through to the snapshot */ }
  }
  if (food) {
    const serving = food.servings.find((s) => s.id === servingId) ?? (food.servings.length === 1 ? food.servings[0] : undefined);
    if (serving) return { item: { foodId, servingId: serving.id, amount, snapshot: snapshotFor(food, serving) }, food };
  }
  const snapshot = cleanSnapshot(input.snapshot);
  if (snapshot) return { item: { foodId, servingId: servingId || 's', amount, snapshot }, food: null };
  throw new ApiError(food ? 400 : 404, food ? 'That serving isn’t one this food has.' : 'Couldn’t find that food right now. Try again, or add it as your own food.');
}

/** Resolve several items, copying the foods into the library as they're used. */
export async function resolveItems(userId: string, inputs: unknown, max = 40): Promise<ResolvedItem[]> {
  if (!Array.isArray(inputs) || !inputs.length) throw new ApiError(400, 'Nothing to add.');
  const out: ResolvedItem[] = [];
  for (const input of inputs.slice(0, max)) {
    const { item, food } = await resolveItem(userId, (input ?? {}) as ItemInput);
    if (food) await keepInLibrary(food, userId);
    out.push(item);
  }
  return out;
}

// ─── Recipes ──────────────────────────────────────────────────────────────────

const recipesFile = () => path.join(process.cwd(), '.data', 'recipes', 'recipes.json');
/** Ingredient lines looked at per recipe. */
export const MAX_RECIPE_LINES = 80;

/**
 * The recipes this account can see, with any parts that are other recipes
 * filled in. The same rule as /api/recipes: a private recipe is only for the
 * account that made it (or the admin). A batch already made still counts: it's
 * still eaten, so the kitchen's "made" set isn't applied here.
 */
export async function visibleRecipes(userId: string): Promise<Recipe[]> {
  const [raw, admin] = await Promise.all([
    readJson<RecipesData | null>(recipesFile(), null),
    isAdminAuthenticated().catch(() => false),
  ]);
  const visible = normalizeRecipesData(raw).recipes.filter((r) => admin || !r.private || r.ownerId === userId);
  return resolveRecipes(visible).map(publicRecipe);
}

export async function loadRecipe(userId: string, recipeId: unknown): Promise<Recipe> {
  if (typeof recipeId !== 'string' || !/^[\w.-]{1,64}$/.test(recipeId)) throw new ApiError(400, 'Pick a recipe.');
  const recipe = (await visibleRecipes(userId)).find((r) => r.id === recipeId);
  if (!recipe) throw new ApiError(404, 'That recipe isn’t there any more.');
  return recipe;
}

/** The ingredients that count: the recipe's list, capped. */
export const recipeItems = (recipe: Recipe): BomItem[] => extractIngredients(recipe).slice(0, MAX_RECIPE_LINES);

/**
 * Matching runs on the foods kept here, never an outside service: the shared
 * library (foods people here have used, ranked up like in search) and the
 * bundled USDA foods. Foods this account logs often rise to the top.
 */
export async function localLookup(usage: Record<string, Usage> = {}): Promise<FoodLookup> {
  const usdaOn = (await getFoodSettings()).sources.usda;
  return {
    async search(query) {
      // Wider than the search box: the plain raw food is often a long name further down.
      const library = (await searchLibrary(query, 20)).map((h) => ({ ...h, score: h.score + 3 }));
      const usda = usdaOn ? searchUsda(query, 40) : [];
      return mergeResults([...library, ...usda], usage, '', new Set(library.map((h) => h.food.id)));
    },
    async get(id) {
      const parsed = parseFoodId(id);
      if (!parsed || parsed.source === 'quick' || parsed.source === 'recipe') return null;
      return (await getLibraryFood(id)) ?? (parsed.source === 'usda' ? await usdaSource.get(parsed.sourceId) : null);
    },
  };
}

/** A recipe's ingredients matched to foods, starting from this account's earlier corrections. */
export async function matchRecipe(recipe: Recipe, data: FoodUserData): Promise<MatchLine[]> {
  const lookup = await localLookup(usageStats(data));
  const lines = await matchIngredients(recipeItems(recipe), data.recipeMatches, lookup, { describe: (item) => formatBomAmount(item, 1, 'both') });
  // Just the food: a library copy also says when it was saved and which account typed it in.
  return lines.map((line) => {
    if (!line.food) return line;
    const { id, source, sourceId, name, brand, servings, per100, category } = line.food;
    return { ...line, food: { id, source, sourceId, name, servings, ...(brand ? { brand } : {}), ...(per100 ? { per100 } : {}), ...(category ? { category } : {}) } };
  });
}

type RecipeLine = { key?: unknown; foodId?: unknown; servingId?: unknown; amount?: unknown; changed?: unknown };

/**
 * A recipe to log, worked out again here from what the page settled on: each
 * ingredient's food, serving and amount for the whole recipe. The page's own
 * totals aren't trusted. With `use: 'recipe'` the recipe's own per-serving
 * numbers are logged instead. Lines marked `changed` are remembered for next time.
 *
 *   { type: 'recipe', date, meal, recipeId, servings, use?: 'lines' | 'recipe', lines: [{ key, foodId, servingId, amount, changed? }] }
 */
export async function resolveRecipeLog(userId: string, raw: Record<string, unknown>): Promise<Extract<LogAction, { type: 'recipe' }>> {
  if (!isMeal(raw.meal)) throw new ApiError(400, 'Pick a meal.');
  if (!isDateKey(raw.date)) throw new ApiError(400, 'Unknown day.');
  const servings = cleanAmount(raw.servings);
  if (!servings || servings > 100) throw new ApiError(400, 'Servings eaten go from a little over 0 to 100.');
  const recipe = await loadRecipe(userId, raw.recipeId);
  const items = new Map(recipeItems(recipe).map((item) => [item.key, item]));
  const lines: RecipeLine[] = Array.isArray(raw.lines) ? raw.lines.slice(0, MAX_RECIPE_LINES) : [];
  const lookup = await localLookup();

  let total = zeroNutrients();
  let counted = 0;
  const remember: Record<string, RecipeMatchPref> = {};
  const seen = new Set<string>();
  for (const line of lines) {
    const item = typeof line?.key === 'string' ? items.get(line.key) : undefined;
    if (!item || seen.has(item.key) || neverCounted(item.key)) continue;
    seen.add(item.key);
    if (line.amount === 0) continue;
    const amount = cleanAmount(line.amount);
    if (!amount) throw new ApiError(400, `The amount for ${item.name} isn’t one that can be logged.`);
    const foodId = typeof line.foodId === 'string' ? line.foodId.slice(0, 100) : '';
    // Mostly the library or USDA; a food picked from a full search may be a FatSecret
    // result the server saw moments ago (getFood has it cached).
    const food = (await lookup.get(foodId)) ?? (await getFood(foodId, userId)).food;
    if (!food) throw new ApiError(404, `Couldn’t find the food for ${item.name}. Pick it again.`);
    const servingId = typeof line.servingId === 'string' ? line.servingId : '';
    if (!food.servings.some((s) => s.id === servingId)) throw new ApiError(400, `That serving isn’t one ${food.name} has.`);
    total = addNutrients(total, lineNutrients(food, servingId, amount));
    counted += 1;
    if (line.changed === true) {
      remember[item.key] = prefFor(item, food.id, servingId, amount);
      // So the next import finds it here, without asking its source again.
      await keepInLibrary(food, userId);
    }
  }

  let perServing;
  if (raw.use === 'recipe') {
    perServing = macrosNutrients(recipe.macros);
    if (!perServing) throw new ApiError(400, 'This recipe doesn’t list its own calories.');
  } else {
    if (!counted) throw new ApiError(400, 'None of the ingredients are counted yet.');
    perServing = scaleNutrients(total, 1 / recipe.servings);
    if (perServing.kcal < 0.5) throw new ApiError(400, 'That comes to no calories. Check the amounts.');
  }
  return {
    type: 'recipe',
    date: raw.date,
    meal: raw.meal,
    item: { foodId: recipeFoodId(recipe.id), servingId: 's', amount: servings, snapshot: recipeSnapshot(recipe.title, perServing, recipe.servings) },
    remember,
  };
}

/** A recipe as the picker lists it. */
export function recipeSummary(recipe: Recipe, usage: Record<string, Usage> = {}): RecipeSummary {
  const out: RecipeSummary = { id: recipe.id, title: recipe.title, emoji: recipeEmoji(recipe), servings: recipe.servings, category: recipe.category };
  if (recipe.photo) out.photo = recipe.photo;
  const own = macrosNutrients(recipe.macros);
  if (own) out.kcal = own.kcal;
  const logged = usage[recipeFoodId(recipe.id)]?.count;
  if (logged) out.logged = logged;
  return out;
}
