import assert from 'node:assert/strict';
import test from 'node:test';
import { AiReplyError, buildRecipePrompt, buildWeekPrompt, parseAiReply, planRangeDates, type PlanRange } from './ai';
import { emptyKitchen, type KitchenState } from './kitchen';
import { DEFAULT_RECIPES, extractIngredients, resolveRecipes } from './recipes';

const kitchen: KitchenState = {
  ...emptyKitchen(),
  have: ['rice', 'made:tzatziki'],
  pantry: { rice: { name: 'Jasmine rice' }, 'made:tzatziki': { name: 'Tzatziki' } },
};
const options = { ask: 'High protein', servings: 4, usePantry: true, useMine: true };
const exampleOf = (prompt: string) => prompt.match(/```json\n([\s\S]+?)```/)![1];

test('the prompts ask for what you said, and tell it only what you let them', () => {
  const week = buildWeekPrompt({ ...options, meals: 5, prep: 1, weekLabel: 'Nov 2 – Nov 8' }, kitchen, DEFAULT_RECIPES);
  assert.match(week, /5 meals, 4 servings each/);
  assert.match(week, /Make 1 of them meal prep/);
  assert.match(week, /High protein/);
  assert.match(week, /Jasmine rice/);
  assert.doesNotMatch(week, /what I already have at home.*Tzatziki/i);
  assert.ok(week.includes(DEFAULT_RECIPES[0].title));

  const quiet = buildRecipePrompt({ ...options, usePantry: false, useMine: false, count: 2 }, kitchen, DEFAULT_RECIPES);
  assert.match(quiet, /Write 2 recipes/);
  assert.doesNotMatch(quiet, /Jasmine rice/);
  assert.ok(!quiet.includes(DEFAULT_RECIPES[0].title));
});

test('the example in each prompt reads back, links and plan included', () => {
  const recipes = parseAiReply(exampleOf(buildRecipePrompt({ ...options, count: 2 }, kitchen, [])), []);
  assert.deepEqual(recipes.recipes.map((r) => r.title), ['Greek beef bowls', 'Tzatziki']);
  assert.deepEqual(recipes.notes, []);
  const [bowl, sauce] = recipes.recipes;
  assert.deepEqual(bowl.sections[2].sub, { recipeId: sauce.id, servings: 4 });
  assert.equal(bowl.private, true);
  assert.deepEqual(bowl.equipment, ['Pan', 'Pot']);
  assert.equal(bowl.macros?.protein, 42);
  const full = resolveRecipes(recipes.recipes)[0];
  assert.ok(extractIngredients(full).some((i) => i.key === 'greek yogurt'));

  const week = parseAiReply(exampleOf(buildWeekPrompt({ ...options, meals: 2, prep: 1, weekLabel: 'x' }, kitchen, [])), []);
  assert.deepEqual(week.plan.map((p) => [p.title, p.day, p.servings]), [['Greek beef bowls', 0, 4], ['Tzatziki', null, 8]]);
  assert.equal(week.plan[1].recipeId, week.recipes[1].id);
});

test('a plan can use recipes you already have, without writing them again', () => {
  const mine = DEFAULT_RECIPES[1];
  const reply = parseAiReply(
    JSON.stringify({
      plan: [{ day: 'Tuesday', recipe: mine.title.toUpperCase(), servings: 2 }, { day: 'Someday', recipe: mine.title }, { day: 'Wed', recipe: 'Made up' }],
      recipes: [{ title: mine.title, parts: [{ name: 'Main', steps: ['Different.'] }] }],
    }),
    DEFAULT_RECIPES,
  );
  assert.deepEqual(reply.recipes, []);
  assert.deepEqual(reply.plan.map((p) => [p.recipeId, p.day]), [[mine.id, 1], [mine.id, null]]);
  assert.equal(reply.notes.length, 3);
});

