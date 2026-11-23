// Having an AI write recipes or plan a week: a prompt to copy out, and the reply
// read back in. No API and no key: it works with whichever AI you already use,
// the same way the study tests do.

import { addDays, dayOfWeek, isDateKey, weekStart, type DateKey } from '@/lib/habits/dates';
import { buildSections } from './import';
import { DAY_NAMES, newKitchenId, type KitchenState } from './kitchen';
import { CATEGORY_LABELS, MAX_SERVINGS, RECIPE_CATEGORIES, extractIngredients, normalizeRecipe, type Recipe, type RecipeCategory, type RecipeSection } from './recipes';

export type AiRequest = {
  /** What you're after, in your own words. */
  ask: string;
  servings: number;
  /** Tell it what's at home, so it can use that up. */
  usePantry: boolean;
  /** Tell it the recipes you already have, so it can reuse them and not write them again. */
  useMine: boolean;
};

const STEP_RULES = `Rules for the recipes:
- Write every step as a plain sentence, and put each amount, time and temperature in square brackets where it's used. My app builds the ingredient list and timers from these, so an ingredient without brackets won't reach my shopping list.
- Ingredients look like [1 cup | 240 ml milk] or [2 lb | 900 g chicken thighs]: US amount, a bar, metric amount, then the ingredient. Things you count look like [2 eggs] or [3 cloves garlic, minced].
- Use the same ingredient name each time, and don't repeat an amount: if a step uses part of something, give each step only its own share.
- Times look like [8 min]. Add the word passive when nobody has to watch it, like [40 min passive]. Temperatures look like [400°F].
- "parts" are things that cook at the same time, like a sauce alongside the meat. Most recipes need one part, called "Main".
- If something is worth making on its own, like a sauce or a spice mix, or more than one recipe needs it, write it as its own recipe and use it with { "recipe": "Tzatziki", "servings": 4 } in place of a part. "servings" is how many of its servings go in.
- "category" is one of: ${RECIPE_CATEGORIES.join(', ')}.
- "equipment" uses these words where they fit: Oven, Stovetop, Grill, Pan, Pot, Saucepan, Sheet pan, Cast iron, Dutch oven, Wok, Air fryer, Slow cooker, Pressure cooker, Microwave, Blender, Food processor, Mixer, Toaster.
- "macros" are your best estimate per serving. Leave them out if you can't estimate them.
- Keep it practical for a home cook, with real quantities and times I can trust.`;

const EXAMPLE_RECIPE = `{
      "title": "Greek beef bowls",
      "summary": "Spiced beef over rice with cool tzatziki.",
      "category": "dinner",
      "servings": 4,
      "equipment": ["Pan", "Pot"],
      "tags": ["Weeknight", "High protein"],
      "macros": { "calories": 620, "protein": 42, "carbs": 58, "fat": 22 },
      "parts": [
        { "name": "Rice", "steps": ["Simmer [1.5 cups | 280 g rice] in [3 cups | 720 ml water] for [18 min passive]."] },
        { "name": "Beef", "steps": ["Brown [1 lb | 450 g ground beef] with [2 tsp | 4 g oregano] for [8 min]."] },
        { "recipe": "Tzatziki", "servings": 4 }
      ]
    },
    {
      "title": "Tzatziki",
      "summary": "Garlicky yogurt sauce that keeps for days.",
      "category": "sauce",
      "servings": 8,
      "equipment": [],
      "tags": ["Make ahead"],
      "parts": [
        { "name": "Main", "steps": ["Stir [2 cups | 480 g Greek yogurt], [1 cucumber, grated] and [2 cloves garlic, minced] together, then chill for [30 min passive]."] }
      ]
    }`;

