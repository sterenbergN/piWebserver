import test from 'node:test';
import { strict as assert } from 'node:assert';
import { ALWAYS_HAVE, extractIngredients, parseIngredientLine, type Amount, type BomItem } from '../recipes/recipes';
import { servingsFromPer100 } from './nutrients';
import {
  baseUnit, cleanRecipeMatches, densityOf, lineNutrients, lineWeight, macrosNutrients, matchIngredients, measureOf, measureQty, NEVER_COUNTED,
  neverCounted, nutrientsForWeight, orderPlan, perUnitNutrients, pieceServing, portionFor, prefFor, quantityFor, queriesFor, rankForRecipe,
  recipeFoodId, recipeSnapshot, recipeTotals, suggestedServings, unitKey, usualFor, type FoodLookup, type MatchLine,
} from './recipe-match';
import { scoreMatch } from './search';
import type { Food, Nutrients } from './types';

// Foods shaped like the bundled USDA ones: per-100 g values plus household portions.
const usdaFood = (id: string, name: string, per100: Nutrients, portions: [string, number][] = []): Food => ({
  id: `usda:${id}`, source: 'usda', sourceId: id, name, per100, servings: servingsFromPer100(per100, portions),
});
const egg = usdaFood('1', 'Egg, whole, raw, fresh', { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }, [['1 large', 50], ['1 medium', 44], ['1 small', 38], ['1 cup (4.86 large eggs)', 243]]);
const milk = usdaFood('2', 'Milk, whole', { kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 }, [['1 cup', 244], ['1 tbsp', 15]]);
const garlic = usdaFood('3', 'Garlic, raw', { kcal: 143, protein: 6.6, carbs: 28.2, fat: 0.4 });
const onion = usdaFood('4', 'Onions, raw', { kcal: 40, protein: 1.1, carbs: 9.3, fat: 0.1 }, [['1 cup, chopped', 160], ['1 large', 150], ['1 slice, large (1/4" thick)', 38], ['1 medium (2-1/2" dia)', 110], ['1 small', 70]]);
const chicken = usdaFood('5', 'Chicken, thigh, boneless, skinless, raw', { kcal: 144, protein: 19.7, carbs: 0, fat: 7.3 });
const cloveFood = usdaFood('6', 'Garlic cloves', { kcal: 149, protein: 6.4, carbs: 33, fat: 0.5 }, [['1 clove', 3]]);
/** A drink typed in by volume: servings in ml only. */
const juice: Food = {
  id: 'custom:j', source: 'custom', sourceId: 'j', name: 'Orange juice',
  servings: [{ id: 's', label: '1 glass (250 ml)', ml: 250, nutrients: { kcal: 110, protein: 2, carbs: 26, fat: 0 } }, { id: 'ml', label: '1 ml', ml: 1, nutrients: { kcal: 0, protein: 0, carbs: 0.1, fat: 0 } }],
};
/** A label food with no weight at all. */
const bar: Food = { id: 'custom:b', source: 'custom', sourceId: 'b', name: 'Protein bar', servings: [{ id: 's', label: '1 bar', nutrients: { kcal: 200, protein: 20, carbs: 22, fat: 7 } }] };

const amount = (usQty: number | null, usUnit: string, metricQty: number | null = usQty, metricUnit = usUnit): Amount => ({ usQty, usUnit, metricQty, metricUnit });
const bom = (key: string, a: Amount, extras: Amount[] = [], name = key): BomItem => ({ key, name, ...a, extras, stepKeys: [] });
const close = (actual: number, expected: number, places = 1) => assert.equal(Math.round(actual * 10 ** places) / 10 ** places, expected);

test('never counted matches the recipes’ always-have list', () => {
  assert.deepEqual([...NEVER_COUNTED].sort(), [...ALWAYS_HAVE].sort());
  assert.ok(neverCounted('water'));
  assert.ok(neverCounted('starchy pasta water'));
  assert.ok(neverCounted('crushed ice'));
  assert.ok(!neverCounted('coconut water'));
  assert.ok(!neverCounted('ice cream'));
});

