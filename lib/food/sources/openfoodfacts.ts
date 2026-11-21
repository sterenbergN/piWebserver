import { cleanText } from '../foods';
import { round, roundNutrients, scaleNutrients, servingsFromPer100, toNumber } from '../nutrients';
import type { Food, Nutrients, Serving } from '../types';
import { recordSourceStatus } from '../settings';
import { fetchWithTimeout, SourceError, USER_AGENT, type FoodSourceAdapter } from './types';

// Open Food Facts (https://world.openfoodfacts.org): a free, open database of
// packaged foods (ODbL), no key needed. Best for barcodes. Its text search is
// slow and limited to about 10 requests a minute, so it's only used when asked
// ("Search more") or when the other sources find little; the orchestrator
// rate-limits it.
//
// - Barcode: GET /api/v2/product/<code>.json → { status: 1, product } or status 0.
// - Search:  GET /cgi/search.pl?search_terms=…&search_simple=1&action=process&json=1
//   → { products: [...] }.
// Nutriments are per 100 g (or 100 ml) as "<name>_100g", sodium in grams.

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments,quantity,product_quantity_unit';
const TIMEOUT_MS = 5000;

type OffProduct = Record<string, any>;

/** Per-100 nutrients from an OFF product, or null when it has no calories. */
export function offPer100(nutriments: Record<string, unknown> | undefined): Nutrients | null {
  if (!nutriments) return null;
  let kcal = toNumber(nutriments['energy-kcal_100g']);
  if (kcal === null) {
    const kj = toNumber(nutriments['energy-kj_100g']) ?? toNumber(nutriments['energy_100g']);
    if (kj !== null) kcal = kj / 4.184;
  }
  if (kcal === null || kcal < 0 || kcal > 1000) return null;
  const n: Nutrients = {
    kcal: Math.round(kcal),
    protein: round(toNumber(nutriments.proteins_100g) ?? 0),
    carbs: round(toNumber(nutriments.carbohydrates_100g) ?? 0),
    fat: round(toNumber(nutriments.fat_100g) ?? 0),
  };
  const fiber = toNumber(nutriments.fiber_100g);
  const sugar = toNumber(nutriments.sugars_100g);
  const sodium = toNumber(nutriments.sodium_100g);
  const salt = toNumber(nutriments.salt_100g);
  const satFat = toNumber(nutriments['saturated-fat_100g']);
  if (fiber !== null) n.fiber = round(fiber);
  if (sugar !== null) n.sugar = round(sugar);
  // Sodium is in grams here; ours is mg. Salt is 2.5× sodium when only that is given.
  if (sodium !== null) n.sodium = Math.round(sodium * 1000);
  else if (salt !== null) n.sodium = Math.round((salt / 2.5) * 1000);
  if (satFat !== null) n.satFat = round(satFat);
  return n;
}

/** "1 bar (40 g)" → "1 bar"; "30 g" → "" (just a weight). */
function servingName(servingSize: string): string {
  const head = servingSize.replace(/\(.*\)/, '').trim();
  return /^[\d.,\s]*(g|gr|grams?|ml|cl|l|oz)?$/i.test(head) ? '' : head.slice(0, 40);
}

/** An OFF product as a Food, or null if it lacks a name or calories. */
export function normalizeOffProduct(p: OffProduct): Food | null {
  const code = String(p?.code || '').trim();
  const name = cleanText(p?.product_name_en || p?.product_name || p?.generic_name, 120);
  const per100 = offPer100(p?.nutriments);
  if (!/^\d{4,14}$/.test(code) || !name || !per100) return null;
  const unit: 'g' | 'ml' = String(p.serving_quantity_unit || p.product_quantity_unit || '').toLowerCase() === 'ml'
    || /\b\d+(\.\d+)?\s*(ml|cl|l)\b/i.test(String(p.quantity || '')) ? 'ml' : 'g';
  const portions: [string, number][] = [];
  const qty = toNumber(p.serving_quantity);
  if (qty && qty > 0 && qty <= 5000) portions.push([servingName(String(p.serving_size || '')) || '1 serving', round(qty, 1)]);
  const servings: Serving[] = servingsFromPer100(per100, portions, unit);
  // When the label's own per-serving calories are given, trust them for that serving.
  const kcalServing = toNumber(p.nutriments?.['energy-kcal_serving']);
  if (portions.length && kcalServing !== null && servings[0].nutrients.kcal > 0) {
    const ratio = kcalServing / servings[0].nutrients.kcal;
    if (ratio > 0.8 && ratio < 1.25) servings[0].nutrients = roundNutrients(scaleNutrients(servings[0].nutrients, ratio));
  }
  const food: Food = { id: `off:${code}`, source: 'off', sourceId: code, name, servings, per100 };
  const brand = cleanText(String(p.brands || '').split(',')[0], 80);
  if (brand) food.brand = brand;
  if (/^\d{8,14}$/.test(code)) food.barcode = code.padStart(13, '0').slice(-13);
  return food;
}

async function getJson(url: string) {
  const res = await fetchWithTimeout('off', url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, TIMEOUT_MS);
  if (res.status === 404) return null;
  if (res.status === 429) throw new SourceError('off', 'rate-limited', 'Open Food Facts asked us to slow down.');
  if (!res.ok) throw new SourceError('off', 'unavailable', `Open Food Facts answered HTTP ${res.status}.`);
  return (await res.json().catch(() => null)) as Record<string, any> | null;
}

async function tracked<T>(work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    void recordSourceStatus('off', true);
    return result;
  } catch (error) {
    if (error instanceof SourceError && error.kind !== 'rate-limited') void recordSourceStatus('off', false, error.message);
    throw error;
  }
}

async function product(code: string): Promise<Food | null> {
  if (!/^\d{4,14}$/.test(code)) return null;
  const json = await getJson(`${BASE}/api/v2/product/${code}.json?fields=${FIELDS}`);
  if (!json || json.status !== 1 || !json.product) return null;
  return normalizeOffProduct({ ...json.product, code: json.product.code || code });
}

export const openFoodFactsSource: FoodSourceAdapter = {
  id: 'off',
  search: (query, limit) => tracked(async () => {
    const params = new URLSearchParams({
      search_terms: query.slice(0, 100), search_simple: '1', action: 'process', json: '1',
      page_size: String(Math.min(Math.max(limit, 1), 30)), fields: FIELDS,
    });
    const json = await getJson(`${BASE}/cgi/search.pl?${params}`);
    const products: OffProduct[] = Array.isArray(json?.products) ? json!.products : [];
    return products.map(normalizeOffProduct).filter((f): f is Food => !!f);
  }),
  get: (code) => tracked(() => product(code)),
  // The 13-digit form first; some products are stored under the 12-digit UPC-A.
  barcode: (gtin13) => tracked(async () => (await product(gtin13)) ?? (gtin13.startsWith('0') ? product(gtin13.slice(1)) : null)),
};
