// The daily price check: re-read the price of every linked wishlist item that
// isn't marked "got it". Ordinary shops are read from their page; Amazon blocks
// that, so its prices come from the price service set up in Admin › Wishlist
// prices. A check that fails never wipes a price: the typed or last-read price
// stays, with a short note saying why it couldn't be refreshed.

import fs from 'fs/promises';
import path from 'path';
import { readJson, writeJsonAtomic } from '@/lib/json-store';
import { fetchPublic } from '@/lib/recipes/import-fetch';
import { isId, type WishlistData } from './model';
import { countryForHost, fetchAmazonPrice, loadPriceService, PriceServiceError, type PriceServiceSettings } from './price-service';
import { parseProductHtml } from './parse';
import { landedElsewhere } from './fetch-product';

export type PriceSummary = { checked: number; updated: number; failed: number; skipped: number };
export type PriceRun = { lastRunAt: string; lastSummary: PriceSummary | null };

export const RECENT_HOURS = 20;
export const MAX_PER_RUN = 150;
export const SHOP_DELAY_MS = 1500;
const SHORT_HOSTS = new Set(['amzn.to', 'a.co']);

export const NEEDS_SERVICE = 'Amazon prices need the price service (Admin › Wishlist prices)';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

export const isAmazonHost = (host: string) => /(^|\.)amazon\.[a-z.]{2,}$/.test(host) || host === 'amzn.com' || host.endsWith('.amzn.com') || SHORT_HOSTS.has(host);

/** The 10-character product number in an Amazon link, or null (also for any other site). */
export function asinFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!isAmazonHost(url.hostname.toLowerCase())) return null;
  const inPath = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/.exec(url.pathname);
  if (inPath) return inPath[1];
  const q = url.searchParams.get('asin') ?? url.searchParams.get('ASIN');
  return q && /^[A-Z0-9]{10}$/.test(q) ? q : null;
}

/** Follow a short link (amzn.to, a.co) one hop at a time, asking only the short-link host, until it points at Amazon. */
export async function resolveShortLink(start: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!SHORT_HOSTS.has(hostOf(url))) return url;
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wishlist-price-check)' } });
    const next = res.headers.get('location');
    if (!next) throw new Error('no redirect');
    url = new URL(next, url).toString();
  }
  return url;
}

export type PriceDeps = {
  load: (userId: string) => Promise<WishlistData>;
  edit: (userId: string, fn: (data: WishlistData) => void) => Promise<unknown>;
  fetchPage: (url: string) => Promise<{ body: string; finalUrl: string }>;
  resolveShort: (url: string) => Promise<string>;
  getService: () => Promise<PriceServiceSettings>;
  fetchService?: typeof fetch;
  now: () => Date;
  /** Pause between two requests to the same shop. */
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Check items even when they were checked recently. */
  force?: boolean;
};

const defaults = (): PriceDeps => ({
  load: async (userId) => (await import('./store')).loadWishlist(userId),
  edit: async (userId, fn) => (await import('./store')).editWishlist(userId, fn),
  fetchPage: async (url) => {
    const page = await fetchPublic(url, { maxBytes: 3 * 1024 * 1024 });
    return { body: page.body.toString('utf8'), finalUrl: page.finalUrl };
  },
  resolveShort: (url) => resolveShortLink(url),
  getService: loadPriceService,
  now: () => new Date(),
  delayMs: SHOP_DELAY_MS,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

class CheckFailed extends Error {}
type Read = { price: number; currency: string };

async function readAmazon(url: string, deps: PriceDeps): Promise<Read> {
  const service = await deps.getService();
  if (!service.baseUrl) throw new CheckFailed(NEEDS_SERVICE);
  let asin = asinFromUrl(url);
  let storeHost = hostOf(url);
  if (!asin && SHORT_HOSTS.has(storeHost)) {
    const final = await deps.resolveShort(url).catch(() => '');
    asin = final ? asinFromUrl(final) : null;
    if (final) storeHost = hostOf(final);
  }
  if (!asin) throw new CheckFailed('Couldn’t find the Amazon product number in that link');
  try {
    return await fetchAmazonPrice(service, asin, countryForHost(storeHost), deps.fetchService);
  } catch (error) {
    throw new CheckFailed(error instanceof PriceServiceError && /show a price/.test(error.message) ? 'The Amazon price service didn’t show a price' : 'Amazon price service didn’t answer');
  }
}

async function readShop(url: string, deps: PriceDeps): Promise<Read> {
  let page;
  try {
    page = await deps.fetchPage(url);
  } catch {
    throw new CheckFailed('Couldn’t reach the shop');
  }
  if (landedElsewhere(url, page.finalUrl)) throw new CheckFailed('The shop sent us to a different page');
  const info = parseProductHtml(page.body, page.finalUrl);
  if (info.price === null || !(info.price > 0)) throw new CheckFailed('The shop didn’t show a price');
  return { price: info.price, currency: info.currency };
}

/** One link's current price, by whichever route fits its shop. Throws CheckFailed with a short reason. */
export async function readPrice(url: string, deps: PriceDeps): Promise<Read> {
  return isAmazonHost(hostOf(url)) ? readAmazon(url, deps) : readShop(url, deps);
}

type Outcome = { url: string; ok: true; price: number; currency: string; at: string } | { url: string; ok: false; note: string };

export async function checkPricesFor(userId: string, overrides: Partial<PriceDeps> = {}): Promise<PriceSummary> {
  const deps: PriceDeps = { ...defaults(), ...overrides };
  const summary: PriceSummary = { checked: 0, updated: 0, failed: 0, skipped: 0 };
  const data = await deps.load(userId);
  const nowMs = deps.now().getTime();

  const due: { listId: string; itemId: string; url: string; checkedAt: string }[] = [];
  for (const list of data.lists) {
    for (const item of list.items) {
      const last = Date.parse(item.checkedAt);
      const recent = Number.isFinite(last) && nowMs - last < RECENT_HOURS * 3_600_000;
      if (!item.url || item.gotIt || (recent && !deps.force)) summary.skipped++;
      else due.push({ listId: list.id, itemId: item.id, url: item.url, checkedAt: item.checkedAt });
    }
  }
  // Longest-unchecked first, so the cap rotates through a long list over the days.
  due.sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || ''));
  summary.skipped += Math.max(0, due.length - MAX_PER_RUN);
  due.length = Math.min(due.length, MAX_PER_RUN);

  const outcomes = new Map<string, Outcome>();
  const seenHosts = new Set<string>();
  for (const entry of due) {
    const host = hostOf(entry.url);
    if (deps.delayMs > 0 && seenHosts.has(host)) await deps.sleep(deps.delayMs);
    seenHosts.add(host);
    summary.checked++;
    try {
      const read = await readPrice(entry.url, deps);
      outcomes.set(`${entry.listId}/${entry.itemId}`, { url: entry.url, ok: true, price: read.price, currency: read.currency, at: deps.now().toISOString() });
      summary.updated++;
    } catch (error) {
      outcomes.set(`${entry.listId}/${entry.itemId}`, { url: entry.url, ok: false, note: error instanceof CheckFailed ? error.message : 'Couldn’t check this one' });
      summary.failed++;
    }
  }

  if (outcomes.size) {
    // One write at the end; an item whose link was edited meanwhile is left as the owner has it.
    await deps.edit(userId, (current) => {
      for (const list of current.lists) {
        for (const item of list.items) {
          const out = outcomes.get(`${list.id}/${item.id}`);
          if (!out || item.url !== out.url) continue;
          if (out.ok) {
            item.price = out.price;
            item.currency = out.currency || item.currency;
            item.checkedAt = out.at;
            item.checkNote = '';
          } else {
            item.checkNote = out.note;
          }
        }
      }
    });
  }
  return summary;
}

