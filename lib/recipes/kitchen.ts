// What you keep at home, the weekly meal plan and the shopping list built from
// them. Pure functions and types, used on both sides: the browser keeps a copy
// on the device, and signed-in accounts sync it through /api/recipes/kitchen.

import { addDays, isDateKey, localToday, weekStart, type DateKey } from '../habits/dates';
import {
  ALWAYS_HAVE,
  buildSchedule,
  extractIngredients,
  mergeBoms,
  parseStepKey,
  type BomItem,
  type Recipe,
  type RecipeSection,
} from './recipes';

export type PlanEntry = {
  id: string;
  recipeId: string;
  servings: number;
  /** 0 = Monday … 6 = Sunday; null = meal prep, cooked ahead for the week. */
  day: number | null;
  cooked?: boolean;
};

export type KitchenState = {
  version: 1;
  /** Ingredient keys you already have, marked on any recipe. */
  have: string[];
  /** Meal plans by the Monday their week starts on. */
  plans: Record<DateKey, PlanEntry[]>;
  /** Recipes on the shopping list outside the plan. */
  listRecipes: { recipeId: string; servings: number }[];
  /** Things typed straight onto the list. */
  listItems: { id: string; text: string }[];
  /** Ingredient keys and typed-item ids already in the basket. */
  got: string[];
};

export function emptyKitchen(): KitchenState {
  return { version: 1, have: [], plans: {}, listRecipes: [], listItems: [], got: [] };
}

const WEEKS_KEPT = 26;
const clampServings = (n: unknown) => Math.min(48, Math.max(1, Math.round(Number(n)) || 1));
const shortString = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const newKitchenId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Clean anything read from storage or sent by a browser; never throws. */
export function normalizeKitchen(raw: unknown, today = localToday()): KitchenState {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strings = (v: unknown, max: number, limit: number) =>
    Array.isArray(v) ? [...new Set(v.map((s) => shortString(s, max)).filter(Boolean))].slice(-limit) : [];

  const oldest = addDays(weekStart(today), -7 * WEEKS_KEPT);
  const plans: KitchenState['plans'] = {};
  const rawPlans = source.plans && typeof source.plans === 'object' ? (source.plans as Record<string, unknown>) : {};
  for (const [week, entries] of Object.entries(rawPlans)) {
    if (!isDateKey(week) || week < oldest || !Array.isArray(entries)) continue;
    const clean: PlanEntry[] = entries
      .slice(0, 60)
      .map((e: Record<string, unknown>) => ({
        id: shortString(e?.id, 40) || newKitchenId(),
        recipeId: shortString(e?.recipeId, 60),
        servings: clampServings(e?.servings),
        day: Number.isInteger(e?.day) && (e.day as number) >= 0 && (e.day as number) <= 6 ? (e.day as number) : null,
        ...(e?.cooked === true ? { cooked: true } : {}),
      }))
      .filter((e) => e.recipeId);
    if (clean.length) plans[week] = clean;
  }

  const listRecipes = (Array.isArray(source.listRecipes) ? source.listRecipes : [])
    .slice(0, 60)
    .map((r: Record<string, unknown>) => ({ recipeId: shortString(r?.recipeId, 60), servings: clampServings(r?.servings) }))
    .filter((r) => r.recipeId);
  const listItems = (Array.isArray(source.listItems) ? source.listItems : [])
    .slice(0, 200)
    .map((i: Record<string, unknown>) => ({ id: shortString(i?.id, 40) || newKitchenId(), text: shortString(i?.text, 120) }))
    .filter((i) => i.text);

  return {
    version: 1,
    have: strings(source.have, 80, 500),
    plans,
    listRecipes,
    listItems,
    got: strings(source.got, 100, 500),
  };
}

// ─── Weeks ────────────────────────────────────────────────────────────────────

const toDate = (key: DateKey) => new Date(`${key}T12:00:00`);
const monthDay = (key: DateKey) => toDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const currentWeek = (today = localToday()) => weekStart(today);
export const weekLabel = (week: DateKey) => `${monthDay(week)} – ${monthDay(addDays(week, 6))}`;

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dayInfo(week: DateKey, day: number, today = localToday()) {
  const key = addDays(week, day);
  return { name: DAY_NAMES[day], date: toDate(key).getDate(), isToday: key === today, isPast: key < today };
}

// ─── Have / missing ───────────────────────────────────────────────────────────

