// The food tracker's shared model. Every source (the site's own library, USDA,
// FatSecret, Open Food Facts) is turned into the same Food shape, so search,
// logging and the UI never care where a food came from.

export const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** kcal, grams, and sodium in mg. The four main ones are always there; the rest only when known. */
export type Nutrients = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  satFat?: number;
};

/** Where a food came from. "custom" = typed in from a label here; "quick" = calories only, no food. */
export type FoodSource = 'custom' | 'usda' | 'fatsecret' | 'off' | 'quick';

export const SOURCE_LABELS: Record<FoodSource, string> = {
  custom: 'My foods',
  usda: 'USDA',
  fatsecret: 'FatSecret',
  off: 'Open Food Facts',
  quick: 'Quick add',
};

/** One way to measure a food: "1 cup", "100 g", "1 bar (45 g)". Nutrients are for one of it. */
export type Serving = {
  id: string;
  label: string;
  grams?: number;
  ml?: number;
  nutrients: Nutrients;
};

export type Food = {
  /** `<source>:<sourceId>`, e.g. "usda:171477", "fatsecret:33691", "off:0049000006346", "custom:abc123". */
  id: string;
  source: FoodSource;
  sourceId: string;
  name: string;
  brand?: string;
  /** Barcode (GTIN-13) when known. */
  barcode?: string;
  servings: Serving[];
  /** Nutrients per 100 g (or 100 ml for drinks) when known. */
  per100?: Nutrients;
  /** USDA category or similar, for display. */
  category?: string;
  /** A search result with only a summary serving: fetch the full food (GET /api/food/foods) before showing servings. */
  partial?: boolean;
};

/** A food as stored in the shared library: when it was saved, and by whom (custom foods). */
export type LibraryFood = Food & {
  savedAt: string;
  /** When the nutrition was last fetched from its source (FatSecret copies expire unless kept). */
  fetchedAt?: string;
  createdBy?: string;
};

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABELS: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

/** What a log entry remembers of its food, so history never changes when the library does. */
export type EntrySnapshot = {
  name: string;
  brand?: string;
  source: FoodSource;
  servingLabel: string;
  grams?: number;
  ml?: number;
  /** For one serving. */
  nutrients: Nutrients;
};

export type LogEntry = {
  id: string;
  meal: Meal;
  foodId: string;
  servingId: string;
  /** How many servings. */
  amount: number;
  snapshot: EntrySnapshot;
  /** ISO time it was logged. */
  at: string;
};

/** A named combination of foods ("My usual breakfast"), logged in one tap. */
export type SavedMeal = {
  id: string;
  name: string;
  items: { foodId: string; servingId: string; amount: number; snapshot: EntrySnapshot }[];
  createdAt: string;
};

/** The account's own choices. Blank targets mean "work it out" (weight plan, bodyweight). */
export type FoodSettings = {
  kcalTarget?: number;
  proteinTarget?: number;
  carbsTarget?: number;
  fatTarget?: number;
  /** Protein from bodyweight: grams per lb. */
  proteinPerLb: number;
  /** Which weight-plan number sets the calorie target. */
  planTarget: 'plan' | 'needed';
  /** Add the day's active calories (Health) to the calorie target. */
  addExercise: boolean;
};

/** One account's food file: .data/food/logs/<userId>.json */
export type FoodUserData = {
  days: Record<string, LogEntry[]>;
  meals: SavedMeal[];
  settings: FoodSettings;
};
