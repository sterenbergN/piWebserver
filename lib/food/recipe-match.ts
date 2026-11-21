import { round, roundNutrients, scaleNutrients, sumNutrients, zeroNutrients } from './nutrients';
import { normalizeText, tokenize, type SearchHit } from './search';
import type { EntrySnapshot, Food, Nutrients, RecipeMatchPref, Serving } from './types';
import type { Amount, BomItem, RecipeMacros } from '../recipes/recipes';

// Logging a meal from a recipe: each ingredient on the recipe's list is matched
// to a food the tracker knows and its amount turned into grams, so the dish's
// calories and macros come from the same foods as everything else in the diary.
// Pure: the API route hands in the search and food lookup, which keeps this
// testable and keeps outside services out of it (only the library and the
// bundled USDA foods are asked, never once per ingredient over the network).

/** How sure a line is: matched and measured, matched with a guess somewhere, nothing found, or left out on purpose. */
export type LineStatus = 'good' | 'guessed' | 'none' | 'skipped';

export type MatchLine = {
  /** The recipe's ingredient key ("chicken thigh"), which corrections are remembered by. */
  key: string;
  name: string;
  /** The whole recipe's amount, as the recipe says it ("2 cups"). */
  amountText: string;
  status: LineStatus;
  /** Why it's guessed, skipped or empty, in a few words. */
  note?: string;
  food?: Food;
  servingId?: string;
  /** How many of that serving go into the whole recipe. 0 = not worked out yet. */
  amount?: number;
  /** Came from a correction made on an earlier import. */
  remembered?: boolean;
};

/** Never counted: the same as the recipes' ALWAYS_HAVE (a test keeps them in step). */
export const NEVER_COUNTED = ['water', 'ice'];
export const MAX_REMEMBERED = 600;

// ─── Measuring the recipe's side ──────────────────────────────────────────────

/** Grams in one of each weight unit the recipes write. */
export const GRAMS_PER: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
/** Millilitres in one of each volume unit (the recipes' own cup of 240 ml, so it lines up with their conversions). */
export const ML_PER: Record<string, number> = {
  ml: 1, L: 1000, l: 1000, tsp: 5, tbsp: 15, cup: 240, 'fl oz': 30, pint: 480, quart: 960, pinch: 0.31, dash: 0.62,
};

export type Measure =
  | { kind: 'weight'; grams: number }
  | { kind: 'volume'; ml: number }
  /** "2 eggs" (unit "") or "3 cloves" (unit "clove"). */
  | { kind: 'count'; count: number; unit: string };

