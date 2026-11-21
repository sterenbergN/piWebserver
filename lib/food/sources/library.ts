import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { cleanFood } from '../foods';
import { TokenIndex, type SearchHit } from '../search';
import { FOOD_DIR, getFoodSettings } from '../settings';
import type { Food, LibraryFood } from '../types';
import type { FoodSourceAdapter } from './types';

// The site's own food library, shared by every account (a food's nutrition is
// a fact, not a secret): every food picked from a remote source is copied in,
// plus foods typed in from a label. It's searched first and works with no
// network at all, so losing FatSecret or Open Food Facts loses nothing you've
// already eaten. FatSecret copies are only kept a day unless the admin says
// otherwise (their terms; see settings.ts).

export const libraryFile = () => path.join(FOOD_DIR(), 'library.json');
type LibraryStore = { foods: LibraryFood[] };

export const MAX_LIBRARY = 25_000;
export const FATSECRET_TTL_MS = 24 * 3_600_000;

/** Whether a stored food may still be used (FatSecret copies expire after a day unless kept). */
export function isLive(food: LibraryFood, keepFatSecret: boolean, now = Date.now()): boolean {
  if (food.source !== 'fatsecret' || keepFatSecret) return true;
  const fetched = Date.parse(food.fetchedAt || food.savedAt);
  return Number.isFinite(fetched) && now - fetched < FATSECRET_TTL_MS;
}

function cleanStored(raw: unknown): LibraryFood | null {
  try {
    const food = cleanFood(raw);
    const r = raw as Record<string, unknown>;
    const out: LibraryFood = { ...food, savedAt: typeof r.savedAt === 'string' ? r.savedAt : new Date(0).toISOString() };
    if (typeof r.fetchedAt === 'string') out.fetchedAt = r.fetchedAt;
    if (typeof r.createdBy === 'string' && /^[\w-]{1,64}$/.test(r.createdBy)) out.createdBy = r.createdBy;
    delete out.partial;
    return out;
  } catch {
    return null;
  }
}

// The library is read on every search, so it's held in memory and re-read
// when the file changes (a save here, or a backup being restored).
let cache: { mtimeMs: number; foods: LibraryFood[]; index: TokenIndex<LibraryFood>; byId: Map<string, LibraryFood> } | null = null;

async function loadAll() {
  const stat = await fs.stat(libraryFile()).catch(() => null);
  const mtimeMs = stat?.mtimeMs ?? 0;
  if (cache && cache.mtimeMs === mtimeMs) return cache;
  const store = await readJson<LibraryStore>(libraryFile(), { foods: [] });
  const foods = (Array.isArray(store.foods) ? store.foods : []).map(cleanStored).filter((f): f is LibraryFood => !!f);
  cache = { mtimeMs, foods, index: new TokenIndex(foods, (f) => ({ name: f.name, brand: f.brand })), byId: new Map(foods.map((f) => [f.id, f])) };
  return cache;
}

async function keepFatSecret() {
  return (await getFoodSettings()).keepFatSecretCopies;
}

export async function searchLibrary(query: string, limit = 25): Promise<SearchHit[]> {
  const [all, keep] = [await loadAll(), await keepFatSecret()];
  const now = Date.now();
  return all.index.search(query, limit * 2).filter((h) => isLive(h.item, keep, now)).slice(0, limit).map(({ item, score }) => ({ food: item, score }));
}

export async function getLibraryFood(id: string): Promise<LibraryFood | null> {
  const [all, keep] = [await loadAll(), await keepFatSecret()];
  const food = all.byId.get(id);
  return food && isLive(food, keep) ? food : null;
}

export async function findLibraryBarcode(gtin13: string): Promise<LibraryFood | null> {
  const [all, keep] = [await loadAll(), await keepFatSecret()];
  return all.foods.find((f) => f.barcode && f.barcode.padStart(13, '0') === gtin13 && isLive(f, keep)) ?? null;
}

