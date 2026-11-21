import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { servingsFromPer100 } from '../nutrients';
import { TokenIndex } from '../search';
import type { Food, Nutrients } from '../types';
import type { FoodSourceAdapter } from './types';

// USDA FoodData Central generic foods, bundled with the site (public domain),
// so a search always finds "banana" or "chicken breast" with no network. The
// file is built by scripts/build-usda-foods.mjs and read once per process.
// (next.config.ts traces it into the release build for the food API routes.)

/** [fdcId, name, categoryIndex, [kcal, protein, carbs, fat, fiber, sugar, sodium, satFat] per 100 g, [[label, grams]…]] */
export type UsdaRow = [number, string, number, (number | null)[], [string, number][]];
export type UsdaData = { v: number; source: string; builtAt: string; nutrients: string[]; categories: string[]; foods: UsdaRow[] };

export const USDA_FILE = () => path.join(process.cwd(), 'lib', 'food', 'data', 'usda-foods.json.gz');

/** One packed row as a Food. */
export function usdaRowToFood(row: UsdaRow, categories: string[]): Food {
  const [fdcId, name, cat, n, portions] = row;
  const [kcal, protein, carbs, fat, fiber, sugar, sodium, satFat] = n;
  const per100: Nutrients = { kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 };
  if (fiber != null) per100.fiber = fiber;
  if (sugar != null) per100.sugar = sugar;
  if (sodium != null) per100.sodium = sodium;
  if (satFat != null) per100.satFat = satFat;
  // A "medium" one (banana, apple, egg) is the natural first choice when USDA lists it.
  const ordered = [...portions].sort((a, b) => Number(/medium/i.test(b[0])) - Number(/medium/i.test(a[0])));
  const food: Food = { id: `usda:${fdcId}`, source: 'usda', sourceId: String(fdcId), name, per100, servings: servingsFromPer100(per100, ordered) };
  if (categories[cat]) food.category = categories[cat];
  return food;
}

type Loaded = { data: UsdaData; index: TokenIndex<UsdaRow>; byId: Map<string, UsdaRow> };
let loaded: Loaded | null = null;
let failed = false;

function load(): Loaded | null {
  if (loaded || failed) return loaded;
  try {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(USDA_FILE())).toString('utf-8')) as UsdaData;
    loaded = {
      data,
      index: new TokenIndex(data.foods, (row) => ({ name: row[1] })),
      byId: new Map(data.foods.map((row) => [String(row[0]), row])),
    };
  } catch (error) {
    // Missing from a build: say so once, and carry on with the other sources.
    failed = true;
    console.error('USDA foods could not be loaded:', error instanceof Error ? error.message : error);
  }
  return loaded;
}

export function usdaInfo() {
  const l = load();
  return l ? { count: l.data.foods.length, builtAt: l.data.builtAt, source: l.data.source } : null;
}

/** Scored matches, for the orchestrator's merge. */
export function searchUsda(query: string, limit: number) {
  const l = load();
  if (!l) return [];
  return l.index.search(query, limit).map(({ item, score }) => ({ food: usdaRowToFood(item, l.data.categories), score }));
}

export const usdaSource: FoodSourceAdapter = {
  id: 'usda',
  async search(query, limit) {
    return searchUsda(query, limit).map((h) => h.food);
  },
  async get(sourceId) {
    const l = load();
    const row = l?.byId.get(sourceId);
    return row ? usdaRowToFood(row, l!.data.categories) : null;
  },
};