function kitchenContext(
  kitchen: Pick<KitchenState, 'have' | 'pantry'> & { equipment?: string[] },
  recipes: Recipe[],
  options: AiRequest,
) {
  const lines: string[] = [];
  if (options.usePantry) {
    const shelf = kitchen.have.filter((key) => !key.startsWith('made:')).map((key) => kitchen.pantry[key]?.name || key);
    if (shelf.length) lines.push(`What I already have at home (use these where they fit, but don't feel limited to them): ${shelf.join(', ')}.`);
  }
  if (kitchen.equipment && kitchen.equipment.length > 0) {
    lines.push(`Kitchen equipment I have (use these and avoid equipment I didn't list): ${kitchen.equipment.join(', ')}.`);
  }
  if (options.useMine && recipes.length) {
    lines.push(`Recipes I already have (don't write these out again): ${recipes.map((r) => r.title).join('; ')}.`);
  }
  return lines;
}

/** A prompt for one or more new recipes. */
export function buildRecipePrompt(
  options: AiRequest & { count: number },
  kitchen: Pick<KitchenState, 'have' | 'pantry'> & { equipment?: string[] },
  recipes: Recipe[],
) {
  const count = options.count === 1 ? 'a recipe' : `${options.count} recipes`;
  return [
    `Write ${count} for me${options.ask.trim() ? `: ${options.ask.trim()}` : '.'} Each should serve about ${options.servings}.`,
    ...kitchenContext(kitchen, recipes, options),
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "recipes": [
    ${EXAMPLE_RECIPE}
  ]
}
\`\`\``,
    STEP_RULES,
  ].join('\n\n');
}

export type PlanRange = { start: DateKey; days: number };

export function planRangeDates(range: PlanRange): { date: DateKey; week: DateKey; day: number; dayName: string }[] {
  const count = Math.min(14, Math.max(1, range.days));
  const out: { date: DateKey; week: DateKey; day: number; dayName: string }[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(range.start, i);
    const week = weekStart(date);
    const day = (dayOfWeek(date) + 6) % 7;
    out.push({ date, week, day, dayName: DAY_NAMES[day] });
  }
  return out;
}

/** A prompt for a whole week: a plan, and any recipes it needs that I don't have yet. */
export function buildWeekPrompt(
  options: AiRequest & { meals: number; prep: number; weekLabel: string; range?: PlanRange },
  kitchen: Pick<KitchenState, 'have' | 'pantry'> & { equipment?: string[] },
  recipes: Recipe[],
) {
  const prep = options.prep > 0 ? ` Make ${options.prep} of them meal prep, cooked ahead and eaten through the week.` : '';
  const dates = options.range ? planRangeDates(options.range) : null;
  const crossWeek = Boolean(dates && (weekStart(options.range!.start) !== options.range!.start || dates.length !== 7));
  const opening = crossWeek
    ? `Plan my meals for ${options.weekLabel} (${dates!.length} days): ${options.meals} ${options.meals === 1 ? 'meal' : 'meals'}, ${options.servings} servings each.${prep}${options.ask.trim() ? ` ${options.ask.trim()}` : ''}`
    : `Plan my meals for the week of ${options.weekLabel}: ${options.meals} ${options.meals === 1 ? 'meal' : 'meals'}, ${options.servings} servings each.${prep}${options.ask.trim() ? ` ${options.ask.trim()}` : ''}`;
  const exampleDay = crossWeek ? dates![0].date : 'Mon';
  const dayRule = crossWeek
    ? `- "day" is one of ${dates!.map((d) => `${d.date} (${d.dayName})`).join(', ')}, or "prep" for something cooked ahead.`
    : `- "day" is one of ${DAY_NAMES.join(', ')}, or "prep" for something cooked ahead.`;

  return [
    opening,
    `Plan the week so ingredients overlap and little goes to waste, and put quick meals on busy-looking nights if I've said which those are.`,
    ...kitchenContext(kitchen, recipes, options),
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "plan": [
    { "day": "${exampleDay}", "recipe": "Greek beef bowls", "servings": 4 },
    { "day": "prep", "recipe": "Tzatziki", "servings": 8 }
  ],
  "recipes": [
    ${EXAMPLE_RECIPE}
  ]
}
\`\`\``,
    `Rules for the plan:
${dayRule}
- "recipe" is the exact title of a recipe, either one of mine or one in "recipes".
- "recipes" holds every recipe the plan needs that I don't already have, written out in full.`,
    STEP_RULES,
  ].join('\n\n');
}

// ─── Reading the reply ────────────────────────────────────────────────────────

