// What a home keeps in, its weekly meal plan and the shopping list built from
// them. Pure functions and types, used on both sides: the browser keeps a copy
// on the device, and signed-in households sync it through /api/recipes/kitchen,
// one small change at a time so two people editing at once both keep theirs.

import { addDays, daysBetween, isDateKey, localToday, weekStart, type DateKey } from '../habits/dates';
import {
  ALWAYS_HAVE,
  addAmounts,
  amountRatio,
  buildSchedule,
  extractIngredients,
  madeKey,
  mergeBoms,
  ovenTemps,
  parseStepKey,
  resolveRecipes,
  scaleAmount,
  type Amount,
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

/**
 * What's known about something kept at home. Only ever as much as you've
 * bothered to say: most things are just "have it" with no amount, and that
 * stays true until you say you ran out.
 */
export type PantryItem = {
  name: string;
  /** How much is left, if you said or it came from the store. Counts down as you cook. */
  amount?: Amount;
  /** The amount has been worked out from cooking since anyone last looked. */
  estimated?: boolean;
  /** Still some, but it's time to buy more. */
  low?: boolean;
  /** Ran out: not at home, and waiting on the list until it's bought or forgotten. */
  out?: boolean;
  /** When it came in. */
  since?: DateKey;
  /** The last time someone said it's still there. */
  checked?: DateKey;
};

/** A cook or a shop that changed the pantry: remembered so it can't count twice and a cook can be taken back. */
export type KitchenLogEntry = {
  id: string;
  kind: 'cook' | 'put-away';
  at: DateKey;
  recipeId?: string;
  title?: string;
  servings?: number;
  /** What the cook took off the shelf. */
  spent?: { key: string; amount: Amount }[];
  /** The plan entry it ticked off. */
  entry?: { week: DateKey; id: string };
};

export type KitchenState = {
  version: 1;
  /** Ingredient keys at home, marked on any recipe, in the pantry or by shopping. */
  have: string[];
  /** The details of what's at home, and what's run out, by ingredient key. */
  pantry: Record<string, PantryItem>;
  log: KitchenLogEntry[];
  /** Meal plans by the Monday their week starts on. */
  plans: Record<DateKey, PlanEntry[]>;
  /** Recipes on the shopping list outside the plan. */
  listRecipes: { recipeId: string; servings: number }[];
  /** Things typed straight onto the list, and which account added them. */
  listItems: { id: string; text: string; by?: string }[];
  /** Ingredient keys and typed-item ids already in the basket. */
  got: string[];
};

export function emptyKitchen(): KitchenState {
  return { version: 1, have: [], pantry: {}, log: [], plans: {}, listRecipes: [], listItems: [], got: [] };
}

const WEEKS_KEPT = 26;
const LOG_KEPT = 60;
const clampServings = (n: unknown) => Math.min(48, Math.max(1, Math.round(Number(n)) || 1));
const shortString = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const newKitchenId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const cleanAmount = (raw: unknown): Amount | undefined => {
  const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const qty = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const [usQty, metricQty] = [qty(a.usQty), qty(a.metricQty)];
  if (usQty === null && metricQty === null) return undefined;
  return { usQty, usUnit: shortString(a.usUnit, 16), metricQty, metricUnit: shortString(a.metricUnit, 16) };
};

const titleCase = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

function cleanPantry(raw: unknown, have: string[], today: DateKey): KitchenState['pantry'] {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, Record<string, unknown>>) : {};
  const pantry: KitchenState['pantry'] = {};
  const date = (v: unknown) => (isDateKey(v) ? v : undefined);
  for (const [key, item] of Object.entries(source).slice(0, 800)) {
    const held = have.includes(key);
    if (!key || key.length > 80 || !item || typeof item !== 'object' || (!held && item.out !== true)) continue;
    const amount = held ? cleanAmount(item.amount) : undefined;
    const since = date(item.since);
    const checked = date(item.checked);
    pantry[key] = {
      name: shortString(item.name, 80) || titleCase(key),
      ...(amount ? { amount } : {}),
      ...(amount && item.estimated === true ? { estimated: true } : {}),
      ...(held && item.low === true ? { low: true } : {}),
      ...(!held ? { out: true } : {}),
      ...(since ? { since } : {}),
      ...(checked ? { checked } : {}),
    };
  }
  // Marked before the pantry knew any more about them: their time starts now.
  for (const key of have) if (!pantry[key]) pantry[key] = { name: titleCase(key), since: today };
  return pantry;
}

