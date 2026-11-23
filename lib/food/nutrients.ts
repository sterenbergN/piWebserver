import { NUTRIENT_KEYS, type Food, type Nutrients, type Serving } from './types';

// Arithmetic on nutrient sets, and turning untrusted numbers into clean ones.

/** Upper bounds that no single serving of anything plausibly exceeds (sodium in mg). */
const MAX: Record<keyof Nutrients, number> = {
  kcal: 10_000, protein: 1_000, carbs: 1_000, fat: 1_000, fiber: 500, sugar: 1_000, sodium: 100_000, satFat: 1_000,
};

const OPTIONAL = ['fiber', 'sugar', 'sodium', 'satFat'] as const;

export const zeroNutrients = (): Nutrients => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });

/** A number from anything: "12.5", 12.5, "12,5" → 12.5; anything else → null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * A valid nutrient set from untrusted input, or null when calories are missing.
 * Macros that weren't given count as 0; optional ones are left out; everything is
 * clamped to a sane range and rounded.
 */
export function cleanNutrients(raw: unknown): Nutrients | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kcal = toNumber(r.kcal);
  if (kcal === null || kcal < 0) return null;
  const clamp = (key: keyof Nutrients, v: number) => Math.min(Math.max(v, 0), MAX[key]);
  const out: Nutrients = {
    kcal: clamp('kcal', kcal),
    protein: clamp('protein', toNumber(r.protein) ?? 0),
    carbs: clamp('carbs', toNumber(r.carbs) ?? 0),
    fat: clamp('fat', toNumber(r.fat) ?? 0),
  };
  for (const key of OPTIONAL) {
    const v = toNumber(r[key]);
    if (v !== null && v >= 0) out[key] = clamp(key, v);
  }
  return roundNutrients(out);
}

export function round(n: number, places = 1) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// Small amounts keep more places: a "1 g" serving of chicken is 1.65 kcal, and
// rounding it to 2 would make "450 × 1 g" log 900 kcal instead of 743.
const kcalPlaces = (v: number) => (v < 10 ? 2 : 0);
const gramPlaces = (v: number) => (v < 1 ? 3 : 1);

/** `n` times `factor`, optional nutrients only where known. Not rounded. */
export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out: Nutrients = { kcal: n.kcal * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor };
  for (const key of OPTIONAL) if (n[key] !== undefined) out[key] = n[key]! * factor;
  return out;
}

/** a + b. An optional nutrient is kept when either side has it. */
export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out: Nutrients = { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
  for (const key of OPTIONAL) if (a[key] !== undefined || b[key] !== undefined) out[key] = (a[key] ?? 0) + (b[key] ?? 0);
  return out;
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, zeroNutrients());
}

/** Rounded for storage: kcal and sodium whole and grams to 0.1, with more places for small amounts. */
export function roundNutrients(n: Nutrients): Nutrients {
  const g = (v: number) => round(v, gramPlaces(v));
  const out: Nutrients = { kcal: round(n.kcal, kcalPlaces(n.kcal)), protein: g(n.protein), carbs: g(n.carbs), fat: g(n.fat) };
  for (const key of OPTIONAL) if (n[key] !== undefined) out[key] = key === 'sodium' ? round(n[key]!, kcalPlaces(n[key]!)) : g(n[key]!);
  return out;
}

/** True when every nutrient key holds a finite, non-negative number. */
export function isNutrients(value: unknown): value is Nutrients {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return NUTRIENT_KEYS.every((k) => {
    const v = r[k];
    if (v === undefined) return OPTIONAL.includes(k as (typeof OPTIONAL)[number]);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  });
}

/**
 * Servings built from per-100 values: 100 g (or ml), 1 g, 1 oz, plus any household
 * portions given as [label, grams]. Ids are stable so a log entry can point at one.
 */