/** Every live food, for the admin's download. */
export async function allLibraryFoods(): Promise<LibraryFood[]> {
  const [all, keep] = [await loadAll(), await keepFatSecret()];
  return all.foods.filter((f) => isLive(f, keep));
}

export async function libraryStats() {
  const foods = await allLibraryFoods();
  const bySource: Record<string, number> = {};
  for (const f of foods) bySource[f.source] = (bySource[f.source] ?? 0) + 1;
  return { total: foods.length, bySource };
}

/**
 * Copy foods into the library (new ones added, known ones refreshed). Summary-only
 * search results aren't kept. Expired FatSecret copies are dropped on the way.
 */
export async function rememberFoods(foods: Food[], userId?: string): Promise<void> {
  const keep = await keepFatSecret();
  const usable = foods.filter((f) => !f.partial && f.source !== 'quick');
  if (!usable.length) return;
  // Re-logging a food the library already has, unchanged, shouldn't rewrite the whole file
  // (FatSecret copies still get their clock reset every few hours, so they don't expire mid-use).
  const all = await loadAll();
  const same = (a: Food, b: LibraryFood) => JSON.stringify([a.name, a.brand, a.servings, a.per100]) === JSON.stringify([b.name, b.brand, b.servings, b.per100]);
  const fresh = (b: LibraryFood) => b.source !== 'fatsecret' || Date.now() - Date.parse(b.fetchedAt || b.savedAt) < 6 * 3_600_000;
  if (usable.every((f) => { const b = all.byId.get(f.id); return b && same(f, b) && fresh(b); })) return;
  await updateJson<LibraryStore>(libraryFile(), { foods: [] }, (store) => {
    const now = new Date();
    const list = (Array.isArray(store.foods) ? store.foods : []).map(cleanStored).filter((f): f is LibraryFood => !!f && isLive(f, keep, now.getTime()));
    const byId = new Map(list.map((f, i) => [f.id, i]));
    for (const food of usable) {
      const at = byId.get(food.id);
      const stored: LibraryFood = { ...food, savedAt: at !== undefined ? list[at].savedAt : now.toISOString(), fetchedAt: now.toISOString() };
      delete stored.partial;
      if (at !== undefined) {
        if (list[at].createdBy) stored.createdBy = list[at].createdBy;
        list[at] = stored;
      } else {
        if (userId && food.source === 'custom') stored.createdBy = userId;
        byId.set(food.id, list.length);
        list.push(stored);
      }
    }
    // Over the cap: the oldest copies of remote foods go first; your own foods stay.
    if (list.length > MAX_LIBRARY) {
      const remote = list.filter((f) => f.source !== 'custom').sort((a, b) => (a.fetchedAt || a.savedAt).localeCompare(b.fetchedAt || b.savedAt));
      const drop = new Set(remote.slice(0, list.length - MAX_LIBRARY).map((f) => f.id));
      store.foods = list.filter((f) => !drop.has(f.id));
    } else store.foods = list;
  });
}

/** Remove a food you typed in yourself (or any custom food, for the admin). */
export async function removeCustomFood(id: string, userId: string | null, isAdmin = false): Promise<boolean> {
  return updateJson<LibraryStore, boolean>(libraryFile(), { foods: [] }, (store) => {
    const list = Array.isArray(store.foods) ? store.foods : [];
    const food = list.find((f) => f?.id === id);
    if (!food || food.source !== 'custom' || (!isAdmin && food.createdBy !== userId)) return false;
    store.foods = list.filter((f) => f?.id !== id);
    return true;
  });
}

export const librarySource: FoodSourceAdapter = {
  id: 'library',
  async search(query, limit) {
    return (await searchLibrary(query, limit)).map((h) => h.food);
  },
  async get(id) {
    return getLibraryFood(id);
  },
  async barcode(gtin13) {
    return findLibraryBarcode(gtin13);
  },
};