test('measures: weights, volumes and counts from recipe amounts', () => {
  assert.deepEqual(measureOf(amount(2, 'lb', 900, 'g')), { kind: 'weight', grams: 900 });
  close((measureOf(amount(8, 'oz', null, ''))! as { grams: number }).grams, 226.8);
  assert.deepEqual(measureOf(amount(1.5, 'kg')), { kind: 'weight', grams: 1500 });
  assert.deepEqual(measureOf(amount(2, 'tbsp', 30, 'ml')), { kind: 'volume', ml: 30 });
  assert.deepEqual(measureOf(amount(1, 'L')), { kind: 'volume', ml: 1000 });
  assert.deepEqual(measureOf(amount(2, 'fl oz', null, '')), { kind: 'volume', ml: 60 });
  assert.deepEqual(measureOf(amount(0.5, 'cup', null, '')), { kind: 'volume', ml: 120 });
  assert.deepEqual(measureOf(amount(1, 'tsp', null, '')), { kind: 'volume', ml: 5 });
  assert.deepEqual(measureOf(amount(3, 'cloves')), { kind: 'count', count: 3, unit: 'clove' });
  assert.deepEqual(measureOf(amount(2, 'slices')), { kind: 'count', count: 2, unit: 'slice' });
  assert.deepEqual(measureOf(amount(2, 'bunch')), { kind: 'count', count: 2, unit: 'bunch' });
  assert.deepEqual(measureOf(amount(2, '')), { kind: 'count', count: 2, unit: '' });
  assert.equal(measureOf(amount(null, '')), null);
  assert.equal(measureOf(amount(0, 'g')), null);
  // A weight on either side wins: the recipes already weigh a cup of flour.
  assert.deepEqual(measureOf(amount(1, 'cup', 120, 'g')), { kind: 'weight', grams: 120 });

  assert.equal(unitKey({ kind: 'weight', grams: 5 }), 'g');
  assert.equal(unitKey({ kind: 'volume', ml: 5 }), 'ml');
  assert.equal(unitKey({ kind: 'count', count: 2, unit: '' }), 'each');
  assert.equal(unitKey({ kind: 'count', count: 2, unit: 'clove' }), 'clove');
  assert.equal(measureQty({ kind: 'count', count: 2, unit: '' }), 2);
});

test('measures from lines the recipes parse', () => {
  const of = (line: string) => measureOf(parseIngredientLine(line).amount!);
  assert.deepEqual(of('2 cups milk'), { kind: 'weight', grams: 480 });
  assert.deepEqual(of('3 cloves garlic'), { kind: 'count', count: 3, unit: 'clove' });
  assert.deepEqual(of('2 eggs'), { kind: 'count', count: 2, unit: '' });
  close((of('1 1/2 lb chicken thighs') as { grams: number }).grams, 680.4);
  assert.deepEqual(of('3 tbsp soy sauce'), { kind: 'volume', ml: 45 });
});

test('gram to nutrient maths', () => {
  assert.equal(baseUnit(milk), 'g');
  assert.equal(baseUnit(juice), 'ml');
  assert.equal(baseUnit(bar), null);
  // From the biggest weighed serving, not the rounded "1 g" one.
  close(perUnitNutrients(chicken)!.per.kcal, 1.44, 2);
  close(nutrientsForWeight(chicken, 250)!.kcal, 360);
  close(nutrientsForWeight(chicken, 250)!.protein, 49.3);
  assert.equal(nutrientsForWeight(bar, 100), null);
  // 450 × "1 g" rounds each gram to 1 kcal; by weight it comes out right.
  close(lineNutrients(chicken, 'g', 450).kcal, 648);
  close(lineNutrients(egg, 'p-1-large', 2).kcal, 143);
  close(lineNutrients(egg, 'p-1-large', 2).protein, 12.6);
  close(lineNutrients(juice, 'ml', 500).kcal, 220);
  // A serving with no weight counts as itself.
  assert.equal(lineNutrients(bar, 's', 1.5).kcal, 300);
  assert.equal(lineNutrients(bar, 'nope', 1).kcal, 0);
  assert.equal(lineNutrients(bar, 's', 0).kcal, 0);
  assert.deepEqual(lineWeight(egg, 'p-1-large', 3), { qty: 150, unit: 'g' });
  assert.deepEqual(lineWeight(juice, 's', 2), { qty: 500, unit: 'ml' });
  assert.equal(lineWeight(bar, 's', 1), null);
});

