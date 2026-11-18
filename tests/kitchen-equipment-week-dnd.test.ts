import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_EDIT_PRESETS,
  AiReplyError,
  buildEditRecipePrompt,
  buildRecipePrompt,
  buildWeekPrompt,
  parseAiEditReply,
} from '@/lib/recipes/ai';
import {
  BASIC_KITCHEN_EQUIPMENT,
  COMMON_KITCHEN_EQUIPMENT,
  applyKitchenAction,
  emptyKitchen,
  mergeKitchens,
  missingEquipment,
  normalizeKitchen,
  type KitchenAction,
  type KitchenState,
} from '@/lib/recipes/kitchen';
import { DEFAULT_RECIPES, normalizeRecipe, type Recipe } from '@/lib/recipes/recipes';

const WEEK = '2026-11-16';

const makeRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  ...normalizeRecipe({
    title: 'Garlic Butter Salmon',
    summary: 'Quick seared salmon.',
    category: 'dinner',
    servings: 4,
    equipment: ['Cast Iron', 'Oven'],
    tags: ['Weeknight'],
    sections: [
      {
        name: 'Main',
        steps: [
          'Season [1.5 lb | 680 g salmon] with [1 tsp | 6 g kosher salt] and sear in [1 tbsp | 15 ml olive oil] for [4 min].',
          'Transfer to oven at [400°F] and roast for [6 min passive].',
        ],
      },
    ],
  }),
  ...overrides,
});

test('emptyKitchen initializes equipment as an empty array and normalizeKitchen canonicalizes, deduplicates, and caps at 100', () => {
  const empty = emptyKitchen();
  assert.deepEqual(empty.equipment, []);

  const normalized = normalizeKitchen({
    equipment: ['  skillet ', 'Pan', 'frying pan', 'Crock Pot', '  cast iron  ', '', 42, 'Sous vide', 'sous vide'],
  });
  // 'skillet', 'Pan', 'frying pan' all canonicalize to 'Pan'; 'Crock Pot' -> 'Slow cooker'; 'cast iron' -> 'Cast iron'
  assert.deepEqual(normalized.equipment, ['Pan', 'Slow cooker', 'Cast iron', 'Sous vide']);

  const many = Array.from({ length: 120 }, (_, i) => `Custom Tool ${i + 1}`);
  const capped = normalizeKitchen({ equipment: many });
  assert.equal(capped.equipment.length, 100);
  assert.equal(capped.equipment[0], 'Custom Tool 1');
  assert.equal(capped.equipment[99], 'Custom Tool 100');

  assert.equal(new Set(COMMON_KITCHEN_EQUIPMENT).size, COMMON_KITCHEN_EQUIPMENT.length);
  assert.ok(COMMON_KITCHEN_EQUIPMENT.includes('Rice cooker'));
  assert.ok(COMMON_KITCHEN_EQUIPMENT.includes('Thermometer'));
  assert.deepEqual(BASIC_KITCHEN_EQUIPMENT, ['Oven', 'Stovetop', 'Pan', 'Pot', 'Saucepan', 'Sheet pan', 'Microwave']);
});

test('equipment-toggle and equipment-set actions update kitchen equipment idempotently and safely', () => {
  let k = applyKitchenAction(emptyKitchen(), { type: 'equipment-toggle', item: 'skillet', on: true });
  assert.deepEqual(k.equipment, ['Pan']);
  // Safe to send twice
  assert.deepEqual(applyKitchenAction(k, { type: 'equipment-toggle', item: 'Pan', on: true }), k);

  k = applyKitchenAction(k, { type: 'equipment-toggle', item: 'Sous vide', on: true });
  assert.deepEqual(k.equipment, ['Pan', 'Sous vide']);

  // Empty item does nothing
  assert.deepEqual(applyKitchenAction(k, { type: 'equipment-toggle', item: '   ', on: true }), k);

  k = applyKitchenAction(k, { type: 'equipment-toggle', item: 'frying pan', on: false });
  assert.deepEqual(k.equipment, ['Sous vide']);

  // equipment-set canonicalizes, deduplicates, and caps at 100
  const setK = applyKitchenAction(k, {
    type: 'equipment-set',
    items: ['Oven', 'stove', 'Stovetop', ...Array.from({ length: 110 }, (_, i) => `Gear ${i}`)],
  });
  assert.equal(setK.equipment.length, 100);
  assert.equal(setK.equipment[0], 'Oven');
  assert.equal(setK.equipment[1], 'Stovetop');

  // Invalid non-array items leaves state unchanged
  assert.deepEqual(
    applyKitchenAction(setK, { type: 'equipment-set', items: 'not-an-array' as unknown as string[] }),
    setK,
  );

  // Merge combines equipment cleanly without duplicates
  const merged = mergeKitchens(
    { ...emptyKitchen(), equipment: ['Pan', 'Oven'] },
    { ...emptyKitchen(), equipment: ['skillet', 'Air fryer'] },
  );
  assert.deepEqual(merged.equipment, ['Pan', 'Oven', 'Air fryer']);
});

