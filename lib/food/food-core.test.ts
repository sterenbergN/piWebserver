import test from 'node:test';
import { strict as assert } from 'node:assert';
import { checkDigitOk, computeCheckDigit, expandUpcE, toGtin13, barcodeVariants } from './barcode';
import { buildCustomFood, cleanFood, FoodInputError, macroLine, parseFoodId } from './foods';
import { addNutrients, cleanNutrients, isNutrients, per100FromServings, roundNutrients, scaleNutrients, servingsFromPer100, sumNutrients, toNumber } from './nutrients';
import { mergeResults, normalizeText, scoreMatch, stem, tokenize, TokenIndex } from './search';
import type { Food } from './types';

// ─── Nutrients ────────────────────────────────────────────────────────────────

test('toNumber reads numbers and numeric strings, nothing else', () => {
  assert.equal(toNumber(12.5), 12.5);
  assert.equal(toNumber(' 12.5 '), 12.5);
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(NaN), null);
  assert.equal(toNumber(null), null);
});

test('cleanNutrients: calories required, macros default to 0, optional kept only when given, clamped', () => {
  assert.equal(cleanNutrients({ protein: 5 }), null);
  assert.equal(cleanNutrients({ kcal: -5 }), null);
  assert.equal(cleanNutrients('x'), null);
  assert.deepEqual(cleanNutrients({ kcal: '250', protein: 20.04, fat: 'x' }), { kcal: 250, protein: 20, carbs: 0, fat: 0 });
  assert.deepEqual(cleanNutrients({ kcal: 100, sodium: 123.6, fiber: -1, sugar: 2.26 }), { kcal: 100, protein: 0, carbs: 0, fat: 0, sodium: 124, sugar: 2.3 });
  assert.equal(cleanNutrients({ kcal: 1e9 })!.kcal, 10_000);
});

