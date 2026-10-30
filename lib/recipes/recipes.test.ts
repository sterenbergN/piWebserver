import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RECIPES,
  buildSchedule,
  canonicalIngredientKey,
  cookOrder,
  extractIngredients,
  formatBomAmount,
  formatIngredientAmount,
  formatQuantity,
  formatTemp,
  isRecipePhotoSrc,
  normalizeRecipe,
  normalizeRecipesData,
  parseQuantity,
  parseStepTokens,
  smartAnnotateText,
  stepPlainText,
} from './recipes';

test('parseQuantity handles integers, decimals, fractions, and mixed numbers', () => {
  assert.equal(parseQuantity('2'), 2);
  assert.equal(parseQuantity('1.5'), 1.5);
  assert.equal(parseQuantity('1/2'), 0.5);
  assert.equal(parseQuantity('1 1/2'), 1.5);
  assert.equal(parseQuantity('¾'), 0.75);
  assert.equal(parseQuantity('2½'), 2.5);
  const mixed = parseStepTokens('[1½ cups sugar] [1 ½ cups rice]');
  assert.deepEqual(mixed.flatMap((t) => (t.kind === 'ingredient' ? [[t.usQty, t.usUnit, t.name]] : [])), [[1.5, 'cup', 'sugar'], [1.5, 'cup', 'rice']]);
  assert.equal(parseQuantity('invalid'), null);
});

test('formatQuantity formats kitchen fractions for US and clean decimals for metric', () => {
  assert.equal(formatQuantity(0.5, false), '½');
  assert.equal(formatQuantity(1.25, false), '1 ¼');
  assert.equal(formatQuantity(2, false), '2');
  assert.equal(formatQuantity(124.6, true), '125');
  assert.equal(formatQuantity(4.25, true), '4.3');
});

test('canonicalIngredientKey normalizes plurals and casing', () => {
  assert.equal(canonicalIngredientKey('Garlic Cloves'), 'garlic clove');
  assert.equal(canonicalIngredientKey('garlic clove'), 'garlic clove');
  assert.equal(canonicalIngredientKey('roma tomatoes'), 'roma tomato');
  assert.equal(canonicalIngredientKey('berries'), 'berry');
});

test('parseStepTokens extracts ingredients, active timers, passive timers, and temperatures', () => {
  const tokens = parseStepTokens(
    'Sear [1.5 lb | 680 g chicken thighs] at [400°F] for [6 min], then rest [10 min passive].',
  );
  const ing = tokens.find((t) => t.kind === 'ingredient');
  const temp = tokens.find((t) => t.kind === 'temp');
  const timers = tokens.filter((t) => t.kind === 'timer');

  assert.ok(ing && ing.kind === 'ingredient');
  assert.equal(ing.usQty, 1.5);
  assert.equal(ing.usUnit, 'lb');
  assert.equal(ing.metricQty, 680);
  assert.equal(ing.metricUnit, 'g');
  assert.equal(ing.name, 'chicken thighs');

  assert.ok(temp && temp.kind === 'temp');
  assert.equal(temp.fahrenheit, 400);
  assert.equal(temp.celsius, 204);
  assert.equal(formatTemp(temp, 'us'), '400°F');
  assert.equal(formatTemp(temp, 'metric'), '204°C');

  assert.equal(timers.length, 2);
  assert.equal(timers[0].kind === 'timer' && timers[0].minutes, 6);
  assert.equal(timers[0].kind === 'timer' && timers[0].passive, false);
  assert.equal(timers[1].kind === 'timer' && timers[1].minutes, 10);
  assert.equal(timers[1].kind === 'timer' && timers[1].passive, true);
});

