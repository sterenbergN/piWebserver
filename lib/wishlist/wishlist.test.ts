import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildIdeasPrompt, IdeasReplyError, parseSuggestions } from './ai';
import { ClaimError, claimItem, emptyClaims, unclaimItem, whoFromKey } from './claims';
import {
  applyWishlistAction, emptyWishlist, giverView, listAsText, mustHaveTotal, normalizeWishlist, ownerPreview, ownerView, setShareToken, sortItems,
  WishlistInputError, type Claim, type WishlistAction, type WishlistData,
} from './model';
import { parseProductHtml, titleFromUrl } from './parse';
import { applyReceivedAction, applyTidy, buildTidyRows } from './tidy';

let n = 0;
const newId = () => `id${++n}`;
const img = (id: string) => `/img/${id}`;
const apply = (d: WishlistData, a: WishlistAction) => applyWishlistAction(d, a, newId);

function sample() {
  const d = emptyWishlist();
  apply(d, { type: 'addList', id: 'L1', kind: 'mine', fields: { name: 'Christmas' } });
  apply(d, { type: 'addItem', listId: 'L1', id: 'A', item: { title: 'Headphones', price: 199.99, priority: 'must', quantity: 2 } });
  apply(d, { type: 'addItem', listId: 'L1', id: 'B', item: { title: 'Book', price: 12, priority: 'nice' } });
  apply(d, { type: 'addItem', listId: 'L1', id: 'C', item: { title: 'Bought already', gotIt: true } });
  return d;
}

test('items: urls are cleaned, store derived, bad values clamped', () => {
  const d = emptyWishlist();
  apply(d, { type: 'addList', id: 'L', fields: { name: 'x' } });
  apply(d, { type: 'addItem', listId: 'L', item: { url: 'www.amazon.com/dp/X', title: ' Thing ', price: -5, quantity: 500, priority: 'bogus' as never } });
  const item = d.lists[0].items[0];
  assert.equal(item.url, 'https://www.amazon.com/dp/X');
  assert.equal(item.store, 'amazon.com');
  assert.equal(item.price, null);
  assert.equal(item.quantity, 99);
  assert.equal(item.priority, 'love');
  apply(d, { type: 'addItem', listId: 'L', item: { title: 'x', url: 'javascript:alert(1)' } });
  assert.equal(d.lists[0].items[1].url, '');
  assert.throws(() => apply(d, { type: 'addItem', listId: 'L', item: {} }), WishlistInputError);
});

test('lists: reorder, move items, only "mine" lists can be shared', () => {
  const d = sample();
  apply(d, { type: 'addList', id: 'L2', kind: 'for', fields: { name: 'Ideas', person: 'Sam' } });
  apply(d, { type: 'moveList', id: 'L2', dir: -1 });
  assert.deepEqual(d.lists.map((l) => l.id), ['L2', 'L1']);
  apply(d, { type: 'transferItem', listId: 'L1', id: 'B', toListId: 'L2' });
  assert.deepEqual(d.lists[0].items.map((i) => i.id), ['B']);
  apply(d, { type: 'moveItem', listId: 'L1', id: 'C', dir: -1 });
  assert.deepEqual(d.lists[1].items.map((i) => i.id), ['C', 'A']);
  assert.throws(() => setShareToken(d, 'L2', 'abcdefghijklmnopqrstuv'), WishlistInputError);
  setShareToken(d, 'L1', 'abcdefghijklmnopqrstuv');
  assert.equal(d.lists[1].shareToken, 'abcdefghijklmnopqrstuv');
  // a "for" list never keeps a token, even if stored data says so
  const reread = normalizeWishlist({ lists: [{ id: 'F', kind: 'for', shareToken: 'abcdefghijklmnopqrstuv', items: [] }] });
  assert.equal(reread.lists[0].shareToken, null);
});

