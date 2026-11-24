// The daily price check: re-read the price of every linked wishlist item that
// isn't marked "got it", from the shop's own page. Amazon blocks those reads, so
// Amazon links are passed over (the list offers a "check on Amazon" link instead;
// an Amazon-only price service was tried and dropped as too much to install).
// A check that fails never wipes a price: the typed or last-read price stays,
// with a short note saying why it couldn't be refreshed.

import fs from 'fs/promises';
import path from 'path';
import { readJson, writeJsonAtomic } from '@/lib/json-store';
import { fetchPublic } from '@/lib/recipes/import-fetch';
import { isAmazonLink, isId, type WishlistData } from './model';
import { parseProductHtml } from './parse';
import { landedElsewhere } from './fetch-product';

export type PriceSummary = { checked: number; updated: number; failed: number; skipped: number };
export type PriceRun = { lastRunAt: string; lastSummary: PriceSummary | null };

export const RECENT_HOURS = 20;
export const MAX_PER_RUN = 150;
export const SHOP_DELAY_MS = 1500;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

export type PriceDeps = {
  load: (userId: string) => Promise<WishlistData>;
  edit: (userId: string, fn: (data: WishlistData) => void) => Promise<unknown>;
  fetchPage: (url: string) => Promise<{ body: string; finalUrl: string }>;
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
  now: () => new Date(),
  delayMs: SHOP_DELAY_MS,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

class CheckFailed extends Error {}
type Read = { price: number; currency: string };

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

/** One link's current price, read from the shop's page. Throws CheckFailed with a short reason. */
export const readPrice = (url: string, deps: PriceDeps): Promise<Read> => readShop(url, deps);

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
      // Amazon blocks page reads, so its items keep the price typed in.
      if (!item.url || item.gotIt || isAmazonLink(item.url) || (recent && !deps.force)) summary.skipped++;
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
