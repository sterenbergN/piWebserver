import { createLimiter } from '@/lib/security/rate-limit';
import { barcodeVariants } from '../barcode';
import { parseFoodId } from '../foods';
import { mergeResults, scoreMatch, type SearchHit, type Usage } from '../search';
import { getFoodSettings } from '../settings';
import type { Food } from '../types';
import { fatSecretSource } from './fatsecret';
import { findLibraryBarcode, getLibraryFood, rememberFoods, searchLibrary } from './library';
import { openFoodFactsSource } from './openfoodfacts';
import { SourceError, type SourceId } from './types';
import { searchUsda, usdaSource } from './usda';

// Every source behind one search: the library and USDA answer in-process and
// always; FatSecret (when set up) is asked next with a 5 s limit; Open Food
// Facts only on "Search more" or when the rest found little. Any remote failure
// becomes a short notice and the others' results still come back.

export const FEW_RESULTS = 6;

// Outbound calls per account (searches and barcodes), and Open Food Facts'
// own limit of about 10 searches a minute for the whole site.
const remotePerAccount = createLimiter({ max: 40, windowMs: 60_000 });
const offSearchSite = createLimiter({ max: 8, windowMs: 60_000 });

// Remote foods seen in recent searches, so logging one doesn't fetch it again.
// Held a few hours at most (well inside FatSecret's 24-hour limit).
const recent = new Map<string, { food: Food; at: number }>();
const RECENT_TTL_MS = 6 * 3_600_000;
const RECENT_MAX = 3000;

function remember(foods: Food[]) {
  const now = Date.now();
  for (const f of foods) {
    if (f.partial) continue;
    recent.delete(f.id); // re-inserted at the end, so the Map stays oldest-first
    recent.set(f.id, { food: f, at: now });
  }
  for (const id of recent.keys()) {
    if (recent.size <= RECENT_MAX) break;
    recent.delete(id);
  }
}

function recalled(id: string): Food | null {
  const hit = recent.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > RECENT_TTL_MS) { recent.delete(id); return null; }
  return hit.food;
}

export type SearchOptions = {
  userId: string;
  query: string;
  /** "Search more": include Open Food Facts even when there are plenty of results. */
  more?: boolean;
  usage?: Record<string, Usage>;
  today?: string;
  limit?: number;
};

export type SearchResponse = {
  results: (SearchHit & { source: SourceId })[];
  notices: string[];
  /** Which sources answered. */
  searched: SourceId[];
  /** Whether "Search more" could add anything. */
  canSearchMore: boolean;
};

/** A friendly line for a failed remote source. */
export function noticeFor(error: unknown): string | null {
  if (!(error instanceof SourceError)) return 'A food source failed; showing the others.';
  if (error.kind === 'off') return null;
  if (error.source === 'fatsecret') {
    return error.kind === 'ip'
      ? 'FatSecret unavailable (this server’s IP isn’t on the key’s allowed list); showing other sources.'
      : 'FatSecret unavailable, showing other sources.';
  }
  if (error.kind === 'rate-limited') return 'Open Food Facts is busy; try “Search more” again in a minute.';
  return 'Open Food Facts unavailable, showing other sources.';
}

export async function searchFoods({ userId, query, more = false, usage = {}, today = '', limit = 40 }: SearchOptions): Promise<SearchResponse> {
  const q = query.trim().slice(0, 100);
  const settings = await getFoodSettings();
  const notices: string[] = [];
  const searched: SourceId[] = ['library'];
  const hits: (SearchHit & { source: SourceId })[] = [];
  const libraryHits = await searchLibrary(q, 25);
  const libraryIds = new Set(libraryHits.map((h) => h.food.id));
  hits.push(...libraryHits.map((h) => ({ ...h, score: h.score + 3, source: 'library' as const })));
  if (settings.sources.usda) {
    searched.push('usda');
    hits.push(...searchUsda(q, 25).map((h) => ({ ...h, source: 'usda' as const })));
  }

  const remoteAllowed = remotePerAccount.retryAfter(userId) === 0;
  const fatSecretReady = settings.sources.fatsecret && !!settings.fatsecret.clientId && !!settings.fatsecret.clientSecret;
  if (fatSecretReady && remoteAllowed) {
    remotePerAccount.hit(userId);
    try {
      const foods = await fatSecretSource.search(q, 25);
      remember(foods);
      searched.push('fatsecret');
      // Their order is their relevance; ours is applied on top so all sources compare.
      hits.push(...foods.map((food, i) => ({ food, score: Math.max(scoreMatch(q, food.name, food.brand), 0.5) + Math.max(0, 3 - i * 0.2), source: 'fatsecret' as const })));
    } catch (error) {
      const notice = noticeFor(error);
      if (notice) notices.push(notice);
    }
  } else if (fatSecretReady) notices.push('Searching too fast for FatSecret; showing other sources.');

  const few = mergeResults(hits, usage, today, libraryIds).length < FEW_RESULTS;
  const offOn = settings.sources.off;
  if (offOn && (more || few)) {
    if (offSearchSite.retryAfter('site') > 0 || remotePerAccount.retryAfter(userId) > 0) {
      if (more) notices.push('Open Food Facts allows only a few searches a minute; try again shortly.');
    } else {
      offSearchSite.hit('site');
      remotePerAccount.hit(userId);
      try {
        const foods = await openFoodFactsSource.search(q, 20);
        remember(foods);
        searched.push('off');
        hits.push(...foods.map((food) => ({ food, score: scoreMatch(q, food.name, food.brand) * 0.9, source: 'off' as const })));
      } catch (error) {
        const notice = noticeFor(error);
        if (notice) notices.push(notice);
      }
    }
  }

  const merged = mergeResults(hits, usage, today, libraryIds).slice(0, limit);
  const sourceOf = new Map(hits.map((h) => [h.food.id, h.source]));
  return {
    results: merged.map((h) => ({ ...h, source: sourceOf.get(h.food.id) ?? 'library' })),
    notices,
    searched,
    canSearchMore: offOn && !searched.includes('off'),
  };
}