const singular = (word: string) => {
  const w = word.trim().toLowerCase();
  if (/(ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};

/**
 * An amount in a form that can be weighed: grams, millilitres or a count. A
 * weight on either side wins (the recipes already turn cups of flour or sugar
 * into grams), then a volume, then whatever's left is a count.
 */
export function measureOf(a: Amount): Measure | null {
  const sides: [number | null, string][] = [[a.metricQty, a.metricUnit], [a.usQty, a.usUnit]];
  const usable = (q: number | null): q is number => q !== null && Number.isFinite(q) && q > 0;
  for (const [q, u] of sides) if (usable(q) && u in GRAMS_PER) return { kind: 'weight', grams: q * GRAMS_PER[u] };
  for (const [q, u] of sides) if (usable(q) && u in ML_PER) return { kind: 'volume', ml: q * ML_PER[u] };
  const qty = usable(a.usQty) ? a.usQty : usable(a.metricQty) ? a.metricQty : null;
  if (qty === null) return null;
  return { kind: 'count', count: qty, unit: singular(a.usUnit || a.metricUnit || '') };
}

/** What a measure counts in, for remembering "this many of that serving per one of these". */
export const unitKey = (m: Measure) => (m.kind === 'weight' ? 'g' : m.kind === 'volume' ? 'ml' : m.unit || 'each');
export const measureQty = (m: Measure) => (m.kind === 'weight' ? m.grams : m.kind === 'volume' ? m.ml : m.count);

// ─── Measuring the food's side ────────────────────────────────────────────────

/** What a food is weighed in: grams for nearly everything, millilitres for a drink typed in by volume. */
export function baseUnit(food: Pick<Food, 'servings'>): 'g' | 'ml' | null {
  if (food.servings.some((s) => (s.grams ?? 0) > 0)) return 'g';
  if (food.servings.some((s) => (s.ml ?? 0) > 0)) return 'ml';
  return null;
}

const sizeIn = (s: Serving, unit: 'g' | 'ml') => (unit === 'g' ? s.grams ?? 0 : s.ml ?? 0);

/**
 * Nutrients in one gram (or ml) of a food. Worked out from its 100 g serving,
 * or else its biggest weighed one, rather than the "1 g" one, whose calories
 * are rounded to a whole number.
 */
export function perUnitNutrients(food: Pick<Food, 'servings'>): { unit: 'g' | 'ml'; per: Nutrients } | null {
  const unit = baseUnit(food);
  if (!unit) return null;
  const weighed = food.servings.filter((s) => sizeIn(s, unit) > 0);
  const best = weighed.find((s) => sizeIn(s, unit) === 100) ?? weighed.sort((a, b) => sizeIn(b, unit) - sizeIn(a, unit))[0];
  return { unit, per: scaleNutrients(best.nutrients, 1 / sizeIn(best, unit)) };
}

/** Nutrients for `qty` grams (or ml, for a food measured by volume). */
export function nutrientsForWeight(food: Pick<Food, 'servings'>, qty: number): Nutrients | null {
  const p = perUnitNutrients(food);
  return p && qty >= 0 ? scaleNutrients(p.per, qty) : null;
}

/** Nutrients for `amount` of one serving: by weight when the serving has one, so rounding in small servings doesn't creep in. */
export function lineNutrients(food: Pick<Food, 'servings'>, servingId: string | undefined, amount: number | undefined): Nutrients {
  const serving = food.servings.find((s) => s.id === servingId);
  if (!serving || !amount || amount <= 0) return zeroNutrients();
  const p = perUnitNutrients(food);
  const size = p ? sizeIn(serving, p.unit) : 0;
  return p && size > 0 ? scaleNutrients(p.per, size * amount) : scaleNutrients(serving.nutrients, amount);
}

/** Grams (or ml) in `amount` of a serving, when the serving has a weight. */
export function lineWeight(food: Pick<Food, 'servings'>, servingId: string | undefined, amount: number | undefined): { qty: number; unit: 'g' | 'ml' } | null {
  const serving = food.servings.find((s) => s.id === servingId);
  if (!serving || !amount) return null;
  if (serving.grams) return { qty: serving.grams * amount, unit: 'g' };
  if (serving.ml) return { qty: serving.ml * amount, unit: 'ml' };
  return null;
}

const VOLUME_LABEL = /^(\d+(?:\.\d+)?|\d+\/\d+)\s*(cups?|c\b|tablespoons?|tbsps?|teaspoons?|tsps?|fl\.?\s*oz|fluid ounces?|pints?|quarts?|ml|millilit(?:er|re)s?|lit(?:er|re)s?)\b/i;

function labelMl(label: string): number | null {
  const m = label.match(VOLUME_LABEL);
  if (!m) return null;
  const [num, den] = m[1].split('/').map(Number);
  const qty = den ? num / den : num;
  const unit = m[2].toLowerCase().replace(/\s+/g, ' ');
  const per = unit.startsWith('c') ? 240
    : unit.startsWith('tablespoon') || unit.startsWith('tbsp') ? 15
      : unit.startsWith('teaspoon') || unit.startsWith('tsp') ? 5
        : unit.startsWith('fl') ? 30
          : unit.startsWith('pint') ? 480
            : unit.startsWith('quart') ? 960
              : unit.startsWith('lit') ? 1000 : 1;
  return qty > 0 ? qty * per : null;
}

/**
 * Grams per ml for a food, from what it says about itself: a "1 cup (240 g)"
 * style portion (USDA lists these), or a serving by volume next to one by
 * weight (FatSecret often has both). Null when it doesn't say.
 */
export function densityOf(food: Pick<Food, 'servings'>): number | null {
  const plausible = (d: number) => d >= 0.1 && d <= 2.5;
  let best: { ml: number; density: number } | null = null;
  for (const s of food.servings) {
    if (!s.grams) continue;
    const ml = labelMl(s.label);
    if (!ml || !plausible(s.grams / ml)) continue;
    if (!best || ml > best.ml) best = { ml, density: s.grams / ml };
  }
  if (best) return best.density;
  const perGram = perUnitNutrients(food);
  const byVolume = food.servings.find((s) => (s.ml ?? 0) > 0 && s.nutrients.kcal > 0);
  if (perGram?.unit === 'g' && perGram.per.kcal > 0 && byVolume) {
    const d = (byVolume.nutrients.kcal / byVolume.ml!) / perGram.per.kcal;
    if (plausible(d)) return d;
  }
  return null;
}

const SIZES = ['extra large', 'jumbo', 'large', 'medium', 'small'];
/** Words that make a serving a measure, not "one of the thing". */
const NOT_A_PIECE = /\b(cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|fl|lbs?|pounds?|g|grams?|ml|kg|quarts?|pints?|servings?|portions?|pats?|dash|pinch|slices?|cloves?|stalks?|sprigs?|leaf|leaves|cans?|sticks?|packets?|containers?|bottles?|package|chopped|diced|shredded|sliced|mashed|pieces? cut)\b/i;

/**
 * The serving that's one of the thing: "1 clove" for 3 cloves, "1 large" for
 * 2 large eggs, "1 medium" for 2 onions. Null when the food doesn't list one.
 */
export function pieceServing(food: Pick<Food, 'servings'>, unit: string, name = ''): Serving | null {
  const base = baseUnit(food);
  if (!base) return null;
  const pieces = food.servings
    .filter((s) => sizeIn(s, base) > 0)
    .map((s) => ({ s, text: s.label.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase() }))
    .filter(({ text }) => /^1\s/.test(text));
  if (unit && unit !== 'piece' && unit !== 'each') {
    const re = new RegExp(`^1\\s+(?:[a-z-]+\\s+)?${unit.replace(/[^a-z]/g, '')}(?:s|es)?\\b`);
    return pieces.find(({ text }) => re.test(text))?.s ?? null;
  }
  const lower = name.toLowerCase();
  const wanted = SIZES.find((size) => new RegExp(`\\b${size}\\b`).test(lower));
  // Recipes mean large eggs, and medium everything else, unless they say.
  const usual = /\beggs?\b/.test(lower) ? 'large' : 'medium';
  const rank = (text: string) => {
    if (wanted && text.includes(wanted)) return 0;
    if (text.includes(usual) && !text.includes('extra large')) return 1;
    if (/\b(medium|large)\b/.test(text) && !text.includes('extra large')) return 2;
    if (/\b(whole|piece|item|each|fruit|egg)\b/.test(text)) return 3;
    if (/\bsmall\b/.test(text)) return 5;
    if (/extra large|jumbo/.test(text)) return 6;
    return 4;
  };
  return pieces
    .filter(({ text }) => !NOT_A_PIECE.test(text.slice(2)))
    .sort((a, b) => rank(a.text) - rank(b.text))[0]?.s ?? null;
}

/** Rough weights for counted things when the food doesn't list one (always flagged as a guess). */
export const TYPICAL_PIECE_GRAMS: Record<string, number> = {
  clove: 3, slice: 25, can: 400, stalk: 40, sprig: 1, bunch: 60, head: 500, piece: 50, leaf: 1, stick: 113,
};

export type BaseQty = { qty: number; unit: 'g' | 'ml'; guess?: string };

/** One measure of the recipe in the food's own unit (grams, or ml for a drink), and what was guessed to get there. */
export function quantityFor(m: Measure, food: Pick<Food, 'servings'>, name = ''): BaseQty | null {
  const unit = baseUnit(food);
  if (!unit) return null;
  if (m.kind === 'weight') {
    return unit === 'g' ? { qty: m.grams, unit } : { qty: m.grams, unit, guess: 'Weighed as water' };
  }
  if (m.kind === 'volume') {
    if (unit === 'ml') return { qty: m.ml, unit };
    const density = densityOf(food);
    return density ? { qty: m.ml * density, unit } : { qty: m.ml, unit, guess: 'Weighed as water' };
  }
  const piece = pieceServing(food, m.unit, name);
  if (piece) return { qty: m.count * sizeIn(piece, unit), unit };
  const typical = TYPICAL_PIECE_GRAMS[m.unit];
  if (typical && unit === 'g') return { qty: m.count * typical, unit, guess: `A ${m.unit} taken as ${typical} g` };
  return null;
}

/** The serving to count weighed amounts in: 1 g (or 1 ml), else 100 g, else any with a weight. */
export function weightServing(food: Pick<Food, 'servings'>): Serving | null {
  const unit = baseUnit(food);
  if (!unit) return null;
  const weighed = food.servings.filter((s) => sizeIn(s, unit) > 0);
  return weighed.find((s) => sizeIn(s, unit) === 1) ?? weighed.find((s) => sizeIn(s, unit) === 100) ?? weighed[0] ?? null;
}

const amount3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * How much of the food the recipe's amounts come to, as a serving and a
 * count of it. A plain count with a matching piece serving stays as pieces
 * ("2 × 1 large"); anything else is summed by weight. Null when it can't be.
 */
export function portionFor(measures: Measure[], food: Pick<Food, 'servings'>, name = ''): { servingId: string; amount: number; guess?: string } | null {
  if (!measures.length) return null;
  if (measures.length === 1 && measures[0].kind === 'count') {
    const piece = pieceServing(food, measures[0].unit, name);
    if (piece) return { servingId: piece.id, amount: amount3(measures[0].count) };
  }
  let total = 0;
  let guess: string | undefined;
  for (const m of measures) {
    const q = quantityFor(m, food, name);
    if (!q) return null;
    total += q.qty;
    guess ??= q.guess;
  }
  const serving = weightServing(food);
  if (!serving) return null;
  const size = serving.grams || serving.ml || 1;
  return { servingId: serving.id, amount: amount3(total / size), ...(guess ? { guess } : {}) };
}

// ─── Finding the food ─────────────────────────────────────────────────────────

/** Is this ingredient water or ice ("starchy pasta water", "crushed ice")? Coconut water has calories, so it counts. */
export function neverCounted(key: string): boolean {
  if (NEVER_COUNTED.includes(key)) return true;
  const words = key.split(' ');
  return NEVER_COUNTED.includes(words[words.length - 1]) && !words.includes('coconut');
}

/** Words that say what kind or what shape, not what food: never searched for on their own. */
const NOT_ALONE = new Set((
  'white black red green yellow brown dark light fresh dried dry ground whole sweet hot cold warm extra virgin plain fine coarse '
  + 'raw cooked frozen canned crushed starchy flaky creamy crunchy smoked toasted roasted shredded baby jumbo '
  + 'fillet floret paste powder crisp chunk strip piece slice leaf leave stalk sprig zest juice sauce mix seasoning extract flake spray'
).split(' '));

/**
 * What to search for, most exact first: the whole name, then shorter runs of
 * its words ("dark brown sugar" → "brown sugar"), then single words that name
 * a food ("salmon fillet" → "salmon", never "fillet").
 */
export function queriesFor(item: Pick<BomItem, 'key' | 'name'>): string[] {
  const words = (item.key || normalizeText(item.name)).split(' ').filter(Boolean);
  const out = [words.join(' ')];
  for (let len = words.length - 1; len >= 2; len--) {
    out.push(words.slice(-len).join(' '), words.slice(0, len).join(' '));
  }
  for (let i = words.length - 1; i >= 0; i--) if (!NOT_ALONE.has(words[i])) out.push(words[i]);
  return [...new Set(out.filter(Boolean))];
}

/** What a recipe usually means by a bare word: "egg" is a whole raw egg, "flour" all-purpose. */
const USUALLY: Record<string, string> = {
  egg: 'egg whole raw',
  flour: 'wheat flour white all purpose',
  rice: 'rice white long grain',
  sugar: 'sugars granulated',
  milk: 'milk whole',
  vinegar: 'vinegar distilled',
  mayonnaise: 'mayonnaise regular',
  butter: 'butter salted',
  cream: 'cream heavy whipping',
  // The supermarket default; USDA's 70/30 otherwise wins and adds a fifth to the calories.
  'ground beef': 'beef ground 80% lean meat 20% fat raw',
};
/** The usual kind of a bare word, to search for as well (it's often too far down the plain word's results). */
export function usualFor(query: string): string | null {
  const words = tokenize(query);
  return USUALLY[words.join(' ')] ?? null;
}

/** Kinds a recipe would have said if it meant them. */
const UNLESS_ASKED = new Set((
  'tofu imitation free nonfat reduced lowfat low lite light diet dietetic substitute restaurant fast school industrial '
  + 'breaded battered nugget heated microwaved total content smoked dehydrated native canned drained solid'
).split(' '));
const AVOID = /\b(babyfood|baby food|infant|formula|toddler)\b/i;

/**
 * Search hits re-ranked for cooking: raw ingredients first (recipes start
 * from them), the usual kind of a bare word next, "made with tofu" or "fat
 * free" only when the recipe says so, and baby food last. `wanted` are words
 * the amount implies ("canned" for "1 can"), lifted rather than held back.
 */
export function rankForRecipe(hits: SearchHit[], query = '', wanted: string[] = []): SearchHit[] {
  const asked = [...tokenize(query), ...wanted];
  // Only for a bare word: "brown sugar" already says which sugar.
  const usual = usualFor(query);
  const usually = usual ? tokenize(usual) : null;
  return hits
    .map((h) => {
      const words = tokenize(h.food.name);
      let score = h.score;
      if (words.includes('raw')) score += 2.5;
      if (usually && usually.every((w) => words.includes(w))) score += 15;
      score += 4 * wanted.filter((w) => words.includes(w)).length;
      score -= 4 * words.filter((w) => UNLESS_ASKED.has(w) && !asked.includes(w)).length;
      if (AVOID.test(h.food.name)) score -= 20;
      return { ...h, score };
    })
    .sort((a, b) => b.score - a.score);
}

export type FoodLookup = {
  /** Local search (the shared library and the bundled USDA foods), best first. */
  search: (query: string) => SearchHit[] | Promise<SearchHit[]>;
  get: (id: string) => Food | null | Promise<Food | null>;
};

export type MatchOptions = {
  /** The recipe's amount as text, for the line. */
  describe?: (item: BomItem) => string;
};

/** Every ingredient on a recipe's list, matched to a food and measured. */
export async function matchIngredients(items: BomItem[], prefs: Record<string, RecipeMatchPref>, lookup: FoodLookup, options: MatchOptions = {}): Promise<MatchLine[]> {
  const out: MatchLine[] = [];
  for (const item of items) out.push(await matchOne(item, prefs[item.key], lookup, options));
  return out;
}

async function matchOne(item: BomItem, pref: RecipeMatchPref | undefined, lookup: FoodLookup, options: MatchOptions): Promise<MatchLine> {
  const line: MatchLine = { key: item.key, name: item.name, amountText: options.describe?.(item) ?? '', status: 'none' };
  if (neverCounted(item.key)) return { ...line, status: 'skipped', note: 'Not counted' };
  const measures = [item, ...item.extras].map(measureOf).filter((m): m is Measure => !!m);
  if (!measures.length) return { ...line, status: 'skipped', note: 'No amount, so not counted' };

  let food: Food | null = null;
  let closest = false;
  const wanted = measures.some((m) => m.kind === 'count' && m.unit === 'can') ? ['canned'] : [];
  if (pref) food = await lookup.get(pref.foodId);
  const remembered = !!food;
  if (!food) {
    const queries = queriesFor(item);
    for (const q of queries) {
      const usual = usualFor(q);
      const hits = [...await lookup.search(q), ...(usual ? await lookup.search(usual) : [])];
      const best = rankForRecipe(hits, q, wanted)[0];
      if (best) { food = best.food; closest = q !== queries[0]; break; }
    }
  }
  if (!food) return { ...line, note: 'No match. Tap to pick a food' };
  line.food = food;
  if (remembered) line.remembered = true;

  // A correction made before, for the same kind of amount: "1 large per egg", "1 g per g".
  if (pref && remembered && pref.servingId && pref.perUnit && measures.length === 1 && unitKey(measures[0]) === pref.unit
    && food.servings.some((s) => s.id === pref.servingId)) {
    return { ...line, status: 'good', servingId: pref.servingId, amount: amount3(measureQty(measures[0]) * pref.perUnit) };
  }
  const portion = portionFor(measures, food, item.name);
  if (!portion) {
    return { ...line, status: 'guessed', servingId: pref?.servingId ?? weightServing(food)?.id ?? food.servings[0]?.id, amount: 0, note: 'How much? Tap to set it' };
  }
  const note = portion.guess ?? (closest ? 'Closest match' : undefined);
  return { ...line, status: note ? 'guessed' : 'good', servingId: portion.servingId, amount: portion.amount, ...(note ? { note } : {}) };
}

/**
 * What to remember when a line is corrected, so the next recipe with this
 * ingredient starts from it: the food and serving, and how many of that
 * serving one of the recipe's units came to (only when there's one amount).
 */
export function prefFor(item: BomItem, foodId: string, servingId: string, amount: number): RecipeMatchPref {
  const pref: RecipeMatchPref = { foodId, servingId };
  const measures = [item, ...item.extras].map(measureOf).filter((m): m is Measure => !!m);
  if (measures.length === 1 && amount > 0) {
    pref.unit = unitKey(measures[0]);
    pref.perUnit = Math.round((amount / measureQty(measures[0])) * 10_000) / 10_000;
  }
  return pref;
}

const PREF_KEY = /^[a-z0-9][a-z0-9 ]{0,79}$/;
const FOOD_ID = /^[a-z]+:[\w.-]{1,64}$/;
const SERVING_ID = /^[\w.-]{1,40}$/;

/** Stored corrections, cleaned: bad ones dropped, at most MAX_REMEMBERED kept. */
export function cleanRecipeMatches(raw: unknown): Record<string, RecipeMatchPref> {
  const out: Record<string, RecipeMatchPref> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_REMEMBERED)) {
    const v = value as Record<string, unknown> | null;
    if (!PREF_KEY.test(key) || !v || typeof v.foodId !== 'string' || !FOOD_ID.test(v.foodId)) continue;
    const pref: RecipeMatchPref = { foodId: v.foodId };
    if (typeof v.servingId === 'string' && SERVING_ID.test(v.servingId)) pref.servingId = v.servingId;
    if (typeof v.perUnit === 'number' && Number.isFinite(v.perUnit) && v.perUnit > 0 && v.perUnit <= 10_000
      && typeof v.unit === 'string' && /^[a-z ]{1,16}$/.test(v.unit)) {
      pref.perUnit = v.perUnit;
      pref.unit = v.unit;
    }
    out[key] = pref;
  }
  return out;
}