export type AiPlanEntry = { recipeId: string; title: string; servings: number; day: number | null; week?: DateKey; date?: DateKey };

export type AiReply = {
  /** New recipes, ready to save, with ids already given so they can link to each other. */
  recipes: Recipe[];
  plan: AiPlanEntry[];
  /** What couldn't be used, in plain words. */
  notes: string[];
};

export class AiReplyError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whole objects in a reply that got cut off part way. */
function wholeObjects(text: string): unknown[] {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === ']' && depth === 0) break;
    else if (c === '{') {
      if (depth++ === 0) start = i;
    } else if (c === '}' && depth > 0 && --depth === 0) {
      try {
        found.push(JSON.parse(text.slice(start, i + 1).replace(/,(\s*[}\]])/g, '$1')));
      } catch {
        /* skip that one */
      }
    }
  }
  return found;
}

/** The JSON in a reply: code fences, chatter around it and trailing commas are all forgiven. */
function readJson(text: string): { value: unknown; cutOff: boolean } {
  const clean = text.replace(/```[a-z]*\s*\n?/gi, '').replace(/```/g, '');
  const start = clean.search(/[{[]/);
  if (start < 0) throw new AiReplyError('I couldn’t find any JSON in that. Paste the whole reply, including the part in the code block.');
  const body = clean.slice(start, Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']')) + 1);
  for (const candidate of [body, body.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      return { value: JSON.parse(candidate), cutOff: false };
    } catch {
      /* try the next */
    }
  }
  const arrayObjects = (key: string): unknown[] => {
    const marker = clean.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
    if (marker < 0) return [];
    const open = clean.indexOf('[', marker);
    return open >= 0 ? wholeObjects(clean.slice(open + 1)) : [];
  };
  const recipes = arrayObjects('recipes');
  const plan = arrayObjects('plan');
  if (recipes.length || plan.length) return { value: { recipes, plan }, cutOff: true };
  throw new AiReplyError('That isn’t valid JSON. Ask the AI to send it again as one JSON code block.');
}

function readDay(value: unknown, range?: PlanRange): { day: number | null; week?: DateKey; date?: DateKey } | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (/^(prep|meal ?prep|ahead)/.test(text)) {
    return { day: null, ...(range ? { week: weekStart(range.start) } : {}) };
  }
  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (isoMatch && isDateKey(isoMatch[1])) {
    const iso = isoMatch[1];
    return { day: (dayOfWeek(iso) + 6) % 7, week: weekStart(iso), date: iso };
  }
  const day = DAY_NAMES.findIndex((name) => text.startsWith(name.toLowerCase()));
  if (day >= 0) {
    if (range) {
      const slot = planRangeDates(range).find((s) => s.day === day);
      if (slot) return { day: slot.day, week: slot.week, date: slot.date };
    }
    return { day };
  }
  return undefined;
}

