import { ApiError } from '@/lib/workout/api';
import { cleanFood, parseFoodId } from './foods';
import { cleanAmount, cleanSnapshot, isDateKey, MAX_AMOUNT, snapshotFor, type ResolvedItem } from './log';
import { getFood, keepInLibrary } from './sources';
import type { Food } from './types';

// Turning what the page sends ("this food, this serving, this many") into a
// log-ready item. The server finds the food itself where it can, so nutrition
// comes from the source, not the browser; when nobody has the food any more
// (FatSecret gone, say), re-logging falls back to the snapshot of the last time.

export type ItemInput = { foodId?: unknown; servingId?: unknown; amount?: unknown; food?: unknown; snapshot?: unknown };

/** Today's date as the browser sees it (it knows the user's time zone), or the server's. */
export function dateParam(value: unknown): string {
  if (isDateKey(value)) return value;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function resolveItem(userId: string, input: ItemInput): Promise<{ item: ResolvedItem; food: Food | null }> {
  const foodId = typeof input.foodId === 'string' ? input.foodId : '';
  const parsed = parseFoodId(foodId);
  if (!parsed || parsed.source === 'quick') throw new ApiError(400, 'Unknown food.');
  const amount = cleanAmount(input.amount);
  if (!amount) throw new ApiError(400, `Amounts go from a little over 0 to ${MAX_AMOUNT}.`);
  const servingId = typeof input.servingId === 'string' ? input.servingId.slice(0, 40) : '';

  let { food } = await getFood(foodId, userId);
  // A remote result the server no longer has cached, and its source can't be reached: take the
  // browser's copy (it came from our own search). Your own foods must already be in the library.
  if (!food && input.food && parsed.source !== 'custom' && parsed.source !== 'usda') {
    try {
      const sent = cleanFood(input.food);
      if (sent.id === foodId && !sent.partial) food = sent;
    } catch { /* fall through to the snapshot */ }
  }
  if (food) {
    const serving = food.servings.find((s) => s.id === servingId) ?? (food.servings.length === 1 ? food.servings[0] : undefined);
    if (serving) return { item: { foodId, servingId: serving.id, amount, snapshot: snapshotFor(food, serving) }, food };
  }
  const snapshot = cleanSnapshot(input.snapshot);
  if (snapshot) return { item: { foodId, servingId: servingId || 's', amount, snapshot }, food: null };
  throw new ApiError(food ? 400 : 404, food ? 'That serving isn’t one this food has.' : 'Couldn’t find that food right now. Try again, or add it as your own food.');
}

/** Resolve several items, copying the foods into the library as they're used. */
export async function resolveItems(userId: string, inputs: unknown, max = 40): Promise<ResolvedItem[]> {
  if (!Array.isArray(inputs) || !inputs.length) throw new ApiError(400, 'Nothing to add.');
  const out: ResolvedItem[] = [];
  for (const input of inputs.slice(0, max)) {
    const { item, food } = await resolveItem(userId, (input ?? {}) as ItemInput);
    if (food) await keepInLibrary(food, userId);
    out.push(item);
  }
  return out;
}