function cleanLog(raw: unknown): KitchenLogEntry[] {
  return (Array.isArray(raw) ? raw : []).slice(-LOG_KEPT).flatMap((e: Record<string, unknown>) => {
    const id = shortString(e?.id, 60);
    if (!id || !isDateKey(e?.at)) return [];
    const entry = e.entry as { week?: unknown; id?: unknown } | undefined;
    const spent = (Array.isArray(e.spent) ? e.spent : []).flatMap((s: Record<string, unknown>) => {
      const amount = cleanAmount(s?.amount);
      const key = shortString(s?.key, 80);
      return amount && key ? [{ key, amount }] : [];
    });
    return [{
      id,
      kind: e.kind === 'put-away' ? ('put-away' as const) : ('cook' as const),
      at: e.at,
      ...(typeof e.recipeId === 'string' ? { recipeId: shortString(e.recipeId, 60) } : {}),
      ...(typeof e.title === 'string' ? { title: shortString(e.title, 100) } : {}),
      ...(typeof e.servings === 'number' ? { servings: clampServings(e.servings) } : {}),
      ...(spent.length ? { spent } : {}),
      ...(isDateKey(entry?.week) && typeof entry?.id === 'string' ? { entry: { week: entry.week, id: shortString(entry.id, 40) } } : {}),
    }];
  });
}

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
    .map((i: Record<string, unknown>) => {
      const by = shortString(i?.by, 64);
      return { id: shortString(i?.id, 40) || newKitchenId(), text: shortString(i?.text, 120), ...(by ? { by } : {}) };
    })
    .filter((i) => i.text);

  const have = strings(source.have, 80, 500);
  return {
    version: 1,
    have,
    pantry: cleanPantry(source.pantry, have, today),
    log: cleanLog(source.log),
    plans,
    listRecipes,
    listItems,
    got: strings(source.got, 100, 500),
  };
}

// ─── Changes ──────────────────────────────────────────────────────────────────

/**
 * One change to the kitchen. The browser applies it straight away and sends it;
 * the server applies it to whatever is stored by then. Saying the outcome
 * ("ticked", not "toggled") and naming new things up front makes each one safe
 * to send twice, which a lost reply on a bad connection will sometimes do.
 */
export type KitchenAction =
  | { type: 'have'; key: string; on: boolean; name?: string }
  | { type: 'got'; key: string; on: boolean }
  /** Say how much there is (null: don't know any more) and whether it's low. It's at home, as of today. */
  | { type: 'pantry-set'; key: string; name?: string; amount?: Amount | null; low?: boolean }
  /** Ran out: off the shelf and on the list. */
  | { type: 'pantry-out'; key: string; name?: string }
  /** Not something kept at home after all: no shelf, no list. */
  | { type: 'pantry-forget'; key: string }
  /** Home from the store: what was ticked goes on the shelf and off the list. */
  | { type: 'put-away'; id: string; items: PutAwayItem[]; got: string[]; listItems: string[] }
  /** Cooked something: what it used comes off the shelf, and it's ticked off the plan. */
  | { type: 'cook'; id: string; recipeId: string; title?: string; servings: number; used: UsedIngredient[]; entry?: { week: DateKey; id: string } }
  | { type: 'cook-undo'; id: string }
  | { type: 'plan-add'; week: DateKey; entry: PlanEntry }
  | { type: 'plan-change'; week: DateKey; ids: string[]; patch: Partial<Pick<PlanEntry, 'servings' | 'day' | 'cooked'>> }
  | { type: 'plan-remove'; week: DateKey; id: string }
  | { type: 'plan-copy'; week: DateKey; entries: PlanEntry[] }
  | { type: 'list-recipe'; recipeId: string; servings: number }
  | { type: 'list-recipe-remove'; recipeId: string }
  | { type: 'list-item'; id: string; text: string; by?: string }
  | { type: 'list-item-remove'; id: string }
  /** Starting over clears what this person could see, not what someone added a moment ago. */
  | { type: 'list-clear'; items: string[]; recipes: string[]; got: string[] };

export type PutAwayItem = { key: string; name: string; amount?: Amount | null };
export type UsedIngredient = Amount & { key: string };

