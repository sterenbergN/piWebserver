// Engineering-style recipes. A recipe is authored once: each step embeds
// inline bracket tokens for ingredients (`[1/2 cup | 60 g flour]`), timers
// (`[12 min]`, `[15 min passive]`), and temperatures (`[375°F]`). The top Bill
// of Materials (shopping list) and parallel Gantt schedule are derived from
// the steps so numbers can never get out of sync.

export const RECIPE_CATEGORIES = [
  'breakfast',
  'lunch',
  'dinner',
  'side',
  'sauce',
  'dessert',
  'drink',
] as const;
export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<RecipeCategory, { label: string; emoji: string }> = {
  breakfast: { label: 'Breakfast', emoji: '🍳' },
  lunch: { label: 'Lunch', emoji: '🥪' },
  dinner: { label: 'Dinner', emoji: '🍗' },
  side: { label: 'Side', emoji: '🥗' },
  sauce: { label: 'Sauce / Staple', emoji: '🫙' },
  dessert: { label: 'Dessert', emoji: '🍪' },
  drink: { label: 'Drink', emoji: '☕' },
};

export type UnitMode = 'us' | 'metric' | 'both';

export type RecipeMacros = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

export type RecipeSection = {
  name: string;
  steps: string[];
  /**
   * The step (`"sectionIndex:stepIndex"`) of another section this one has to
   * be ready for, e.g. a glaze poured in at the chicken's last step. Unset:
   * the section finishes with the dish.
   */
  readyBy?: string;
};

export type Recipe = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: RecipeCategory;
  servings: number;
  prepMinutes?: number;
  cookMinutes?: number;
  equipment: string[];
  tags: string[];
  photo?: string;
  macros?: RecipeMacros;
  rating?: number;
  notes?: string;
  timesCooked: number;
  lastCookedAt?: string;
  sections: RecipeSection[];
  /** Workout account that created it (may delete it); never sent to the browser. */
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RecipesData = {
  version: 1;
  recipes: Recipe[];
};

export class RecipeInputError extends Error {}

// ─── Token Types ───────────────────────────────────────────────────────────────

export type IngredientToken = {
  kind: 'ingredient';
  raw: string;
  /** Canonical key for summing across steps and pantry matching. */
  key: string;
  /** Display name as written in this step (e.g. "garlic cloves, minced"). */
  name: string;
  /** Clean base name for the top shopping list (e.g. "Garlic cloves"). */
  baseName: string;
  usQty: number | null;
  usUnit: string;
  metricQty: number | null;
  metricUnit: string;
};

export type TimerToken = {
  kind: 'timer';
  raw: string;
  /** Upper-bound seconds for countdowns & Gantt scheduling. */
  seconds: number;
  minutes: number;
  /** Display text (e.g. "5–6 min" or "15 min"). */
  label: string;
  passive: boolean;
};

export type TempToken = {
  kind: 'temp';
  raw: string;
  fahrenheit: number;
  celsius: number;
};

export type TextSegment =
  | { kind: 'text'; text: string }
  | IngredientToken
  | TimerToken
  | TempToken;

export type Amount = Pick<IngredientToken, 'usQty' | 'usUnit' | 'metricQty' | 'metricUnit'>;

export type BomItem = Amount & {
  key: string;
  name: string;
  /** Amounts that can't be added to the main one (e.g. `3 cloves` + `1 tbsp`), listed as `+ …`. */
  extras: Amount[];
  /** `"sectionIndex:stepIndex"` keys of every step that uses this ingredient. */
  stepKeys: string[];
};

export type GanttBlock = {
  sectionIndex: number;
  sectionName: string;
  stepIndex: number;
  stepKey: string;
  label: string;
  durationMin: number;
  startMin: number;
  endMin: number;
  passive: boolean;
};

export type GanttTrack = {
  sectionIndex: number;
  sectionName: string;
  durationMin: number;
  startOffsetMin: number;
  blocks: GanttBlock[];
};

export type RecipeSchedule = {
  totalMinutes: number;
  activeMinutes: number;
  passiveMinutes: number;
  tracks: GanttTrack[];
};

// ─── Unit & Number Parsing ─────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '½': 0.5,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** Parse numbers like `"1.5"`, `"1/2"`, `"1 1/2"`, `"½"`, or `"1½"`. */
export function parseQuantity(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  for (const [ch, val] of Object.entries(UNICODE_FRACTIONS)) {
    if (s === ch) return val;
    if (s.endsWith(ch)) {
      const whole = Number(s.slice(0, -ch.length).trim());
      if (Number.isFinite(whole)) return whole + val;
    }
  }
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    return den ? Number(mixed[1]) + Number(mixed[2]) / den : null;
  }
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den ? Number(frac[1]) / den : null;
  }
  const num = Number(s);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/** Format a scaled number using clean kitchen fractions where appropriate. */
export function formatQuantity(n: number, isMetric = false): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (isMetric) {
    if (n >= 10) return String(Math.round(n));
    return Number(n.toFixed(1)).toString();
  }
  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(rounded + 1e-6);
  const rem = rounded - whole;
  const fracs: [number, string][] = [
    [0.125, '⅛'],
    [0.25, '¼'],
    [1 / 3, '⅓'],
    [0.375, '⅜'],
    [0.5, '½'],
    [0.625, '⅝'],
    [2 / 3, '⅔'],
    [0.75, '¾'],
    [0.875, '⅞'],
  ];
  if (rem < 0.04) return String(whole);
  if (rem > 0.96) return String(whole + 1);
  for (const [val, sym] of fracs) {
    if (Math.abs(rem - val) < 0.045) {
      return whole > 0 ? `${whole} ${sym}` : sym;
    }
  }
  return Number(rounded.toFixed(1)).toString();
}

const UNIT_ALIASES: Record<string, string> = {
  c: 'cup',
  cup: 'cup',
  cups: 'cup',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  floz: 'fl oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'L',
  liter: 'L',
  liters: 'L',
  clove: 'cloves',
  cloves: 'cloves',
  slice: 'slices',
  slices: 'slices',
  can: 'cans',
  cans: 'cans',
  bunch: 'bunch',
  pinch: 'pinch',
  dash: 'dash',
  sprig: 'sprigs',
  sprigs: 'sprigs',
  stalk: 'stalks',
  stalks: 'stalks',
  head: 'head',
  piece: 'pieces',
  pieces: 'pieces',
};