/** Read what an AI wrote against the recipes you have. Throws AiReplyError when there's nothing to use. */
export function parseAiReply(text: string, mine: Recipe[], fallbackServings = 4, range?: PlanRange): AiReply {
  const { value, cutOff } = readJson(text);
  const root = isRecord(value) ? value : { recipes: value };
  const rawRecipes: unknown[] = Array.isArray(root.recipes) ? root.recipes : isRecord(value) && typeof value.title === 'string' ? [value] : [];
  const notes: string[] = [];
  if (cutOff) notes.push('The reply was cut off, so whatever came after the break was lost. Ask the AI to continue if you need the rest.');

  // Titles first, so a recipe can link to one written later in the reply.
  const wanted: { raw: Record<string, unknown>; id: string; title: string }[] = [];
  for (const raw of rawRecipes) {
    if (!isRecord(raw) || typeof raw.title !== 'string' || !raw.title.trim()) continue;
    const title = raw.title.trim();
    if (mine.some((r) => sameTitle(r.title, title))) {
      notes.push(`You already have ${title}, so yours was kept.`);
    } else if (!wanted.some((w) => sameTitle(w.title, title))) {
      wanted.push({ raw, id: newKitchenId(), title });
    }
  }
  const idFor = (title: string) => wanted.find((w) => sameTitle(w.title, title))?.id ?? mine.find((r) => sameTitle(r.title, title))?.id;

  const recipes: Recipe[] = [];
  const dropped = new Set<string>();
  for (const { raw, id, title } of wanted) {
    const parts = Array.isArray(raw.parts) ? raw.parts : Array.isArray(raw.sections) ? raw.sections : [];
    const sections = parts.flatMap((part): Recipe['sections'] => {
      if (!isRecord(part)) return [];
      if (typeof part.recipe === 'string') {
        const recipeId = idFor(part.recipe);
        if (recipeId && recipeId !== id) return [{ name: '', steps: [], sub: { recipeId, servings: Math.min(MAX_SERVINGS, Math.max(1, Math.round(Number(part.servings)) || 1)) } }];
        notes.push(`${title} uses ${part.recipe}, which wasn’t in the reply, so that part was left out.`);
        return [];
      }
      const steps = Array.isArray(part.steps) ? part.steps.filter((s): s is string => typeof s === 'string' && Boolean(s.trim())) : [];
      return steps.length ? [{ name: typeof part.name === 'string' ? part.name : 'Main', steps }] : [];
    });
    // Forgot the brackets but gave a list: match the amounts to the steps as an import would.
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients.filter((s): s is string => typeof s === 'string') : [];
    const bracketed = sections.some((s) => s.steps.some((step) => step.includes('[')));
    const category: RecipeCategory = RECIPE_CATEGORIES.includes(raw.category as RecipeCategory) ? (raw.category as RecipeCategory) : 'dinner';
    try {
      recipes.push(
        normalizeRecipe({
          ...raw,
          id,
          title,
          category,
          servings: Number(raw.servings) || fallbackServings,
          // AI-written and unchecked: it stays between signed-in people until you say otherwise.
          private: true,
          photo: undefined,
          rating: null,
          timesCooked: 0,
          lastCookedAt: undefined,
          sections: !bracketed && ingredients.length ? buildSections(ingredients, sections.map((s) => ({ name: s.name, steps: s.steps }))) : sections,
        }),
      );
    } catch {
      dropped.add(id);
      notes.push(`${title} had no steps, so it was left out.`);
    }
  }

  const plan: AiPlanEntry[] = [];
  for (const raw of Array.isArray(root.plan) ? root.plan : []) {
    if (!isRecord(raw) || typeof raw.recipe !== 'string') continue;
    const recipeId = idFor(raw.recipe);
    const parsedDay = readDay(raw.day, range);
    if (!recipeId || dropped.has(recipeId)) {
      notes.push(`The plan mentions ${raw.recipe}, but there’s no recipe for it.`);
      continue;
    }
    const servings = Math.min(MAX_SERVINGS, Math.max(1, Math.round(Number(raw.servings)) || fallbackServings));
    if (parsedDay === undefined) {
      notes.push(`${raw.recipe} had no day I could read, so it went into meal prep.`);
      plan.push({
        recipeId,
        title: raw.recipe,
        servings,
        day: null,
        ...(range ? { week: weekStart(range.start) } : {}),
      });
    } else {
      plan.push({
        recipeId,
        title: raw.recipe,
        servings,
        day: parsedDay.day,
        ...(parsedDay.week ? { week: parsedDay.week } : {}),
        ...(parsedDay.date ? { date: parsedDay.date } : {}),
      });
    }
  }

  if (!recipes.length && !plan.length) throw new AiReplyError('I couldn’t find any recipes or a plan in that. Paste the whole reply.');
  return { recipes, plan, notes };
}

/** "Dinner", for showing a recipe in the check-over list. */
export const categoryLabel = (recipe: Pick<Recipe, 'category'>) => CATEGORY_LABELS[recipe.category]?.label ?? '';

// ─── Editing an existing recipe with AI ───────────────────────────────────────