test('density from portions or from servings by volume and by weight', () => {
  close(densityOf(milk)!, 1.02, 2);
  // FatSecret-style: one serving by weight, one by volume.
  const oil: Food = {
    id: 'fatsecret:1', source: 'fatsecret', sourceId: '1', name: 'Olive oil',
    servings: [
      { id: 'a', label: '100 g', grams: 100, nutrients: { kcal: 884, protein: 0, carbs: 0, fat: 100 } },
      { id: 'b', label: '100 ml', ml: 100, nutrients: { kcal: 809, protein: 0, carbs: 0, fat: 91.5 } },
    ],
  };
  close(densityOf(oil)!, 0.92, 2);
  assert.equal(densityOf(garlic), null);
  // A "cup" portion that can't be right (5 g a cup) is ignored.
  assert.equal(densityOf(usdaFood('9', 'Puffed rice', { kcal: 400, protein: 6, carbs: 90, fat: 1 }, [['1 cup', 5]])), null);
});

test('piece servings for counts', () => {
  assert.equal(pieceServing(egg, '', 'Eggs')?.label, '1 large (50 g)');
  assert.equal(pieceServing(egg, '', 'Small eggs')?.label, '1 small (38 g)');
  assert.equal(pieceServing(onion, '', 'Onion')?.label, '1 medium (2-1/2" dia) (110 g)');
  assert.equal(pieceServing(onion, '', 'Large onion')?.label, '1 large (150 g)');
  assert.equal(pieceServing(cloveFood, 'clove')?.label, '1 clove (3 g)');
  assert.equal(pieceServing(garlic, 'clove'), null);
  assert.equal(pieceServing(milk, ''), null);
  assert.equal(pieceServing(bar, ''), null);
});

test('quantities in the food’s own unit, and what was guessed', () => {
  assert.deepEqual(quantityFor({ kind: 'weight', grams: 200 }, chicken), { qty: 200, unit: 'g' });
  const cup = quantityFor({ kind: 'volume', ml: 240 }, milk)!;
  close(cup.qty, 244);
  assert.equal(cup.guess, undefined);
  assert.deepEqual(quantityFor({ kind: 'volume', ml: 30 }, chicken), { qty: 30, unit: 'g', guess: 'Weighed as water' });
  assert.deepEqual(quantityFor({ kind: 'volume', ml: 300 }, juice), { qty: 300, unit: 'ml' });
  assert.deepEqual(quantityFor({ kind: 'weight', grams: 300 }, juice), { qty: 300, unit: 'ml', guess: 'Weighed as water' });
  assert.deepEqual(quantityFor({ kind: 'count', count: 2, unit: '' }, egg, 'eggs'), { qty: 100, unit: 'g' });
  assert.deepEqual(quantityFor({ kind: 'count', count: 3, unit: 'clove' }, garlic), { qty: 9, unit: 'g', guess: 'A clove taken as 3 g' });
  assert.equal(quantityFor({ kind: 'count', count: 2, unit: '' }, chicken), null);
  assert.equal(quantityFor({ kind: 'weight', grams: 10 }, bar), null);
});

