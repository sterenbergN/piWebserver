import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aisleFor,
  applyKitchenAction,
  buildPrepSession,
  buildShoppingList,
  currentWeek,
  dayInfo,
  emptyKitchen,
  freshToUse,
  groceriesLeft,
  missingIngredients,
  haveSet,
  mergeKitchens,
  normalizeKitchen,
  pantryChecks,
  pendingCooks,
  planEntryFor,
  recipesFor,
  restockKey,
  stockFor,
  usedIn,
  weekLabel,
  type KitchenAction,
  type KitchenState,
  type PlanEntry,
} from './kitchen';
import { DEFAULT_RECIPES, cookOrder, extractIngredients, formatBomAmount, madeKey, normalizeRecipe, type Amount, type Recipe } from './recipes';

const WEEK = '2026-10-26';
const recipe = (id: string, steps: string[], servings = 2): Recipe => ({
  ...normalizeRecipe({ title: id, servings, sections: [{ name: 'Main', steps }] }),
  id,
});

const stew = recipe('stew', ['Sear [1 lb beef] in [1 tbsp olive oil] with [1 tsp salt].', 'Add [2 cups water] and [1 cup rice].']);
const stirFry = recipe('stir-fry', ['Fry [1 lb beef] in [1 tbsp olive oil].'], 4);

const applyAll = (k: KitchenState, actions: KitchenAction[]) => actions.reduce(applyKitchenAction, k);

test('two people changing the list at once both keep what they did', () => {
  const start = applyAll(emptyKitchen(), [{ type: 'list-item', id: 'eggs', text: 'eggs' }]);
  // Each sees the same list, then their changes reach the server one after the other.
  const server = applyAll(start, [
    { type: 'got', key: 'eggs', on: true },
    { type: 'list-item', id: 'milk', text: 'milk', by: 'partner' },
    { type: 'plan-add', week: WEEK, entry: { id: 'a', recipeId: 'stew', servings: 2, day: 1 } },
  ]);
  assert.deepEqual(server.listItems.map((i) => i.text), ['eggs', 'milk']);
  assert.equal(server.listItems[1].by, 'partner');
  assert.deepEqual(server.got, ['eggs']);
  assert.equal(server.plans[WEEK].length, 1);
});

test('every kitchen change is safe to send twice', () => {
  const start = applyAll(emptyKitchen(), [
    { type: 'list-item', id: 'eggs', text: 'eggs' },
    { type: 'plan-add', week: WEEK, entry: { id: 'a', recipeId: 'stew', servings: 2, day: 1 } },
  ]);
  const actions: KitchenAction[] = [
    { type: 'have', key: 'salt', on: true },
    { type: 'got', key: 'eggs', on: true },
    { type: 'plan-add', week: WEEK, entry: { id: 'b', recipeId: 'soup', servings: 2, day: 2 } },
    { type: 'plan-change', week: WEEK, ids: ['a'], patch: { cooked: true } },
    { type: 'plan-remove', week: WEEK, id: 'gone' },
    { type: 'plan-copy', week: '2026-11-02', entries: [{ id: 'c', recipeId: 'soup', servings: 2, day: 0 }] },
    { type: 'list-recipe', recipeId: 'stew', servings: 4 },
    { type: 'list-recipe-remove', recipeId: 'gone' },
    { type: 'list-item', id: 'milk', text: 'milk' },
    { type: 'list-item-remove', id: 'gone' },
    { type: 'list-clear', items: ['gone'], recipes: [], got: [] },
    { type: 'pantry-set', key: 'rice', name: 'Rice', amount: cups(2), low: true },
    { type: 'pantry-out', key: 'salt' },
    { type: 'pantry-forget', key: 'gone' },
    { type: 'put-away', id: 'p', items: [{ key: 'milk', name: 'Milk' }], got: ['eggs'], listItems: [] },
    { type: 'cook', id: 'c', recipeId: 'stew', servings: 2, used: usedIn(stew, 2) },
    { type: 'cook-undo', id: 'gone' },
  ];
  for (const action of actions) {
    const once = applyKitchenAction(start, action);
    assert.deepEqual(applyKitchenAction(once, action), once, action.type);
  }
});

