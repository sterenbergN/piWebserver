import assert from 'node:assert/strict';
import test from 'node:test';
import { isAmazonLink, normalizeWishlist, type WishItem, type WishlistData } from './model';
import { checkIsDue, checkPricesFor, MAX_PER_RUN, runDailyCheck, type PriceDeps } from './prices';

const NOW = new Date('2026-11-24T12:00:00Z');

const page = (price: string, currency = 'USD') =>
  `<html><head><title>Thing</title><meta property="product:price:amount" content="${price}"><meta property="product:price:currency" content="${currency}"></head><body></body></html>`;

function store(items: Partial<WishItem>[]) {
  let data: WishlistData = normalizeWishlist({ lists: [{ id: 'L1', name: 'Mine', kind: 'mine', items: items.map((it, i) => ({ id: `i${i}`, title: `Item ${i}`, ...it })) }] });
  return {
    get data() { return data; },
    item: (i: number) => data.lists[0].items[i],
    deps: (extra: Partial<PriceDeps> = {}): Partial<PriceDeps> => ({
      load: async () => structuredClone(data),
      edit: async (_id, fn) => { const copy = structuredClone(data); fn(copy); data = copy; },
      now: () => NOW,
      delayMs: 0,
      sleep: async () => {},
      fetchPage: async () => { throw new Error('no network in tests'); },
      ...extra,
    }),
  };
}

test('Amazon links are told apart from other shops', () => {
  for (const url of ['https://www.amazon.com/dp/B08N5WRWNW', 'https://amazon.co.uk/x', 'https://smile.amazon.ca/x', 'https://amzn.to/3abc', 'https://a.co/d/xyz']) assert.equal(isAmazonLink(url), true, url);
  for (const url of ['https://www.target.com/p/amazon-thing', 'https://notamazon.com/x', 'not a link', '']) assert.equal(isAmazonLink(url), false, url);
});

test('Amazon items are passed over: no request, price and notes left as they are', async () => {
  const fetched: string[] = [];
  const s = store([{ url: 'https://www.amazon.com/Some-Thing/dp/B08N5WRWNW', price: 500 }, { url: 'https://shop.example/x', price: 30 }]);
  const summary = await checkPricesFor('u1', s.deps({ fetchPage: async (url) => { fetched.push(url); return { body: page('25'), finalUrl: url }; } }));
  assert.deepEqual(fetched, ['https://shop.example/x']);
  assert.deepEqual(summary, { checked: 1, updated: 1, failed: 0, skipped: 1 });
  assert.equal(s.item(0).price, 500);
  assert.equal(s.item(0).checkNote, '');
  assert.equal(s.item(1).price, 25);
});

test('another shop is read from its page; a page without a price keeps the old one', async () => {
  const s = store([{ url: 'https://shop.example/thing', price: 30 }, { url: 'https://other.example/x', price: 40 }]);
  const summary = await checkPricesFor('u1', s.deps({
    fetchPage: async (url) => ({ body: url.includes('shop.example') ? page('24.99') : '<html><body>hi</body></html>', finalUrl: url }),
  }));
  assert.deepEqual(summary, { checked: 2, updated: 1, failed: 1, skipped: 0 });
  assert.equal(s.item(0).price, 24.99);
  assert.equal(s.item(0).checkNote, '');
  assert.equal(s.item(1).price, 40);
  assert.equal(s.item(1).checkNote, 'The shop didn’t show a price');
});

test('a shop that cannot be reached, or sends us to another page, is a failed check', async () => {
  const s = store([{ url: 'https://shop.example/thing', price: 30 }, { url: 'https://shop.example/a/b/product-9', price: 31 }]);
  await checkPricesFor('u1', s.deps({
    fetchPage: async (url) => {
      if (url.endsWith('/thing')) throw new Error('boom');
      return { body: page('5'), finalUrl: 'https://shop.example/a/b' };
    },
  }));
  assert.equal(s.item(0).checkNote, 'Couldn’t reach the shop');
  assert.equal(s.item(1).price, 31);
  assert.match(s.item(1).checkNote, /different page/);
});