export const haveSet = (kitchen: Pick<KitchenState, 'have'>) => new Set([...kitchen.have, ...ALWAYS_HAVE]);

/** Ingredients of a recipe you'd still need to buy. */
export function missingIngredients(recipe: Pick<Recipe, 'sections'>, have: Set<string>): BomItem[] {
  return extractIngredients(recipe).filter((item) => !have.has(item.key));
}

// ─── Aisles ───────────────────────────────────────────────────────────────────

// First match wins, so "peanut butter" is a spread and not dairy, and "garlic
// powder" a spice and not produce. Display order follows AISLES.
const AISLE_RULES: [string, RegExp][] = [
  ['Frozen', /\bfrozen\b/],
  ['Baking', /\b(flour(?!\s+tortilla)|sugar|baking|yeast|cornstarch|cocoa|chocolate|vanilla|sprinkles|espresso powder|molasses|powdered)\b/],
  ['Spices', /\b(salt|black pepper|white pepper|peppercorns?|paprika|cumin|cinnamon|nutmeg|oregano|cayenne|turmeric|cardamom|allspice|seasoning|chili powder|\w+ powder|\w+ flakes|dried \w+|ground \w*(ginger|coriander|cloves?)|bay lea\w+)\b/],
  ['Oils & sauces', /\b(oil|vinegar|sauce|mustard|ketchup|mayo|mayonnaise|relish|pickles?|miso|chili crisp|tahini|peanut butter|almond butter|honey|maple syrup|syrup|jam|salsa|dressing|sriracha|gochujang|hoisin)\b/],
  ['Bread & grains', /\b(rice|pasta|noodles?|spaghetti|penne|macaroni|oats?|quinoa|couscous|tortillas?|bread|buns?|pita|bagels?|breadcrumbs?|panko|crackers?)\b/],
  ['Canned & dry goods', /\b(broth|stock|canned|paste|coconut milk|lentils?|chickpeas?|black beans?|kidney beans?|pinto beans?|cannellini|beans|almonds?|walnuts?|pecans?|peanuts?|cashews?|nuts|seeds)\b/],
  ['Meat & seafood', /\b(chicken|beef|pork|turkey|lamb|bacon|sausages?|ham|salmon|shrimp|tuna|cod|fish|steaks?|prosciutto|chorizo|tofu)\b/],
  ['Dairy & eggs', /\b(milk|cream|butter|buttermilk|cheese|yogurt|yoghurt|eggs?|parmesan|mozzarella|cheddar|feta|ricotta|ghee)\b/],
  ['Produce', /\b(onions?|garlic|tomato(es)?|peppers?|carrots?|celery|lettuce|broccoli|cauliflower|spinach|kale|cabbage|potato(es)?|mushrooms?|zucchini|cucumbers?|lemons?|limes?|oranges?|apples?|bananas?|berry|berries|avocados?|ginger|cilantro|parsley|basil|mint|thyme|rosemary|dill|scallions?|shallots?|squash|corn|green beans?|peas|leeks?|arugula|beets?|edamame|jalape\w+)\b/],
];

export const AISLES = [
  'Produce',
  'Meat & seafood',
  'Dairy & eggs',
  'Bread & grains',
  'Canned & dry goods',
  'Baking',
  'Oils & sauces',
  'Spices',
  'Frozen',
  'Other',
];

export function aisleFor(name: string): string {
  const lower = name.toLowerCase();
  for (const [aisle, rule] of AISLE_RULES) if (rule.test(lower)) return aisle;
  return 'Other';
}

// ─── Shopping list ────────────────────────────────────────────────────────────

export type ShoppingItem = BomItem & { aisle: string; sources: string[] };

export type ShoppingList = {
  /** What's left to buy, by aisle in the order you'd walk the store. */
  groups: { aisle: string; items: ShoppingItem[] }[];
  need: ShoppingItem[];
  /** On the list's recipes, but marked as already at home. */
  have: ShoppingItem[];
  recipeCount: number;
};