test('starting over leaves what someone added since you last looked', () => {
  const seen = applyAll(emptyKitchen(), [{ type: 'list-item', id: 'eggs', text: 'eggs' }, { type: 'got', key: 'eggs', on: true }]);
  const clear: KitchenAction = { type: 'list-clear', items: ['eggs'], recipes: [], got: ['eggs'] };
  const server = applyAll(seen, [{ type: 'list-item', id: 'milk', text: 'milk' }, clear]);
  assert.deepEqual(server.listItems.map((i) => i.text), ['milk']);
  assert.deepEqual(server.got, []);
});

test('a change that makes no sense changes nothing', () => {
  const start = applyAll(emptyKitchen(), [{ type: 'list-item', id: 'eggs', text: 'eggs' }]);
  const nonsense = [
    null,
    { type: 'nope' },
    { type: 'plan-add', week: '../../etc', entry: { id: 'x', recipeId: 'x', servings: 1, day: 0 } },
    { type: 'list-item', id: 'x', text: 42 },
  ] as unknown as KitchenAction[];
  for (const action of nonsense) assert.deepEqual(applyKitchenAction(start, action), start);
  // Junk that gets through is cleaned before it's stored.
  const dirty = applyKitchenAction(start, { type: 'plan-add', week: WEEK, entry: null } as unknown as KitchenAction);
  assert.deepEqual(normalizeKitchen(dirty).plans, {});
  assert.doesNotThrow(() => applyKitchenAction(start, { type: 'plan-change', week: WEEK, ids: 5, patch: null } as unknown as KitchenAction));
});

test('moving in together keeps both kitchens without doubling up', () => {
  const mine: KitchenState = {
    ...emptyKitchen(),
    have: ['salt'],
    plans: { [WEEK]: [{ id: 'a', recipeId: 'stew', servings: 2, day: 0 }] },
    listRecipes: [{ recipeId: 'stew', servings: 2 }],
    listItems: [{ id: '1', text: 'Milk' }],
  };
  const theirs: KitchenState = {
    ...emptyKitchen(),
    have: ['salt', 'rice'],
    plans: { [WEEK]: [{ id: 'b', recipeId: 'stew', servings: 4, day: 0 }, { id: 'c', recipeId: 'soup', servings: 2, day: 3 }] },
    listRecipes: [{ recipeId: 'stew', servings: 8 }, { recipeId: 'soup', servings: 2 }],
    listItems: [{ id: '2', text: 'milk' }, { id: '3', text: 'eggs' }],
    got: ['3'],
  };
  const both = mergeKitchens(mine, theirs);
  assert.deepEqual(both.have, ['salt', 'rice']);
  assert.deepEqual(both.plans[WEEK].map((e) => e.id), ['a', 'c']);
  assert.deepEqual(both.listRecipes, [{ recipeId: 'stew', servings: 2 }, { recipeId: 'soup', servings: 2 }]);
  assert.deepEqual(both.listItems.map((i) => i.text), ['Milk', 'eggs']);
  assert.deepEqual(both.got, ['3']);
});

test('who added an item survives being stored', () => {
  const stored = normalizeKitchen({ listItems: [{ id: '1', text: 'milk', by: 'partner' }, { id: '2', text: 'eggs' }] });
  assert.deepEqual(stored.listItems, [{ id: '1', text: 'milk', by: 'partner' }, { id: '2', text: 'eggs' }]);
});

