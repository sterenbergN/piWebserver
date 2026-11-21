// Browser-side helpers for the Food pages: talking to /api/food and formatting.
// Kept free of server imports so client components can use it.

import type { Food, LogEntry, Meal, Nutrients, SavedMeal, FoodSettings } from './types';
import type { Targets } from './targets';

/** Today (or `date`) as YYYY-MM-DD in the phone's own time zone. */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

/** "Today", "Yesterday", "Tomorrow", or "Thu, Nov 20" (with the year when it isn't this one). */
export function dayLabel(key: string, today = localDateKey()): string {
  if (key === today) return 'Today';
  if (key === shiftKey(today, -1)) return 'Yesterday';
  if (key === shiftKey(today, 1)) return 'Tomorrow';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const grams = (n: number) => `${Math.round(n)} g`;

/** "1.5 × 1 cup (80 g)" or just the serving when it's one. */
export function amountLabel(amount: number, servingLabel: string): string {
  if (amount === 1) return servingLabel;
  const a = Math.round(amount * 100) / 100;
  return `${a} × ${servingLabel}`;
}

export class FoodApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function foodApi<T = Record<string, any>>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      ...(json !== undefined ? { method: rest.method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new FoodApiError(0, 'You look offline. Try again when you’re connected.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) throw new FoodApiError(res.status, body?.message || body?.error || 'Something went wrong.');
  return body as T;
}

export type RecentFood = { foodId: string; servingId: string; amount: number; snapshot: LogEntry['snapshot']; meal: Meal; date: string; count: number };

export type PlanInfo = {
  hasPlan: boolean;
  planKcal: number | null;
  neededKcal: number | null;
  calculatorMaintenance: number | null;
  planRealMaintenance: number | null;
  status?: string;
};

export type DayData = {
  date: string;
  entries: LogEntry[];
  totals: Nutrients;
  meals: Record<Meal, Nutrients>;
  targets: Targets;
  exerciseKcal: number | null;
  plan: PlanInfo;
  latestWeight: number | null;
  settings: FoodSettings;
  recent: RecentFood[];
  frequent: RecentFood[];
  savedMeals: SavedMeal[];
  previous: { date: string; meals: Meal[] };
};

export type LogResponse = { added: LogEntry[]; date?: string; entries?: LogEntry[]; totals?: Nutrients; meals?: Record<Meal, Nutrients>; savedMeals: SavedMeal[] };

export type SearchResult = { food: Food; source: 'library' | 'usda' | 'fatsecret' | 'off' };

/** Post one diary change. */
export function logChange(action: Record<string, unknown>) {
  return foodApi<LogResponse>('/api/food/log', { json: { action } });
}

/** An item for the log API from a food the page holds. */
export function itemFor(food: Food, servingId: string, amount: number) {
  // The food goes along so a remote result can still be logged if its source has gone quiet since.
  return { foodId: food.id, servingId, amount, food };
}

/** An item from something logged before (works even when the food's source is gone). */
export const itemFromRecent = (r: Pick<RecentFood, 'foodId' | 'servingId' | 'amount' | 'snapshot'>) =>
  ({ foodId: r.foodId, servingId: r.servingId, amount: r.amount, snapshot: r.snapshot });

/** The camera can be used here. Native BarcodeDetector isn't needed: iPhone Safari falls back to a WebAssembly reader (lib/food/scanner.ts). */
export function canScanBarcodes(): boolean {
  if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return false;
  // The site's Permissions-Policy may switch the camera off for this page.
  const doc = document as Document & { permissionsPolicy?: { allowsFeature?: (f: string) => boolean }; featurePolicy?: { allowsFeature?: (f: string) => boolean } };
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  return policy?.allowsFeature ? policy.allowsFeature('camera') : true;
}