const listOf = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const switched = (list: string[], key: string, on: boolean) => (on ? (list.includes(key) ? list : [...list, key]) : list.filter((x) => x !== key));

/** Whether an amount has been counted down to nothing. */
const isGone = (amount: Amount | undefined) => Boolean(amount) && [amount!.usQty, amount!.metricQty].every((q) => q === null || q <= 0);

/** Things you buy about as much of as you need, so what you bought is a fair guess at what's there. A bottle of oil isn't. */
const COUNTS_WHEN_BOUGHT = new Set(['Meat & seafood']);

/** The kitchen after a change. Nonsense from a browser changes nothing; the server normalizes the rest. */
export function applyKitchenAction(k: KitchenState, action: KitchenAction): KitchenState {
  const setPlan = (week: DateKey, change: (entries: PlanEntry[]) => PlanEntry[]) =>
    isDateKey(week) ? { ...k, plans: { ...k.plans, [week]: change(k.plans[week] || []) } } : k;
  const today = localToday();
  const logged = (id: string) => k.log.some((e) => e.id === id);
  const withoutKey = <T,>(record: Record<string, T>, key: string) => {
    const { [key]: _gone, ...rest } = record;
    return rest;
  };
  switch (action?.type) {
    case 'have': {
      if (typeof action.key !== 'string' || !action.key) return k;
      if (!action.on) return { ...k, have: switched(k.have, action.key, false), pantry: withoutKey(k.pantry, action.key) };
      if (k.have.includes(action.key)) return k;
      const { out: _out, ...earlier } = k.pantry[action.key] ?? { name: '' };
      return {
        ...k,
        have: [...k.have, action.key],
        pantry: { ...k.pantry, [action.key]: { ...earlier, name: earlier.name || action.name || titleCase(action.key), since: today } },
      };
    }
    case 'pantry-set': {
      if (typeof action.key !== 'string' || !action.key) return k;
      const { out: _out, amount: oldAmount, estimated: oldEstimated, low: oldLow, ...earlier } = k.pantry[action.key] ?? { name: '' };
      const amount = action.amount === undefined ? oldAmount : cleanAmount(action.amount);
      // Asked and answered: an amount that had counted down to nothing was wrong, and nobody said how much instead.
      const known = action.amount === undefined && isGone(amount) ? undefined : amount;
      const low = action.low ?? oldLow;
      return {
        ...k,
        have: switched(k.have, action.key, true),
        pantry: {
          ...k.pantry,
          [action.key]: {
            ...earlier,
            name: action.name || earlier.name || titleCase(action.key),
            ...(known ? { amount: known } : {}),
            ...(known && action.amount === undefined && oldEstimated ? { estimated: true } : {}),
            ...(low ? { low: true } : {}),
            since: earlier.since ?? today,
            checked: today,
          },
        },
      };
    }
    case 'pantry-out': {
      if (typeof action.key !== 'string' || !action.key) return k;
      const earlier = k.pantry[action.key];
      return {
        ...k,
        have: switched(k.have, action.key, false),
        pantry: { ...k.pantry, [action.key]: { name: action.name || earlier?.name || titleCase(action.key), out: true } },
      };
    }
    case 'pantry-forget':
      return { ...k, have: switched(k.have, action.key, false), pantry: withoutKey(k.pantry, action.key), got: k.got.filter((g) => g !== restockKey(action.key)) };
    case 'put-away': {
      if (typeof action.id !== 'string' || logged(action.id)) return k;
      const have = new Set(k.have);
      const pantry = { ...k.pantry };
      for (const item of listOf<PutAwayItem>(action.items)) {
        if (typeof item?.key !== 'string' || !item.key) continue;
        const earlier = pantry[item.key];
        const bought = cleanAmount(item.amount);
        const wasCounting = have.has(item.key) && earlier?.amount && !isGone(earlier.amount);
        const name = shortString(item.name, 80) || earlier?.name || titleCase(item.key);
        const amount = wasCounting ? (bought ? addAmounts(earlier.amount!, bought) ?? earlier.amount : earlier.amount) : COUNTS_WHEN_BOUGHT.has(aisleFor(name)) ? bought : undefined;
        have.add(item.key);
        pantry[item.key] = { name, ...(amount ? { amount, estimated: true } : {}), since: today, checked: today };
      }
      const [got, typed] = [listOf<string>(action.got), listOf<string>(action.listItems)];
      return {
        ...k,
        have: [...have],
        pantry,
        got: k.got.filter((g) => !got.includes(g) && !typed.includes(g)),
        listItems: k.listItems.filter((i) => !typed.includes(i.id)),
        log: [...k.log, { id: action.id, kind: 'put-away' as const, at: today }].slice(-LOG_KEPT),
      };
    }
    case 'cook': {
      if (typeof action.id !== 'string' || logged(action.id)) return k;
      const pantry = { ...k.pantry };
      const spent: { key: string; amount: Amount }[] = [];
      for (const used of listOf<UsedIngredient>(action.used)) {
        const item = used?.key ? pantry[used.key] : undefined;
        if (!item?.amount || !k.have.includes(used.key)) continue;
        const ratio = amountRatio(used, item.amount);
        if (ratio === null) continue;
        const taken = Math.min(1, ratio);
        spent.push({ key: used.key, amount: scaleAmount(item.amount, taken) });
        pantry[used.key] = { ...item, amount: scaleAmount(item.amount, 1 - taken), estimated: true };
      }
      const week = action.entry?.week;
      const entryId = action.entry?.id;
      const plans = week && isDateKey(week) && k.plans[week] ? { ...k.plans, [week]: k.plans[week].map((e) => (e.id === entryId ? { ...e, cooked: true } : e)) } : k.plans;
      const entry: KitchenLogEntry = {
        id: action.id,
        kind: 'cook',
        at: today,
        recipeId: action.recipeId,
        ...(action.title ? { title: action.title } : {}),
        servings: action.servings,
        ...(spent.length ? { spent } : {}),
        ...(action.entry ? { entry: action.entry } : {}),
      };
      return { ...k, pantry, plans, log: [...k.log, entry].slice(-LOG_KEPT) };
    }
    case 'cook-undo': {
      const entry = k.log.find((e) => e.id === action.id && e.kind === 'cook');
      if (!entry) return k;
      const pantry = { ...k.pantry };
      for (const { key, amount } of entry.spent ?? []) {
        const item = pantry[key];
        if (!item?.amount) continue;
        pantry[key] = { ...item, amount: addAmounts(item.amount, amount) ?? amount };
      }
      const plans = entry.entry && k.plans[entry.entry.week]
        ? { ...k.plans, [entry.entry.week]: k.plans[entry.entry.week].map((e) => (e.id === entry.entry!.id ? { ...e, cooked: false } : e)) }
        : k.plans;
      return { ...k, pantry, plans, log: k.log.filter((e) => e.id !== action.id) };
    }
    case 'got':
      return { ...k, got: switched(k.got, action.key, action.on) };
    case 'plan-add':
      return setPlan(action.week, (entries) => (entries.some((e) => e.id === action.entry?.id) ? entries : [...entries, action.entry]));
    case 'plan-change': {
      const ids = listOf<string>(action.ids);
      const { servings, day, cooked } = action.patch ?? {};
      const patch = { ...(servings !== undefined ? { servings } : {}), ...(day !== undefined ? { day } : {}), ...(cooked !== undefined ? { cooked } : {}) };
      return setPlan(action.week, (entries) => entries.map((e) => (ids.includes(e.id) ? { ...e, ...patch } : e)));
    }
    case 'plan-remove':
      return setPlan(action.week, (entries) => entries.filter((e) => e.id !== action.id));
    case 'plan-copy':
      return setPlan(action.week, () => listOf<PlanEntry>(action.entries));
    case 'list-recipe':
      return { ...k, listRecipes: [...k.listRecipes.filter((r) => r.recipeId !== action.recipeId), { recipeId: action.recipeId, servings: action.servings }] };
    case 'list-recipe-remove':
      return { ...k, listRecipes: k.listRecipes.filter((r) => r.recipeId !== action.recipeId) };
    case 'list-item':
      return typeof action.text === 'string' ? addListItem(k, action.text, action.id, action.by) : k;
    case 'list-item-remove':
      return { ...k, listItems: k.listItems.filter((i) => i.id !== action.id), got: k.got.filter((g) => g !== action.id) };
    case 'list-clear': {
      const [items, recipes, got] = [listOf<string>(action.items), listOf<string>(action.recipes), listOf<string>(action.got)];
      return {
        ...k,
        listItems: k.listItems.filter((i) => !items.includes(i.id)),
        listRecipes: k.listRecipes.filter((r) => !recipes.includes(r.recipeId)),
        got: k.got.filter((g) => !got.includes(g)),
      };
    }
    default:
      return k;
  }
}