test('the shopping list merges the plan at each entry’s servings', () => {
  const kitchen: KitchenState = {
    ...emptyKitchen(),
    plans: {
      [WEEK]: [
        { id: 'a', recipeId: 'stew', servings: 4, day: 0 }, // double
        { id: 'b', recipeId: 'stir-fry', servings: 4, day: null }, // as written
      ],
    },
  };
  const list = buildShoppingList([stew, stirFry], kitchen, WEEK);
  const beef = list.need.find((i) => i.key === 'beef');
  assert.ok(beef);
  assert.equal(formatBomAmount(beef, 1, 'us'), '3 lb');
  assert.deepEqual(beef.sources, ['stew', 'stir-fry']);
  assert.equal(list.recipeCount, 2);
});

test('what you already have stays off the list, and water never appears', () => {
  const kitchen: KitchenState = {
    ...emptyKitchen(),
    have: ['salt', 'olive oil'],
    listRecipes: [{ recipeId: 'stew', servings: 2 }],
  };
  const list = buildShoppingList([stew], kitchen, WEEK);
  assert.deepEqual(list.need.map((i) => i.key).sort(), ['beef', 'rice']);
  assert.deepEqual(list.have.map((i) => i.key).sort(), ['olive oil', 'salt']);
  assert.equal(missingIngredients(stew, kitchen).length, 2);
});

const cups = (usQty: number): Amount => ({ usQty, usUnit: 'cup', metricQty: usQty * 185, metricUnit: 'g' });
const cookStew: KitchenAction = { type: 'cook', id: 'c1', recipeId: 'stew', servings: 2, used: usedIn(stew, 2) };

test('marking something on a recipe keeps it until you say it ran out, however much you cook', () => {
  let k = applyAll(emptyKitchen(), [{ type: 'have', key: 'rice', on: true, name: 'Rice' }, cookStew]);
  assert.ok(haveSet(k).has('rice'));
  assert.equal(stockFor(extractIngredients(stew).find((i) => i.key === 'rice')!, k).status, 'have');

  k = applyKitchenAction(k, { type: 'pantry-out', key: 'rice' });
  assert.ok(!haveSet(k).has('rice'));
  assert.deepEqual(buildShoppingList([], k, WEEK).restock, [{ key: 'rice', name: 'Rice', low: false }]);
  assert.equal(groceriesLeft([], k, WEEK), 1);

  // Bought again: back on the shelf and off the list.
  k = applyKitchenAction(k, { type: 'put-away', id: 'p1', items: [{ key: 'rice', name: 'Rice' }], got: [restockKey('rice')], listItems: [] });
  assert.ok(haveSet(k).has('rice'));
  assert.deepEqual(buildShoppingList([], k, WEEK).restock, []);
});

test('with an amount, the list only asks for the difference', () => {
  const k = applyAll(emptyKitchen(), [{ type: 'pantry-set', key: 'rice', name: 'Rice', amount: cups(0.25) }, { type: 'list-recipe', recipeId: 'stew', servings: 2 }]);
  const rice = buildShoppingList([stew], k, WEEK).need.find((i) => i.key === 'rice');
  assert.equal(rice?.usQty, 0.75);
  assert.deepEqual(rice?.inStock, cups(0.25));
  // Enough, and it's off the list. Grams on the shelf count against cups in the recipe.
  const plenty = applyKitchenAction(k, { type: 'pantry-set', key: 'rice', amount: { usQty: 1, usUnit: 'lb', metricQty: 453, metricUnit: 'g' } });
  assert.equal(buildShoppingList([stew], plenty, WEEK).need.find((i) => i.key === 'rice'), undefined);
  // An amount that can't be compared isn't a reason to buy more.
  const bag = applyKitchenAction(k, { type: 'pantry-set', key: 'rice', amount: { usQty: 1, usUnit: 'bag', metricQty: 1, metricUnit: 'bag' } });
  assert.equal(buildShoppingList([stew], bag, WEEK).need.find((i) => i.key === 'rice'), undefined);
});

