import { cleanFood, cleanText, FoodInputError, parseFoodId } from './foods';
import { cleanNutrients, roundNutrients, scaleNutrients, sumNutrients, zeroNutrients } from './nutrients';
import { cleanRecipeMatches, MAX_REMEMBERED } from './recipe-match';
import type { Usage } from './search';
import {
  MEALS, type EntrySnapshot, type Food, type FoodSettings, type FoodSource, type FoodUserData, type LogEntry, type Meal, type Nutrients, type RecipeMatchPref, type SavedMeal, type Serving,
} from './types';

// One account's food diary: days of entries, saved meals and settings, and the
// changes the page can make to them. Pure functions; the API route does the
// file locking and resolves foods before calling in here.

export const MAX_ENTRIES_PER_DAY = 150;
export const MAX_SAVED_MEALS = 60;
export const MAX_MEAL_ITEMS = 40;
/** Servings per entry. High because "1 g" and "1 ml" are servings too (450 g of rice is 450 of them). */
export const MAX_AMOUNT = 5000;
const ID = /^[\w-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES: FoodSource[] = ['custom', 'usda', 'fatsecret', 'off', 'quick', 'recipe'];

export const DEFAULT_SETTINGS: FoodSettings = { proteinPerLb: 0.8, planTarget: 'plan', addExercise: false };

export const emptyFoodData = (): FoodUserData => ({ days: {}, meals: [], settings: { ...DEFAULT_SETTINGS }, recipeMatches: {} });

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

export const isMeal = (value: unknown): value is Meal => MEALS.includes(value as Meal);

/** The meal a time of day suggests: breakfast before 10:30, lunch to 3, snack to 5, then dinner, late snack after 9. */
export function mealForTime(date: Date): Meal {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 4 && h < 10.5) return 'breakfast';
  if (h >= 10.5 && h < 15) return 'lunch';
  if (h >= 15 && h < 17) return 'snack';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snack';
}

export function cleanAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  return Math.round(n * 1000) / 1000;
}

/** What an entry keeps of its food and serving. */
export function snapshotFor(food: Food, serving: Serving): EntrySnapshot {
  const snap: EntrySnapshot = { name: food.name, source: food.source, servingLabel: serving.label, nutrients: roundNutrients(serving.nutrients) };
  if (food.brand) snap.brand = food.brand;
  if (serving.grams) snap.grams = serving.grams;
  else if (serving.ml) snap.ml = serving.ml;
  return snap;
}

export function cleanSnapshot(raw: unknown): EntrySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = cleanText(r.name, 120);
  const servingLabel = cleanText(r.servingLabel, 80) || '1 serving';
  const nutrients = cleanNutrients(r.nutrients);
  const source = SOURCES.includes(r.source as FoodSource) ? (r.source as FoodSource) : 'custom';
  if (!name || !nutrients) return null;
  const snap: EntrySnapshot = { name, source, servingLabel, nutrients };
  const brand = cleanText(r.brand, 80);
  if (brand) snap.brand = brand;
  if (typeof r.grams === 'number' && r.grams > 0 && r.grams <= 10_000) snap.grams = r.grams;
  else if (typeof r.ml === 'number' && r.ml > 0 && r.ml <= 10_000) snap.ml = r.ml;
  return snap;
}

function cleanEntry(raw: unknown): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const snapshot = cleanSnapshot(r.snapshot);
  const amount = cleanAmount(r.amount);
  if (typeof r.id !== 'string' || !ID.test(r.id) || !isMeal(r.meal) || !snapshot || !amount) return null;
  const foodId = r.foodId === 'quick' || parseFoodId(r.foodId) ? (r.foodId as string) : 'quick';
  const servingId = typeof r.servingId === 'string' && r.servingId.length <= 40 ? r.servingId : 's';
  const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date(0).toISOString();
  return { id: r.id, meal: r.meal, foodId, servingId, amount, snapshot, at };
}

function cleanTarget(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
}

/** Settings from untrusted input, on top of `base`. A blank (null/"") target goes back to automatic. */
export function cleanSettings(raw: unknown, base: FoodSettings = DEFAULT_SETTINGS): FoodSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: FoodSettings = { ...base };
  const targets: [keyof FoodSettings, number, number][] = [['kcalTarget', 800, 8000], ['proteinTarget', 20, 500], ['carbsTarget', 0, 1000], ['fatTarget', 10, 400]];
  for (const [key, min, max] of targets) {
    if (!(key in r)) continue;
    const v = cleanTarget(r[key], min, max);
    if (v === undefined) delete out[key];
    else (out as Record<string, unknown>)[key] = v;
  }
  if ('proteinPerLb' in r) {
    const v = Number(r.proteinPerLb);
    if (Number.isFinite(v) && v >= 0.3 && v <= 1.5) out.proteinPerLb = Math.round(v * 100) / 100;
  }
  if (r.planTarget === 'plan' || r.planTarget === 'needed') out.planTarget = r.planTarget;
  if (typeof r.addExercise === 'boolean') out.addExercise = r.addExercise;
  return out;
}