// ─── Totals and logging ───────────────────────────────────────────────────────

/** The whole recipe and one serving of it, from the lines that are counted. */
export function recipeTotals(lines: Pick<MatchLine, 'food' | 'servingId' | 'amount' | 'status'>[], servings: number): { total: Nutrients; perServing: Nutrients } {
  const counted = lines.filter((l) => l.status !== 'skipped' && l.food && l.amount);
  const total = sumNutrients(counted.map((l) => lineNutrients(l.food!, l.servingId, l.amount)));
  const n = servings > 0 ? servings : 1;
  return { total: roundNutrients(total), perServing: roundNutrients(scaleNutrients(total, 1 / n)) };
}

/** A recipe's own per-serving numbers as nutrients, when it has calories. */
export function macrosNutrients(m: RecipeMacros | undefined): Nutrients | null {
  if (!m || typeof m.calories !== 'number' || !(m.calories > 0)) return null;
  const g = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? round(v) : 0);
  return { kcal: Math.round(m.calories), protein: g(m.protein), carbs: g(m.carbs), fat: g(m.fat) };
}

export const recipeFoodId = (recipeId: string) => `recipe:${recipeId}`;
export const RECIPE_ENTRY_SUFFIX = ' · recipe';

/** What the diary keeps for a recipe: one serving of it, named after it. */
export function recipeSnapshot(title: string, perServing: Nutrients, recipeServings: number): EntrySnapshot {
  const name = `${title.trim().slice(0, 120 - RECIPE_ENTRY_SUFFIX.length)}${RECIPE_ENTRY_SUFFIX}`;
  return { name, source: 'recipe', servingLabel: `1 serving (of ${recipeServings})`, nutrients: roundNutrients(perServing) };
}