/** The week's plan plus any one-off recipes, merged, with what you have set aside. */
export function buildShoppingList(recipes: Recipe[], kitchen: KitchenState, week: DateKey): ShoppingList {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const wanted = [
    ...(kitchen.plans[week] || []).filter((e) => !e.cooked),
    ...kitchen.listRecipes,
  ].flatMap((entry) => {
    const recipe = byId.get(entry.recipeId);
    return recipe ? [{ recipe, servings: entry.servings }] : [];
  });

  const lists = wanted.map(({ recipe, servings }) => ({ items: extractIngredients(recipe), scale: servings / recipe.servings, recipe }));
  const sources = new Map<string, Set<string>>();
  for (const { items, recipe } of lists) {
    for (const item of items) {
      if (!sources.has(item.key)) sources.set(item.key, new Set());
      sources.get(item.key)!.add(recipe.title);
    }
  }

  const have = haveSet(kitchen);
  const merged: ShoppingItem[] = mergeBoms(lists).map((item) => ({
    ...item,
    aisle: aisleFor(item.name),
    sources: [...(sources.get(item.key) || [])],
  }));
  const need = merged.filter((item) => !have.has(item.key));
  const groups = AISLES.map((aisle) => ({ aisle, items: need.filter((item) => item.aisle === aisle) })).filter((g) => g.items.length);
  return {
    groups,
    need,
    have: merged.filter((item) => have.has(item.key) && !ALWAYS_HAVE.includes(item.key)),
    recipeCount: new Set(wanted.map((w) => w.recipe.id)).size,
  };
}

/** How many things are left to buy for a week: its plan, plus anything typed onto the list. */
export function groceriesLeft(recipes: Recipe[], kitchen: KitchenState, week: DateKey) {
  const planned = buildShoppingList(recipes, kitchen, week).need.filter((i) => !kitchen.got.includes(`${week}|${i.key}`));
  return planned.length + kitchen.listItems.filter((i) => !kitchen.got.includes(i.id)).length;
}

/** Type something onto the list, unless it's already there and unticked. */
export function addListItem(kitchen: KitchenState, text: string): KitchenState {
  const clean = text.trim().slice(0, 120);
  const open = kitchen.listItems.some((i) => i.text.toLowerCase() === clean.toLowerCase() && !kitchen.got.includes(i.id));
  if (!clean || open) return kitchen;
  return { ...kitchen, listItems: [...kitchen.listItems, { id: newKitchenId(), text: clean }] };
}

/** Today's meals from the plan: what's on for today, and the week's meal prep still in the fridge or to cook. */
export function mealsToday(recipes: Recipe[], kitchen: KitchenState, today = localToday()) {
  const week = currentWeek(today);
  const day = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${week}T12:00:00`).getTime()) / 86_400_000);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const entries = (kitchen.plans[week] || []).flatMap((entry) => {
    const recipe = byId.get(entry.recipeId);
    return recipe ? [{ entry, recipe }] : [];
  });
  return { week, tonight: entries.filter((e) => e.entry.day === day), prep: entries.filter((e) => e.entry.day === null && !e.entry.cooked) };
}

// ─── Meal prep session ────────────────────────────────────────────────────────

/**
 * Every meal-prep recipe of the week as one recipe, so cook mode can merge
 * them into a single order. Each section remembers its recipe's own scale.
 */
export function buildPrepSession(entries: PlanEntry[], recipes: Recipe[], week: DateKey) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const sections: RecipeSection[] = [];
  const sectionScales: number[] = [];
  const parts: { recipe: Recipe; servings: number }[] = [];
  for (const entry of entries) {
    const recipe = byId.get(entry.recipeId);
    if (!recipe) continue;
    parts.push({ recipe, servings: entry.servings });
    const base = sections.length;
    recipe.sections.forEach((sec) => {
      const target = parseStepKey(sec.readyBy);
      sections.push({
        name: recipe.sections.length > 1 ? `${recipe.title} · ${sec.name}` : recipe.title,
        steps: sec.steps,
        ...(target ? { readyBy: `${target.section + base}:${target.step}` } : {}),
      });
      sectionScales.push(entry.servings / recipe.servings);
    });
  }
  const now = new Date().toISOString();
  const recipe: Recipe = {
    id: `prep-${week}`,
    slug: '',
    title: 'meal prep',
    summary: '',
    category: 'dinner',
    servings: 1,
    equipment: [],
    tags: [],
    timesCooked: 0,
    sections,
    createdAt: now,
    updatedAt: now,
  };
  const schedule = buildSchedule({ sections });
  const bom = mergeBoms(parts.map(({ recipe: r, servings }) => ({ items: extractIngredients(r), scale: servings / r.servings })));
  return { recipe, sectionScales, schedule, bom, recipeCount: parts.length };
}
