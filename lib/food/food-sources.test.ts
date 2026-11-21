import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { asArray, classifyFatSecretError, normalizeFatSecretFood, normalizeFatSecretSummary, parseFoodDescription } from './sources/fatsecret';
import { normalizeOffProduct, offPer100 } from './sources/openfoodfacts';
import { isLive, FATSECRET_TTL_MS } from './sources/library';
import { noticeFor } from './sources/index';
import { SourceError } from './sources/types';
import { USDA_FILE, usdaRowToFood, type UsdaData } from './sources/usda';
import { cleanFoodSettings, secretHint, toPublicFoodSettings } from './settings';
import type { LibraryFood } from './types';

// ─── FatSecret ────────────────────────────────────────────────────────────────

// Shaped like the food.get v5 example in FatSecret's docs (numbers as strings).
const fsFood = {
  food_id: '33691',
  food_name: 'Cheddar Cheese',
  food_type: 'Generic',
  servings: {
    serving: [
      { serving_id: '29131', serving_description: '1 cup, diced', metric_serving_amount: '132.000', metric_serving_unit: 'g', calories: '532', carbohydrate: '1.69', protein: '32.87', fat: '43.74', saturated_fat: '27.84', fiber: '0', sugar: '0.69', sodium: '820' },
      { serving_id: '30126', serving_description: '100 g', metric_serving_amount: '100.000', metric_serving_unit: 'g', calories: '403', carbohydrate: '1.28', protein: '24.90', fat: '33.14', is_default: '1' },
      { serving_id: '30127', serving_description: '1 oz', metric_serving_amount: '1.000', metric_serving_unit: 'oz', calories: '114', carbohydrate: '0.36', protein: '7.06', fat: '9.40' },
      { serving_id: 'bad', serving_description: 'no calories' },
    ],
  },
};

test('FatSecret food: servings normalised, default first, per-100 from the 100 g serving', () => {
  const food = normalizeFatSecretFood(fsFood)!;
  assert.equal(food.id, 'fatsecret:33691');
  assert.deepEqual(food.servings.map((s) => s.id), ['30126', '29131', '30127']);
  assert.equal(food.servings[0].label, '100 g');
  assert.equal(food.servings[1].label, '1 cup, diced (132 g)');
  assert.deepEqual(food.servings[1].nutrients, { kcal: 532, protein: 32.9, carbs: 1.7, fat: 43.7, fiber: 0, sugar: 0.7, sodium: 820, satFat: 27.8 });
  assert.equal(food.servings[2].grams, 28.35);
  assert.equal(food.per100!.kcal, 403);
  // A lone serving arrives as an object, not an array.
  const single = normalizeFatSecretFood({ ...fsFood, brand_name: 'Tillamook', servings: { serving: fsFood.servings.serving[0] } })!;
  assert.equal(single.servings.length, 1);
  assert.equal(single.brand, 'Tillamook');
  assert.equal(normalizeFatSecretFood({ food_id: 'x', food_name: 'y' }), null);
  assert.equal(normalizeFatSecretFood({ ...fsFood, servings: undefined }), null);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(1), [1]);
});

test('FatSecret v1 summaries become partial foods', () => {
  const serving = parseFoodDescription('Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g')!;
  assert.deepEqual(serving, { id: 'summary', label: '100g', grams: 100, nutrients: { kcal: 52, protein: 0.3, carbs: 13.8, fat: 0.2 } });
  assert.equal(parseFoodDescription('Per 1 cup - Calories: 120kcal | Fat: 5g | Carbs: 12g | Protein: 8g')!.grams, undefined);
  assert.equal(parseFoodDescription('nonsense'), null);
  const food = normalizeFatSecretSummary({ food_id: '35718', food_name: 'Apples', food_description: 'Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g' })!;
  assert.equal(food.partial, true);
  assert.equal(food.servings.length, 1);
});

test('FatSecret errors are classified for the right message', () => {
  assert.equal(classifyFatSecretError(21, 'Invalid IP address detected: 1.2.3.4').kind, 'ip');
  assert.equal(classifyFatSecretError(14, 'Missing scope').kind, 'not-permitted');
  assert.equal(classifyFatSecretError(13, 'Invalid token').kind, 'auth');
  assert.equal(classifyFatSecretError(500, 'Boom').kind, 'unavailable');
  assert.match(noticeFor(classifyFatSecretError(21, 'Invalid IP address detected'))!, /IP/);
  assert.equal(noticeFor(new SourceError('fatsecret', 'timeout', 'slow')), 'FatSecret unavailable, showing other sources.');
  assert.equal(noticeFor(new SourceError('fatsecret', 'off', 'not set up')), null);
});

// ─── Open Food Facts ──────────────────────────────────────────────────────────