// ---- The daily run over every account -----------------------------------------------------

const dataRoot = () => path.join(process.cwd(), '.data', 'wishlist');
const runFile = () => path.join(dataRoot(), 'price-check.json');

export async function readPriceRun(): Promise<PriceRun> {
  const raw = await readJson<Partial<PriceRun> | null>(runFile(), null).catch(() => null);
  const s = raw?.lastSummary;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    lastRunAt: typeof raw?.lastRunAt === 'string' ? raw.lastRunAt : '',
    lastSummary: s && typeof s === 'object' ? { checked: n(s.checked), updated: n(s.updated), failed: n(s.failed), skipped: n(s.skipped) } : null,
  };
}

export const checkIsDue = (lastRunAt: string, now: Date, hours = 23) => {
  const last = Date.parse(lastRunAt);
  return !Number.isFinite(last) || now.getTime() - last > hours * 3_600_000;
};

let running = false;
export const priceCheckRunning = () => running;

/** Every account's linked items, one account at a time. Returns null when a run is already going. */
export async function runDailyCheck(
  opts: { listUsers?: () => Promise<string[]>; perUser?: (userId: string) => Promise<PriceSummary>; save?: (run: PriceRun) => Promise<void>; now?: () => Date; force?: boolean } = {},
): Promise<PriceSummary | null> {
  if (running) return null;
  running = true;
  try {
    const listUsers = opts.listUsers ?? (async () => {
      const names = await fs.readdir(path.join(dataRoot(), 'lists')).catch(() => [] as string[]);
      return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter(isId);
    });
    const perUser = opts.perUser ?? ((id: string) => checkPricesFor(id, { force: opts.force }));
    const total: PriceSummary = { checked: 0, updated: 0, failed: 0, skipped: 0 };
    for (const id of await listUsers()) {
      try {
        const s = await perUser(id);
        total.checked += s.checked;
        total.updated += s.updated;
        total.failed += s.failed;
        total.skipped += s.skipped;
      } catch (error) {
        console.error('Wishlist price check failed for one account:', error instanceof Error ? error.message : 'unknown error');
      }
    }
    const run: PriceRun = { lastRunAt: (opts.now ?? (() => new Date()))().toISOString(), lastSummary: total };
    await (opts.save ?? ((r: PriceRun) => writeJsonAtomic(runFile(), r)))(run);
    return total;
  } finally {
    running = false;
  }
}

/** Called hourly by the server: runs the daily check when 23 hours have passed since the last one. */
export async function runDailyCheckIfDue(): Promise<void> {
  try {
    const { lastRunAt } = await readPriceRun();
    if (!checkIsDue(lastRunAt, new Date())) return;
    const total = await runDailyCheck();
    if (total) console.log(`Wishlist prices: checked ${total.checked}, updated ${total.updated}, couldn't read ${total.failed}`);
  } catch (error) {
    console.error('Wishlist price check failed:', error instanceof Error ? error.message : 'unknown error');
  }
}