/** Grams per US cup for common dry/viscous ingredients so volume converts to weight accurately. */
const GRAMS_PER_CUP: [RegExp, number][] = [
  [/flour|cornstarch|cocoa/i, 120],
  [/brown sugar/i, 215],
  [/powdered sugar|confectioners/i, 120],
  [/sugar/i, 200],
  [/butter/i, 227],
  [/honey|maple syrup|molasses/i, 340],
  [/oats/i, 90],
  [/rice/i, 185],
  [/milk|cream|buttermilk|yogurt|water|broth|stock/i, 240],
  [/oil/i, 218],
  [/cheese|parmesan|cheddar|mozzarella/i, 110],
];

function gramsPerCupFor(name: string): number | null {
  for (const [re, grams] of GRAMS_PER_CUP) {
    if (re.test(name)) return grams;
  }
  return null;
}

const METRIC_UNITS = new Set(['g', 'kg', 'ml', 'L']);
const US_VOLUME_TO_ML: Record<string, number> = {
  cup: 240,
  tbsp: 15,
  tsp: 5,
  'fl oz': 30,
};
const US_WEIGHT_TO_G: Record<string, number> = {
  lb: 453.592,
  oz: 28.3495,
};

function convertUnits(
  qty: number | null,
  unit: string,
  name: string,
): { usQty: number | null; usUnit: string; metricQty: number | null; metricUnit: string } {
  if (qty === null) {
    return { usQty: null, usUnit: unit, metricQty: null, metricUnit: unit };
  }
  if (!unit) {
    return { usQty: qty, usUnit: '', metricQty: qty, metricUnit: '' };
  }
  if (METRIC_UNITS.has(unit)) {
    if (unit === 'g') {
      return {
        usQty: qty >= 450 ? qty / 453.592 : qty / 28.3495,
        usUnit: qty >= 450 ? 'lb' : 'oz',
        metricQty: qty,
        metricUnit: 'g',
      };
    }
    if (unit === 'kg') {
      return { usQty: qty * 2.20462, usUnit: 'lb', metricQty: qty, metricUnit: 'kg' };
    }
    if (unit === 'ml') {
      return {
        usQty: qty >= 60 ? qty / 240 : qty >= 15 ? qty / 15 : qty / 5,
        usUnit: qty >= 60 ? 'cup' : qty >= 15 ? 'tbsp' : 'tsp',
        metricQty: qty,
        metricUnit: 'ml',
      };
    }
    if (unit === 'L') {
      return { usQty: (qty * 1000) / 240, usUnit: 'cup', metricQty: qty, metricUnit: 'L' };
    }
  }
  if (unit in US_WEIGHT_TO_G) {
    const grams = qty * US_WEIGHT_TO_G[unit];
    return {
      usQty: qty,
      usUnit: unit,
      metricQty: grams,
      metricUnit: 'g',
    };
  }
  if (unit in US_VOLUME_TO_ML) {
    const gPerCup = gramsPerCupFor(name);
    if (gPerCup !== null && unit !== 'fl oz') {
      const cups = (qty * US_VOLUME_TO_ML[unit]) / 240;
      return {
        usQty: qty,
        usUnit: unit,
        metricQty: cups * gPerCup,
        metricUnit: 'g',
      };
    }
    if (/kosher salt|sea salt|table salt|^salt$/i.test(name) && (unit === 'tsp' || unit === 'tbsp')) {
      const tspCount = unit === 'tbsp' ? qty * 3 : qty;
      return {
        usQty: qty,
        usUnit: unit,
        metricQty: tspCount * 6,
        metricUnit: 'g',
      };
    }
    const ml = qty * US_VOLUME_TO_ML[unit];
    return {
      usQty: qty,
      usUnit: unit,
      metricQty: ml,
      metricUnit: 'ml',
    };
  }
  return { usQty: qty, usUnit: unit, metricQty: qty, metricUnit: unit };
}

/** Canonical ingredient key so `"garlic cloves, minced"` and `"garlic"` match cleanly. */
export function canonicalIngredientKey(rawName: string): string {
  const withoutPrep = rawName
    .split(',')[0]
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(fresh|freshly|finely|coarsely|thinly|chopped|minced|diced|sliced|grated|divided|melted|softened|room temperature|to taste|optional|large|medium|small|boneless|skinless|bone-in|skin-on|low-sodium|unsalted|all-purpose|kosher)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const base = withoutPrep || rawName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return base
    .split(/\s+/)
    .map((w) => {
      if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
      if (w.length > 4 && /(?:oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
      if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
      return w;
    })
    .join(' ');
}

function cleanBaseName(rawName: string): string {
  const beforeComma = rawName.split(',')[0].replace(/\s+/g, ' ').trim();
  if (!beforeComma) return rawName.trim();
  return beforeComma.charAt(0).toUpperCase() + beforeComma.slice(1);
}

function parseQtyAndUnit(part: string): { qty: number | null; unit: string; rest: string } {
  const trimmed = part.trim();
  const m = trimmed.match(/^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\d*[¼⅓⅔½¾⅛⅜⅝⅞]))\s*(.*)$/);
  if (!m) return { qty: null, unit: '', rest: trimmed };
  const qty = parseQuantity(m[1]);
  const afterQty = m[2].trim();
  if (!afterQty) return { qty, unit: '', rest: '' };

  const flOz = afterQty.match(/^fl\.?\s*oz\.?(?:\s+(.*))?$/i);
  if (flOz) return { qty, unit: 'fl oz', rest: (flOz[1] || '').trim() };

  const firstWord = afterQty.match(/^([a-zA-Z]+)\.?(?:\s+(.*))?$/);
  if (firstWord) {
    const alias = UNIT_ALIASES[firstWord[1].toLowerCase()];
    if (alias && firstWord[2]) {
      return { qty, unit: alias, rest: firstWord[2].trim() };
    }
    if (alias && !firstWord[2]) {
      return { qty, unit: alias, rest: '' };
    }
  }
  return { qty, unit: '', rest: afterQty };
}