test('a messy reply still reads: chatter, fences, trailing commas, cut off part way', () => {
  const steps = '"parts": [{ "name": "Main", "steps": ["Cook [1 egg] for [2 min]."], }],';
  const fenced = parseAiReply(`Sure! Here you go:\n\`\`\`json\n{ "recipes": [{ "title": "Eggs", ${steps} }], }\n\`\`\`\nEnjoy!`, []);
  assert.equal(fenced.recipes[0].title, 'Eggs');

  const cut = parseAiReply(`{ "recipes": [{ "title": "Eggs", ${steps} }, { "title": "Toast", "parts": [{ "name": "Main", "steps": ["Toa`, []);
  assert.deepEqual(cut.recipes.map((r) => r.title), ['Eggs']);
  assert.match(cut.notes[0], /cut off/);

  assert.equal(parseAiReply(`[{ "title": "Bare list", ${steps} }]`, []).recipes.length, 1);
  assert.equal(parseAiReply(`{ "title": "Just one", ${steps} }`, []).recipes.length, 1);
});

test('plain steps with an ingredient list get their amounts matched, like an import', () => {
  const reply = parseAiReply(
    JSON.stringify({ recipes: [{ title: 'Soup', ingredients: ['2 cups broth', '1 onion'], parts: [{ name: 'Main', steps: ['Simmer the broth with the onion for 10 minutes.'] }] }] }),
    [],
  );
  const bom = extractIngredients(reply.recipes[0]);
  assert.deepEqual(bom.map((i) => i.key).sort(), ['broth', 'onion']);
});

test('what can’t be used is said plainly, and nothing usable is an error', () => {
  const partial = parseAiReply(
    JSON.stringify({
      recipes: [
        { title: 'No steps', parts: [] },
        { title: 'Good', category: 'nonsense', timesCooked: 99, rating: 10, parts: [{ name: 'Main', steps: ['Cook [1 egg].'] }, { recipe: 'Nowhere', servings: 2 }] },
      ],
      plan: [{ day: 'Mon', recipe: 'No steps' }],
    }),
    [],
  );
  assert.deepEqual(partial.recipes.map((r) => r.title), ['Good']);
  assert.equal(partial.recipes[0].category, 'dinner');
  assert.equal(partial.recipes[0].timesCooked, 0);
  assert.equal(partial.recipes[0].rating, undefined);
  assert.deepEqual(partial.plan, []);
  assert.equal(partial.notes.length, 3);

  assert.throws(() => parseAiReply('Sorry, I can’t help with that.', []), AiReplyError);
  assert.throws(() => parseAiReply('{ "recipes": [] }', []), AiReplyError);
  assert.throws(() => parseAiReply('{ "recipes": [', []), AiReplyError);
});

test('a cut-off week reply keeps valid plan entries without bleeding across arrays', () => {
  const mine = DEFAULT_RECIPES[0];
  const cutPlanBeforeRecipes = `{
    "plan": [
      { "day": "Mon", "recipe": "Eggs", "servings": 2 },
      { "day": "Tue", "recipe": ${JSON.stringify(mine.title)}, "servings": 4 },
      { "day": "Wed", "recipe": "Toast", "servings": 2 }
    ],
    "recipes": [
      { "title": "Eggs", "parts": [{ "name": "Main", "steps": ["Cook [1 egg]."] }] },
      { "title": "Toast", "parts": [{ "name": "Main", "steps": ["Toa`;
  const parsed = parseAiReply(cutPlanBeforeRecipes, [mine]);
  assert.deepEqual(parsed.recipes.map((r) => r.title), ['Eggs']);
  assert.deepEqual(parsed.plan.map((p) => [p.title, p.day, p.servings]), [
    ['Eggs', 0, 2],
    [mine.title, 1, 4],
  ]);
  assert.ok(parsed.notes.some((n) => /cut off/i.test(n)));
  assert.ok(parsed.notes.some((n) => /Toast/.test(n)));

  const cutMidPlan = `{
    "recipes": [{ "title": "Eggs", "parts": [{ "name": "Main", "steps": ["Cook [1 egg]."] }] }],
    "plan": [
      { "day": "Fri", "recipe": "Eggs", "servings": 99 },
      { "day": "Sat", "rec`;
  const parsedMid = parseAiReply(cutMidPlan, []);
  assert.deepEqual(parsedMid.recipes.map((r) => r.title), ['Eggs']);
  assert.deepEqual(parsedMid.plan.map((p) => [p.title, p.day, p.servings]), [['Eggs', 4, 48]]);
});