test('owner view carries no claim information at all', () => {
  const d = sample();
  const claims: Claim[] = [{ id: 'c1', itemId: 'A', who: 'k:secret-hash', name: 'Grandma', note: 'wrapped already', qty: 1, at: '2026-11-20T00:00:00Z' }];
  // Stored data that somehow picked up claim-shaped fields still comes out clean.
  const dirty = JSON.parse(JSON.stringify(d));
  dirty.lists[0].items[0].claimed = 1;
  dirty.lists[0].items[0].claims = claims;
  dirty.lists[0].claims = claims;
  const view = JSON.stringify(ownerView(normalizeWishlist(dirty), img));
  for (const word of ['Grandma', 'secret-hash', 'wrapped already', 'claimed', 'claims', '"mine":', '"who"']) assert.ok(!view.includes(word), word);
  // The share-link preview for the signed-in owner has no claim fields either.
  const preview = JSON.stringify(ownerPreview(d.lists[0], img));
  assert.ok(!/claimed|"mine":/.test(preview));
  assert.ok(!preview.includes('Bought already'));
});

test('giver view hides got-it items and shows claims', () => {
  const d = sample();
  const claims = emptyClaims();
  const me = whoFromKey('a-browser-key-1234567');
  claimItem(claims, d.lists[0].items[0], me, { qty: 1, name: 'Aunt' }, newId);
  const view = giverView(d.lists[0], claims.claims, me, img);
  assert.deepEqual(view.items.map((i) => i.id), ['A', 'B']);
  assert.equal(view.items[0].claimed, 1);
  assert.equal(view.items[0].mine?.name, 'Aunt');
  const other = giverView(d.lists[0], claims.claims, whoFromKey('someone-else-key-123456'), img);
  assert.equal(other.items[0].mine, null);
  assert.equal(other.items[0].claimed, 1);
});

test('claims: quantity-aware, replace your own, undo only your own', () => {
  const d = sample();
  const item = d.lists[0].items[0]; // wants 2
  const c = emptyClaims();
  claimItem(c, item, 'k:one', { qty: 1 }, newId);
  assert.throws(() => claimItem(c, item, 'k:two', { qty: 2 }, newId), ClaimError);
  claimItem(c, item, 'k:two', { qty: 1 }, newId);
  assert.throws(() => claimItem(c, item, 'k:three', { qty: 1 }, newId), ClaimError);
  claimItem(c, item, 'k:one', { qty: 1, note: 'changed' }, newId);
  assert.equal(c.claims.length, 2);
  unclaimItem(c, item.id, 'k:one');
  assert.deepEqual(c.claims.map((x) => x.who), ['k:two']);
  assert.throws(() => claimItem(c, d.lists[0].items[2], 'k:one', {}, newId), ClaimError); // got it myself
  assert.throws(() => whoFromKey('short'), ClaimError);
});

test('totals, sorting and text', () => {
  const d = sample();
  assert.equal(mustHaveTotal(d.lists[0]), '$399.98');
  const sorted = sortItems(d.lists[0].items, 'price-low');
  assert.equal(sorted[0].title, 'Bought already'.length ? 'Book' : '');
  assert.equal(sortItems(d.lists[0].items, 'priority')[0].priority, 'must');
  const text = listAsText(d.lists[0]);
  assert.ok(text.includes('Headphones') && !text.includes('Bought already'));
});

test('product page: JSON-LD beats og, falls back to title, slug works for blocked shops', () => {
  const html = `<html><head><title>Fallback &amp; co</title>
    <meta property="og:title" content="OG name"><meta content="https://cdn.x.com/a.jpg" property="og:image">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Real Name","image":["/img/p.png"],
    "offers":{"@type":"Offer","price":"1,299.50","priceCurrency":"eur"}}</script></head></html>`;
  const info = parseProductHtml(html, 'https://shop.example.com/p/1');
  assert.equal(info.title, 'Real Name');
  assert.equal(info.imageUrl, 'https://shop.example.com/img/p.png');
  assert.equal(info.price, 1299.5);
  assert.equal(info.currency, 'EUR');
  const bare = parseProductHtml('<title>Just a title &amp; more</title>', 'https://a.com/x');
  assert.equal(bare.title, 'Just a title & more');
  assert.equal(bare.price, null);
  assert.equal(titleFromUrl('https://www.amazon.com/Sony-WH-1000XM5-Wireless-Headphones/dp/B09XS7JWHH/ref=sr_1_1'), 'Sony WH 1000XM5 Wireless Headphones');
});