function parseBracketToken(content: string): IngredientToken | TimerToken | TempToken {
  const raw = content.trim();

  // 1. Temperature: e.g. "375°F", "400 F", "200°C", "175°F / 80°C". Without
  // the degree sign only a capital F/C counts, so "[2 c]" stays 2 cups.
  const tempMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*(°?)\s*([FCfc])(?:\s*(?:\/|\()\s*-?\d+(?:\.\d+)?\s*°?\s*[FCfc]\)?)?$/);
  if (tempMatch && (tempMatch[2] || /[FC]/.test(tempMatch[3]))) {
    const val = Number(tempMatch[1]);
    const unit = tempMatch[3].toUpperCase();
    const fahrenheit = unit === 'F' ? Math.round(val) : Math.round((val * 9) / 5 + 32);
    const celsius = unit === 'C' ? Math.round(val) : Math.round(((val - 32) * 5) / 9);
    return { kind: 'temp', raw, fahrenheit, celsius };
  }

  // 2. Timer: e.g. "12 min", "5-6 min", "45 sec", "1.5 hr", "15 min passive"
  const timerMatch = raw.match(
    /^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(sec|secs|second|seconds|s|min|mins|minute|minutes|m|hr|hrs|hour|hours|h)(?:\s+(passive|wait|rest|active))?$/i,
  );
  if (timerMatch) {
    const low = Number(timerMatch[1]);
    const high = timerMatch[2] ? Number(timerMatch[2]) : low;
    const u = timerMatch[3].toLowerCase();
    const mult = u.startsWith('h') ? 3600 : u.startsWith('s') ? 1 : 60;
    const seconds = Math.max(1, Math.round(high * mult));
    const minutes = Math.round((seconds / 60) * 10) / 10;
    const unitShort = u.startsWith('h') ? 'hr' : u.startsWith('s') ? 'sec' : 'min';
    const rangeText = timerMatch[2] ? `${low}–${high} ${unitShort}` : `${low} ${unitShort}`;
    const passive = Boolean(timerMatch[4] && /passive|wait|rest/i.test(timerMatch[4]));
    return {
      kind: 'timer',
      raw,
      seconds,
      minutes,
      label: passive ? `${rangeText} (passive)` : rangeText,
      passive,
    };
  }

  // 3. Ingredient with explicit US | Metric split: "[1/2 cup | 60 g all-purpose flour]"
  if (raw.includes('|')) {
    const [left, right] = raw.split('|').map((s) => s.trim());
    const usParsed = parseQtyAndUnit(left);
    const mParsed = parseQtyAndUnit(right);
    const name = (mParsed.rest || usParsed.rest || raw).replace(/^of\s+/i, '').trim();
    return {
      kind: 'ingredient',
      raw,
      key: canonicalIngredientKey(name),
      name,
      baseName: cleanBaseName(name),
      usQty: usParsed.qty,
      usUnit: usParsed.unit,
      metricQty: mParsed.qty,
      metricUnit: mParsed.unit,
    };
  }

  // 4. Standard single ingredient token: "[1/2 cup flour]" or "[6 cloves garlic, minced]"
  const parsed = parseQtyAndUnit(raw);
  const name = (parsed.rest || raw).replace(/^of\s+/i, '').trim();
  const conv = convertUnits(parsed.qty, parsed.unit, name);
  return {
    kind: 'ingredient',
    raw,
    key: canonicalIngredientKey(name),
    name,
    baseName: cleanBaseName(name),
    ...conv,
  };
}

/** Parse a step string into plain text and structured `[...]` tokens. */
export function parseStepTokens(step: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /\[([^\[\]]+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(step)) !== null) {
    if (match.index > last) {
      segments.push({ kind: 'text', text: step.slice(last, match.index) });
    }
    segments.push(parseBracketToken(match[1]));
    last = match.index + match[0].length;
  }
  if (last < step.length) {
    segments.push({ kind: 'text', text: step.slice(last) });
  }
  return segments;
}

/** Format an ingredient's scaled amount according to `unitMode` (`us`, `metric`, or `both`). */
export function formatIngredientAmount(
  item: Pick<IngredientToken, 'usQty' | 'usUnit' | 'metricQty' | 'metricUnit'>,
  scale: number,
  unitMode: UnitMode,
): string {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const us =
    item.usQty !== null
      ? `${formatQuantity(item.usQty * s, false)}${item.usUnit ? ` ${item.usUnit}` : ''}`
      : '';
  const metric =
    item.metricQty !== null
      ? `${formatQuantity(item.metricQty * s, METRIC_UNITS.has(item.metricUnit))}${item.metricUnit ? ` ${item.metricUnit}` : ''}`
      : '';

  if (unitMode === 'us') return us || metric;
  if (unitMode === 'metric') return metric || us;
  if (us && metric && us !== metric) return `${us} (${metric})`;
  return us || metric;
}

/** A shopping-list amount: the summed amount plus any that couldn't be added (`3 cloves + 1 tbsp`). */
export function formatBomAmount(item: BomItem, scale: number, unitMode: UnitMode): string {
  return [item, ...item.extras]
    .map((amount) => formatIngredientAmount(amount, scale, unitMode))
    .filter(Boolean)
    .join(' + ');
}

export function formatTemp(token: TempToken, unitMode: UnitMode): string {
  if (unitMode === 'us') return `${token.fahrenheit}°F`;
  if (unitMode === 'metric') return `${token.celsius}°C`;
  return `${token.fahrenheit}°F (${token.celsius}°C)`;
}

// ─── Bill of Materials (BOM) Extraction & Summing ─────────────────────────────

type Sum = { qty: number; unit: string } | null;