test('formatIngredientAmount supports US, metric, and both modes with scaling', () => {
  const tokens = parseStepTokens('Add [1/2 cup | 60 g all-purpose flour]');
  const ing = tokens.find((t) => t.kind === 'ingredient');
  assert.ok(ing && ing.kind === 'ingredient');

  assert.equal(formatIngredientAmount(ing, 1, 'us'), '½ cup');
  assert.equal(formatIngredientAmount(ing, 1, 'metric'), '60 g');
  assert.equal(formatIngredientAmount(ing, 2, 'both'), '1 cup (120 g)');
});

test('extractIngredients sums repeated ingredients across steps and tracks stepKeys', () => {
  const sections = [
    {
      name: 'Sauce',
      steps: [
        'Sauté [2 cloves garlic, minced] in [1 tbsp butter] for [1 min].',
        'Add [2 cloves garlic] and [1 tbsp butter] at the end.',
      ],
    },
  ];
  const bom = extractIngredients({ sections });
  const butter = bom.find((i) => i.key === 'butter');
  const garlic = bom.find((i) => i.key === 'garlic');

  assert.ok(butter);
  assert.equal(butter.usQty, 2);
  assert.equal(butter.usUnit, 'tbsp');
  assert.deepEqual(butter.stepKeys, ['0:0', '0:1']);

  assert.ok(garlic);
  assert.equal(garlic.usQty, 4);
  assert.deepEqual(garlic.stepKeys, ['0:0', '0:1']);
});

test('buildSchedule back-schedules parallel sub-assemblies so they finish together', () => {
  const sections = [
    {
      name: 'Rice',
      steps: ['Boil [2 min] then simmer [15 min passive] and rest [10 min passive].'],
    },
    {
      name: 'Chicken',
      steps: ['Sear [12 min].'],
    },
  ];
  const schedule = buildSchedule({ sections });
  assert.equal(schedule.totalMinutes, 27);
  assert.equal(schedule.tracks.length, 2);
  // Rice takes 27m so starts at T+0m
  assert.equal(schedule.tracks[0].startOffsetMin, 0);
  // Chicken takes 12m so starts at T+15m (27 - 12)
  assert.equal(schedule.tracks[1].startOffsetMin, 15);
});

test('smartAnnotateText wraps durations, temperatures, and quantities in brackets', () => {
  const annotated = smartAnnotateText('Bake 2 cups flour at 375°F for 15 minutes then rest 10 min.');
  assert.ok(annotated.includes('[375°F]'));
  assert.ok(annotated.includes('[15 min]'));
  assert.ok(annotated.includes('[10 min passive]'));
  assert.ok(annotated.includes('[2 cups flour]'));
});

test('normalizeRecipe validates and fills defaults', () => {
  const norm = normalizeRecipe({
    title: 'Quick Eggs',
    sections: [{ name: 'Main', steps: ['Cook [2 eggs] in [1 tbsp butter] for [3 min].'] }],
  });
  assert.ok(norm);
  assert.equal(norm.title, 'Quick Eggs');
  assert.equal(norm.sections.length, 1);
  assert.equal(norm.servings, 4);
});

test('a lowercase c or f without a degree sign is a unit, not a temperature', () => {
  assert.equal(parseStepTokens('[2 c]')[0].kind, 'ingredient');
  assert.equal(parseStepTokens('[400 F]')[0].kind, 'temp');
  assert.equal(parseStepTokens('[200°c]')[0].kind, 'temp');
});

test('extractIngredients keeps amounts it cannot add instead of dropping them', () => {
  const bom = extractIngredients({ sections: [{ name: 'x', steps: ['[3 cloves garlic]', '[1 tbsp garlic, minced]', '[2 cloves garlic]'] }] });
  const garlic = bom.find((i) => i.key === 'garlic');
  assert.ok(garlic);
  assert.equal(garlic.usQty, 5);
  assert.equal(garlic.extras.length, 1);
  assert.equal(formatBomAmount(garlic, 1, 'us'), '5 cloves + 1 tbsp');
});