test('ideas: prompt includes the list; replies parse leniently', () => {
  const prompt = buildIdeasPrompt('Christmas', [{ title: 'Headphones', price: 200, currency: 'USD', priority: 'must' }], { forWho: 'me', occasion: 'Christmas', budget: '$50', interests: 'hiking' });
  assert.ok(prompt.includes('Headphones') && prompt.includes('$50') && prompt.includes('hiking') && prompt.includes('JSON'));
  const reply = 'Sure! Here you go:\n```json\n[{"title":"Trail socks","why":"For hiking","priceRange":"$15-25","searchQuery":"merino hiking socks","url":"https://x.com/s"},{"title":"Trail socks"},{"name":"Pack","url":"javascript:x"}]\n```\nEnjoy!';
  const s = parseSuggestions(reply);
  assert.deepEqual(s.map((x) => x.title), ['Trail socks', 'Pack']);
  assert.equal(s[1].searchQuery, 'Pack');
  assert.equal(s[1].url, '');
  assert.equal(parseSuggestions('{"suggestions":[{"title":"A"}]} trailing').length, 1);
  assert.throws(() => parseSuggestions('no json here'), IdeasReplyError);
});

test('import: notices a shop redirecting to a general page, but follows short links', async () => {
  const { landedElsewhere } = await import('./fetch-product');
  const ikea = 'https://www.ikea.com/us/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s99305852/';
  assert.equal(landedElsewhere(ikea, 'https://www.ikea.com/us/en/cat/products-products/'), true);
  assert.equal(landedElsewhere(ikea, 'https://www.ikea.com/us/en/'), true);
  assert.equal(landedElsewhere(ikea, ikea), false);
  assert.equal(landedElsewhere(ikea, ikea.replace('www.', '')), false);
  assert.equal(landedElsewhere('https://amzn.to/3abc', 'https://www.amazon.com/dp/B0ABC'), false);
  assert.equal(landedElsewhere('https://shop.example/item/123', 'https://shop.example/item/123/blue-mug'), false);
});

// ---- Tidy-up ----------------------------------------------------------------------

function claimed() {
  const d = sample(); // L1: A (wants 2), B, C (got it myself)
  const c = emptyClaims();
  claimItem(c, d.lists[0].items[0], 'k:one', { qty: 1, name: 'Aunt May' }, newId, new Date('2026-12-20T10:00:00Z'));
  claimItem(c, d.lists[0].items[1], 'u:wife', { qty: 1 }, newId, new Date('2026-12-21T10:00:00Z'));
  return { d, c };
}
const nameFor = (who: string) => (who === 'u:wife' ? 'Sam' : 'Someone');
const deps = { nameFor, newId, now: new Date('2026-12-26T09:00:00Z') };

test('tidy preview: claimed items with giver names, newest first; for-lists are ignored', () => {
  const { d, c } = claimed();
  apply(d, { type: 'addList', id: 'F1', kind: 'for', fields: { name: 'Ideas' } });
  const rows = buildTidyRows(d, c, {}, nameFor);
  assert.deepEqual(rows.map((r) => r.itemId), ['B', 'A']);
  assert.equal(rows[0].givers[0].name, 'Sam'); // household member: no typed name
  assert.equal(rows[1].givers[0].name, 'Aunt May');
  assert.equal(rows[1].listName, 'Christmas');
  assert.equal(buildTidyRows(d, c, { since: '2026-12-21T00:00:00Z' }, nameFor).length, 1);
  assert.equal(buildTidyRows(d, c, { listId: 'F1' }, nameFor).length, 0);
});

test('tidy apply: got items leave (or shrink), kept items stay, claims clear, history and marker are set', () => {
  const { d, c } = claimed();
  const result = applyTidy(d, c, { decisions: { A: 'got', B: 'keep' }, asOf: '2026-12-25T00:00:00Z', groupName: ' Christmas 2026 ' }, deps);
  assert.equal(result.got, 1);
  assert.equal(result.kept, 1);
  // A wanted 2 and one was claimed: one remains on the list.
  const a = d.lists[0].items.find((i) => i.id === 'A')!;
  assert.equal(a.quantity, 1);
  assert.ok(d.lists[0].items.some((i) => i.id === 'B'));
  assert.equal(c.claims.length, 0);
  assert.equal(d.received[0].name, 'Christmas 2026');
  assert.deepEqual(d.received[0].items[0].givers, [{ name: 'Aunt May', qty: 1 }]);
  assert.equal(d.received[0].items[0].thanked, false);
  assert.equal(d.lastTidyAt, '2026-12-25T00:00:00Z');
  // Kept item is free to claim again.
  claimItem(c, d.lists[0].items.find((i) => i.id === 'B')!, 'k:new', {}, newId);
  assert.equal(c.claims.length, 1);
});