function addUsQuantities(q1: number, u1: string, q2: number, u2: string): Sum {
  if (u1 === u2) return { qty: q1 + q2, unit: u1 };
  if (u1 in US_VOLUME_TO_ML && u2 in US_VOLUME_TO_ML) {
    const totalMl = q1 * US_VOLUME_TO_ML[u1] + q2 * US_VOLUME_TO_ML[u2];
    if (totalMl >= 60) return { qty: totalMl / 240, unit: 'cup' };
    if (totalMl >= 15) return { qty: totalMl / 15, unit: 'tbsp' };
    return { qty: totalMl / 5, unit: 'tsp' };
  }
  if (u1 in US_WEIGHT_TO_G && u2 in US_WEIGHT_TO_G) {
    const totalG = q1 * US_WEIGHT_TO_G[u1] + q2 * US_WEIGHT_TO_G[u2];
    if (totalG >= 453.592) return { qty: totalG / 453.592, unit: 'lb' };
    return { qty: totalG / 28.3495, unit: 'oz' };
  }
  return null;
}

const METRIC_BASE: Record<string, [base: 'g' | 'ml', factor: number]> = {
  g: ['g', 1],
  kg: ['g', 1000],
  ml: ['ml', 1],
  L: ['ml', 1000],
};

function addMetricQuantities(q1: number, u1: string, q2: number, u2: string): Sum {
  if (u1 === u2) return { qty: q1 + q2, unit: u1 };
  const a = METRIC_BASE[u1];
  const b = METRIC_BASE[u2];
  if (!a || !b || a[0] !== b[0]) return null;
  const total = q1 * a[1] + q2 * b[1];
  return total >= 1000 ? { qty: total / 1000, unit: a[0] === 'g' ? 'kg' : 'L' } : { qty: total, unit: a[0] };
}

/**
 * Add two amounts, or null when either the US or the metric side can't be
 * added: both sides are summed or neither, so they never disagree.
 */
function addAmounts(a: Amount, b: Amount): Amount | null {
  const empty = (x: Amount) => x.usQty === null && x.metricQty === null;
  if (empty(b)) return a;
  if (empty(a)) return b;
  const side = (q1: number | null, u1: string, q2: number | null, u2: string, add: typeof addUsQuantities) => {
    if (q1 === null && q2 === null) return { qty: null, unit: u1 };
    if (q1 === null || q2 === null) return null;
    return add(q1, u1, q2, u2);
  };
  const us = side(a.usQty, a.usUnit, b.usQty, b.usUnit, addUsQuantities);
  const metric = side(a.metricQty, a.metricUnit, b.metricQty, b.metricUnit, addMetricQuantities);
  if (!us || !metric) return null;
  return { usQty: us.qty, usUnit: us.unit, metricQty: metric.qty, metricUnit: metric.unit };
}

/**
 * Extract and sum the complete Bill of Materials from a recipe's steps.
 * If an ingredient is used across multiple steps, its quantities are summed
 * (amounts in units that can't be added are kept as `extras`) and all
 * referencing `stepKeys` (`"sectionIdx:stepIdx"`) are recorded.
 */
export function extractIngredients(recipe: Pick<Recipe, 'sections'>): BomItem[] {
  const map = new Map<string, BomItem>();
  recipe.sections.forEach((sec, sIdx) => {
    sec.steps.forEach((step, stIdx) => {
      const stepKey = `${sIdx}:${stIdx}`;
      for (const seg of parseStepTokens(step)) {
        if (seg.kind !== 'ingredient' || !seg.key) continue;
        const amount: Amount = {
          usQty: seg.usQty,
          usUnit: seg.usUnit,
          metricQty: seg.metricQty,
          metricUnit: seg.metricUnit,
        };
        const existing = map.get(seg.key);
        if (!existing) {
          map.set(seg.key, { key: seg.key, name: seg.baseName, ...amount, extras: [], stepKeys: [stepKey] });
          continue;
        }
        if (!existing.stepKeys.includes(stepKey)) existing.stepKeys.push(stepKey);
        const main = addAmounts(existing, amount);
        if (main) {
          Object.assign(existing, main);
          continue;
        }
        const extraIdx = existing.extras.findIndex((extra) => addAmounts(extra, amount));
        if (extraIdx >= 0) existing.extras[extraIdx] = addAmounts(existing.extras[extraIdx], amount)!;
        else existing.extras.push(amount);
      }
    });
  });
  return [...map.values()];
}

// ─── Back-Scheduled Parallel Gantt Timeline ───────────────────────────────────

