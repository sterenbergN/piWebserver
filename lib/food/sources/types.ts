import type { Food } from '../types';

// The one interface every food source sits behind. Local sources answer
// in-process; remote ones may fail in all sorts of ways, and each failure is
// a SourceError the orchestrator turns into a quiet notice while the other
// sources carry on.

export type SourceId = 'library' | 'usda' | 'fatsecret' | 'off';

export type SourceErrorKind =
  /** Not set up (no key) or switched off by the admin. */
  | 'off'
  /** Our server's address isn't on FatSecret's allowed list. */
  | 'ip'
  /** Bad client id / secret. */
  | 'auth'
  /** The plan the key is on doesn't include this call (e.g. barcodes need Premier). */
  | 'not-permitted'
  | 'rate-limited'
  | 'timeout'
  | 'unavailable';

export class SourceError extends Error {
  constructor(public source: SourceId, public kind: SourceErrorKind, message: string) {
    super(message);
  }
}

export interface FoodSourceAdapter {
  id: SourceId;
  /** Up to `limit` foods for a text query, best first. */
  search(query: string, limit: number): Promise<Food[]>;
  /** One food by its id within the source (the part after "source:"). */
  get(sourceId: string): Promise<Food | null>;
  /** A packaged food by its GTIN-13 barcode, where the source can. */
  barcode?(gtin13: string): Promise<Food | null>;
}

/** fetch with a hard timeout, turning a hang into a SourceError. */
export async function fetchWithTimeout(source: SourceId, url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    if (controller.signal.aborted) throw new SourceError(source, 'timeout', 'It took too long to answer.');
    throw new SourceError(source, 'unavailable', error instanceof Error ? `Couldn’t reach it (${error.message}).` : 'Couldn’t reach it.');
  } finally {
    clearTimeout(timer);
  }
}

/** Same User-Agent for every outside service, with nothing about who runs the site. */
export const USER_AGENT = 'PiDashboard-FoodTracker/1.0 (self-hosted)';