test('missingEquipment treats empty kitchen equipment as unrestricted and matches canonically', () => {
  const recipe = makeRecipe({ equipment: ['Cast Iron', 'Skillet', 'Air fryer'] });

  // Empty equipment -> no restriction
  assert.deepEqual(missingEquipment(recipe, { equipment: [] }), []);

  // Matches canonical equivalents case-insensitively
  assert.deepEqual(
    missingEquipment(recipe, { equipment: ['cast iron', 'Pan'] }),
    ['Air fryer'],
  );

  assert.deepEqual(
    missingEquipment(recipe, { equipment: ['Cast iron', 'Pan', 'Air fryer'] }),
    [],
  );
});

test('plan-reorder moves entries across days, to Meal prep (null), and reorders via beforeEntryId', () => {
  const start: KitchenState = {
    ...emptyKitchen(),
    plans: {
      [WEEK]: [
        { id: 'e1', recipeId: 'r1', servings: 2, day: 0 },
        { id: 'e2', recipeId: 'r2', servings: 4, day: 0 },
        { id: 'e3', recipeId: 'r3', servings: 4, day: 2 },
        { id: 'e4', recipeId: 'r4', servings: 6, day: null },
      ],
    },
  };

  // Reorder within Monday: move e2 before e1
  const reorderedSameDay = applyKitchenAction(start, {
    type: 'plan-reorder',
    week: WEEK,
    entryId: 'e2',
    targetDay: 0,
    beforeEntryId: 'e1',
  });
  assert.deepEqual(
    reorderedSameDay.plans[WEEK].map((e) => [e.id, e.day]),
    [
      ['e2', 0],
      ['e1', 0],
      ['e3', 2],
      ['e4', null],
    ],
  );
  // Idempotent when applied twice
  assert.deepEqual(
    applyKitchenAction(reorderedSameDay, {
      type: 'plan-reorder',
      week: WEEK,
      entryId: 'e2',
      targetDay: 0,
      beforeEntryId: 'e1',
    }),
    reorderedSameDay,
  );

  // Move across days directly before an entry (e4 from Meal prep -> Wednesday before e3)
  const movedFromPrep = applyKitchenAction(reorderedSameDay, {
    type: 'plan-reorder',
    week: WEEK,
    entryId: 'e4',
    targetDay: 2,
    beforeEntryId: 'e3',
  });
  assert.deepEqual(
    movedFromPrep.plans[WEEK].map((e) => [e.id, e.day]),
    [
      ['e2', 0],
      ['e1', 0],
      ['e4', 2],
      ['e3', 2],
    ],
  );

  // Move an entry to Meal prep (targetDay: null) without beforeEntryId -> appended
  const movedToPrep = applyKitchenAction(movedFromPrep, {
    type: 'plan-reorder',
    week: WEEK,
    entryId: 'e1',
    targetDay: null,
  });
  assert.deepEqual(
    movedToPrep.plans[WEEK].map((e) => [e.id, e.day]),
    [
      ['e2', 0],
      ['e4', 2],
      ['e3', 2],
      ['e1', null],
    ],
  );

  // Unknown entryId or invalid week leaves plan unchanged
  const badActions: KitchenAction[] = [
    { type: 'plan-reorder', week: WEEK, entryId: 'missing', targetDay: 1 },
    { type: 'plan-reorder', week: 'bad-week', entryId: 'e2', targetDay: 1 },
  ];
  for (const act of badActions) {
    assert.deepEqual(applyKitchenAction(movedToPrep, act), movedToPrep);
  }
});