export const AI_EDIT_PRESETS: { id: string; label: string; prompt: string }[] = [
  {
    id: 'cook-notes',
    label: '📝 Apply my cook notes',
    prompt: 'Update ingredients, quantities, times, and steps to incorporate my cook notes and past cook log feedback.',
  },
  {
    id: 'my-gear',
    label: '🍳 Use only my kitchen gear',
    prompt: 'Adapt the cooking method and steps so this recipe only uses the kitchen equipment I have at home.',
  },
  {
    id: 'high-protein',
    label: '💪 Boost protein',
    prompt: 'Modify this recipe to significantly increase protein per serving while keeping great flavor.',
  },
  {
    id: 'faster',
    label: '⚡ Make it faster (<25m)',
    prompt: 'Streamline the prep and cooking steps so the whole recipe finishes in under 25 minutes.',
  },
  {
    id: 'one-pan',
    label: '🥘 One-pan / sheet-pan',
    prompt: 'Convert this recipe into a one-pan or sheet-pan method to minimize cleanup.',
  },
  {
    id: 'air-fryer',
    label: '🌬️ Air fryer version',
    prompt: 'Adapt the cooking steps, times, and temperatures for an air fryer.',
  },
  {
    id: 'lighter',
    label: '🥗 Lighter / lower calorie',
    prompt: 'Reduce calories and fat per serving with smart swaps while keeping it satisfying.',
  },
  {
    id: 'vegetarian',
    label: '🌱 Make vegetarian',
    prompt: 'Convert this recipe into a flavorful vegetarian version with good protein.',
  },
];

/** A prompt asking an AI to revise an existing recipe or draft, optionally folding in cook notes and kitchen gear. */
export function buildEditRecipePrompt(
  recipe: Partial<Recipe> & { title: string; sections: RecipeSection[] },
  options: {
    ask: string;
    servings?: number;
    includeNotes?: boolean;
    usePantry?: boolean;
    useEquipment?: boolean;
  },
  kitchen?: Pick<KitchenState, 'have' | 'pantry'> & { equipment?: string[] },
  allRecipes?: Recipe[],
): string {
  const byId = allRecipes ? new Map(allRecipes.map((r) => [r.id, r])) : null;
  const targetServings = options.servings ?? recipe.servings ?? 4;
  const ask = options.ask.trim() || 'Improve this recipe while keeping its core character.';

  const parts = recipe.sections.map((sec) => {
    if (sec.sub) {
      const subTitle = byId?.get(sec.sub.recipeId)?.title || sec.from?.title || sec.sub.recipeId;
      return { recipe: subTitle, servings: sec.sub.servings };
    }
    return {
      name: sec.name || 'Main',
      steps: sec.steps,
      ...(sec.readyBy ? { readyBy: sec.readyBy } : {}),
    };
  });

  const currentJson = {
    title: recipe.title,
    ...(recipe.summary ? { summary: recipe.summary } : {}),
    category: recipe.category ?? 'dinner',
    servings: targetServings,
    equipment: recipe.equipment ?? [],
    tags: recipe.tags ?? [],
    ...(recipe.macros ? { macros: recipe.macros } : {}),
    parts,
  };

  const contextLines: string[] = [];
  if (options.includeNotes !== false) {
    const noteLines: string[] = [];
    if (recipe.notes?.trim()) noteLines.push(`- Pinned note: ${recipe.notes.trim()}`);
    for (const entry of (recipe.cookLog || []).filter((e) => e.note?.trim()).slice(0, 5)) {
      const date = entry.cookedAt ? entry.cookedAt.slice(0, 10) : 'past cook';
      const rated = entry.rating ? `, rated ${entry.rating}/10` : '';
      noteLines.push(`- Cook log (${date}${rated}): ${entry.note!.trim()}`);
    }
    if (noteLines.length) {
      contextLines.push(`My cook notes & feedback from making this recipe:\n${noteLines.join('\n')}`);
    }
  }
  if (options.useEquipment !== false && kitchen?.equipment && kitchen.equipment.length > 0) {
    contextLines.push(`Kitchen equipment I have (use these and avoid equipment I didn't list): ${kitchen.equipment.join(', ')}.`);
  }
  if (options.usePantry && kitchen?.have?.length) {
    const shelf = kitchen.have.filter((key) => !key.startsWith('made:')).map((key) => kitchen.pantry[key]?.name || key);
    if (shelf.length) contextLines.push(`What I already have at home (use these where they fit, but don't feel limited to them): ${shelf.join(', ')}.`);
  }

  return [
    `Update this recipe for me (${targetServings} ${targetServings === 1 ? 'serving' : 'servings'}): ${ask}`,
    ...contextLines,
    `Here is the current recipe to edit:\n\n\`\`\`json\n${JSON.stringify(currentJson, null, 2)}\n\`\`\``,
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "recipes": [
    {
      "title": "...",
      "summary": "...",
      "category": "${currentJson.category}",
      "servings": ${targetServings},
      "equipment": ["Pan"],
      "tags": ["Weeknight"],
      "macros": { "calories": 500, "protein": 35, "carbs": 45, "fat": 18 },
      "parts": [
        { "name": "Main", "steps": ["..."] }
      ]
    }
  ]
}
\`\`\``,
    STEP_RULES,
  ].join('\n\n');
}