test('portions: pieces stay pieces, everything else is weighed', () => {
  assert.deepEqual(portionFor([{ kind: 'count', count: 2, unit: '' }], egg, 'eggs'), { servingId: 'p-1-large', amount: 2 });
  assert.deepEqual(portionFor([{ kind: 'weight', grams: 680.3879 }], chicken), { servingId: 'g', amount: 680.388 });
  // "3 cloves + 1 tbsp" of garlic: the cloves guessed at 3 g, the spoon as water.
  assert.deepEqual(portionFor([{ kind: 'count', count: 3, unit: 'clove' }, { kind: 'volume', ml: 15 }], garlic), { servingId: 'g', amount: 24, guess: 'A clove taken as 3 g' });
  assert.deepEqual(portionFor([{ kind: 'volume', ml: 500 }], juice), { servingId: 'ml', amount: 500 });
  // No 1 g serving: counted in 100 g.
  const label: Food = { ...bar, id: 'custom:l', servings: [{ id: 's', label: '1 bar (50 g)', grams: 50, nutrients: { kcal: 200, protein: 20, carbs: 22, fat: 7 } }] };
  assert.deepEqual(portionFor([{ kind: 'weight', grams: 75 }], label), { servingId: 's', amount: 1.5 });
  assert.equal(portionFor([{ kind: 'count', count: 2, unit: '' }], chicken), null);
  assert.equal(portionFor([], chicken), null);
});

test('search queries and ranking for cooking', () => {
  assert.deepEqual(queriesFor({ key: 'dark brown sugar', name: 'Dark brown sugar' }), ['dark brown sugar', 'brown sugar', 'dark brown', 'sugar']);
  assert.deepEqual(queriesFor({ key: 'salmon fillet', name: 'Salmon fillets' }), ['salmon fillet', 'salmon']);
  assert.deepEqual(queriesFor({ key: 'garlic', name: 'Garlic' }), ['garlic']);
  assert.equal(usualFor('eggs'), 'egg whole raw');
  assert.equal(usualFor('brown sugar'), null);

  const hit = (food: Food, q: string) => ({ food, score: scoreMatch(q, food.name) });
  const white = usdaFood('10', 'Egg, white, raw, fresh', { kcal: 52, protein: 10.9, carbs: 0.7, fat: 0.2 });
  const fried = usdaFood('11', 'Egg, whole, cooked, fried', { kcal: 196, protein: 13.6, carbs: 0.8, fat: 14.8 });
  assert.equal(rankForRecipe([hit(white, 'egg'), hit(fried, 'egg'), hit(egg, 'egg')], 'egg')[0].food.id, egg.id);
  const tofuMayo = usdaFood('12', 'Mayonnaise, made with tofu', { kcal: 322, protein: 6, carbs: 3, fat: 32 });
  const mayo = usdaFood('13', 'Salad dressing, mayonnaise, regular', { kcal: 680, protein: 1, carbs: 0.6, fat: 75 });
  assert.equal(rankForRecipe([hit(tofuMayo, 'mayonnaise'), hit(mayo, 'mayonnaise')], 'mayonnaise')[0].food.id, mayo.id);
  assert.equal(rankForRecipe([hit(tofuMayo, 'tofu mayonnaise'), hit(mayo, 'mayonnaise')], 'tofu mayonnaise')[0].food.id, tofuMayo.id);
  const dry = usdaFood('14', 'Beans, black, mature seeds, raw', { kcal: 341, protein: 21.6, carbs: 62.4, fat: 1.4 });
  const canned = usdaFood('15', 'Beans, black turtle, mature seeds, canned', { kcal: 91, protein: 6, carbs: 16.6, fat: 0.3 });
  assert.equal(rankForRecipe([hit(dry, 'black bean'), hit(canned, 'black bean')], 'black bean')[0].food.id, dry.id);
  assert.equal(rankForRecipe([hit(dry, 'black bean'), hit(canned, 'black bean')], 'black bean', ['canned'])[0].food.id, canned.id);
});

/** A tiny stand-in for the library and USDA search. */
function fakeLookup(foods: Food[]): FoodLookup & { searched: string[] } {
  const searched: string[] = [];
  return {
    searched,
    search(q) {
      searched.push(q);
      return foods.map((food) => ({ food, score: scoreMatch(q, food.name) })).filter((h) => h.score > 0).sort((a, b) => b.score - a.score);
    },
    get: (id) => foods.find((f) => f.id === id) ?? null,
  };
}