test('buildRecipePrompt and buildWeekPrompt include global kitchen equipment when configured', () => {
  const withGear: KitchenState = {
    ...emptyKitchen(),
    equipment: ['Cast iron', 'Air fryer', 'Saucepan'],
  };
  const baseOpts = { ask: 'Quick weeknight dinners', servings: 4, usePantry: false, useMine: false };

  const recipePrompt = buildRecipePrompt({ ...baseOpts, count: 2 }, withGear, DEFAULT_RECIPES);
  assert.match(recipePrompt, /Kitchen equipment I have \(use these and avoid equipment I didn't list\): Cast iron, Air fryer, Saucepan\./);

  const weekPrompt = buildWeekPrompt({ ...baseOpts, meals: 4, prep: 1, weekLabel: 'Nov 16 – Nov 22' }, withGear, DEFAULT_RECIPES);
  assert.match(weekPrompt, /Kitchen equipment I have \(use these and avoid equipment I didn't list\): Cast iron, Air fryer, Saucepan\./);

  const withoutGearPrompt = buildRecipePrompt({ ...baseOpts, count: 1 }, emptyKitchen(), DEFAULT_RECIPES);
  assert.doesNotMatch(withoutGearPrompt, /Kitchen equipment I have/);
});

test('buildEditRecipePrompt includes current recipe, cook notes, cookLog, and kitchen equipment', () => {
  assert.ok(AI_EDIT_PRESETS.some((p) => p.id === 'cook-notes'));
  assert.ok(AI_EDIT_PRESETS.some((p) => p.id === 'my-gear'));

  const subSauce = makeRecipe({ id: 'herb-sauce', title: 'Herb Sauce' });
  const original = makeRecipe({
    id: 'salmon-1',
    title: 'Garlic Butter Salmon',
    notes: 'Skin gets crispier if patted very dry first.',
    cookLog: [
      { id: 'log-1', cookedAt: '2026-11-10T18:00:00.000Z', servings: 4, rating: 9, note: 'Needed 2 extra minutes.' },
    ],
    sections: [
      { name: 'Salmon', steps: ['Sear [1.5 lb salmon] for [4 min].'] },
      { name: '', steps: [], sub: { recipeId: 'herb-sauce', servings: 4 } },
    ],
  });

  const kitchen: KitchenState = {
    ...emptyKitchen(),
    have: ['olive oil'],
    pantry: { 'olive oil': { name: 'Olive oil' } },
    equipment: ['Air fryer', 'Pan'],
  };

  const prompt = buildEditRecipePrompt(
    original,
    { ask: 'Adapt for air fryer and apply notes', servings: 4, includeNotes: true, usePantry: true, useEquipment: true },
    kitchen,
    [subSauce, original],
  );

  assert.match(prompt, /Update this recipe for me \(4 servings\): Adapt for air fryer and apply notes/);
  assert.match(prompt, /My cook notes & feedback from making this recipe:/);
  assert.match(prompt, /Skin gets crispier if patted very dry first\./);
  assert.match(prompt, /Needed 2 extra minutes\./);
  assert.match(prompt, /Kitchen equipment I have \(use these and avoid equipment I didn't list\): Air fryer, Pan\./);
  assert.match(prompt, /Olive oil/);
  assert.match(prompt, /"recipe": "Herb Sauce"/);

  const quietPrompt = buildEditRecipePrompt(
    original,
    { ask: '', includeNotes: false, usePantry: false, useEquipment: false },
    kitchen,
  );
  assert.match(quietPrompt, /Improve this recipe while keeping its core character\./);
  assert.doesNotMatch(quietPrompt, /My cook notes & feedback/);
  assert.doesNotMatch(quietPrompt, /Kitchen equipment I have/);
});

test('parseAiEditReply keeps same title without duplicate rejection, preserves history/metadata, and reports summary', () => {
  const original = makeRecipe({
    id: 'salmon-1',
    slug: 'garlic-butter-salmon',
    title: 'Garlic Butter Salmon',
    servings: 4,
    equipment: ['Cast iron', 'Oven'],
    rating: 9.2,
    timesCooked: 7,
    lastCookedAt: '2026-11-12T19:00:00.000Z',
    notes: 'Original pinned note.',
    cookLog: [{ id: 'c1', cookedAt: '2026-11-12T19:00:00.000Z', rating: 9.2, note: 'Delicious' }],
    private: false,
    ownerId: 'user-123',
  });
  const other = makeRecipe({ id: 'other-1', title: 'Crispy Tofu' });

  const aiReply = `\`\`\`json
{
  "recipes": [
    {
      "title": "Garlic Butter Salmon",
      "summary": "Air-fried crispy salmon.",
      "category": "dinner",
      "servings": 2,
      "equipment": ["Air fryer"],
      "tags": ["Fast"],
      "parts": [
        {
          "name": "Main",
          "steps": [
            "Pat [1 lb | 450 g salmon] dry and brush with [1 tbsp | 15 ml olive oil] and [1 tsp | 6 g kosher salt].",
            "Air fry at [400°F] for [10 min]."
          ]
        }
      ]
    }
  ]
}
\`\`\``;

  // Notice original is inside allRecipes — must NOT be rejected as duplicate!
  const result = parseAiEditReply(aiReply, original, [original, other]);

  assert.equal(result.recipe.id, 'salmon-1');
  assert.equal(result.recipe.slug, 'garlic-butter-salmon');
  assert.equal(result.recipe.title, 'Garlic Butter Salmon');
  assert.equal(result.recipe.servings, 2);
  assert.deepEqual(result.recipe.equipment, ['Air fryer']);
  assert.equal(result.recipe.rating, 9.2);
  assert.equal(result.recipe.timesCooked, 7);
  assert.equal(result.recipe.lastCookedAt, '2026-11-12T19:00:00.000Z');
  assert.equal(result.recipe.cookLog?.length, 1);
  assert.equal(result.recipe.notes, 'Original pinned note.');
  assert.equal(result.recipe.private, false);
  assert.equal(result.recipe.ownerId, 'user-123');
  assert.equal(result.notes.length, 0);

  assert.ok(result.summary.some((s) => s.includes('Servings: 4 → 2')));
  assert.ok(result.summary.some((s) => s.includes('Equipment: Air fryer')));
  assert.ok(result.summary.some((s) => s.includes('ingredient')));
  assert.ok(result.summary.some((s) => s.includes('step')));

  assert.throws(() => parseAiEditReply('No JSON here', original, [original]), AiReplyError);
});