test('cooking counts amounts down, once, and can be taken back', () => {
  const start = applyKitchenAction(emptyKitchen(), { type: 'pantry-set', key: 'rice', name: 'Rice', amount: cups(3) });
  const cooked = applyKitchenAction(start, cookStew);
  assert.equal(cooked.pantry.rice.amount?.usQty, 2);
  assert.equal(cooked.pantry.rice.estimated, true);
  assert.deepEqual(applyKitchenAction(cooked, cookStew), cooked);
  const undone = applyKitchenAction(cooked, { type: 'cook-undo', id: 'c1' });
  assert.equal(undone.pantry.rice.amount?.usQty, 3);
  assert.deepEqual(undone.log, []);
});

test('counted down to nothing, it stops counting as there and gets asked about', () => {
  const k = applyAll(emptyKitchen(), [{ type: 'pantry-set', key: 'rice', name: 'Rice', amount: cups(1) }, cookStew]);
  assert.ok(k.have.includes('rice'));
  assert.equal(stockFor(extractIngredients(stew).find((i) => i.key === 'rice')!, k).status, 'missing');
  assert.deepEqual(pantryChecks(k).map((c) => [c.key, c.reason]), [['rice', 'used-up']]);
  // "Yes, still got some": there's some, and nobody's saying how much any more.
  const confirmed = applyKitchenAction(k, { type: 'pantry-set', key: 'rice', low: false });
  assert.equal(confirmed.pantry.rice.amount, undefined);
  assert.deepEqual(pantryChecks(confirmed), []);
});

test('a tick on the plan takes things off the shelf and shows up as cooked', () => {
  const entry: PlanEntry = { id: 'a', recipeId: 'stew', servings: 2, day: 1 };
  const k = applyAll(emptyKitchen(), [{ type: 'plan-add', week: WEEK, entry }, { type: 'pantry-set', key: 'rice', name: 'Rice', amount: cups(3) }]);
  const cooked = applyKitchenAction(k, { type: 'cook', id: 'plan:a', recipeId: 'stew', servings: 2, used: usedIn(stew, 2), entry: { week: WEEK, id: 'a' } });
  assert.equal(cooked.plans[WEEK][0].cooked, true);
  assert.equal(cooked.pantry.rice.amount?.usQty, 2);
  const undone = applyKitchenAction(cooked, { type: 'cook-undo', id: 'plan:a' });
  assert.equal(undone.plans[WEEK][0].cooked, false);
  assert.equal(undone.pantry.rice.amount?.usQty, 3);
});

test('meals nobody ticked get asked about, for a few days', () => {
  const entries: PlanEntry[] = [
    { id: 'tue', recipeId: 'stew', servings: 2, day: 1 },
    { id: 'today', recipeId: 'stew', servings: 2, day: 3 },
    { id: 'prep', recipeId: 'stew', servings: 2, day: null },
    { id: 'done', recipeId: 'stew', servings: 2, day: 0, cooked: true },
  ];
  const k: KitchenState = { ...emptyKitchen(), plans: { [WEEK]: entries } };
  assert.deepEqual(pendingCooks([stew], k, '2026-10-29').map((p) => p.entry.id), ['tue']);
  assert.deepEqual(pendingCooks([stew], k, '2026-11-20'), []);
  assert.equal(planEntryFor(k, 'stew', '2026-10-29')?.entry.id, 'today');
});

test('fresh things come up as they age, and shelf things only after months', () => {
  const k = normalizeKitchen(
    {
      have: ['cilantro', 'chicken', 'olive oil', 'made:stew'],
      pantry: {
        cilantro: { name: 'Cilantro', since: '2026-10-25', checked: '2026-10-25' },
        chicken: { name: 'Chicken', since: '2026-10-20', checked: '2026-10-20' },
        'olive oil': { name: 'Olive oil', since: '2026-10-01', checked: '2026-10-01' },
        'made:stew': { name: 'Stew', since: '2026-10-20', checked: '2026-10-20' },
      },
    },
    '2026-10-29',
  );
  const checks = pantryChecks(k, '2026-10-29');
  assert.deepEqual(checks.map((c) => c.key).sort(), ['chicken', 'made:stew']);
  assert.deepEqual(freshToUse([], k, '2026-10-29').map((i) => i.key), ['cilantro']);
});