test('matching a recipe’s ingredients', async () => {
  const items = [
    bom('water', amount(2, 'cup', 480, 'ml')),
    bom('salt', amount(null, '', null, ''), [], 'Salt'),
    bom('egg', amount(2, ''), [], 'Eggs'),
    bom('chicken thigh', amount(2, 'lb', 900, 'g'), [], 'Chicken thighs'),
    bom('garlic', amount(3, 'cloves')),
    bom('jasmine rice', amount(1, 'cup', 185, 'g')),
    bom('dragonfruit', amount(1, '')),
    bom('whole milk', amount(0.5, 'cup', null, '')),
  ];
  const rice = usdaFood('20', 'Rice, white, long grain, raw', { kcal: 365, protein: 7.1, carbs: 80, fat: 0.7 }, [['1 cup', 185]]);
  const lookup = fakeLookup([egg, chicken, garlic, rice, milk]);
  const lines = await matchIngredients(items, {}, lookup, { describe: (i) => `${i.usQty ?? ''} ${i.usUnit}`.trim() });
  const by = Object.fromEntries(lines.map((l) => [l.key, l])) as Record<string, MatchLine>;
  assert.equal(by.water.status, 'skipped');
  assert.equal(by.salt.status, 'skipped');
  assert.equal(by.salt.note, 'No amount, so not counted');
  assert.equal(by.egg.status, 'good');
  assert.equal(by.egg.servingId, 'p-1-large');
  assert.equal(by.egg.amount, 2);
  assert.equal(by['chicken thigh'].amount, 900);
  assert.equal(by['chicken thigh'].amountText, '2 lb');
  assert.equal(by.garlic.status, 'guessed');
  assert.equal(by.garlic.amount, 9);
  // Found by its last word only: a guess.
  assert.equal(by['jasmine rice'].food?.id, rice.id);
  assert.equal(by['jasmine rice'].status, 'guessed');
  assert.equal(by['jasmine rice'].note, 'Closest match');
  assert.equal(by.dragonfruit.status, 'none');
  assert.equal(by.dragonfruit.food, undefined);
  close(by['whole milk'].amount!, 122);
  assert.equal(by['whole milk'].status, 'good'); // by its density: ½ cup is 122 g
  // Water and amount-less salt are never searched for.
  assert.ok(!lookup.searched.includes('water'));
  assert.ok(!lookup.searched.includes('salt'));

  const { total, perServing } = recipeTotals(lines, 4);
  const expected = 143 + 900 * 1.44 + 9 * 1.43 + 365 * 1.85 + 122 * 0.61;
  close(total.kcal, Math.round(expected), 0);
  close(perServing.kcal, Math.round(expected / 4), 0);
});

test('corrections are remembered and used next time', async () => {
  const item = bom('egg', amount(3, ''), [], 'Eggs');
  // Someone said "2 eggs" were 1 jumbo-ish 60 g each: 120 × "1 g".
  const pref = prefFor(bom('egg', amount(2, '')), egg.id, 'g', 120);
  assert.deepEqual(pref, { foodId: egg.id, servingId: 'g', unit: 'each', perUnit: 60 });
  const [line] = await matchIngredients([item], { egg: pref }, fakeLookup([egg]));
  assert.equal(line.remembered, true);
  assert.equal(line.servingId, 'g');
  assert.equal(line.amount, 180);
  assert.equal(line.status, 'good');

  // The same food, but the next recipe weighs it: converted as usual.
  const [weighed] = await matchIngredients([bom('egg', amount(200, 'g'))], { egg: pref }, fakeLookup([egg]));
  assert.equal(weighed.servingId, 'g');
  assert.equal(weighed.amount, 200);

  // A remembered food that's gone: searched for again.
  const [gone] = await matchIngredients([item], { egg: { foodId: 'usda:999' } }, fakeLookup([egg]));
  assert.equal(gone.food?.id, egg.id);
  assert.equal(gone.remembered, undefined);

  // Several amounts: the food and serving only.
  assert.deepEqual(prefFor(bom('garlic', amount(3, 'cloves'), [amount(1, 'tbsp')]), garlic.id, 'g', 24), { foodId: garlic.id, servingId: 'g' });
});