test('an item whose link was edited during the check is left alone', async () => {
  const s = store([{ url: 'https://shop.example/old', price: 30 }]);
  const deps = s.deps({
    fetchPage: async (url) => {
      // The owner edits the link while the check is reading the shop.
      s.data.lists[0].items[0].url = 'https://shop.example/new';
      return { body: page('9.99'), finalUrl: url };
    },
  });
  const summary = await checkPricesFor('u1', deps);
  assert.equal(summary.updated, 1);
  assert.equal(s.item(0).url, 'https://shop.example/new');
  assert.equal(s.item(0).price, 30);
  assert.equal(s.item(0).checkedAt, '');
});

test('recent checks, bought items and items without a link are skipped; force overrides only the recent ones', async () => {
  const recent = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
  const old = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
  const items = [
    { url: 'https://a.example/1', price: 1, checkedAt: recent },
    { url: 'https://a.example/2', price: 2, checkedAt: old },
    { url: 'https://a.example/3', price: 3, gotIt: true },
    { price: 4 },
  ];
  const fetchPage = async (url: string) => ({ body: page('7'), finalUrl: url });
  const s = store(items);
  assert.deepEqual(await checkPricesFor('u1', s.deps({ fetchPage })), { checked: 1, updated: 1, failed: 0, skipped: 3 });
  assert.equal(s.item(0).price, 1);
  assert.equal(s.item(1).price, 7);
  assert.equal(s.item(2).price, 3);
  const forced = store(items);
  assert.deepEqual(await checkPricesFor('u1', forced.deps({ fetchPage, force: true })), { checked: 2, updated: 2, failed: 0, skipped: 2 });
  assert.equal(forced.item(0).price, 7);
});

test('a run stops at the cap and counts the rest as skipped', async () => {
  const s = store(Array.from({ length: MAX_PER_RUN + 5 }, (_, i) => ({ url: `https://a.example/${i}`, price: 1 })));
  const summary = await checkPricesFor('u1', s.deps({ fetchPage: async (url) => ({ body: page('2'), finalUrl: url }) }));
  assert.equal(summary.checked, MAX_PER_RUN);
  assert.equal(summary.skipped, 5);
});

test('requests to the same shop are spaced out; different shops are not', async () => {
  const s = store([{ url: 'https://a.example/1' }, { url: 'https://a.example/2' }, { url: 'https://b.example/1' }]);
  const waits: number[] = [];
  await checkPricesFor('u1', s.deps({ delayMs: 1500, sleep: async (ms) => { waits.push(ms); }, fetchPage: async (url) => ({ body: page('2'), finalUrl: url }) }));
  assert.deepEqual(waits, [1500]);
});

test('the daily run adds up every account, survives one failing, and records itself', async () => {
  const saved: unknown[] = [];
  const total = await runDailyCheck({
    listUsers: async () => ['a', 'b', 'c'],
    perUser: async (id) => { if (id === 'b') throw new Error('broken'); return { checked: 2, updated: 1, failed: 1, skipped: 3 }; },
    save: async (run) => { saved.push(run); },
    now: () => NOW,
  });
  assert.deepEqual(total, { checked: 4, updated: 2, failed: 2, skipped: 6 });
  assert.deepEqual(saved, [{ lastRunAt: NOW.toISOString(), lastSummary: total }]);
});

test('a daily check is due only after 23 hours', () => {
  assert.equal(checkIsDue('', NOW), true);
  assert.equal(checkIsDue(new Date(NOW.getTime() - 22 * 3_600_000).toISOString(), NOW), false);
  assert.equal(checkIsDue(new Date(NOW.getTime() - 24 * 3_600_000).toISOString(), NOW), true);
});