test('putting shopping away counts meat, not a bottle of oil, and can’t happen twice', () => {
  const action: KitchenAction = {
    type: 'put-away',
    id: 'p',
    items: [
      { key: 'chicken thigh', name: 'Chicken thighs', amount: { usQty: 2, usUnit: 'lb', metricQty: 900, metricUnit: 'g' } },
      { key: 'olive oil', name: 'Olive oil', amount: { usQty: 1, usUnit: 'tbsp', metricQty: 15, metricUnit: 'ml' } },
      { key: 'paper towel', name: 'Paper towels' },
    ],
    got: [`${WEEK}|olive oil`],
    listItems: ['typed'],
  };
  const start = applyAll(emptyKitchen(), [{ type: 'list-item', id: 'typed', text: 'Paper towels' }, { type: 'got', key: 'typed', on: true }, { type: 'got', key: `${WEEK}|olive oil`, on: true }]);
  const k = applyKitchenAction(start, action);
  assert.equal(k.pantry['chicken thigh'].amount?.usQty, 2);
  assert.equal(k.pantry['olive oil'].amount, undefined);
  assert.deepEqual(k.listItems, []);
  assert.deepEqual(k.got, []);
  assert.deepEqual(applyKitchenAction(k, action), k);
});

test('a batch already made skips that part everywhere, and its ingredients with it', () => {
  const sauce = recipe('sauce', ['Stir [1 cup yogurt] with [1 cucumber].']);
  const bowl: Recipe = { ...recipe('bowl', ['Cook [1 lb beef].'], 4), sections: [{ name: 'Beef', steps: ['Cook [1 lb beef].'] }, { name: '', steps: [], sub: { recipeId: 'sauce', servings: 4 } }] };
  const k: KitchenState = { ...emptyKitchen(), listRecipes: [{ recipeId: 'bowl', servings: 4 }] };
  assert.deepEqual(buildShoppingList([sauce, bowl], k, WEEK).need.map((i) => i.key).sort(), ['beef', 'cucumber', 'yogurt']);
  const made = applyKitchenAction(k, { type: 'pantry-set', key: madeKey('sauce'), name: 'Sauce' });
  assert.deepEqual(buildShoppingList([sauce, bowl], made, WEEK).need.map((i) => i.key), ['beef']);
  assert.equal(recipesFor([sauce, bowl], made)[1].sections[1].from?.made, true);
});

test('pantry details survive being stored, and old lists of what you have move in', () => {
  const old = normalizeKitchen({ have: ['salt'] }, '2026-10-29');
  assert.deepEqual(old.pantry, { salt: { name: 'Salt', since: '2026-10-29' } });
  const k = applyAll(old, [{ type: 'pantry-set', key: 'rice', name: 'Rice', amount: cups(2), low: true }, { type: 'pantry-out', key: 'salt' }, cookStew]);
  const stored = normalizeKitchen(JSON.parse(JSON.stringify(k)));
  assert.deepEqual(stored.pantry, k.pantry);
  assert.deepEqual(stored.log, k.log);
  const junk = normalizeKitchen({ have: ['rice'], pantry: { rice: { amount: { usQty: 'lots' }, low: 'yes' }, gone: { name: 'Not here' } }, log: [{ id: 5 }] }, '2026-10-29');
  assert.deepEqual(junk.pantry, { rice: { name: 'Rice' } });
  assert.deepEqual(junk.log, []);
});

