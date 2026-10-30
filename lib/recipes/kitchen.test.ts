import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aisleFor,
  buildPrepSession,
  buildShoppingList,
  currentWeek,
  dayInfo,
  emptyKitchen,
  missingIngredients,
  haveSet,
  normalizeKitchen,
  weekLabel,
  type KitchenState,
} from './kitchen';
import { DEFAULT_RECIPES, cookOrder, formatBomAmount, normalizeRecipe, type Recipe } from './recipes';

const WEEK = '2026-10-26';
const recipe = (id: string, steps: string[], servings = 2): Recipe => ({
  ...normalizeRecipe({ title: id, servings, sections: [{ name: 'Main', steps }] }),
  id,
});

const stew = recipe('stew', ['Sear [1 lb beef] in [1 tbsp olive oil] with [1 tsp salt].', 'Add [2 cups water] and [1 cup rice].']);
const stirFry = recipe('stir-fry', ['Fry [1 lb beef] in [1 tbsp olive oil].'], 4);

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
  assert.equal(missingIngredients(stew, haveSet(kitchen)).length, 2);
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