test('extractIngredients adds g and kg (and ml and L) so US and metric agree', () => {
  const [flour] = extractIngredients({ sections: [{ name: 'x', steps: ['[500 g flour]', '[1 kg flour]'] }] });
  assert.equal(flour.metricQty, 1.5);
  assert.equal(flour.metricUnit, 'kg');
  assert.ok(Math.abs(flour.usQty! - 3.307) < 0.01);
  assert.equal(flour.usUnit, 'lb');
  assert.deepEqual(flour.extras, []);

  const [stock] = extractIngredients({ sections: [{ name: 'x', steps: ['[250 ml stock]', '[300 ml stock]'] }] });
  assert.equal(formatBomAmount(stock, 1, 'metric'), '550 ml');
});

test('buildSchedule finishes a readyBy section as the step that needs it starts', () => {
  const recipe = DEFAULT_RECIPES[0]; // glaze is ready for the chicken's last step
  const schedule = buildSchedule(recipe);
  const chicken = schedule.tracks[1];
  const glaze = schedule.tracks[2];
  const glazeEnd = glaze.blocks[glaze.blocks.length - 1].endMin;
  assert.equal(glazeEnd, chicken.blocks[2].startMin);
  assert.equal(schedule.totalMinutes, 25); // the manual prep + cook time; tracks span 22
});

test('buildSchedule starts later sections after a long feeder instead of before T+0', () => {
  const schedule = buildSchedule({
    sections: [
      { name: 'Marinade', steps: ['Marinate [60 min passive].'], readyBy: '1:0' },
      { name: 'Grill', steps: ['Grill [20 min].'] },
    ],
  });
  assert.equal(schedule.tracks[0].startOffsetMin, 0);
  assert.equal(schedule.tracks[1].startOffsetMin, 60);
  assert.equal(schedule.totalMinutes, 80);
});

test('buildSchedule splits a step with active and passive timers', () => {
  const schedule = buildSchedule({ sections: [{ name: 'x', steps: ['Melt [5 min], then cool [10 min passive].'] }] });
  assert.equal(schedule.activeMinutes, 5);
  assert.equal(schedule.passiveMinutes, 10);
});

test('smartAnnotateText stops an ingredient at linking words and handles unicode fractions', () => {
  assert.equal(smartAnnotateText('Whisk in 1 cup milk until smooth.'), 'Whisk in [1 cup milk] until smooth.');
  assert.equal(smartAnnotateText('Add ½ cup flour and stir.'), 'Add [½ cup flour] and stir.');
  assert.equal(smartAnnotateText('Add 1½ cups sugar.'), 'Add [1½ cups sugar].');
});

test('normalizeRecipe maps readyBy onto kept steps and drops it when its step is gone', () => {
  const recipe = normalizeRecipe({
    title: 'Two parts',
    sections: [
      { name: 'Empty', steps: ['  '] },
      { name: 'Sauce', steps: ['Whisk [1 tbsp soy sauce].'], readyBy: '2:2' },
      { name: 'Main', steps: ['', 'Sear [5 min].', 'Glaze [2 min].'] },
      { name: 'Side', steps: ['Toss [1 cup rice].'], readyBy: '2:0' },
    ],
  });
  assert.equal(recipe.sections.length, 3);
  assert.equal(recipe.sections[0].readyBy, '1:1');
  assert.equal(recipe.sections[2].readyBy, undefined);
});