test('Open Food Facts nutriments per 100 g, with kJ and salt fallbacks', () => {
  assert.deepEqual(offPer100({ 'energy-kcal_100g': 389, proteins_100g: 13.2, carbohydrates_100g: 67, fat_100g: 6.5, fiber_100g: 10, sugars_100g: 1, sodium_100g: 0.006, 'saturated-fat_100g': 1.1 }),
    { kcal: 389, protein: 13.2, carbs: 67, fat: 6.5, fiber: 10, sugar: 1, sodium: 6, satFat: 1.1 });
  assert.equal(offPer100({ energy_100g: 1046 })!.kcal, 250);
  assert.equal(offPer100({ 'energy-kcal_100g': 100, salt_100g: 1 })!.sodium, 400);
  assert.equal(offPer100({ proteins_100g: 1 }), null);
  assert.equal(offPer100(undefined), null);
});

test('Open Food Facts product → food with its serving first', () => {
  const food = normalizeOffProduct({
    code: '0016000275287', product_name: 'Cheerios', brands: 'General Mills, Nestlé', serving_size: '1 cup (28 g)', serving_quantity: 28,
    nutriments: { 'energy-kcal_100g': 357, proteins_100g: 10.7, carbohydrates_100g: 75, fat_100g: 7.1, 'energy-kcal_serving': 100 },
  })!;
  assert.equal(food.id, 'off:0016000275287');
  assert.equal(food.brand, 'General Mills');
  assert.equal(food.servings[0].label, '1 cup (28 g)');
  assert.equal(food.servings[0].nutrients.kcal, 100);
  assert.equal(food.servings[1].id, '100g');
  assert.equal(food.barcode, '0016000275287');
  const drink = normalizeOffProduct({ code: '5449000000996', product_name: 'Cola', quantity: '330 ml', serving_size: '330 ml', serving_quantity: 330, nutriments: { 'energy-kcal_100g': 42, carbohydrates_100g: 10.6 } })!;
  assert.equal(drink.servings[0].label, '1 serving (330 ml)');
  assert.equal(drink.servings[0].ml, 330);
  assert.equal(drink.servings[1].id, '100ml');
  assert.equal(normalizeOffProduct({ code: '1', product_name: 'x', nutriments: {} }), null);
  assert.equal(normalizeOffProduct({ code: '12345678', product_name: '', nutriments: { 'energy-kcal_100g': 1 } }), null);
});

// ─── USDA bundle ──────────────────────────────────────────────────────────────

test('the bundled USDA file loads and its rows become foods', () => {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(USDA_FILE())).toString('utf-8')) as UsdaData;
  assert.ok(data.foods.length > 7000);
  assert.deepEqual(data.nutrients, ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat']);
  const banana = data.foods.find((r) => r[1] === 'Bananas, raw')!;
  const food = usdaRowToFood(banana, data.categories);
  assert.equal(food.id, `usda:${banana[0]}`);
  assert.equal(food.per100!.kcal, 89);
  assert.ok(food.servings.some((s) => s.label.startsWith('1 medium')));
  assert.ok(food.category);
});

// ─── Library and settings ─────────────────────────────────────────────────────

test('FatSecret copies expire after a day unless kept; other foods never do', () => {
  const t = Date.UTC(2026, 10, 20);
  const fsCopy = { source: 'fatsecret', savedAt: new Date(t - FATSECRET_TTL_MS - 1).toISOString() } as LibraryFood;
  assert.equal(isLive(fsCopy, false, t), false);
  assert.equal(isLive(fsCopy, true, t), true);
  assert.equal(isLive({ ...fsCopy, fetchedAt: new Date(t - 1000).toISOString() }, false, t), true);
  assert.equal(isLive({ ...fsCopy, source: 'off' }, false, t), true);
});

test('admin settings: defaults, cleaning, and the secret never in the public view', () => {
  const d = cleanFoodSettings(null);
  assert.deepEqual(d.sources, { usda: true, fatsecret: true, off: true });
  assert.equal(d.keepFatSecretCopies, false);
  const s = cleanFoodSettings({ fatsecret: { clientId: ' abc ', clientSecret: 'supersecretvalue1234' }, sources: { off: false }, keepFatSecretCopies: true });
  assert.equal(s.fatsecret.clientId, 'abc');
  assert.equal(s.sources.off, false);
  const pub = toPublicFoodSettings(s);
  assert.ok(!JSON.stringify(pub).includes('supersecretvalue'));
  assert.equal(pub.fatsecret.secretHint, '…1234');
  assert.equal(pub.fatsecret.configured, true);
  assert.equal(secretHint(''), '');
  assert.equal(cleanFoodSettings({ fatsecret: { clientId: 'bad id with spaces' } }).fatsecret.clientId, '');
});
