import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { normalizeWishlist, type WishItem, type WishlistData } from './model';
import { asinFromUrl, checkIsDue, checkPricesFor, MAX_PER_RUN, NEEDS_SERVICE, runDailyCheck, type PriceDeps } from './prices';
import { cleanBaseUrl, readServicePrice, toPublicPriceService } from './price-service';

const NOW = new Date('2026-11-24T12:00:00Z');
const AMAZON = 'https://www.amazon.com/Some-Thing/dp/B08N5WRWNW/ref=sr_1_1?th=1';

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
      getService: async () => ({ baseUrl: '', apiKey: '' }),
      fetchPage: async () => { throw new Error('no network in tests'); },
      resolveShort: async (u) => u,
      ...extra,
    }),
  };
}

type Stand = { url: string; seen: http.IncomingHttpHeaders[]; close: () => Promise<void> };
async function standIn(answer: (req: http.IncomingMessage) => { status: number; body: unknown }): Promise<Stand> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    const { status, body } = answer(req);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('ASIN comes from each Amazon link form, and only from Amazon links', () => {
  assert.equal(asinFromUrl('https://www.amazon.com/dp/B08N5WRWNW'), 'B08N5WRWNW');
  assert.equal(asinFromUrl('https://www.amazon.com/Some-Name/dp/B08N5WRWNW/ref=x?th=1'), 'B08N5WRWNW');
  assert.equal(asinFromUrl('https://www.amazon.co.uk/gp/product/B08N5WRWNW?psc=1'), 'B08N5WRWNW');
  assert.equal(asinFromUrl('https://www.amazon.ca/gp/aw/d/B08N5WRWNW'), 'B08N5WRWNW');
  assert.equal(asinFromUrl('https://amazon.de/product/B08N5WRWNW'), 'B08N5WRWNW');
  assert.equal(asinFromUrl('https://www.amazon.com/gp/offer-listing?asin=B08N5WRWNW'), 'B08N5WRWNW');
  assert.equal(asinFromUrl('https://amzn.to/3abcDEF'), null);
  assert.equal(asinFromUrl('https://www.amazon.com/dp/tooShort'), null);
  assert.equal(asinFromUrl('https://www.target.com/p/thing/dp/B08N5WRWNW'), null);
  assert.equal(asinFromUrl('not a link'), null);
});

test('the service answer is read from the top or from under data, as a number or a string', () => {
  assert.deepEqual(readServicePrice({ price: { amount: 449.99, currency: 'USD' } }), { price: 449.99, currency: 'USD' });
  assert.deepEqual(readServicePrice({ data: { price: { amount: '$1,299.00', currency: 'cad' } } }), { price: 1299, currency: 'CAD' });
  assert.equal(readServicePrice({ price: { currency: 'USD' } }), null);
  assert.equal(readServicePrice({ price: null }), null);
  assert.equal(readServicePrice('nope'), null);
});

test('the address must be http(s); the key is shown only as its last four characters', () => {
  assert.equal(cleanBaseUrl('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000');
  assert.equal(cleanBaseUrl('ftp://x.example'), '');
  assert.throws(() => cleanBaseUrl('javascript:alert(1)', true));
  const view = toPublicPriceService({ baseUrl: 'http://127.0.0.1:8000', apiKey: 'secret-key-1234' });
  assert.equal(view.keyHint, '1234');
  assert.ok(!JSON.stringify(view).includes('secret-key'));
});

test('Amazon price comes from the service; with a key the two RapidAPI headers go along', async () => {
  const svc = await standIn(() => ({ status: 200, body: { price: { amount: 449.99, currency: 'USD' } } }));
  try {
    const s = store([{ url: AMAZON, price: 500, checkNote: 'old trouble' }]);
    const summary = await checkPricesFor('u1', s.deps({ getService: async () => ({ baseUrl: svc.url, apiKey: 'abcd1234' }) }));
    assert.deepEqual(summary, { checked: 1, updated: 1, failed: 0, skipped: 0 });
    assert.equal(s.item(0).price, 449.99);
    assert.equal(s.item(0).currency, 'USD');
    assert.equal(s.item(0).checkedAt, NOW.toISOString());
    assert.equal(s.item(0).checkNote, '');
    assert.equal(svc.seen[0]['x-rapidapi-key'], 'abcd1234');
    assert.equal(svc.seen[0]['x-rapidapi-host'], new URL(svc.url).host);
  } finally {
    await svc.close();
  }
});

test('no key means no RapidAPI headers', async () => {
  const svc = await standIn(() => ({ status: 200, body: { data: { price: { amount: '$10.50', currency: 'USD' } } } }));
  try {
    const s = store([{ url: AMAZON }]);
    await checkPricesFor('u1', s.deps({ getService: async () => ({ baseUrl: svc.url, apiKey: '' }) }));
    assert.equal(s.item(0).price, 10.5);
    assert.equal(svc.seen[0]['x-rapidapi-key'], undefined);
  } finally {
    await svc.close();
  }
});

test('a short link is followed to its ASIN before asking the service', async () => {
  const svc = await standIn((req) => ({ status: 200, body: { price: { amount: req.url?.includes('product=B08N5WRWNW') ? 20 : 99, currency: 'USD' } } }));
  try {
    const s = store([{ url: 'https://amzn.to/3abc' }]);
    await checkPricesFor('u1', s.deps({ getService: async () => ({ baseUrl: svc.url, apiKey: '' }), resolveShort: async () => AMAZON }));
    assert.equal(s.item(0).price, 20);
  } finally {
    await svc.close();
  }
});

test('service down: the typed price stays, a note is set, checkedAt is unchanged', async () => {
  const svc = await standIn(() => ({ status: 500, body: {} }));
  const url = svc.url;
  await svc.close();
  const was = '2026-11-01T00:00:00.000Z';
  const s = store([{ url: AMAZON, price: 500, currency: 'USD', checkedAt: was }]);
  const summary = await checkPricesFor('u1', s.deps({ getService: async () => ({ baseUrl: url, apiKey: '' }) }));
  assert.deepEqual(summary, { checked: 1, updated: 0, failed: 1, skipped: 0 });
  assert.equal(s.item(0).price, 500);
  assert.equal(s.item(0).checkedAt, was);
  assert.equal(s.item(0).checkNote, 'Amazon price service didn’t answer');
});

test('service answers without a price: price kept, note set', async () => {
  const svc = await standIn(() => ({ status: 200, body: { title: 'Thing' } }));
  try {
    const s = store([{ url: AMAZON, price: 500 }]);
    await checkPricesFor('u1', s.deps({ getService: async () => ({ baseUrl: svc.url, apiKey: '' }) }));
    assert.equal(s.item(0).price, 500);
    assert.equal(s.item(0).checkedAt, '');
    assert.match(s.item(0).checkNote, /didn’t show a price/);
  } finally {
    await svc.close();
  }
});

test('Amazon with no price service set leaves the price and says what is needed', async () => {
  const s = store([{ url: AMAZON, price: 500 }]);
  await checkPricesFor('u1', s.deps());
  assert.equal(s.item(0).price, 500);
  assert.equal(s.item(0).checkNote, NEEDS_SERVICE);
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

test('the price service key file is never restored from a backup', async () => {
  const { isRestorablePath } = await import('@/lib/backup');
  assert.equal(isRestorablePath('.data/wishlist-private/price-service.json'), false);
  assert.equal(isRestorablePath('.data/wishlist/lists/u1.json'), true);
});