test('scale, add, sum and round nutrients', () => {
  const a = { kcal: 100, protein: 10, carbs: 5, fat: 2, fiber: 1 };
  const b = { kcal: 50, protein: 1, carbs: 10, fat: 0, sodium: 100 };
  assert.deepEqual(scaleNutrients(a, 1.5), { kcal: 150, protein: 15, carbs: 7.5, fat: 3, fiber: 1.5 });
  assert.deepEqual(addNutrients(a, b), { kcal: 150, protein: 11, carbs: 15, fat: 2, fiber: 1, sodium: 100 });
  assert.deepEqual(sumNutrients([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(roundNutrients({ kcal: 99.6, protein: 1.04, carbs: 1.05, fat: 0.333, sodium: 10.5 }), { kcal: 100, protein: 1, carbs: 1.1, fat: 0.333, sodium: 11 });
  // A "1 g" serving keeps its decimals, so 450 of them add up right.
  assert.deepEqual(roundNutrients({ kcal: 1.6512, protein: 0.3102, carbs: 0, fat: 0.0357, sodium: 0.8 }), { kcal: 1.65, protein: 0.31, carbs: 0, fat: 0.036, sodium: 0.8 });
  assert.ok(isNutrients(a));
  assert.ok(!isNutrients({ kcal: 1, protein: 1, carbs: 1 }));
  assert.ok(!isNutrients({ kcal: -1, protein: 1, carbs: 1, fat: 1 }));
});

test('servingsFromPer100 makes portions plus 100 g, oz and g with stable ids', () => {
  const per100 = { kcal: 200, protein: 10, carbs: 20, fat: 8 };
  const servings = servingsFromPer100(per100, [['1 cup', 150], ['bad', 0], ['1 cup', 140]]);
  assert.deepEqual(servings.map((s) => s.id), ['p-1-cup', 'p-1-cup-2', '100g', 'oz', 'g']);
  assert.equal(servings[0].label, '1 cup (150 g)');
  assert.equal(servings[0].nutrients.kcal, 300);
  assert.equal(servings[3].nutrients.kcal, 57);
  const drinks = servingsFromPer100(per100, [], 'ml');
  assert.deepEqual(drinks.map((s) => s.id), ['100ml', 'floz', 'ml']);
  assert.equal(drinks[0].ml, 100);
  assert.deepEqual(per100FromServings([{ id: 's', label: '1 bar', grams: 50, nutrients: { kcal: 100, protein: 5, carbs: 10, fat: 4 } }]), { kcal: 200, protein: 10, carbs: 20, fat: 8 });
  assert.equal(per100FromServings([{ id: 's', label: '1', nutrients: per100 }]), undefined);
});

// ─── Foods ────────────────────────────────────────────────────────────────────

test('parseFoodId accepts known sources and safe ids only', () => {
  assert.deepEqual(parseFoodId('usda:171477'), { source: 'usda', sourceId: '171477' });
  assert.deepEqual(parseFoodId('off:0049000006346'), { source: 'off', sourceId: '0049000006346' });
  assert.equal(parseFoodId('evil:1'), null);
  assert.equal(parseFoodId('usda:../x'), null);
  assert.equal(parseFoodId('usda'), null);
  assert.equal(parseFoodId(5), null);
});

test('cleanFood validates, trims and drops bad servings', () => {
  const food = cleanFood({
    id: 'off:123456789', name: '  Oat   bar ', brand: 'Acme', barcode: '0123456789012', extra: 'x',
    servings: [
      { id: 's', label: '1 bar', grams: 40, nutrients: { kcal: 180, protein: 4, carbs: 25, fat: 7 } },
      { id: 's', label: 'dupe', nutrients: { kcal: 1 } },
      { id: 'bad id!', label: 'x', nutrients: { kcal: 1 } },
      { id: 'n', label: 'no kcal', nutrients: {} },
    ],
  });
  assert.equal(food.name, 'Oat bar');
  assert.equal(food.servings.length, 1);
  assert.equal(food.barcode, '0123456789012');
  assert.ok(!('extra' in food));
  assert.throws(() => cleanFood({ id: 'off:1', name: 'x', servings: [] }), FoodInputError);
  assert.throws(() => cleanFood({ id: 'quick:1', name: 'x', servings: [{ id: 's', label: 'x', nutrients: { kcal: 1 } }] }), FoodInputError);
  assert.throws(() => cleanFood({ id: 'off:1', name: '', servings: [] }), FoodInputError);
});

test('buildCustomFood: label serving, plus per-100 and weight servings when the size is known', () => {
  const bar = buildCustomFood({ name: 'Protein bar', servingLabel: '1 bar', servingSize: 60, nutrients: { kcal: 240, protein: 20, carbs: 22, fat: 8 } }, 'abc');
  assert.equal(bar.id, 'custom:abc');
  assert.equal(bar.servings[0].label, '1 bar (60 g)');
  assert.equal(bar.per100!.kcal, 400);
  assert.ok(bar.servings.some((s) => s.id === '100g'));
  const plain = buildCustomFood({ name: 'Mystery soup', nutrients: { kcal: 150 } }, 'def');
  assert.equal(plain.servings.length, 1);
  assert.equal(plain.servings[0].label, '1 serving');
  assert.equal(plain.per100, undefined);
  const drink = buildCustomFood({ name: 'Juice', servingSize: 250, unit: 'ml', nutrients: { kcal: 110 } }, 'j');
  assert.equal(drink.servings[0].ml, 250);
  assert.equal(drink.servings[0].label, '250 ml');
  assert.throws(() => buildCustomFood({ name: '', nutrients: { kcal: 1 } }, 'x'), FoodInputError);
  assert.throws(() => buildCustomFood({ name: 'x', nutrients: {} }, 'x'), FoodInputError);
  assert.equal(macroLine({ kcal: 249.6, protein: 20.4, carbs: 30, fat: 8 }), '250 kcal · 20 P · 30 C · 8 F');
});

// ─── Barcodes ─────────────────────────────────────────────────────────────────

test('check digits', () => {
  assert.equal(computeCheckDigit('400638133393'), 1); // EAN-13 4006381333931
  assert.ok(checkDigitOk('4006381333931'));
  assert.ok(checkDigitOk('036000291452')); // UPC-A
  assert.ok(!checkDigitOk('036000291453'));
  assert.ok(checkDigitOk('96385074')); // EAN-8
});

test('UPC-E expands to UPC-A', () => {
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(expandUpcE('01234505'), '012000003455');
  assert.equal(expandUpcE('01234535'), '012300000455');
  assert.equal(expandUpcE('01234545'), '012340000055');
  assert.equal(expandUpcE('01234565'), '012345000065');
  assert.equal(expandUpcE('21234505'), null);
});

test('toGtin13 normalises every common form and rejects typos', () => {
  assert.equal(toGtin13('036000291452'), '0036000291452');
  assert.equal(toGtin13('4006381333931'), '4006381333931');
  assert.equal(toGtin13('4006-381 333931'), '4006381333931');
  assert.equal(toGtin13('00036000291452'), '0036000291452');
  assert.equal(toGtin13('96385074'), '0000096385074');
  assert.equal(toGtin13('04252614'), '0042100005264');
  assert.equal(toGtin13('425261'), '0042100005264');
  assert.equal(toGtin13('036000291453'), null);
  assert.equal(toGtin13('abc'), null);
  assert.equal(toGtin13('12345'), null);
  assert.deepEqual(barcodeVariants('0036000291452'), ['0036000291452', '036000291452']);
  assert.deepEqual(barcodeVariants('4006381333931'), ['4006381333931']);
});

// ─── Search ───────────────────────────────────────────────────────────────────

test('normalise, stem and tokenize', () => {
  assert.equal(normalizeText('Crème Brûlée, 2%!'), 'creme brulee 2%');
  assert.equal(stem('eggs'), 'egg');
  assert.equal(stem('berries'), 'berry');
  assert.equal(stem('peaches'), 'peach');
  assert.equal(stem('glass'), 'glass');
  assert.equal(stem('gas'), 'gas');
  assert.deepEqual(tokenize('Eggs and toast, with butter'), ['egg', 'toast', 'butter']);
});

test('scoreMatch: every word must match; close, short names win', () => {
  assert.equal(scoreMatch('banana bread', 'Bananas, raw'), 0);
  const raw = scoreMatch('banana', 'Bananas, raw');
  const bread = scoreMatch('banana', 'Bread, banana, prepared from recipe, made with margarine');
  assert.ok(raw > bread, `${raw} > ${bread}`);
  assert.ok(scoreMatch('chick bre', 'Chicken breast, roasted') > 0);
  assert.ok(scoreMatch('cheerios', 'Toasted oats', 'Cheerios') > 0);
  assert.ok(scoreMatch('butter', 'Peanutbutter cups') > 0);
  assert.equal(scoreMatch('', 'x'), 0);
});

test('TokenIndex finds by word prefixes in any order', () => {
  const items = [{ name: 'Chicken breast, roasted' }, { name: 'Chicken thigh' }, { name: 'Beef, ground' }, { name: 'Breadsticks' }];
  const index = new TokenIndex(items, (i) => i);
  assert.deepEqual(index.search('breast chick').map((h) => h.item.name), ['Chicken breast, roasted']);
  assert.deepEqual(index.search('chicken').map((h) => h.item.name).sort(), ['Chicken breast, roasted', 'Chicken thigh']);
  assert.deepEqual(index.search('zzz'), []);
  assert.equal(index.size, 4);
});

const food = (id: string, name: string, brand?: string): Food => {
  const [source, sourceId] = id.split(':') as [Food['source'], string];
  return { id, source, sourceId, name, ...(brand ? { brand } : {}), servings: [{ id: 's', label: '1', nutrients: { kcal: 1, protein: 0, carbs: 0, fat: 0 } }] };
};

test('mergeResults collapses duplicates onto the better source and lifts foods you log', () => {
  const merged = mergeResults([
    { food: food('off:1', 'Greek yogurt', 'Fage'), score: 10 },
    { food: food('fatsecret:9', 'Greek Yogurt', 'FAGE'), score: 10 },
    { food: food('usda:5', 'Yogurt, Greek, plain'), score: 9 },
    { food: food('usda:6', 'Yogurt, Greek, strawberry'), score: 9 },
  ], { 'usda:6': { count: 8, last: '2026-11-19' } }, '2026-11-20');
  assert.deepEqual(merged.map((h) => h.food.id), ['usda:6', 'fatsecret:9', 'usda:5']);
  // Library foods get a small lift too.
  const lib = mergeResults([{ food: food('usda:1', 'Apple'), score: 5 }, { food: food('custom:a', 'Apple pie'), score: 5 }], {}, '', new Set(['custom:a']));
  assert.equal(lib[0].food.id, 'custom:a');
});