// ─── The plan ─────────────────────────────────────────────────────────────────

/**
 * How much of a planned meal one person likely eats: the planned servings
 * shared across the household, when that comes out at a sensible portion
 * (half to one and a half). Otherwise one serving.
 */
export function suggestedServings(planned: number | undefined, householdSize: number): number {
  if (!planned || planned <= 0 || householdSize < 1) return 1;
  const share = Math.round((planned / householdSize) * 2) / 2;
  return share >= 0.5 && share <= 1.5 ? share : 1;
}

/** This week's plan in the order it's wanted: today's first, then meal prep, then the rest of the week in order. */
export function orderPlan<T extends { day: number | null }>(entries: T[], todayIndex: number): T[] {
  const rank = (e: T) => (e.day === todayIndex ? 0 : e.day === null ? 1 : 2 + e.day);
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

// ─── What the API sends ───────────────────────────────────────────────────────

/** A recipe in the picker: enough to list it, no steps. */
export type RecipeSummary = {
  id: string;
  title: string;
  emoji: string;
  photo?: string;
  servings: number;
  category: string;
  /** The recipe's own calories per serving, when it lists them. */
  kcal?: number;
  /** Times this account has logged it. */
  logged?: number;
};

/** A meal on this week's plan. */
export type PlanMeal = {
  id: string;
  recipeId: string;
  /** "Today", "Wed" or "Meal prep". */
  label: string;
  isToday: boolean;
  day: number | null;
  servings: number;
  cooked: boolean;
  /** Servings one person likely ate. */
  suggested: number;
};

/** The recipe on the review screen, and its lines. */
export type RecipeMatch = {
  recipe: RecipeSummary & { macros: Nutrients | null };
  lines: MatchLine[];
};
