// Turn a recipe from elsewhere into our format. Most recipe sites publish
// schema.org data (JSON-LD) for search engines; failing that we fall back on
// whatever text the page has. The same conversion handles pasted text.
//
// Our recipes keep amounts inside the steps, while other sites list ingredients
// separately, so each ingredient is written into the first step that mentions
// it. Any that no step mentions go in a "Have ready" step, so none are lost.

import {
  RECIPE_CATEGORIES,
  parseStepTokens,
  smartAnnotateText,
  type RecipeCategory,
  type RecipeMacros,
  type RecipeSection,
} from './recipes';

export type ImportedRecipe = {
  title: string;
  summary: string;
  category: RecipeCategory;
  servings: number;
  prepMinutes?: number;
  cookMinutes?: number;
  equipment: string[];
  tags: string[];
  macros?: RecipeMacros;
  sections: RecipeSection[];
  sourceUrl?: string;
  imageUrl?: string;
};

// ─── Cleaning text ────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', deg: '°',
  frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', ntilde: 'ñ', times: '×',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text from a string that may hold HTML and entities (some sites escape twice). */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeEntities(decodeEntities(value))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

// ─── Ingredient lines ─────────────────────────────────────────────────────────

const FRACTIONS = '¼½¾⅓⅔⅛⅜⅝⅞';
const QTY = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|\\d*[${FRACTIONS}])`;
const US_UNIT = '(?:cups?|c|tablespoons?|tbsps?|tbs|teaspoons?|tsps?|ounces?|oz|fl\\.?\\s*oz|pounds?|lbs?)\\.?';
const METRIC_UNIT = '(?:g|grams?|kg|kilograms?|ml|milliliters?|millilitres?|l|liters?|litres?)\\.?';

/** One line of an ingredient list, as what goes inside a `[...]` token. */
export function normalizeIngredientLine(raw: string): string {
  let line = cleanText(raw)
    .replace(/^[-*•–▢☐\s]+/, '')
    .replace(/[[\]|*†‡]/g, ' ')
    .replace(/\(\(+/g, '(')
    .replace(/\)\)+/g, ')')
    .replace(/(\d)\s*⁄\s*(\d)/g, '$1/$2')
    .replace(new RegExp(`(\\d)\\s+([${FRACTIONS}])`, 'g'), '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

  // Long asides are for the page, not the shopping list; "optional" is worth keeping.
  line = line.replace(/\s*\(([^)]*)\)/g, (whole, inner: string) => {
    if (inner.length <= 24) return whole;
    return /^\s*optional/i.test(inner) ? ' (optional)' : '';
  });

  // A range buys the larger amount: "2-3 cloves garlic" is 3 cloves.
  line = line.replace(new RegExp(`^${QTY}\\s*(?:-|–|—|to)\\s*(${QTY})(?=\\s|$)`, 'i'), '$1');

  // "1 (14 oz) can tomatoes" reads as a can, with the size kept in the name.
  line = line.replace(new RegExp(`^(${QTY})\\s*(\\([^)]*\\))\\s*(.+)$`), '$1 $3 $2');

  // Both units given: "1 cup (140g) flour", "1 cup/240ml milk", "140 g (1 cup) flour".
  const usFirst = line.match(new RegExp(`^(${QTY}\\s*${US_UNIT})\\s*[(/]\\s*(${QTY})\\s*(${METRIC_UNIT})\\s*\\)?\\s*(.*)$`, 'i'));
  if (usFirst && usFirst[4]) return `${usFirst[1]} | ${usFirst[2]} ${usFirst[3]} ${usFirst[4]}`;
  const metricFirst = line.match(new RegExp(`^(${QTY})\\s*(${METRIC_UNIT})\\s*[(/]\\s*(${QTY}\\s*${US_UNIT})\\s*\\)?\\s*(.*)$`, 'i'));
  if (metricFirst && metricFirst[4]) return `${metricFirst[3]} | ${metricFirst[1]} ${metricFirst[2]} ${metricFirst[4]}`;

  return line;
}

// ─── Writing ingredients into steps ───────────────────────────────────────────

const PROTEINS = /^(chicken|beef|pork|turkey|lamb|salmon|shrimp|tofu|fish|steak)$/;

/** Words a step might use for an ingredient, most specific first: "chicken thigh" → thigh, chicken. */
function mentionsFor(key: string): string[] {
  const words = key.split(/\s+/).filter(Boolean);
  const terms = [words.join(' ')];
  if (words.length > 2) terms.push(words.slice(-2).join(' '));
  const last = words[words.length - 1];
  if (words.length > 1 && last && last.length >= 3) terms.push(last);
  if (words.length === 2 && PROTEINS.test(words[0])) terms.push(words[0]);
  return [...new Set(terms)];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentionPattern = (term: string) => {
  const stem = escapeRegExp(term).replace(/\\?\s+/g, '\\s+');
  const plural = term.endsWith('y') ? `${stem.slice(0, -1)}(?:y|ies)` : `${stem}(?:s|es)?`;
  // Take any amount the sentence already gives with it ("100g plain flour", "2 large eggs"): the token has its own.
  const amount = `(?:${QTY}\\s*(?:(?!min|hour|sec)[a-z]+\\s+)?(?:of\\s+)?)?`;
  return new RegExp(`(?<![\\w/.])${amount}(?:(?:the|your)\\s+)?${plural}\\b`, 'i');
};

/** Replace the first mention outside existing tokens with the token. False if there's no mention. */
function placeToken(step: string, pattern: RegExp, token: string): string | false {
  const parts = step.split(/(\[[^\]]*\])/);
  for (let i = 0; i < parts.length; i += 2) {
    if (pattern.test(parts[i])) {
      parts[i] = parts[i].replace(pattern, token);
      return parts.join('');
    }
  }
  return false;
}

/** Break up a step that is a whole paragraph, so cook mode shows it a piece at a time. */
function splitLongStep(step: string): string[] {
  if (step.length <= 450) return [step];
  const sentences = step.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [step];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 300) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Build our sections from a separate ingredient list and steps. */
export function buildSections(ingredients: string[], rawSections: { name: string; steps: string[] }[]): RecipeSection[] {
  const sections = rawSections
    .map((sec) => ({
      name: sec.name,
      steps: sec.steps.flatMap((s) => splitLongStep(s.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim())).filter(Boolean),
    }))
    .filter((sec) => sec.steps.length);
  if (!sections.length) return [];

  const lines = ingredients.map(normalizeIngredientLine).filter(Boolean);
  const parsed = lines.flatMap((line) => {
    const token = parseStepTokens(`[${line}]`)[0];
    return token?.kind === 'ingredient' && token.key ? [{ line, key: token.key }] : [];
  });

  // Longest names first, so "bell pepper" claims its mention before "pepper" can.
  const ordered = [...parsed].sort((a, b) => b.key.length - a.key.length);
  const unplaced: string[] = [];
  for (const { line, key } of ordered) {
    let placed = false;
    for (const term of mentionsFor(key)) {
      const pattern = mentionPattern(term);
      for (const sec of sections) {
        for (let i = 0; i < sec.steps.length && !placed; i++) {
          const next = placeToken(sec.steps[i], pattern, `[${line}]`);
          if (next) {
            sec.steps[i] = next;
            placed = true;
          }
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (!placed) unplaced.push(line);
  }

  if (unplaced.length) {
    // Back in the order the recipe listed them.
    const listed = parsed.map((p) => p.line).filter((line) => unplaced.includes(line));
    sections[0].steps.unshift(`Have ready: ${listed.map((line) => `[${line}]`).join(', ')}.`);
  }

  return sections.map((sec) => ({
    name: sec.name,
    steps: sec.steps.map((step) => withoutAsideTimers(smartAnnotateText(step, { quantities: false }))),
  }));
}

const ASIDE = /\b(if you|i prefer|i like|i bake|i cook|mine|the longer|the shorter|you can|you may|mark\b|depending|optional)/i;

/** "Bake 30 min. If you like it softer, stop at the 26 min mark": only the first is a timer to run. */
function withoutAsideTimers(step: string): string {
  return (step.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [step])
    .map((sentence) => (ASIDE.test(sentence) ? sentence.replace(/\[(\d[^\]]*\b(?:min|sec|hr)\b[^\]]*)\]/g, (_m, inner: string) => inner.replace(/\s+passive$/, '')) : sentence))
    .join('');
}

// ─── schema.org data ──────────────────────────────────────────────────────────

/** "PT1H30M" → 90. */
export function isoMinutes(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return undefined;
  const minutes = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return minutes > 0 ? Math.round(minutes) : undefined;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false;
  return asArray((node as Record<string, unknown>)['@type']).some((t) => typeof t === 'string' && /(^|[/#:])Recipe$/i.test(t));
}

function findRecipeNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (isRecipeNode(node)) return node;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const found = findRecipeNode(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

export function findJsonLdRecipe(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of scripts) {
    try {
      const found = findRecipeNode(JSON.parse(body.trim().replace(/^<!--|-->$/g, '')));
      if (found) return found;
    } catch {
      /* one malformed block shouldn't stop the others */
    }
  }
  return null;
}

/** Instructions come as a string, HowToSteps, or HowToSections holding HowToSteps. */
function readInstructions(value: unknown): { name: string; steps: string[] }[] {
  const main = { name: 'Main', steps: [] as string[] };
  const sections: { name: string; steps: string[] }[] = [];

  const stepText = (node: Record<string, unknown>) => cleanText(node.text) || cleanText(node.description) || cleanText(node.name);

  const visit = (item: unknown, target: { name: string; steps: string[] }) => {
    if (typeof item === 'string') {
      const text = /<(li|p|br)\b/i.test(item)
        ? item.split(/<\/(?:li|p)>|<br\s*\/?>/i).map(cleanText)
        : cleanText(item).split(/\s*\n+\s*|(?<=[.!?])\s+(?=\d+[.)]\s)/);
      target.steps.push(...text.map((s) => s.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, '').trim()).filter(Boolean));
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, target));
      return;
    }
    if (!item || typeof item !== 'object') return;
    const node = item as Record<string, unknown>;
    const children = node.itemListElement;
    if (children !== undefined) {
      const isSection = asArray(node['@type']).some((t) => typeof t === 'string' && /HowToSection/i.test(t));
      if (isSection) {
        const section = { name: cleanText(node.name).replace(/:$/, '').slice(0, 50) || 'Main', steps: [] as string[] };
        sections.push(section);
        visit(children, section);
      } else {
        visit(children, target);
      }
      return;
    }
    const text = stepText(node);
    if (text) target.steps.push(text);
  };

  visit(value, main);
  return [...(main.steps.length ? [main] : []), ...sections];
}

const CATEGORY_RULES: [RecipeCategory, RegExp][] = [
  ['breakfast', /breakfast|brunch|pancake|waffle|oatmeal|granola/i],
  ['dessert', /dessert|cookie|cake|brownie|pie\b|sweet|pudding|ice cream|tart\b/i],
  ['drink', /drink|beverage|cocktail|smoothie|latte|coffee|tea\b|lemonade/i],
  ['sauce', /sauce|condiment|dressing|staple|marinade|dip\b|spread/i],
  ['side', /side dish|side\b|sides\b|appetizer|starter|snack/i],
  ['lunch', /lunch|sandwich|salad|soup/i],
  ['dinner', /dinner|main|entr[eé]e|supper/i],
];

/** The first hint that says anything wins, so a site's own category beats a word in the title. */
function guessCategory(...hints: string[]): RecipeCategory {
  for (const text of hints) {
    for (const [category, rule] of CATEGORY_RULES) if (rule.test(text)) return category;
  }
  return 'dinner';
}

function firstNumber(value: unknown): number | undefined {
  for (const item of asArray(value)) {
    const m = String(item ?? '').match(/\d+(?:\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return undefined;
}

function firstUrl(value: unknown, base: string): string | undefined {
  for (const item of asArray(value)) {
    const raw = typeof item === 'string' ? item : item && typeof item === 'object' ? ((item as Record<string, unknown>).url ?? (item as Record<string, unknown>).contentUrl) : undefined;
    if (typeof raw !== 'string' || !raw) continue;
    try {
      const url = new URL(decodeEntities(raw), base);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

export function recipeFromJsonLd(node: Record<string, unknown>, pageUrl: string): ImportedRecipe | null {
  const ingredients = asArray(node.recipeIngredient ?? node.ingredients).map(cleanText).filter(Boolean);
  const sections = buildSections(ingredients, readInstructions(node.recipeInstructions));
  if (!sections.length) return null;

  const title = cleanText(node.name).slice(0, 100);
  const categoryText = asArray(node.recipeCategory).map(cleanText).join(' ');
  const keywords = asArray(node.keywords)
    .flatMap((k) => (typeof k === 'string' ? k.split(',') : []))
    .map(cleanText)
    .filter(Boolean);
  const cuisine = asArray(node.recipeCuisine).map(cleanText).filter(Boolean);

  const prep = isoMinutes(node.prepTime);
  const cook = isoMinutes(node.cookTime);
  const total = isoMinutes(node.totalTime);

  const nutrition = (node.nutrition && typeof node.nutrition === 'object' ? node.nutrition : {}) as Record<string, unknown>;
  const macros: RecipeMacros = {};
  const calories = firstNumber(nutrition.calories);
  const protein = firstNumber(nutrition.proteinContent);
  const carbs = firstNumber(nutrition.carbohydrateContent);
  const fat = firstNumber(nutrition.fatContent);
  if (calories) macros.calories = Math.round(calories);
  if (protein !== undefined) macros.protein = Math.round(protein);
  if (carbs !== undefined) macros.carbs = Math.round(carbs);
  if (fat !== undefined) macros.fat = Math.round(fat);

  return {
    title: title || 'Imported recipe',
    summary: cleanText(node.description).slice(0, 240),
    category: guessCategory(categoryText, title, keywords.join(' ')),
    servings: Math.min(48, Math.max(1, Math.round(firstNumber(node.recipeYield) ?? 4))),
    ...(prep ? { prepMinutes: prep } : {}),
    ...(cook ? { cookMinutes: cook } : !prep && total ? { cookMinutes: total } : {}),
    equipment: asArray(node.tool).map((t) => cleanText(typeof t === 'string' ? t : (t as Record<string, unknown>)?.name)).filter(Boolean).slice(0, 12),
    tags: [...new Set([...cuisine, ...keywords])].slice(0, 8).map((t) => t.slice(0, 32)),
    ...(Object.keys(macros).length ? { macros } : {}),
    sections,
    sourceUrl: pageUrl,
    imageUrl: firstUrl(node.image ?? node.thumbnailUrl, pageUrl),
  };
}

// ─── Plain text ───────────────────────────────────────────────────────────────

const INGREDIENT_HEAD = /^(?:#+\s*)?(?:the\s+)?ingredients?\s*:?$/i;
const STEPS_HEAD = /^(?:#+\s*)?(?:directions?|instructions?|method|steps?|preparation|how to make( it)?)\s*:?$/i;
const NUMBERED = /^\s*(?:step\s*)?\d+\s*[.):]\s*/i;
const STOP_HEAD = /^(?:#+\s*)?(?:notes?|nutrition|tips?|storage|video|related|you might also like|comments?|reviews?)\b.{0,20}:?$/i;

function looksLikeIngredient(line: string) {
  return new RegExp(`^[-*•]?\\s*${QTY}\\b`).test(line) && line.length < 90 && !/[.!?]$/.test(line);
}

/** Read a recipe out of pasted text: a list of ingredients and a list of steps, with or without headings. */
export function recipeFromText(text: string): ImportedRecipe | null {
  const lines = decodeEntities(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const ingredients: string[] = [];
  const steps: string[] = [];
  const before: string[] = [];
  let mode: 'before' | 'ingredients' | 'steps' | 'done' = 'before';

  for (const line of lines) {
    if (mode === 'done') break;
    if (INGREDIENT_HEAD.test(line)) {
      mode = 'ingredients';
    } else if (STEPS_HEAD.test(line)) {
      mode = 'steps';
    } else if (mode !== 'before' && STOP_HEAD.test(line)) {
      mode = 'done';
    } else if (mode === 'ingredients') {
      // "For the sauce:" labels a group; it isn't something to buy.
      if (!/:$/.test(line)) ingredients.push(line);
    } else if (mode === 'steps') {
      steps.push(line.replace(NUMBERED, ''));
    } else if (NUMBERED.test(line) && !looksLikeIngredient(line)) {
      steps.push(line.replace(NUMBERED, ''));
    } else if (looksLikeIngredient(line)) {
      ingredients.push(line);
    } else {
      before.push(line);
    }
  }

  // No headings or numbers: past the ingredient list, full sentences are the steps.
  if (!steps.length && mode === 'before') {
    const sentences = before.filter((l) => /[.!?]$/.test(l) && l.length > 25);
    steps.push(...sentences);
    for (const s of sentences) before.splice(before.indexOf(s), 1);
  }
  if (!steps.length) return null;

  const blob = lines.join(' ');
  const title = (before.find((l) => l.length <= 100 && !/[.!?]$/.test(l)) || 'Imported recipe').replace(/^#+\s*/, '');
  const yieldMatch = blob.match(/\b(?:serves|servings?|yields?|makes)\s*:?\s*(\d+)/i);
  return {
    title,
    summary: '',
    category: guessCategory(title),
    servings: yieldMatch ? Math.min(48, Math.max(1, Number(yieldMatch[1]))) : 4,
    equipment: [],
    tags: [],
    sections: buildSections(ingredients, [{ name: 'Main', steps }]),
  };
}

// ─── Whole pages ──────────────────────────────────────────────────────────────

function metaContent(html: string, property: string): string {
  const tag = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`, 'i').exec(html)?.[0];
  const m = tag?.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
  return cleanText(m?.[1] ?? m?.[2] ?? '');
}

/** A page's text with its structure left as line breaks, for pages with no recipe data. */
function pageText(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|br|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(body);
}

/** Best effort at a recipe from a page's HTML; null if there's nothing recognisable. */
export function recipeFromHtml(html: string, pageUrl: string): ImportedRecipe | null {
  const node = findJsonLdRecipe(html);
  const fromData = node ? recipeFromJsonLd(node, pageUrl) : null;
  if (fromData) return fromData;

  const fromText = recipeFromText(pageText(html));
  if (!fromText) return null;
  const title = metaContent(html, 'og:title') || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  return {
    ...fromText,
    title: title.slice(0, 100) || fromText.title,
    summary: metaContent(html, 'og:description').slice(0, 240),
    category: guessCategory(title),
    sourceUrl: pageUrl,
    imageUrl: firstUrl(metaContent(html, 'og:image'), pageUrl),
  };
}

export const isRecipeCategory = (value: unknown): value is RecipeCategory =>
  (RECIPE_CATEGORIES as readonly unknown[]).includes(value);
