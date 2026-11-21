import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildIdeasPrompt, IdeasReplyError, parseSuggestions } from './ai';
import { ClaimError, claimItem, emptyClaims, unclaimItem, whoFromKey } from './claims';
import {
  applyWishlistAction, emptyWishlist, giverView, listAsText, mustHaveTotal, normalizeWishlist, ownerPreview, ownerView, setShareToken, sortItems,
  WishlistInputError, type Claim, type WishlistAction, type WishlistData,
} from './model';
import { parseProductHtml, titleFromUrl } from './parse';

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