test('tidy apply: fully claimed items are removed; claims after the preview and undecided rows are left alone; one-list tidy keeps the marker', () => {
  const { d, c } = claimed();
  claimItem(c, d.lists[0].items[0], 'k:two', { qty: 1 }, newId, new Date('2026-12-22T10:00:00Z'));
  assert.equal(c.claims.length, 3);
  // The preview was taken on the 21st at noon: k:two's claim came after it.
  applyTidy(d, c, { decisions: { A: 'got' }, asOf: '2026-12-21T12:00:00Z', listId: 'L1' }, deps);
  const a = d.lists[0].items.find((i) => i.id === 'A')!;
  assert.equal(a.quantity, 1); // only the one claim shown was handled
  assert.equal(d.received[0].items[0].quantity, 1);
  assert.equal(d.received[0].name, 'Received 2026-12-26');
  assert.equal(d.lastTidyAt, '');
  assert.deepEqual(c.claims.map((x) => x.who).sort(), ['k:two', 'u:wife']); // B wasn't decided on
  applyTidy(d, c, { decisions: { A: 'got' }, asOf: '2026-12-30T00:00:00Z' }, deps);
  assert.ok(!d.lists[0].items.some((i) => i.id === 'A')); // the rest were claimed: it's gone
  assert.equal(d.lastTidyAt, '2026-12-30T00:00:00Z');
  assert.throws(() => applyTidy(d, c, { decisions: {}, asOf: '2026-12-31T00:00:00Z' }, deps), WishlistInputError);
  assert.throws(() => applyTidy(d, c, { decisions: { A: 'got' }, asOf: '', listId: 'nope' }, deps), WishlistInputError);
});

test('received history: thank-you ticks, rename, remove; old files without history still load', () => {
  const { d, c } = claimed();
  applyTidy(d, c, { decisions: { A: 'got', B: 'got' }, asOf: '2026-12-25T00:00:00Z' }, deps);
  const g = d.received[0];
  applyReceivedAction(d, { type: 'thank', groupId: g.id, itemId: g.items[0].id, thanked: true });
  assert.equal(d.received[0].items[0].thanked, true);
  applyReceivedAction(d, { type: 'renameGroup', groupId: g.id, name: 'Xmas' });
  assert.equal(d.received[0].name, 'Xmas');
  applyReceivedAction(d, { type: 'removeItem', groupId: g.id, itemId: g.items[0].id });
  applyReceivedAction(d, { type: 'removeItem', groupId: g.id, itemId: d.received[0].items[0].id });
  assert.equal(d.received.length, 0); // an empty batch goes away
  assert.throws(() => applyReceivedAction(d, { type: 'removeGroup', groupId: 'nope' }), WishlistInputError);
  const old = normalizeWishlist({ lists: [{ id: 'X', items: [] }] });
  assert.deepEqual([old.received, old.lastTidyAt], [[], '']);
  const again = normalizeWishlist(JSON.parse(JSON.stringify(normalizeWishlist({ lists: [], received: [{ id: 'g', name: 'N', at: '2026-12-26T00:00:00Z', items: [{ id: 'i', title: 'T', thanked: true, givers: [{ name: 'Z' }] }] }] }))));
  assert.equal(again.received[0].items[0].thanked, true);
});

test('owner view still has no claim or giver info, even once a history exists', () => {
  const { d, c } = claimed();
  applyTidy(d, c, { decisions: { A: 'got', B: 'keep' }, asOf: '2026-12-25T00:00:00Z' }, deps);
  claimItem(c, d.lists[0].items.find((i) => i.id === 'B')!, 'k:x', { name: 'Secret Santa' }, newId);
  const json = JSON.stringify(ownerView(d, img));
  assert.ok(!/Aunt May|Secret Santa|givers|claimed|"mine":|received|k:x/.test(json));
});