/** Bring a second kitchen into this one, when people move in together. What's already here wins a tie. */
export function mergeKitchens(into: KitchenState, from: KitchenState): KitchenState {
  const plans = { ...into.plans };
  for (const [week, entries] of Object.entries(from.plans)) {
    const mine = plans[week] || [];
    const isNew = (e: PlanEntry) => !mine.some((m) => m.id === e.id || (m.recipeId === e.recipeId && m.day === e.day));
    plans[week] = [...mine, ...entries.filter(isNew)];
  }
  const openTexts = new Set(into.listItems.filter((i) => !into.got.includes(i.id)).map((i) => i.text.toLowerCase()));
  const ids = new Set(into.listItems.map((i) => i.id));
  return {
    version: 1,
    have: [...new Set([...into.have, ...from.have])],
    pantry: { ...from.pantry, ...into.pantry },
    log: [...into.log, ...from.log.filter((e) => !into.log.some((m) => m.id === e.id))].slice(-LOG_KEPT),
    plans,
    listRecipes: [...into.listRecipes, ...from.listRecipes.filter((r) => !into.listRecipes.some((m) => m.recipeId === r.recipeId))],
    listItems: [...into.listItems, ...from.listItems.filter((i) => !ids.has(i.id) && !openTexts.has(i.text.toLowerCase()))],
    got: [...new Set([...into.got, ...from.got])],
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

/** Recipes with a batch already made and in the fridge. */
export const madeSet = (kitchen: Pick<KitchenState, 'have'>) => new Set(kitchen.have.filter((k) => k.startsWith('made:')).map((k) => k.slice(5)));

/** Recipes as you'd cook them from this kitchen: their parts filled in, and any batch you've made skipped. */
export const recipesFor = (recipes: Recipe[], kitchen: Pick<KitchenState, 'have'>) => resolveRecipes(recipes, madeSet(kitchen));

export type Stock =
  | { status: 'have' | 'missing'; inStock?: Amount }
  /** Some at home, not enough: `short` is what's left to buy. */
  | { status: 'short'; inStock: Amount; short: BomItem };

/** Whether what's at home covers this much of an ingredient. Not knowing how much counts as enough. */
export function stockFor(item: BomItem, kitchen: Pick<KitchenState, 'have' | 'pantry'>, scale = 1): Stock {
  if (ALWAYS_HAVE.includes(item.key)) return { status: 'have' };
  if (!kitchen.have.includes(item.key)) return { status: 'missing' };
  const inStock = kitchen.pantry?.[item.key]?.amount;
  if (!inStock) return { status: 'have' };
  if (isGone(inStock)) return { status: 'missing', inStock };
  const ratios = [item, ...item.extras].map((a) => amountRatio(scaleAmount(a, scale), inStock)).filter((r): r is number => r !== null);
  const ratio = ratios.reduce((sum, r) => sum + r, 0);
  if (!ratios.length || ratio <= 1.01) return { status: 'have', inStock };
  const left = scale * (1 - 1 / ratio);
  return {
    status: 'short',
    inStock,
    short: { ...item, ...scaleAmount(item, left), extras: item.extras.map((e) => scaleAmount(e, left)) },
  };
}

/** Ingredients of a recipe you'd still need to buy, at a scale. */
export function missingIngredients(recipe: Pick<Recipe, 'sections'>, kitchen: Pick<KitchenState, 'have' | 'pantry'>, scale = 1): BomItem[] {
  return extractIngredients(recipe).filter((item) => stockFor(item, kitchen, scale).status !== 'have');
}

/** Ingredient amounts as a cook uses them, for taking them off the shelf. */
export function usedIn(recipe: Pick<Recipe, 'sections' | 'servings'>, servings: number): UsedIngredient[] {
  const scale = servings / recipe.servings;
  return extractIngredients(recipe).flatMap((item) =>
    [item, ...item.extras].map((a) => {
      const { usQty, usUnit, metricQty, metricUnit } = scaleAmount(a, scale);
      return { key: item.key, usQty, usUnit, metricQty, metricUnit };
    }),
  );
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

export type ShoppingItem = BomItem & {
  aisle: string;
  sources: string[];
  /** There's some at home already, and this is only the rest. */
  inStock?: Amount;
};

export type RestockItem = { key: string; name: string; low: boolean };

export type ShoppingList = {
  /** What's left to buy, by aisle in the order you'd walk the store. */
  groups: { aisle: string; items: ShoppingItem[] }[];
  need: ShoppingItem[];
  /** On the list's recipes, but marked as already at home. */
  have: ShoppingItem[];
  /** Ran out or running low, whether or not a recipe wants them. */
  restock: RestockItem[];
  recipeCount: number;
};

/** How something waiting to be restocked is ticked off: it isn't tied to a week. */
export const restockKey = (key: string) => `restock|${key}`;

/** The week's plan plus any one-off recipes, merged, less what's at home, plus what's run out. */
export function buildShoppingList(rawRecipes: Recipe[], kitchen: KitchenState, week: DateKey): ShoppingList {
  const recipes = recipesFor(rawRecipes, kitchen);
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

  const need: ShoppingItem[] = [];
  const have: ShoppingItem[] = [];
  for (const merged of mergeBoms(lists)) {
    const item = { ...merged, aisle: aisleFor(merged.name), sources: [...(sources.get(merged.key) || [])] };
    const stock = stockFor(merged, kitchen);
    if (stock.status === 'have') {
      if (!ALWAYS_HAVE.includes(item.key)) have.push(item);
    } else if (stock.status === 'short') {
      need.push({ ...item, ...stock.short, inStock: stock.inStock });
    } else {
      need.push(item);
    }
  }
  const groups = AISLES.map((aisle) => ({ aisle, items: need.filter((item) => item.aisle === aisle) })).filter((g) => g.items.length);
  const restock = Object.entries(kitchen.pantry ?? {}).flatMap(([key, item]) =>
    (item.out || item.low) && !need.some((n) => n.key === key) ? [{ key, name: item.name, low: !item.out }] : [],
  );
  return { groups, need, have, restock, recipeCount: new Set(wanted.map((w) => w.recipe.id)).size };
}

/** How many things are left to buy for a week: its plan, anything run out, plus anything typed onto the list. */
export function groceriesLeft(recipes: Recipe[], kitchen: KitchenState, week: DateKey) {
  const list = buildShoppingList(recipes, kitchen, week);
  const planned = list.need.filter((i) => !kitchen.got.includes(`${week}|${i.key}`));
  const restock = list.restock.filter((i) => !i.low && !kitchen.got.includes(restockKey(i.key)));
  return planned.length + restock.length + kitchen.listItems.filter((i) => !kitchen.got.includes(i.id)).length;
}

// ─── The living pantry ────────────────────────────────────────────────────────

/** Days before something's worth asking about: it may be gone, or going off. */
const CHECK_AFTER_DAYS: Record<string, number> = {
  Produce: 7,
  'Meat & seafood': 4,
  'Dairy & eggs': 14,
  Frozen: 180,
};
const CHECK_AFTER_SHELF_DAYS = 120;
const CHECK_AFTER_MADE_DAYS = 5;

const isMade = (key: string) => key.startsWith('made:');

function checkAfter(key: string, name: string) {
  return isMade(key) ? CHECK_AFTER_MADE_DAYS : CHECK_AFTER_DAYS[aisleFor(name)] ?? CHECK_AFTER_SHELF_DAYS;
}

export type PantryCheck = { key: string; name: string; reason: 'used-up' | 'old'; days: number };

/**
 * The few things worth a quick "still got this?". Cooking off the record is what
 * makes a pantry drift, so instead of asking for perfect logging it asks about
 * what's most likely wrong: what should have run out, and what's been sitting.
 */
export function pantryChecks(kitchen: KitchenState, today = localToday()): PantryCheck[] {
  const checks = kitchen.have.flatMap((key): PantryCheck[] => {
    const item = kitchen.pantry[key];
    if (!item) return [];
    const days = daysBetween(item.checked ?? item.since ?? today, today);
    if (isGone(item.amount)) return [{ key, name: item.name, reason: 'used-up', days }];
    return days >= checkAfter(key, item.name) ? [{ key, name: item.name, reason: 'old', days }] : [];
  });
  return checks.sort((a, b) => Number(b.reason === 'used-up') - Number(a.reason === 'used-up') || b.days - a.days);
}

export type UseSoon = { key: string; name: string; days: number; recipe?: Recipe };

/** Fresh things past the first half of their time, and something to make with them. */
export function freshToUse(recipes: Recipe[], kitchen: KitchenState, today = localToday()): UseSoon[] {
  return kitchen.have
    .flatMap((key): UseSoon[] => {
      const item = kitchen.pantry[key];
      if (!item || isMade(key) || isGone(item.amount) || !CHECK_AFTER_DAYS[aisleFor(item.name)] || aisleFor(item.name) === 'Frozen') return [];
      const days = daysBetween(item.since ?? today, today);
      const limit = CHECK_AFTER_DAYS[aisleFor(item.name)];
      if (days < limit / 2 || daysBetween(item.checked ?? item.since ?? today, today) >= limit) return [];
      const recipe = recipes
        .filter((r) => extractIngredients(r).some((i) => i.key === key))
        .sort((a, b) => missingIngredients(a, kitchen).length - missingIngredients(b, kitchen).length || (b.rating ?? 0) - (a.rating ?? 0))[0];
      return [{ key, name: item.name, days, recipe }];
    })
    .sort((a, b) => b.days - a.days);
}

/** Recipes you could start right now, best first. */
export function canMakeNow(recipes: Recipe[], kitchen: KitchenState): Recipe[] {
  if (!kitchen.have.length) return [];
  return recipes
    .filter((r) => extractIngredients(r).length > 0 && missingIngredients(r, kitchen).length === 0)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

export type PendingCook = { week: DateKey; entry: PlanEntry; recipe: Recipe; date: DateKey };

/** Meals on the plan in the last few days nobody ticked: cooked and not logged, or skipped? */
export function pendingCooks(recipes: Recipe[], kitchen: KitchenState, today = localToday()): PendingCook[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const thisWeek = currentWeek(today);
  return [addDays(thisWeek, -7), thisWeek].flatMap((week) =>
    (kitchen.plans[week] || []).flatMap((entry): PendingCook[] => {
      const recipe = byId.get(entry.recipeId);
      if (!recipe || entry.cooked || entry.day === null) return [];
      const date = addDays(week, entry.day);
      return date < today && date >= addDays(today, -5) ? [{ week, entry, recipe, date }] : [];
    }),
  );
}

/** The plan entry a cook of this recipe most likely is: today's if there is one, else the nearest unticked. */
export function planEntryFor(kitchen: KitchenState, recipeId: string, today = localToday()) {
  const week = currentWeek(today);
  const day = daysBetween(week, today);
  const open = (kitchen.plans[week] || []).filter((e) => e.recipeId === recipeId && !e.cooked);
  const score = (e: PlanEntry) => (e.day === null ? 3.5 : Math.abs(e.day - day));
  const entry = [...open].sort((a, b) => score(a) - score(b))[0];
  return entry ? { week, entry } : null;
}

/** Type something onto the list, unless it's already there and unticked. */
export function addListItem(kitchen: KitchenState, text: string, id = newKitchenId(), by?: string): KitchenState {
  const clean = text.trim().slice(0, 120);
  const open = kitchen.listItems.some((i) => i.id === id || (i.text.toLowerCase() === clean.toLowerCase() && !kitchen.got.includes(i.id)));
  if (!clean || open) return kitchen;
  return { ...kitchen, listItems: [...kitchen.listItems, { id, text: clean, ...(by ? { by } : {}) }] };
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
export function buildPrepSession(entries: PlanEntry[], rawRecipes: Recipe[], week: DateKey) {
  const byId = new Map(resolveRecipes(rawRecipes).map((r) => [r.id, r]));
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
  return { recipe, sectionScales, schedule, bom, recipeCount: parts.length, ovenClash: ovenClash(parts.map((p) => p.recipe)) };
}

/** Recipes that want the oven at different temperatures, which a shared session has to plan around. */
function ovenClash(recipes: Recipe[]): number[] {
  const perRecipe = recipes.map((r) => ovenTemps(r.sections)).filter((temps) => temps.length);
  const all = [...new Set(perRecipe.flat())].sort((a, b) => a - b);
  return perRecipe.length > 1 && all.length > 1 ? all : [];
}

/** Where a made batch of a recipe is kept. */
export const madeItem = (recipe: Pick<Recipe, 'id' | 'title'>) => ({ key: madeKey(recipe.id), name: recipe.title });