test('stored corrections are cleaned', () => {
  assert.deepEqual(cleanRecipeMatches(undefined), {});
  assert.deepEqual(cleanRecipeMatches([1, 2]), {});
  assert.deepEqual(cleanRecipeMatches({
    egg: { foodId: 'usda:1', servingId: 'g', perUnit: 60, unit: 'each' },
    garlic: { foodId: 'usda:3', perUnit: -1, unit: 'clove' },
    'Bad Key!': { foodId: 'usda:1' },
    onion: { foodId: 'nope' },
    milk: { foodId: 'usda:2', servingId: '../x', perUnit: 2 },
  }), {
    egg: { foodId: 'usda:1', servingId: 'g', perUnit: 60, unit: 'each' },
    garlic: { foodId: 'usda:3' },
    milk: { foodId: 'usda:2' },
  });
});

test('recipe numbers, snapshot and servings', () => {
  assert.deepEqual(macrosNutrients({ calories: 540, protein: 42, carbs: 46, fat: 21 }), { kcal: 540, protein: 42, carbs: 46, fat: 21 });
  assert.deepEqual(macrosNutrients({ calories: 300 }), { kcal: 300, protein: 0, carbs: 0, fat: 0 });
  assert.equal(macrosNutrients({ protein: 20 }), null);
  assert.equal(macrosNutrients(undefined), null);

  assert.equal(recipeFoodId('smash-burger-tacos'), 'recipe:smash-burger-tacos');
  const snap = recipeSnapshot('Chicken burrito bowls', { kcal: 612.4, protein: 40.04, carbs: 60, fat: 20 }, 4);
  assert.deepEqual(snap, { name: 'Chicken burrito bowls · recipe', source: 'recipe', servingLabel: '1 serving (of 4)', nutrients: { kcal: 612, protein: 40, carbs: 60, fat: 20 } });
  assert.ok(recipeSnapshot('x'.repeat(200), { kcal: 1, protein: 0, carbs: 0, fat: 0 }, 1).name.length <= 120);

  assert.equal(suggestedServings(4, 4), 1);
  assert.equal(suggestedServings(2, 2), 1);
  assert.equal(suggestedServings(6, 4), 1.5);
  assert.equal(suggestedServings(2, 4), 0.5);
  assert.equal(suggestedServings(8, 1), 1); // leftovers, not one sitting
  assert.equal(suggestedServings(undefined, 2), 1);

  const plan = [{ id: 'a', day: 4 }, { id: 'b', day: null }, { id: 'c', day: 1 }, { id: 'd', day: 2 }];
  assert.deepEqual(orderPlan(plan, 2).map((e) => e.id), ['d', 'b', 'c', 'a']);
});

test('a whole recipe’s list from its steps', async () => {
  const items = extractIngredients({ sections: [{ name: 'Main', steps: ['Whisk [2 eggs] with [1/2 cup milk].', 'Add [3 cloves garlic, minced] and [2 cups water].'] }] });
  const lines = await matchIngredients(items, {}, fakeLookup([egg, milk, garlic]));
  assert.deepEqual(lines.map((l) => [l.key, l.status]), [['egg', 'good'], ['milk', 'good'], ['garlic', 'guessed'], ['water', 'skipped']]);
  // ½ cup of milk is 120 g by the recipes' own cup.
  assert.equal(lines[1].amount, 120);
});

test('plain ground beef means the usual 80/20, not the fattest kind', () => {
  assert.equal(usualFor('Ground beef'), 'beef ground 80% lean meat 20% fat raw');
  assert.equal(usualFor('lean ground beef'), null);
});