function cleanSavedMeal(raw: unknown): SavedMeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = cleanText(r.name, 60);
  if (typeof r.id !== 'string' || !ID.test(r.id) || !name) return null;
  const items: SavedMeal['items'] = [];
  for (const item of Array.isArray(r.items) ? r.items.slice(0, MAX_MEAL_ITEMS) : []) {
    const i = item as Record<string, unknown>;
    const snapshot = cleanSnapshot(i?.snapshot);
    const amount = cleanAmount(i?.amount);
    if (!snapshot || !amount) continue;
    const foodId = i.foodId === 'quick' || parseFoodId(i.foodId) ? (i.foodId as string) : 'quick';
    items.push({ foodId, servingId: typeof i.servingId === 'string' ? i.servingId.slice(0, 40) : 's', amount, snapshot });
  }
  if (!items.length) return null;
  return { id: r.id, name, items, createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString() };
}

/** Whatever was stored, as valid data. */
export function normalizeFoodData(raw: unknown): FoodUserData {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const days: FoodUserData['days'] = {};
  if (r.days && typeof r.days === 'object') {
    for (const [date, list] of Object.entries(r.days as Record<string, unknown>)) {
      if (!isDateKey(date) || !Array.isArray(list)) continue;
      const entries = list.map(cleanEntry).filter((e): e is LogEntry => !!e).slice(0, MAX_ENTRIES_PER_DAY);
      if (entries.length) days[date] = entries;
    }
  }
  const meals = (Array.isArray(r.meals) ? r.meals : []).map(cleanSavedMeal).filter((m): m is SavedMeal => !!m).slice(0, MAX_SAVED_MEALS);
  // Files from before recipes could be logged have no corrections yet.
  return { days, meals, settings: cleanSettings(r.settings, DEFAULT_SETTINGS), recipeMatches: cleanRecipeMatches(r.recipeMatches) };
}

// ─── Changes ──────────────────────────────────────────────────────────────────

/** An item ready to log: the route has already found the food and built its snapshot. */
export type ResolvedItem = { foodId: string; servingId: string; amount: number; snapshot: EntrySnapshot };

export type LogAction =
  | { type: 'add'; date: string; meal: Meal; items: ResolvedItem[] }
  | { type: 'quick'; date: string; meal: Meal; name?: string; nutrients: unknown }
  | { type: 'edit'; date: string; id: string; amount?: unknown; meal?: unknown; moveTo?: unknown; serving?: { servingId: string; snapshot: EntrySnapshot } }
  | { type: 'remove'; date: string; ids: string[] }
  | { type: 'restore'; date: string; entries: unknown[] }
  | { type: 'copy-meal'; fromDate: string; fromMeal: Meal; date: string; meal: Meal }
  | { type: 'save-meal'; name: string; items: ResolvedItem[] }
  | { type: 'save-meal-from'; name: string; date: string; meal: Meal }
  | { type: 'rename-meal'; id: string; name: string }
  | { type: 'remove-meal'; id: string }
  /** A meal from a recipe: one entry, and any ingredient matches corrected on the way, remembered. */
  | { type: 'recipe'; date: string; meal: Meal; item: ResolvedItem; remember?: Record<string, RecipeMatchPref> };

function dayOf(data: FoodUserData, date: unknown): LogEntry[] {
  if (!isDateKey(date)) throw new FoodInputError('Unknown day.');
  return (data.days[date] ??= []);
}

function pushEntries(data: FoodUserData, date: string, entries: LogEntry[]) {
  const day = dayOf(data, date);
  if (day.length + entries.length > MAX_ENTRIES_PER_DAY) throw new FoodInputError(`That’s more than ${MAX_ENTRIES_PER_DAY} entries for one day.`);
  day.push(...entries);
}

function prune(data: FoodUserData, date: string) {
  if (data.days[date] && !data.days[date].length) delete data.days[date];
}