/** Parse an AI reply editing an existing recipe, keeping the original's identity and cook history. */
export function parseAiEditReply(
  text: string,
  original: Partial<Recipe>,
  allRecipes: Recipe[] = [],
): { recipe: Recipe; summary: string[]; notes: string[] } {
  const origTitle = original.title?.trim().toLowerCase() ?? '';
  const otherRecipes = allRecipes.filter(
    (r) => r.id !== original.id && (!origTitle || r.title.trim().toLowerCase() !== origTitle),
  );
  const parsed = parseAiReply(text, otherRecipes, original.servings ?? 4);
  if (!parsed.recipes.length) {
    throw new AiReplyError('No updated recipe was found in that reply. Ask the AI to send the updated recipe inside one JSON code block.');
  }

  const next = parsed.recipes[0];
  const recipe: Recipe = {
    ...next,
    id: original.id || next.id,
    slug: original.slug || next.slug,
    ...(original.photo ? { photo: original.photo } : {}),
    ...(next.emoji || original.emoji ? { emoji: next.emoji || original.emoji } : {}),
    ...(original.rating !== undefined ? { rating: original.rating } : {}),
    timesCooked: original.timesCooked ?? 0,
    ...(original.lastCookedAt ? { lastCookedAt: original.lastCookedAt } : {}),
    ...(original.cookLog ? { cookLog: original.cookLog } : {}),
    ...(next.notes || original.notes ? { notes: next.notes || original.notes } : {}),
    private: original.private ?? true,
    ...(original.ownerId ? { ownerId: original.ownerId } : {}),
    ...(original.createdAt ? { createdAt: original.createdAt } : {}),
  };

  const summary: string[] = [];
  if (original.title && recipe.title.trim() !== original.title.trim()) {
    summary.push(`Title: ${original.title} → ${recipe.title}`);
  }
  if (original.servings !== undefined && recipe.servings !== original.servings) {
    summary.push(`Servings: ${original.servings} → ${recipe.servings}`);
  }
  const origEquip = original.equipment ?? [];
  const sameEquip =
    origEquip.length === recipe.equipment.length &&
    origEquip.every((e, i) => e.toLowerCase() === recipe.equipment[i]?.toLowerCase());
  if (!sameEquip) {
    summary.push(`Equipment: ${recipe.equipment.length ? recipe.equipment.join(', ') : 'none'}`);
  }
  const newIngCount = extractIngredients(recipe).length;
  const oldIngCount = original.sections ? extractIngredients({ sections: original.sections }).length : null;
  summary.push(
    oldIngCount !== null && oldIngCount !== newIngCount
      ? `Ingredients: ${oldIngCount} → ${newIngCount}`
      : `${newIngCount} ${newIngCount === 1 ? 'ingredient' : 'ingredients'}`,
  );
  const countSteps = (secs: RecipeSection[]) => secs.reduce((n, s) => n + s.steps.length, 0);
  const newSteps = countSteps(recipe.sections);
  const oldSteps = original.sections ? countSteps(original.sections) : null;
  summary.push(
    oldSteps !== null && oldSteps !== newSteps
      ? `Steps: ${oldSteps} → ${newSteps}`
      : `${newSteps} ${newSteps === 1 ? 'step' : 'steps'}`,
  );

  return { recipe, summary, notes: parsed.notes };
}
