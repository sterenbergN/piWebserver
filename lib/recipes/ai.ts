// Having an AI write recipes or plan a week: a prompt to copy out, and the reply
// read back in. No API and no key: it works with whichever AI you already use,
// the same way the study tests do.

import { buildSections } from './import';
import { DAY_NAMES, newKitchenId, type KitchenState } from './kitchen';
import { CATEGORY_LABELS, RECIPE_CATEGORIES, normalizeRecipe, type Recipe, type RecipeCategory } from './recipes';

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

function kitchenContext(kitchen: Pick<KitchenState, 'have' | 'pantry'>, recipes: Recipe[], options: AiRequest) {
  const lines: string[] = [];
  if (options.usePantry) {
    const shelf = kitchen.have.filter((key) => !key.startsWith('made:')).map((key) => kitchen.pantry[key]?.name || key);
    if (shelf.length) lines.push(`What I already have at home (use these where they fit, but don't feel limited to them): ${shelf.join(', ')}.`);
  }
  if (options.useMine && recipes.length) {
    lines.push(`Recipes I already have (don't write these out again): ${recipes.map((r) => r.title).join('; ')}.`);
  }
  return lines;
}

/** A prompt for one or more new recipes. */
export function buildRecipePrompt(options: AiRequest & { count: number }, kitchen: Pick<KitchenState, 'have' | 'pantry'>, recipes: Recipe[]) {
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

/** A prompt for a whole week: a plan, and any recipes it needs that I don't have yet. */
export function buildWeekPrompt(options: AiRequest & { meals: number; prep: number; weekLabel: string }, kitchen: Pick<KitchenState, 'have' | 'pantry'>, recipes: Recipe[]) {
  const prep = options.prep > 0 ? ` Make ${options.prep} of them meal prep, cooked ahead and eaten through the week.` : '';
  return [
    `Plan my meals for the week of ${options.weekLabel}: ${options.meals} ${options.meals === 1 ? 'meal' : 'meals'}, ${options.servings} servings each.${prep}${options.ask.trim() ? ` ${options.ask.trim()}` : ''}`,
    `Plan the week so ingredients overlap and little goes to waste, and put quick meals on busy-looking nights if I've said which those are.`,
    ...kitchenContext(kitchen, recipes, options),
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "plan": [
    { "day": "Mon", "recipe": "Greek beef bowls", "servings": 4 },
    { "day": "prep", "recipe": "Tzatziki", "servings": 8 }
  ],
  "recipes": [
    ${EXAMPLE_RECIPE}
  ]
}
\`\`\``,
    `Rules for the plan:
- "day" is one of ${DAY_NAMES.join(', ')}, or "prep" for something cooked ahead.
- "recipe" is the exact title of a recipe, either one of mine or one in "recipes".
- "recipes" holds every recipe the plan needs that I don't already have, written out in full.`,
    STEP_RULES,
  ].join('\n\n');
}

// ─── Reading the reply ────────────────────────────────────────────────────────

export type AiPlanEntry = { recipeId: string; title: string; servings: number; day: number | null };

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
  const marker = clean.search(/"recipes"\s*:\s*\[/);
  const objects = marker >= 0 ? wholeObjects(clean.slice(clean.indexOf('[', marker) + 1)) : [];
  if (objects.length) return { value: { recipes: objects }, cutOff: true };
  throw new AiReplyError('That isn’t valid JSON. Ask the AI to send it again as one JSON code block.');
}

function readDay(value: unknown): number | null | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (/^(prep|meal ?prep|ahead)/.test(text)) return null;
  const day = DAY_NAMES.findIndex((name) => text.startsWith(name.toLowerCase()));
  return day >= 0 ? day : undefined;
}

/** Read what an AI wrote against the recipes you have. Throws AiReplyError when there's nothing to use. */
export function parseAiReply(text: string, mine: Recipe[], fallbackServings = 4): AiReply {
  const { value, cutOff } = readJson(text);
  const root = isRecord(value) ? value : { recipes: value };
  const rawRecipes: unknown[] = Array.isArray(root.recipes) ? root.recipes : isRecord(value) && typeof value.title === 'string' ? [value] : [];
  const notes: string[] = [];
  if (cutOff) notes.push('The reply was cut off, so the plan and the last recipe were lost. Ask the AI to continue if you need the rest.');

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
        if (recipeId && recipeId !== id) return [{ name: '', steps: [], sub: { recipeId, servings: Number(part.servings) || 1 } }];
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
    const day = readDay(raw.day);
    if (!recipeId || dropped.has(recipeId)) {
      notes.push(`The plan mentions ${raw.recipe}, but there’s no recipe for it.`);
      continue;
    }
    if (day === undefined) notes.push(`${raw.recipe} had no day I could read, so it went into meal prep.`);
    plan.push({ recipeId, title: raw.recipe, servings: Math.min(48, Math.max(1, Math.round(Number(raw.servings)) || fallbackServings)), day: day ?? null });
  }

  if (!recipes.length && !plan.length) throw new AiReplyError('I couldn’t find any recipes or a plan in that. Paste the whole reply.');
  return { recipes, plan, notes };
}

/** "Dinner", for showing a recipe in the check-over list. */
export const categoryLabel = (recipe: Pick<Recipe, 'category'>) => CATEGORY_LABELS[recipe.category]?.label ?? '';
