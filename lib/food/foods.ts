import { cleanNutrients, per100FromServings, round, servingsFromPer100 } from './nutrients';
import { NUTRIENT_KEYS, type Food, type FoodSource, type Nutrients, type Serving } from './types';

// Making foods safe to store: anything that arrives from a browser or another
// service goes through cleanFood before it's kept or logged.

export const MAX_NAME = 120;
export const MAX_SERVINGS = 20;
const SOURCES: FoodSource[] = ['custom', 'usda', 'fatsecret', 'off', 'quick'];
const SOURCE_ID = /^[\w.-]{1,64}$/;
const SERVING_ID = /^[\w.-]{1,40}$/;

export class FoodInputError extends Error {}

export const foodId = (source: FoodSource, sourceId: string) => `${source}:${sourceId}`;

/** "usda:171477" → { source, sourceId }, or null for anything malformed. */
export function parseFoodId(id: unknown): { source: FoodSource; sourceId: string } | null {
  if (typeof id !== 'string') return null;
  const at = id.indexOf(':');
  if (at < 0) return null;
  const source = id.slice(0, at) as FoodSource;
  const sourceId = id.slice(at + 1);
  return SOURCES.includes(source) && SOURCE_ID.test(sourceId) ? { source, sourceId } : null;
}

export const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';

function positive(value: unknown, max: number): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? round(n, 2) : undefined;
}

export function cleanServing(raw: unknown): Serving | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && SERVING_ID.test(r.id) ? r.id : null;
  const label = cleanText(r.label, 80);
  const nutrients = cleanNutrients(r.nutrients);
  if (!id || !label || !nutrients) return null;
  const serving: Serving = { id, label, nutrients };
  const grams = positive(r.grams, 10_000);
  const ml = positive(r.ml, 10_000);
  if (grams) serving.grams = grams;
  else if (ml) serving.ml = ml;
  return serving;
}

/** A Food from untrusted input, or a FoodInputError saying what's wrong. */
export function cleanFood(raw: unknown): Food {
  if (!raw || typeof raw !== 'object') throw new FoodInputError('Missing food.');
  const r = raw as Record<string, unknown>;
  const parsed = parseFoodId(r.id);
  if (!parsed || parsed.source === 'quick') throw new FoodInputError('Unknown food.');
  const name = cleanText(r.name, MAX_NAME);
  if (!name) throw new FoodInputError('A food needs a name.');
  const seen = new Set<string>();
  const servings: Serving[] = [];
  for (const s of Array.isArray(r.servings) ? r.servings.slice(0, MAX_SERVINGS) : []) {
    const clean = cleanServing(s);
    if (clean && !seen.has(clean.id)) { seen.add(clean.id); servings.push(clean); }
  }
  if (!servings.length) throw new FoodInputError('A food needs at least one serving with calories.');
  const food: Food = { id: foodId(parsed.source, parsed.sourceId), source: parsed.source, sourceId: parsed.sourceId, name, servings };
  const brand = cleanText(r.brand, 80);
  if (brand) food.brand = brand;
  const category = cleanText(r.category, 80);
  if (category) food.category = category;
  if (typeof r.barcode === 'string' && /^\d{8,14}$/.test(r.barcode)) food.barcode = r.barcode;
  const per100 = cleanNutrients(r.per100);
  if (per100) food.per100 = per100;
  return food;
}

export type CustomFoodInput = {
  name: unknown;
  brand?: unknown;
  barcode?: unknown;
  /** What one serving on the label is, e.g. "1 bar" or "2/3 cup". */
  servingLabel?: unknown;
  /** Its weight in grams (or volume in ml with `unit: 'ml'`), when the label gives it. */
  servingSize?: unknown;
  unit?: unknown;
  /** Per serving. */
  nutrients: unknown;
};

/**
 * A food typed in from a nutrition label: the label's serving, and when its
 * weight is known, per-100 values and gram/oz servings too, so it can be logged by weight.
 */
export function buildCustomFood(input: CustomFoodInput, id: string): Food {
  const name = cleanText(input.name, MAX_NAME);
  if (!name) throw new FoodInputError('Give the food a name.');
  const nutrients = cleanNutrients(input.nutrients);
  if (!nutrients) throw new FoodInputError('Enter the calories per serving.');
  const unit = input.unit === 'ml' ? 'ml' : 'g';
  const size = positive(input.servingSize, 5_000);
  const label = cleanText(input.servingLabel, 60) || (size ? `${size} ${unit}` : '1 serving');
  const servings: Serving[] = [{
    id: 's',
    label: size && !label.includes(`${size}`) ? `${label} (${size} ${unit})` : label,
    ...(size ? (unit === 'ml' ? { ml: size } : { grams: size }) : {}),
    nutrients,
  }];
  const food: Food = { id: foodId('custom', id), source: 'custom', sourceId: id, name, servings };
  const brand = cleanText(input.brand, 80);
  if (brand) food.brand = brand;
  if (typeof input.barcode === 'string' && /^\d{8,14}$/.test(input.barcode.trim())) food.barcode = input.barcode.trim();
  if (size) {
    const per100 = per100FromServings(servings)!;
    food.per100 = per100;
    food.servings.push(...servingsFromPer100(per100, [], unit));
  }
  return food;
}

/** Nutrients written as a short line: "250 kcal · 20 P · 30 C · 8 F". */
export function macroLine(n: Nutrients): string {
  return `${Math.round(n.kcal)} kcal · ${round(n.protein, 0)} P · ${round(n.carbs, 0)} C · ${round(n.fat, 0)} F`;
}

/** True when two nutrient sets are the same after rounding. */
export function sameNutrients(a: Nutrients, b: Nutrients) {
  return NUTRIENT_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