function stepSummaryLabel(step: string, index: number): string {
  // Tokens read as words ("Pat chicken thighs dry"), not as their raw "2 lb | 900 g" text.
  const plain = parseStepTokens(step)
    .map((seg) => (seg.kind === 'text' ? seg.text : seg.kind === 'ingredient' ? seg.name : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const firstClause = plain.split(/[.;:—–]/)[0].trim();
  const words = firstClause.split(/\s+/).slice(0, 4).join(' ');
  return words || `Step ${index + 1}`;
}

/** `"sectionIndex:stepIndex"` → indices, or null. */
export function parseStepKey(key: unknown): { section: number; step: number } | null {
  const m = typeof key === 'string' ? key.match(/^(\d{1,3}):(\d{1,3})$/) : null;
  return m ? { section: Number(m[1]), step: Number(m[2]) } : null;
}

/**
 * Build a parallel Gantt schedule across all sections of a recipe.
 * Each section is a sub-assembly track, back-scheduled so it finishes with
 * the dish, or, when it has a `readyBy` step, just as that step starts.
 */
export function buildSchedule(recipe: Pick<Recipe, 'sections' | 'prepMinutes' | 'cookMinutes'>): RecipeSchedule {
  let activeMinutes = 0;
  let passiveMinutes = 0;

  const rawTracks = recipe.sections.map((sec, sIdx) => {
    let cursor = 0;
    const blocks: GanttBlock[] = [];
    sec.steps.forEach((step, stIdx) => {
      const tokens = parseStepTokens(step);
      const timers = tokens.filter((t): t is TimerToken => t.kind === 'timer');
      const minutesOf = (list: TimerToken[]) => list.reduce((sum, t) => sum + Math.max(0.5, t.minutes), 0);
      const stepMin = timers.length ? minutesOf(timers) : 2; // default 2 min for untimed prep action
      const passiveMin = minutesOf(timers.filter((t) => t.passive));
      const passive = timers.length > 0 && passiveMin === stepMin;
      activeMinutes += stepMin - passiveMin;
      passiveMinutes += passiveMin;

      blocks.push({
        sectionIndex: sIdx,
        sectionName: sec.name || 'Main',
        stepIndex: stIdx,
        stepKey: `${sIdx}:${stIdx}`,
        label: stepSummaryLabel(step, stIdx),
        durationMin: Math.round(stepMin * 10) / 10,
        startMin: cursor,
        endMin: cursor + stepMin,
        passive,
      });
      cursor += stepMin;
    });
    return {
      sectionIndex: sIdx,
      sectionName: sec.name || 'Main',
      durationMin: Math.round(cursor * 10) / 10,
      startOffsetMin: 0,
      blocks,
    };
  });

  // Where each track ends (relative; may go negative before shifting): a
  // section with a valid `readyBy` ends as that step starts, the rest when
  // the longest track does. A cycle of readyBy falls back to the end.
  const lastEnd = Math.max(0, ...rawTracks.map((t) => t.durationMin));
  const ends = new Map<number, number>();
  const endOf = (sIdx: number, visiting: Set<number>): number => {
    const known = ends.get(sIdx);
    if (known !== undefined) return known;
    let end = lastEnd;
    const target = parseStepKey(recipe.sections[sIdx]?.readyBy);
    const block = target ? rawTracks[target.section]?.blocks[target.step] : undefined;
    if (target && block && target.section !== sIdx && !visiting.has(sIdx)) {
      visiting.add(sIdx);
      const targetTrack = rawTracks[target.section];
      end = endOf(target.section, visiting) - targetTrack.durationMin + block.startMin;
      visiting.delete(sIdx);
    }
    ends.set(sIdx, end);
    return end;
  };
  const starts = rawTracks.map((t) => endOf(t.sectionIndex, new Set()) - t.durationMin);
  const shift = -Math.min(0, ...starts);
  const span = Math.max(0, ...rawTracks.map((t, i) => starts[i] + shift + t.durationMin));

  const manualTotal = (recipe.prepMinutes || 0) + (recipe.cookMinutes || 0);
  const totalMinutes = Math.max(Math.round(span), manualTotal || Math.round(span));

  const tracks: GanttTrack[] = rawTracks.map((t, i) => {
    const offset = Math.max(0, Math.round((starts[i] + shift) * 10) / 10);
    return {
      ...t,
      startOffsetMin: offset,
      blocks: t.blocks.map((b) => ({
        ...b,
        startMin: Math.round((b.startMin + offset) * 10) / 10,
        endMin: Math.round((b.endMin + offset) * 10) / 10,
      })),
    };
  });

  return {
    totalMinutes,
    activeMinutes: Math.round(activeMinutes),
    passiveMinutes: Math.round(passiveMinutes),
    tracks,
  };
}

// ─── Pantry / Fridge Matcher ──────────────────────────────────────────────────

const PANTRY_FREEBIES = new Set(['water', 'salt', 'black pepper', 'pepper', 'ice']);

export function matchPantry(
  recipe: Pick<Recipe, 'sections'>,
  pantryQuery: string,
): { matched: number; total: number; ratio: number; missing: string[] } {
  const haveTerms = pantryQuery
    .split(/[,;\n]+|\s+and\s+/i)
    .map((s) => canonicalIngredientKey(s))
    .filter(Boolean);
  const bom = extractIngredients(recipe).filter((item) => !PANTRY_FREEBIES.has(item.key));
  if (!bom.length) return { matched: 0, total: 0, ratio: 1, missing: [] };
  if (!haveTerms.length) return { matched: 0, total: bom.length, ratio: 0, missing: bom.map((b) => b.name) };

  // Whole words, either way round: "chicken" covers "chicken thigh" and
  // "jasmine rice" covers "rice", but "egg" doesn't cover "eggplant".
  const covers = (outer: string[], inner: string[]) => inner.every((w) => outer.includes(w));
  const missing: string[] = [];
  let matched = 0;
  for (const item of bom) {
    const keyWords = item.key.split(/\s+/);
    const hasIt = haveTerms.some((term) => {
      const termWords = term.split(/\s+/);
      return covers(keyWords, termWords) || covers(termWords, keyWords);
    });
    if (hasIt) matched++;
    else missing.push(item.name);
  }
  return {
    matched,
    total: bom.length,
    ratio: matched / bom.length,
    missing,
  };
}

// ─── Smart Paste Auto-Annotator ───────────────────────────────────────────────

const STOP_WORDS = new Set(
  'and or in to into with until for on over from at by of as then the a an while til'.split(' '),
);

/**
 * Convert plain-text recipe instructions into bracket-annotated steps:
 * wraps temperatures (`375°F`), durations (`12 minutes`), and common
 * `quantity + unit + ingredient` phrases (`1/2 cup flour`) in `[...]`.
 */
export function smartAnnotateText(raw: string): string {
  // Don't double-wrap existing brackets.
  const placeholders: string[] = [];
  let text = raw.replace(/\[[^\]]+\]/g, (m) => {
    placeholders.push(m);
    return `__BRACKET_${placeholders.length - 1}__`;
  });

  // 1. Wrap temperatures: e.g. 375°F, 400 F, 200°C
  text = text.replace(/\b(\d{2,3}\s*°\s*[FCfc]|\d{3}\s*degrees\s*[FCfc]?)\b/g, (m) => {
    const clean = m.replace(/degrees\s*/i, '°').replace(/\s+/g, '');
    return `[${clean.endsWith('°') ? `${clean}F` : clean}]`;
  });

  // 2. Wrap durations: e.g. "12 minutes", "5-6 min", "45 seconds"
  text = text.replace(
    /\b(?:(rest|resting|cool|cooling|chill|steep|marinate|stand|let\s+sit)(?:\s+for)?\s+)?(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s*(minutes|minute|mins|min|seconds|second|secs|sec|hours|hour|hrs|hr)\b/gi,
    (m, passiveVerb, num, unit) => {
      const u = /^h/i.test(unit) ? 'hr' : /^s/i.test(unit) ? 'sec' : 'min';
      const prefix = passiveVerb ? m.slice(0, m.toLowerCase().indexOf(String(num).toLowerCase())) : '';
      const suffix = passiveVerb ? ' passive' : '';
      return `${prefix}[${num.replace(/\s+/g, '')} ${u}${suffix}]`;
    },
  );

  // 3. Wrap quantity + unit + 1–3 ingredient words: e.g. "1/2 cup all-purpose flour".
  // The name stops at the first linking word, so "1 cup milk until smooth" wraps just "1 cup milk".
  text = text.replace(
    /(?<![\w¼⅓⅔½¾⅛/.])((?:\d*[¼⅓⅔½¾⅛]|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|cloves?)\s+(?:of\s+)?)([a-zA-Z][a-zA-Z-]*(?:\s+[a-zA-Z][a-zA-Z-]*){0,2})/g,
    (m, amount: string, words: string) => {
      const list = words.split(/\s+/);
      const stop = list.findIndex((w) => STOP_WORDS.has(w.toLowerCase()));
      const name = (stop < 0 ? list : list.slice(0, stop)).join(' ');
      if (!name) return m;
      return `[${amount}${name}]${words.slice(name.length)}`;
    },
  );

  return text.replace(/__BRACKET_(\d+)__/g, (_m, idx) => placeholders[Number(idx)]);
}

// ─── Normalization & Validation ───────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'recipe';
}

export function normalizeRecipe(input: any, existing?: Recipe, now = new Date().toISOString()): Recipe {
  const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 100) : '';
  if (!title) throw new RecipeInputError('Give the recipe a title.');
  const summary = typeof input?.summary === 'string' ? input.summary.trim().slice(0, 240) : '';
  const category: RecipeCategory = RECIPE_CATEGORIES.includes(input?.category) ? input.category : 'dinner';
  const servings = Math.min(48, Math.max(1, Math.round(Number(input?.servings) || 4)));

  // Empty steps and sections are dropped, so `readyBy` (written against the
  // editor's indices) is mapped onto the kept ones, or dropped if its step went.
  const rawSections: any[] = Array.isArray(input?.sections) ? input.sections.slice(0, 20) : [];
  const sectionIndex = new Map<number, number>();
  const stepIndex = new Map<string, number>();
  const kept: { name: string; steps: string[]; readyBy: unknown }[] = [];
  rawSections.forEach((sec, i) => {
    const steps: string[] = [];
    (Array.isArray(sec?.steps) ? sec.steps.slice(0, 60) : []).forEach((s: unknown, j: number) => {
      const text = typeof s === 'string' ? s.trim().slice(0, 1200) : '';
      if (!text) return;
      stepIndex.set(`${i}:${j}`, steps.length);
      steps.push(text);
    });
    if (!steps.length) return;
    sectionIndex.set(i, kept.length);
    kept.push({
      name: typeof sec?.name === 'string' ? sec.name.trim().slice(0, 50) : 'Main',
      steps,
      readyBy: sec?.readyBy,
    });
  });
  const sections: RecipeSection[] = kept.map(({ name, steps, readyBy }, i) => {
    const target = parseStepKey(readyBy);
    const section = target ? sectionIndex.get(target.section) : undefined;
    const step = target ? stepIndex.get(`${target.section}:${target.step}`) : undefined;
    return section !== undefined && step !== undefined && section !== i
      ? { name, steps, readyBy: `${section}:${step}` }
      : { name, steps };
  });

  if (sections.length === 0) {
    throw new RecipeInputError('Add at least one step to the recipe.');
  }

  const equipment = Array.isArray(input?.equipment)
    ? [...new Set<string>(input.equipment.map((e: any) => String(e || '').trim().slice(0, 32)).filter(Boolean))].slice(0, 12)
    : [];
  const tags = Array.isArray(input?.tags)
    ? [...new Set<string>(input.tags.map((t: any) => String(t || '').trim().slice(0, 32)).filter(Boolean))].slice(0, 12)
    : [];

  const prepMinutes = Number(input?.prepMinutes) > 0 ? Math.min(1440, Math.round(Number(input.prepMinutes))) : undefined;
  const cookMinutes = Number(input?.cookMinutes) > 0 ? Math.min(1440, Math.round(Number(input.cookMinutes))) : undefined;

  const macros: RecipeMacros = {};
  if (Number(input?.macros?.calories) > 0) macros.calories = Math.round(Number(input.macros.calories));
  if (Number(input?.macros?.protein) >= 0 && input?.macros?.protein !== '' && input?.macros?.protein !== undefined) {
    macros.protein = Math.round(Number(input.macros.protein));
  }
  if (Number(input?.macros?.carbs) >= 0 && input?.macros?.carbs !== '' && input?.macros?.carbs !== undefined) {
    macros.carbs = Math.round(Number(input.macros.carbs));
  }
  if (Number(input?.macros?.fat) >= 0 && input?.macros?.fat !== '' && input?.macros?.fat !== undefined) {
    macros.fat = Math.round(Number(input.macros.fat));
  }

  // A rating sent as null (or out of range) clears it; one left out keeps the old one.
  const ratingInput = input && 'rating' in input ? input.rating : existing?.rating;
  const rating =
    Number(ratingInput) >= 1 && Number(ratingInput) <= 10 ? Math.round(Number(ratingInput) * 10) / 10 : undefined;
  const notes = typeof input?.notes === 'string' ? input.notes.trim().slice(0, 1000) : existing?.notes;
  const photo = isRecipePhotoSrc(input?.photo) ? input.photo : undefined;

  const id = existing?.id || (typeof input?.id === 'string' && /^[\w-]{1,48}$/.test(input.id) ? input.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
  const slug = existing?.slug || slugify(title);

  return {
    id,
    slug,
    title,
    summary,
    category,
    servings,
    ...(prepMinutes ? { prepMinutes } : {}),
    ...(cookMinutes ? { cookMinutes } : {}),
    equipment,
    tags,
    ...(photo ? { photo } : {}),
    ...(Object.keys(macros).length ? { macros } : {}),
    ...(rating ? { rating } : {}),
    ...(notes ? { notes } : {}),
    timesCooked: Math.max(0, Math.round(Number(existing?.timesCooked ?? input?.timesCooked ?? 0))),
    ...(existing?.lastCookedAt || input?.lastCookedAt ? { lastCookedAt: existing?.lastCookedAt || input?.lastCookedAt } : {}),
    sections,
    ...(existing?.ownerId ? { ownerId: existing.ownerId } : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

/** Where uploaded dish photos are served from (see lib/recipes/photos.ts). */
export const RECIPE_PHOTO_PREFIX = '/api/media/uploads/recipes/';

/** Only photos uploaded through the recipe form are accepted on a recipe. */
export function isRecipePhotoSrc(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith(RECIPE_PHOTO_PREFIX) && /^[a-z0-9-]{8,64}\.webp$/.test(src.slice(RECIPE_PHOTO_PREFIX.length));
}

/** A recipe as sent to the browser (without who created it). */
export function publicRecipe({ ownerId: _ownerId, ...recipe }: Recipe): Recipe {
  return recipe;
}

// ─── Seeded Starter Recipes ───────────────────────────────────────────────────

export const DEFAULT_RECIPES: Recipe[] = [
  {
    id: 'crispy-honey-garlic-chicken',
    slug: 'crispy-honey-garlic-chicken',
    title: 'Crispy Cold-Pan Honey-Garlic Chicken Thighs',
    summary: 'Skin-on thighs started in a cold cast-iron skillet for glass-crisp skin, glazed in a 4-ingredient reduction alongside jasmine rice.',
    category: 'dinner',
    servings: 4,
    prepMinutes: 5,
    cookMinutes: 20,
    equipment: ['Cast Iron', 'Saucepan'],
    tags: ['High Protein', 'Weeknight', 'Gluten-Free Option'],
    macros: { calories: 540, protein: 42, carbs: 46, fat: 21 },
    rating: 9.5,
    notes: 'Starting skin-side down in a cold dry skillet renders 80% of the subcutaneous fat without splattering.',
    timesCooked: 8,
    sections: [
      {
        name: 'Jasmine Rice',
        steps: [
          'Rinse [1.5 cups | 280 g jasmine rice] under cold water until mostly clear, then combine with [2.25 cups | 540 ml water] and [0.5 tsp | 3 g kosher salt] in a saucepan.',
          'Bring to a boil, cover tightly, reduce to low, and simmer for [15 min passive].',
          'Remove from heat and let steam covered for [5 min passive], then fluff with a fork.',
        ],
      },
      {
        name: 'Chicken Thighs',
        steps: [
          'Pat [2 lb | 900 g bone-in skin-on chicken thighs] completely dry and season all over with [1.5 tsp | 9 g kosher salt] and [0.5 tsp | 1.5 g black pepper].',
          'Place thighs skin-side down in a cold 12-inch cast-iron skillet, set over medium heat, and render undisturbed for [13 min passive] until skin is deep golden brown and crisp.',
          'Spoon off all but 1 tbsp rendered fat, flip thighs skin-side up, pour in the glaze, and simmer for [5 min] until internal temp reaches [175°F] and glaze coats the meat.',
        ],
      },
      {
        name: 'Honey-Garlic Glaze',
        readyBy: '1:2',
        steps: [
          'While chicken renders, whisk [1/3 cup | 110 g honey], [3 tbsp | 45 ml soy sauce], [6 cloves garlic, minced], and [1 tbsp | 15 ml rice vinegar] in a small bowl.',
        ],
      },
    ],
    createdAt: '2026-10-01T18:00:00.000Z',
    updatedAt: '2026-10-01T18:00:00.000Z',
  },
  {
    id: 'smash-burger-tacos',
    slug: 'smash-burger-tacos',
    title: 'Lacy-Edge Smash Burger Tacos',
    summary: 'Tortillas pressed directly onto seasoned 80/20 beef on a blazing-hot griddle, topped with American cheese, pickles, and tangy burger sauce.',
    category: 'dinner',
    servings: 4,
    prepMinutes: 7,
    cookMinutes: 8,
    equipment: ['Cast Iron', 'One-Pan'],
    tags: ['≤ 20 min', 'High Protein', 'Crowd Pleaser'],
    macros: { calories: 610, protein: 38, carbs: 34, fat: 35 },
    rating: 9.4,
    notes: 'Press hard for the first 10 seconds so the meat bonds to the tortilla and forms lacy Maillard edges.',
    timesCooked: 11,
    sections: [
      {
        name: 'Burger Sauce & Prep',
        readyBy: '1:0',
        steps: [
          'Whisk [1/3 cup | 80 ml mayonnaise], [2 tbsp | 30 ml ketchup], [1 tbsp | 15 g dill pickle relish], [1 tsp | 5 ml yellow mustard], and [1 tsp | 5 ml white vinegar] in a bowl.',
          'Divide [1.5 lb | 680 g ground beef] into 8 loose balls and shred [2 cups | 100 g iceberg lettuce].',
        ],
      },
      {
        name: 'Griddle & Smash',
        steps: [
          'Heat a cast-iron skillet or griddle to [450°F] until smoking. Place beef balls on the dry metal, season with [1.5 tsp | 9 g kosher salt] and [0.5 tsp | 1.5 g black pepper], and press [8 pieces small flour tortillas] directly on top.',
          'Sear beef-side down for [3 min] until edges are deeply browned and crisp.',
          'Flip tortilla-side down, top each with [8 slices American cheese], cover with a lid for [1 min] to melt, then top with lettuce, [1/2 cup | 75 g dill pickles], and burger sauce.',
        ],
      },
    ],
    createdAt: '2026-10-05T18:00:00.000Z',
    updatedAt: '2026-10-05T18:00:00.000Z',
  },
  {
    id: 'sheet-pan-miso-salmon',
    slug: 'sheet-pan-miso-salmon',
    title: 'One-Pan Miso-Maple Salmon & Blistered Broccoli',
    summary: 'High-heat roasted broccoli florets get a 10-minute head start before glazed salmon fillets join the same sheet pan.',
    category: 'dinner',
    servings: 4,
    prepMinutes: 8,
    cookMinutes: 18,
    equipment: ['Sheet Pan', 'One-Pan'],
    tags: ['≤ 30 min', 'High Protein', 'Meal Prep'],
    macros: { calories: 480, protein: 39, carbs: 22, fat: 25 },
    rating: 9.1,
    notes: 'Preheating the empty sheet pan during oven warmup gives the broccoli an immediate sear.',
    timesCooked: 6,
    sections: [
      {
        name: 'Sheet Pan Roast',
        steps: [
          'Preheat oven to [425°F]. Toss [1.25 lb | 570 g broccoli florets] with [2 tbsp | 30 ml avocado oil] and [0.75 tsp | 4.5 g kosher salt] on a foil-lined sheet pan and roast for [10 min passive].',
          'Meanwhile, whisk [2 tbsp | 36 g white miso paste], [1.5 tbsp | 22 ml maple syrup], [1 tbsp | 15 ml soy sauce], and [1 tsp | 5 ml sesame oil].',
          'Push broccoli to the edges, place [1.5 lb | 680 g salmon fillets] in the center, brush with the miso glaze, and roast for [8 min] until internal temp reaches [125°F] and top is caramelized.',
        ],
      },
    ],
    createdAt: '2026-10-10T18:00:00.000Z',
    updatedAt: '2026-10-10T18:00:00.000Z',
  },
  {
    id: 'dan-dan-chili-crisp-noodles',
    slug: 'dan-dan-chili-crisp-noodles',
    title: '15-Minute Garlic Chili-Crisp Sesame Noodles',
    summary: 'Silky peanut-tahini and chili crisp emulsion emulsified with starchy noodle water and topped with crispy pork or edamame.',
    category: 'lunch',
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    equipment: ['One-Pot', 'Wok'],
    tags: ['≤ 20 min', 'Weeknight'],
    macros: { calories: 590, protein: 28, carbs: 62, fat: 26 },
    rating: 9.0,
    timesCooked: 9,
    sections: [
      {
        name: 'Sauce & Aromatics',
        readyBy: '1:1',
        steps: [
          'In the serving bowls, whisk [2 tbsp | 32 g creamy peanut butter], [2 tbsp | 30 ml soy sauce], [1.5 tbsp | 22 g chili crisp], [1 tbsp | 15 ml black vinegar], and [2 cloves garlic, grated].',
          'Brown [0.5 lb | 225 g ground pork] in a skillet over medium-high heat for [6 min] until crisp, then toss with [1 tsp | 5 ml soy sauce].',
        ],
      },
      {
        name: 'Noodles',
        steps: [
          'Boil [8 oz | 225 g wheat noodles] in salted water for [4 min] until al dente.',
          'Whisk [1/4 cup | 60 ml starchy pasta water] into the sauce to emulsify, toss in the drained noodles, and top with crispy pork and [2 stalks green onions, sliced].',
        ],
      },
    ],
    createdAt: '2026-10-12T18:00:00.000Z',
    updatedAt: '2026-10-12T18:00:00.000Z',
  },
  {
    id: 'brown-butter-espresso-cookies',
    slug: 'brown-butter-espresso-cookies',
    title: 'Brown-Butter Espresso Dark Chocolate Cookies',
    summary: 'Toasted milk solids, espresso powder, and chopped dark chocolate bars baked with a pan-banging ripple for crisp edges and fudgy centers.',
    category: 'dessert',
    servings: 12,
    prepMinutes: 15,
    cookMinutes: 12,
    equipment: ['Sheet Pan', 'Saucepan'],
    tags: ['Baking', 'Crowd Pleaser'],
    macros: { calories: 290, protein: 4, carbs: 35, fat: 15 },
    rating: 9.8,
    notes: 'Use a chopped chocolate bar instead of chips so thin shards create laminated layers throughout the dough.',
    timesCooked: 5,
    sections: [
      {
        name: 'Brown Butter & Dough',
        readyBy: '1:0',
        steps: [
          'Melt [1 cup | 227 g unsalted butter] in a light-colored saucepan over medium heat, swirling for [5 min] until milk solids turn nutty brown. Pour into a bowl and cool for [10 min passive].',
          'Whisk [1 cup | 215 g dark brown sugar], [0.5 cup | 100 g granulated sugar], and [1 tsp | 3 g espresso powder] into the brown butter, then beat in [2 large eggs] and [2 tsp | 10 ml vanilla extract] for [1 min] until glossy.',
          'Fold in [2 cups | 240 g all-purpose flour], [1 tsp | 5 g baking soda], and [1 tsp | 6 g kosher salt] just until no dry streaks remain, then fold in [7 oz | 200 g dark chocolate bar, chopped].',
        ],
      },
      {
        name: 'Bake',
        steps: [
          'Preheat oven to [350°F]. Scoop 3-tbsp dough balls onto parchment-lined sheet pans and bake for [11 min] until edges are golden and centers are still soft.',
          'Tap the pan firmly on the oven rack, sprinkle with [0.5 tsp | 2 g flaky sea salt], and cool on the pan for [5 min passive].',
        ],
      },
    ],
    createdAt: '2026-10-15T18:00:00.000Z',
    updatedAt: '2026-10-15T18:00:00.000Z',
  },
];

export function normalizeRecipesData(raw: unknown): RecipesData {
  const source = raw && typeof raw === 'object' ? (raw as any) : null;
  if (!source || !Array.isArray(source.recipes)) {
    return { version: 1, recipes: structuredClone(DEFAULT_RECIPES) };
  }
  const seen = new Set<string>();
  const recipes: Recipe[] = [];
  for (const r of source.recipes) {
    if (!r || typeof r !== 'object') continue;
    try {
      const normalized = normalizeRecipe(r, r as Recipe, r.updatedAt || new Date().toISOString());
      if (!seen.has(normalized.id)) {
        seen.add(normalized.id);
        recipes.push(normalized);
      }
    } catch {
      /* skip malformed recipe */
    }
  }
  return { version: 1, recipes };
}