/**
 * A food by id, from wherever it can be had: the library, recent search
 * results, USDA, then the source itself. Null when nobody has it.
 */
export async function getFood(id: string, userId?: string): Promise<{ food: Food | null; notice?: string }> {
  const parsed = parseFoodId(id);
  if (!parsed || parsed.source === 'quick') return { food: null };
  const stored = await getLibraryFood(id);
  if (stored) return { food: stored };
  const seen = recalled(id);
  if (seen) return { food: seen };
  try {
    let food: Food | null = null;
    if (parsed.source === 'usda') food = await usdaSource.get(parsed.sourceId);
    else if (parsed.source === 'fatsecret' || parsed.source === 'off') {
      if (userId) {
        if (remotePerAccount.retryAfter(userId) > 0) return { food: null, notice: 'Too many lookups; try again in a minute.' };
        remotePerAccount.hit(userId);
      }
      food = parsed.source === 'fatsecret' ? await fatSecretSource.get(parsed.sourceId) : await openFoodFactsSource.get(parsed.sourceId);
      if (food) remember([food]);
    }
    return { food };
  } catch (error) {
    return { food: null, notice: noticeFor(error) ?? undefined };
  }
}

export type BarcodeResponse = { food: Food | null; source?: SourceId; notices: string[] };

/** A packaged food by barcode: the library first, then FatSecret, then Open Food Facts. */
export async function lookupBarcode(gtin13: string, userId: string): Promise<BarcodeResponse> {
  const notices: string[] = [];
  for (const code of barcodeVariants(gtin13)) {
    const stored = await findLibraryBarcode(code.padStart(13, '0'));
    if (stored) return { food: stored, source: 'library', notices };
  }
  if (remotePerAccount.retryAfter(userId) > 0) return { food: null, notices: ['Too many lookups; try again in a minute.'] };
  remotePerAccount.hit(userId);
  const settings = await getFoodSettings();
  if (settings.sources.fatsecret && settings.fatsecret.clientId && settings.fatsecret.clientSecret) {
    try {
      const food = await fatSecretSource.barcode!(gtin13);
      if (food) {
        food.barcode = gtin13;
        remember([food]);
        return { food, source: 'fatsecret', notices };
      }
    } catch (error) {
      // A key without barcode access is normal (Basic plan); don't nag about it.
      if (!(error instanceof SourceError && error.kind === 'not-permitted')) {
        const notice = noticeFor(error);
        if (notice) notices.push(notice);
      }
    }
  }
  if (settings.sources.off) {
    try {
      const food = await openFoodFactsSource.barcode!(gtin13);
      if (food) {
        food.barcode = gtin13;
        remember([food]);
        return { food, source: 'off', notices };
      }
    } catch (error) {
      const notice = noticeFor(error);
      if (notice) notices.push(notice);
    }
  }
  return { food: null, notices };
}

/** Copy a picked food into the library (best effort: logging never fails over it). */
export async function keepInLibrary(food: Food, userId: string) {
  if (food.partial || food.source === 'quick') return;
  if (food.source === 'usda') return; // Always bundled; no need to copy.
  try {
    await rememberFoods([food], userId);
  } catch (error) {
    console.error('Saving to the food library failed:', error instanceof Error ? error.message : error);
  }
}