export function servingsFromPer100(per100: Nutrients, portions: [string, number][] = [], unit: 'g' | 'ml' = 'g'): Serving[] {
  const per = (grams: number) => roundNutrients(scaleNutrients(per100, grams / 100));
  // Ids come from the label, not the position, so a rebuilt data file that lists
  // portions in another order can't point an old diary entry at a different one.
  const taken = new Set<string>();
  const out: Serving[] = portions
    .filter(([label, grams]) => label && grams > 0)
    .map(([label, grams]) => {
      const base = `p-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34) || 'x'}`;
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      return { id, label: `${label} (${round(grams)} ${unit})`, ...(unit === 'ml' ? { ml: grams } : { grams }), nutrients: per(grams) };
    });
  out.push({ id: unit === 'ml' ? '100ml' : '100g', label: `100 ${unit}`, ...(unit === 'ml' ? { ml: 100 } : { grams: 100 }), nutrients: per(100) });
  if (unit === 'g') {
    out.push({ id: 'oz', label: '1 oz (28 g)', grams: 28.35, nutrients: per(28.35) });
    out.push({ id: 'g', label: '1 g', grams: 1, nutrients: per(1) });
  } else {
    out.push({ id: 'floz', label: '1 fl oz (30 ml)', ml: 29.57, nutrients: per(29.57) });
    out.push({ id: 'ml', label: '1 ml', ml: 1, nutrients: per(1) });
  }
  return out;
}

/** Per-100 g values worked out from a serving that has a weight, when the food doesn't carry them. */
export function per100FromServings(servings: Serving[]): Nutrients | undefined {
  const s = servings.find((x) => (x.grams ?? x.ml ?? 0) > 0);
  if (!s) return undefined;
  return roundNutrients(scaleNutrients(s.nutrients, 100 / (s.grams ?? s.ml!)));
}

/**
 * Append universal 1 oz / 1 g (or 1 fl oz / 1 ml) servings when a food has
 * weight/volume data and doesn't already include them, up to 20 servings.
 */
export function ensureUnitServings(food: Food): Food {
  if (food.partial || !food.servings.length) return food;
  const per100 = food.per100 ?? per100FromServings(food.servings);
  if (!per100) return food;

  const hasGrams = food.servings.some((s) => s.grams !== undefined);
  const hasMl = food.servings.some((s) => s.ml !== undefined);
  const unit: 'g' | 'ml' = hasMl && !hasGrams ? 'ml' : 'g';

  const servings = [...food.servings];
  let added = false;
  const per = (amount: number) => roundNutrients(scaleNutrients(per100, amount / 100));

  if (unit === 'g') {
    if (!servings.some((s) => s.id === 'oz' || (s.grams !== undefined && Math.abs(s.grams - 28.35) < 0.25)) && servings.length < 20) {
      servings.push({ id: 'oz', label: '1 oz (28 g)', grams: 28.35, nutrients: per(28.35) });
      added = true;
    }
    if (!servings.some((s) => s.id === 'g' || s.grams === 1) && servings.length < 20) {
      servings.push({ id: 'g', label: '1 g', grams: 1, nutrients: per(1) });
      added = true;
    }
  } else {
    if (!servings.some((s) => s.id === 'floz' || (s.ml !== undefined && Math.abs(s.ml - 29.57) < 0.3)) && servings.length < 20) {
      servings.push({ id: 'floz', label: '1 fl oz (30 ml)', ml: 29.57, nutrients: per(29.57) });
      added = true;
    }
    if (!servings.some((s) => s.id === 'ml' || s.ml === 1) && servings.length < 20) {
      servings.push({ id: 'ml', label: '1 ml', ml: 1, nutrients: per(1) });
      added = true;
    }
  }

  if (!added) return food;
  return { ...food, per100: food.per100 ?? per100, servings };
}

/** The serving a food opens on: a household portion first, otherwise its first. */
export function defaultServing(food: Pick<Food, 'servings'>): Serving | undefined {
  return food.servings[0];
}

/** Calories from macros (4/4/9), for a sanity check on typed-in labels. */
export function kcalFromMacros(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat'>) {
  return n.protein * 4 + n.carbs * 4 + n.fat * 9;
}