test('normalizeRecipe only keeps uploaded photos, clears a null rating, and keeps the owner', () => {
  const base = { title: 'T', sections: [{ name: 'Main', steps: ['Cook [3 min].'] }] };
  const existing = normalizeRecipe({ ...base, rating: 8 });
  existing.ownerId = 'user-1';
  assert.equal(normalizeRecipe({ ...base, photo: 'https://example.com/x.jpg' }).photo, undefined);
  assert.equal(normalizeRecipe({ ...base, photo: '/api/media/uploads/recipes/../../secret.webp' }).photo, undefined);
  const photo = '/api/media/uploads/recipes/mabc123-0123456789ab.webp';
  assert.ok(isRecipePhotoSrc(photo));
  assert.equal(normalizeRecipe({ ...base, photo }).photo, photo);

  const cleared = normalizeRecipe({ ...base, rating: null, ownerId: 'someone-else' }, existing);
  assert.equal(cleared.rating, undefined);
  assert.equal(cleared.ownerId, 'user-1');
  assert.equal(normalizeRecipe(base, existing).rating, 8);
  assert.equal(normalizeRecipesData({ recipes: [existing] }).recipes[0].ownerId, 'user-1');
});

test('cookOrder merges parallel parts by start time and keeps each part in order', () => {
  const order = cookOrder(buildSchedule(DEFAULT_RECIPES[0]));
  assert.equal(order.length, 7);
  assert.equal(order[0].sectionName, 'Jasmine Rice');
  // The glaze (ready for the chicken's last step) comes before that step.
  const glaze = order.findIndex((b) => b.sectionName === 'Honey-Garlic Glaze');
  const pourGlaze = order.findIndex((b) => b.stepKey === '1:2');
  assert.ok(glaze < pourGlaze);
  for (const part of [0, 1]) {
    const steps = order.filter((b) => b.sectionIndex === part).map((b) => b.stepIndex);
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
  }
});

test('amounts use the right form of the unit for the scaled quantity', () => {
  const amount = (step: string, scale = 1) => {
    const ing = parseStepTokens(step)[0];
    assert.ok(ing.kind === 'ingredient');
    return formatIngredientAmount(ing, scale, 'us');
  };
  assert.equal(amount('[1/2 cup flour]'), '½ cup');
  assert.equal(amount('[1 cup flour]'), '1 cup');
  assert.equal(amount('[1 cup flour]', 2.25), '2 ¼ cups');
  assert.equal(amount('[2 cloves garlic]', 0.5), '1 clove');
  assert.equal(amount('[1 clove garlic]'), '1 clove');
  assert.equal(amount('[3 tbsp butter]'), '3 tbsp');
  assert.equal(amount('[2 eggs]'), '2');
});

test('stepPlainText reads as a sentence, with amounts left out', () => {
  assert.equal(
    stepPlainText('Melt [1 cup | 227 g butter] at [350°F] for [5 min], then rest [10 min passive].'),
    'Melt butter at 350°F for 5 min, then rest 10 min.',
  );
});

test('smartAnnotateText reads more ways of writing times and temperatures', () => {
  assert.equal(smartAnnotateText('Bake at 350 degrees F for 20 to 25 minutes.'), 'Bake at [350°F] for [20-25 min].');
  assert.equal(smartAnnotateText('Preheat to 350°F (175°C).'), 'Preheat to [350°F].');
  assert.equal(smartAnnotateText('Tilt it 45 degrees.'), 'Tilt it 45 degrees.');
  assert.equal(smartAnnotateText('Refrigerate for 2 hours.'), 'Refrigerate for [2 hr passive].');
  assert.equal(smartAnnotateText('Add 2 tbsp butter.', { quantities: false }), 'Add 2 tbsp butter.');
});

test('normalizeRecipe keeps a web source and the private flag', () => {
  const base = { title: 'T', sections: [{ name: 'Main', steps: ['Cook [3 min].'] }] };
  const imported = normalizeRecipe({ ...base, sourceUrl: 'https://example.com/a', private: true });
  assert.equal(imported.sourceUrl, 'https://example.com/a');
  assert.equal(imported.private, true);
  assert.equal(normalizeRecipe({ ...base, sourceUrl: 'javascript:alert(1)' }).sourceUrl, undefined);
  assert.equal(normalizeRecipe(base, imported).private, true);
  assert.equal(normalizeRecipe({ ...base, private: false }, imported).private, undefined);
});