test('cross-week buildWeekPrompt includes explicit dates and round-trips its example', () => {
  const range: PlanRange = { start: '2026-11-27', days: 7 };
  const slots = planRangeDates(range);
  assert.equal(slots.length, 7);
  assert.deepEqual(slots[0], { date: '2026-11-27', week: '2026-11-23', day: 4, dayName: 'Fri' });
  assert.deepEqual(slots[6], { date: '2026-12-03', week: '2026-11-30', day: 3, dayName: 'Thu' });

  const prompt = buildWeekPrompt({ ...options, meals: 5, prep: 1, weekLabel: 'Nov 27 – Dec 3', range }, kitchen, []);
  assert.match(prompt, /Plan my meals for Nov 27 – Dec 3 \(7 days\): 5 meals/);
  for (const slot of slots) {
    assert.ok(prompt.includes(`${slot.date} (${slot.dayName})`), `missing ${slot.date} (${slot.dayName})`);
  }

  const parsed = parseAiReply(exampleOf(prompt), [], 4, range);
  assert.deepEqual(
    parsed.plan.map((p) => [p.title, p.day, p.week, p.date, p.servings]),
    [
      ['Greek beef bowls', 4, '2026-11-23', '2026-11-27', 4],
      ['Tzatziki', null, '2026-11-23', undefined, 8],
    ],
  );

  // A Mon–Sun 7-day range keeps the classic prompt wording.
  const classic = buildWeekPrompt(
    { ...options, meals: 5, prep: 0, weekLabel: 'Nov 23 – Nov 29', range: { start: '2026-11-23', days: 7 } },
    kitchen,
    [],
  );
  assert.match(classic, /Plan my meals for the week of Nov 23 – Nov 29:/);
  assert.match(classic, /"day" is one of Mon, Tue, Wed, Thu, Fri, Sat, Sun/);
});

test('parseAiReply maps ISO dates and weekday names across week boundaries against range', () => {
  const range: PlanRange = { start: '2026-11-27', days: 7 };
  const r0 = DEFAULT_RECIPES[0];
  const r1 = DEFAULT_RECIPES[1];
  const reply = parseAiReply(
    JSON.stringify({
      plan: [
        { day: '2026-11-28', recipe: r0.title, servings: 2 },
        { day: '2026-12-02', recipe: r1.title, servings: 4 },
        { day: 'Fri', recipe: r0.title, servings: 3 },
        { day: 'Tue', recipe: r1.title, servings: 4 },
        { day: 'prep', recipe: r0.title, servings: 6 },
        { day: 'Someday', recipe: r1.title, servings: 2 },
      ],
    }),
    DEFAULT_RECIPES,
    4,
    range,
  );

  assert.deepEqual(
    reply.plan.map((p) => ({ title: p.title, day: p.day, week: p.week, date: p.date, servings: p.servings })),
    [
      { title: r0.title, day: 5, week: '2026-11-23', date: '2026-11-28', servings: 2 },
      { title: r1.title, day: 2, week: '2026-11-30', date: '2026-12-02', servings: 4 },
      { title: r0.title, day: 4, week: '2026-11-23', date: '2026-11-27', servings: 3 },
      { title: r1.title, day: 1, week: '2026-11-30', date: '2026-12-01', servings: 4 },
      { title: r0.title, day: null, week: '2026-11-23', date: undefined, servings: 6 },
      { title: r1.title, day: null, week: '2026-11-23', date: undefined, servings: 2 },
    ],
  );
  assert.equal(reply.notes.length, 1);
  assert.match(reply.notes[0], /meal prep/);
});