/** Apply one change in place. Returns the entries it added, if any. */
export function applyLogAction(data: FoodUserData, action: LogAction, now: Date, newId: () => string): LogEntry[] {
  const at = now.toISOString();
  const entryFrom = (meal: Meal, item: ResolvedItem): LogEntry => {
    const amount = cleanAmount(item.amount);
    const snapshot = cleanSnapshot(item.snapshot);
    if (!amount) throw new FoodInputError(`Amounts go from a little over 0 to ${MAX_AMOUNT}.`);
    if (!snapshot) throw new FoodInputError('That food has no calories to log.');
    return { id: newId(), meal, foodId: item.foodId, servingId: item.servingId, amount, snapshot, at };
  };
  switch (action?.type) {
    case 'add': {
      if (!isMeal(action.meal)) throw new FoodInputError('Pick a meal.');
      if (!Array.isArray(action.items) || !action.items.length) throw new FoodInputError('Nothing to add.');
      const entries = action.items.slice(0, MAX_MEAL_ITEMS).map((item) => entryFrom(action.meal, item));
      pushEntries(data, action.date, entries);
      return entries;
    }
    case 'quick': {
      if (!isMeal(action.meal)) throw new FoodInputError('Pick a meal.');
      const nutrients = cleanNutrients(action.nutrients);
      if (!nutrients || nutrients.kcal <= 0) throw new FoodInputError('Enter some calories.');
      const name = cleanText(action.name, 80) || 'Quick add';
      const entry = entryFrom(action.meal, { foodId: 'quick', servingId: 's', amount: 1, snapshot: { name, source: 'quick', servingLabel: '1 serving', nutrients } });
      pushEntries(data, action.date, [entry]);
      return [entry];
    }
    case 'edit': {
      const day = dayOf(data, action.date);
      const entry = day.find((e) => e.id === action.id);
      if (!entry) throw new FoodInputError('That entry isn’t there any more.');
      if (action.amount !== undefined) {
        const amount = cleanAmount(action.amount);
        if (!amount) throw new FoodInputError(`Amounts go from a little over 0 to ${MAX_AMOUNT}.`);
        entry.amount = amount;
      }
      if (action.meal !== undefined) {
        if (!isMeal(action.meal)) throw new FoodInputError('Pick a meal.');
        entry.meal = action.meal;
      }
      if (action.serving) {
        const snapshot = cleanSnapshot(action.serving.snapshot);
        if (!snapshot) throw new FoodInputError('That serving has no calories.');
        entry.servingId = String(action.serving.servingId).slice(0, 40);
        entry.snapshot = snapshot;
      }
      if (action.moveTo !== undefined && action.moveTo !== action.date) {
        if (!isDateKey(action.moveTo)) throw new FoodInputError('Unknown day.');
        data.days[action.date] = day.filter((e) => e.id !== entry.id);
        prune(data, action.date);
        pushEntries(data, action.moveTo, [entry]);
      }
      return [];
    }
    case 'remove': {
      const ids = new Set(Array.isArray(action.ids) ? action.ids : []);
      const day = dayOf(data, action.date);
      data.days[action.date] = day.filter((e) => !ids.has(e.id));
      prune(data, action.date);
      return [];
    }
    case 'restore': {
      const day = dayOf(data, action.date);
      const taken = new Set(day.map((e) => e.id));
      const back = (Array.isArray(action.entries) ? action.entries : []).map(cleanEntry).filter((e): e is LogEntry => !!e && !taken.has(e.id));
      pushEntries(data, action.date, back);
      day.sort((a, b) => a.at.localeCompare(b.at));
      return back;
    }
    case 'copy-meal': {
      if (!isMeal(action.fromMeal) || !isMeal(action.meal)) throw new FoodInputError('Pick a meal.');
      if (!isDateKey(action.fromDate)) throw new FoodInputError('Unknown day.');
      const from = (data.days[action.fromDate] || []).filter((e) => e.meal === action.fromMeal);
      if (!from.length) throw new FoodInputError('Nothing was logged for that meal.');
      const entries = from.map((e) => ({ ...e, id: newId(), meal: action.meal, at }));
      pushEntries(data, action.date, entries);
      return entries;
    }
    case 'save-meal':
    case 'save-meal-from': {
      const name = cleanText(action.name, 60);
      if (!name) throw new FoodInputError('Give the meal a name.');
      const source: ResolvedItem[] = action.type === 'save-meal'
        ? (Array.isArray(action.items) ? action.items : [])
        : (isDateKey(action.date) ? data.days[action.date] || [] : []).filter((e) => e.meal === action.meal);
      const items = source.slice(0, MAX_MEAL_ITEMS).map((i) => ({ foodId: i.foodId, servingId: i.servingId, amount: cleanAmount(i.amount), snapshot: cleanSnapshot(i.snapshot) }))
        .filter((i): i is ResolvedItem => !!i.amount && !!i.snapshot);
      if (!items.length) throw new FoodInputError('A saved meal needs at least one food.');
      const existing = data.meals.find((m) => m.name.toLowerCase() === name.toLowerCase());
      if (existing) existing.items = items;
      else {
        if (data.meals.length >= MAX_SAVED_MEALS) throw new FoodInputError(`That’s ${MAX_SAVED_MEALS} saved meals. Remove one first.`);
        data.meals.push({ id: newId(), name, items, createdAt: at });
      }
      return [];
    }
    case 'rename-meal': {
      const meal = data.meals.find((m) => m.id === action.id);
      const name = cleanText(action.name, 60);
      if (!meal) throw new FoodInputError('That meal isn’t there any more.');
      if (!name) throw new FoodInputError('Give the meal a name.');
      meal.name = name;
      return [];
    }
    case 'remove-meal':
      data.meals = data.meals.filter((m) => m.id !== action.id);
      return [];
    case 'recipe': {
      if (!isMeal(action.meal)) throw new FoodInputError('Pick a meal.');
      const entry = entryFrom(action.meal, action.item);
      pushEntries(data, action.date, [entry]);
      // The latest corrections go last, so when there are too many the oldest are the ones dropped.
      const fresh = cleanRecipeMatches(action.remember);
      const kept = Object.entries(data.recipeMatches).filter(([key]) => !(key in fresh));
      data.recipeMatches = Object.fromEntries([...kept, ...Object.entries(fresh)].slice(-MAX_REMEMBERED));
      return [entry];
    }
    default:
      throw new FoodInputError('Unknown change.');
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export const entryNutrients = (entry: Pick<LogEntry, 'amount' | 'snapshot'>): Nutrients => scaleNutrients(entry.snapshot.nutrients, entry.amount);

export function dayTotals(entries: LogEntry[] = []): Nutrients {
  return entries.length ? roundNutrients(sumNutrients(entries.map(entryNutrients))) : zeroNutrients();
}

export function mealTotals(entries: LogEntry[] = []): Record<Meal, Nutrients> {
  return Object.fromEntries(MEALS.map((m) => [m, dayTotals(entries.filter((e) => e.meal === m))])) as Record<Meal, Nutrients>;
}

/** How often and how lately each food was logged (quick adds aside). */
export function usageStats(data: FoodUserData): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  for (const [date, entries] of Object.entries(data.days)) {
    for (const e of entries) {
      if (e.foodId === 'quick') continue;
      const u = (out[e.foodId] ??= { count: 0, last: date });
      u.count += 1;
      if (date > u.last) u.last = date;
    }
  }
  return out;
}

/** A food as you last logged it: enough to log it again even if its source is gone. */
export type RecentFood = ResolvedItem & { meal: Meal; date: string; count: number };

function latestLogged(data: FoodUserData, since = ''): Map<string, RecentFood> {
  const latest = new Map<string, RecentFood>();
  const dates = Object.keys(data.days).filter((d) => d >= since).sort();
  for (const date of dates) {
    for (const e of data.days[date]) {
      if (e.foodId === 'quick') continue;
      const prev = latest.get(e.foodId);
      latest.set(e.foodId, { foodId: e.foodId, servingId: e.servingId, amount: e.amount, snapshot: e.snapshot, meal: e.meal, date, count: (prev?.count ?? 0) + 1 });
    }
  }
  return latest;
}

/** Foods logged lately, newest first, once each. */
export function recentFoods(data: FoodUserData, limit = 30): RecentFood[] {
  return [...latestLogged(data).values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/** Foods logged most in the `days` before `today`, most first. */
export function frequentFoods(data: FoodUserData, today: string, days = 60, limit = 20): RecentFood[] {
  const since = shiftDate(today, -days);
  return [...latestLogged(data, since).values()].filter((f) => f.count >= 2).sort((a, b) => b.count - a.count || b.date.localeCompare(a.date)).slice(0, limit);
}

/** YYYY-MM-DD plus `n` days. */
export function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The `n` dates ending on `end`, oldest first. */
export function dateRange(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDate(end, i - n + 1));
}

/** A food the client sent, cleaned (a FatSecret result the server no longer has cached, say). */
export function foodFromClient(raw: unknown): Food | null {
  try { return cleanFood(raw); } catch { return null; }
}