test('cooked meals no longer count, and deleted recipes are ignored', () => {
  const kitchen: KitchenState = {
    ...emptyKitchen(),
    plans: {
      [WEEK]: [
        { id: 'a', recipeId: 'stew', servings: 2, day: 0, cooked: true },
        { id: 'b', recipeId: 'gone', servings: 2, day: 1 },
      ],
    },
  };
  assert.equal(buildShoppingList([stew], kitchen, WEEK).need.length, 0);
});

test('aisles keep look-alikes apart', () => {
  assert.equal(aisleFor('Peanut butter'), 'Oils & sauces');
  assert.equal(aisleFor('Unsalted butter'), 'Dairy & eggs');
  assert.equal(aisleFor('Garlic powder'), 'Spices');
  assert.equal(aisleFor('Garlic'), 'Produce');
  assert.equal(aisleFor('Black pepper'), 'Spices');
  assert.equal(aisleFor('Bell pepper'), 'Produce');
  assert.equal(aisleFor('Chicken broth'), 'Canned & dry goods');
  assert.equal(aisleFor('Bone-in skin-on chicken thighs'), 'Meat & seafood');
  assert.equal(aisleFor('Small flour tortillas'), 'Bread & grains');
  assert.equal(aisleFor('All-purpose flour'), 'Baking');
  assert.equal(aisleFor('Frozen peas'), 'Frozen');
  assert.equal(aisleFor('Mystery item'), 'Other');
});

test('normalizeKitchen cleans bad input and drops very old weeks', () => {
  const clean = normalizeKitchen(
    {
      have: ['salt', 'salt', '', 7],
      plans: {
        '2026-10-26': [{ recipeId: 'stew', servings: 500, day: 9 }, { servings: 2 }],
        '2020-01-06': [{ recipeId: 'stew', servings: 2, day: 0 }],
        nonsense: [{ recipeId: 'stew' }],
      },
      listRecipes: 'nope',
      listItems: [{ text: ' paper towels ' }, { text: '' }],
    },
    '2026-10-29',
  );
  assert.deepEqual(clean.have, ['salt']);
  assert.deepEqual(Object.keys(clean.plans), ['2026-10-26']);
  const [entry] = clean.plans['2026-10-26'];
  assert.equal(entry.servings, 48);
  assert.equal(entry.day, null);
  assert.equal(clean.plans['2026-10-26'].length, 1);
  assert.deepEqual(clean.listRecipes, []);
  assert.equal(clean.listItems[0].text, 'paper towels');
  assert.deepEqual(normalizeKitchen(null), emptyKitchen());
});

test('weeks start on Monday', () => {
  assert.equal(currentWeek('2026-10-29'), WEEK);
  assert.equal(weekLabel(WEEK), 'Oct 26 – Nov 1');
  assert.deepEqual(dayInfo(WEEK, 3, '2026-10-29'), { name: 'Thu', date: 29, isToday: true, isPast: false });
});

test('a prep session merges recipes into one cook order, each at its own scale', () => {
  const [chicken, tacos] = DEFAULT_RECIPES;
  const session = buildPrepSession(
    [
      { id: 'a', recipeId: chicken.id, servings: 8, day: null },
      { id: 'b', recipeId: tacos.id, servings: 4, day: null },
    ],
    DEFAULT_RECIPES,
    WEEK,
  );
  assert.equal(session.recipeCount, 2);
  assert.equal(session.recipe.sections.length, chicken.sections.length + tacos.sections.length);
  assert.equal(session.sectionScales[0], 2);
  assert.equal(session.sectionScales[chicken.sections.length], 1);
  // The glaze's "ready for" link still points at the chicken; the tacos' moved along with them.
  assert.equal(session.recipe.sections[2].readyBy, '1:2');
  assert.equal(session.recipe.sections[chicken.sections.length].readyBy, `${chicken.sections.length + 1}:0`);
  assert.equal(cookOrder(session.schedule).length, 7 + 5);
});
