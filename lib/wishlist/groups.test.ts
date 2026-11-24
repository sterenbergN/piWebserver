import test from 'node:test';
import { strict as assert } from 'node:assert';
import { ClaimError, claimItem, emptyClaims } from './claims';
import {
  applyWishlistAction, arrangeGroups, emptyWishlist, giverView, groupSiblings, normalizeWishlist, ownerPreview, pickOfGroup,
  WishlistInputError, type PriceRule, type WishlistAction, type WishlistData,
} from './model';
import { applyTidy } from './tidy';

// Groups of alternatives ("a vacuum": this one, the newer one, or a cheaper one),
// with price rules that pick which one givers see on top.

let n = 0;
const newId = () => `g${++n}`;
const img = (id: string) => `/img/${id}`;
const apply = (d: WishlistData, a: WishlistAction) => applyWishlistAction(d, a, newId);

// The ticket's example: the vacuum at $500, a newer one at $650; take the newer one
// if it's no more than $100 more; if it's over $600, the other option.
const RULES: PriceRule[] = [
  { pick: 'NEW', subject: 'NEW', op: 'withinOf', amount: 100, other: 'OLD' },
  { pick: 'ALT', subject: 'NEW', op: 'over', amount: 600 },
];

function vacuums(prices: { OLD: number | null; NEW: number | null; ALT: number | null }) {
  const d = emptyWishlist();
  apply(d, { type: 'addList', id: 'L', kind: 'mine', fields: { name: 'House' } });
  apply(d, { type: 'addItem', listId: 'L', id: 'OLD', item: { title: 'Vac 1', price: prices.OLD } });
  apply(d, { type: 'addItem', listId: 'L', id: 'NEW', item: { title: 'Vac 2', price: prices.NEW } });
  apply(d, { type: 'addItem', listId: 'L', id: 'ALT', item: { title: 'Stick vac', price: prices.ALT } });
  apply(d, { type: 'addItem', listId: 'L', id: 'MUG', item: { title: 'Mug', price: 12 } });
  apply(d, { type: 'saveGroup', listId: 'L', id: 'VAC', name: 'A vacuum', itemIds: ['OLD', 'NEW', 'ALT'], rules: RULES });
  return d;
}
const pick = (d: WishlistData) => pickOfGroup(d.lists[0].groups[0], d.lists[0].items);

test('price rules: the first rule that holds picks, with the reason; otherwise the first item', () => {
  // Newer one only $80 more: take it.
  assert.deepEqual(pick(vacuums({ OLD: 500, NEW: 580, ALT: 300 })), { itemId: 'NEW', reason: 'Vac 2 is only $80 more than Vac 1' });
  // $150 more and over $600: the other option.
  assert.deepEqual(pick(vacuums({ OLD: 500, NEW: 650, ALT: 300 })), { itemId: 'ALT', reason: 'Vac 2 is $650, over $600' });
  // $150 more but under $600 (the old one went down): nothing holds, so the first one.
  assert.deepEqual(pick(vacuums({ OLD: 440, NEW: 590, ALT: 300 })), { itemId: 'OLD', reason: '' });
  // Unknown prices: those rules are passed over.
  assert.deepEqual(pick(vacuums({ OLD: 500, NEW: null, ALT: 300 })), { itemId: 'OLD', reason: '' });
  // "At most" on the item's own price.
  const d = vacuums({ OLD: 500, NEW: 650, ALT: 300 });
  apply(d, { type: 'saveGroup', listId: 'L', id: 'VAC', itemIds: ['OLD', 'NEW', 'ALT'], rules: [{ pick: 'OLD', subject: 'OLD', op: 'atMost', amount: 450 }], fallback: 'ALT' });
  assert.deepEqual(pick(d), { itemId: 'ALT', reason: '' });
  d.lists[0].items.find((i) => i.id === 'OLD')!.price = 449;
  assert.deepEqual(pick(d), { itemId: 'OLD', reason: 'Vac 1 is $449, no more than $450' });
});

test('groups: need two items; rules naming other items are dropped; removing items or the group lets the rest go', () => {
  const d = vacuums({ OLD: 500, NEW: 650, ALT: 300 });
  assert.throws(() => apply(d, { type: 'saveGroup', listId: 'L', itemIds: ['MUG'] }), WishlistInputError);
  // A rule naming the mug (not in the group) is dropped.
  apply(d, { type: 'saveGroup', listId: 'L', id: 'VAC', itemIds: ['OLD', 'NEW', 'ALT'], rules: [...RULES, { pick: 'MUG', subject: 'OLD', op: 'over', amount: 1 }] });
  assert.equal(d.lists[0].groups[0].rules.length, 2);
  // The owner can't move an item into a group by editing it, nor set the check fields.
  apply(d, { type: 'updateItem', listId: 'L', id: 'MUG', fields: { group: 'VAC', checkedAt: '2026-01-01T00:00:00Z' } });
  assert.equal(d.lists[0].items.find((i) => i.id === 'MUG')!.group, '');
  assert.equal(d.lists[0].items.find((i) => i.id === 'MUG')!.checkedAt, '');
  // Deleting the newer vacuum drops the rules that named it.
  apply(d, { type: 'removeItem', listId: 'L', id: 'NEW' });
  assert.deepEqual(d.lists[0].groups[0].rules, []);
  // Moving one to another list takes it out of the group.
  apply(d, { type: 'addList', id: 'L2', kind: 'mine', fields: { name: 'Other' } });
  apply(d, { type: 'transferItem', listId: 'L', id: 'ALT', toListId: 'L2' });
  assert.equal(d.lists[1].items[0].group, '');
  apply(d, { type: 'removeGroup', listId: 'L', id: 'VAC' });
  assert.deepEqual(d.lists[0].groups, []);
  assert.ok(d.lists[0].items.every((i) => i.group === ''));
  // Stored data with a dangling group or rule loads cleanly.
  const loaded = normalizeWishlist({ lists: [{ id: 'L', items: [{ id: 'A', title: 'a', group: 'nope' }], groups: [{ id: 'empty', name: 'x' }] }] });
  assert.equal(loaded.lists[0].items[0].group, '');
  assert.deepEqual(loaded.lists[0].groups, []);
});

test('givers: the group shows its pick; one claim covers the group; got-it-myself hides the whole group', () => {
  const d = vacuums({ OLD: 500, NEW: 650, ALT: 300 });
  const list = d.lists[0];
  const c = emptyClaims();
  let view = giverView(list, c.claims, 'k:aunt', img);
  assert.deepEqual(view.groups, [{ id: 'VAC', name: 'A vacuum', pick: 'ALT', reason: 'Vac 2 is $650, over $600' }]);
  assert.ok(view.items.every((i) => !('checkNote' in i) && !('checkedAt' in i)));

  const item = (id: string) => list.items.find((i) => i.id === id)!;
  claimItem(c, item('ALT'), 'k:aunt', {}, newId, undefined, groupSiblings(list, 'ALT'));
  view = giverView(list, c.claims, 'k:uncle', img);
  assert.deepEqual(view.items.filter((i) => i.groupTaken).map((i) => i.id), ['OLD', 'NEW']);
  assert.equal(view.items.find((i) => i.id === 'MUG')!.groupTaken, false);
  // Nobody else can get another one of the group.
  assert.throws(() => claimItem(c, item('NEW'), 'k:uncle', {}, newId, undefined, groupSiblings(list, 'NEW')), ClaimError);
  // The same person changing their mind moves their claim.
  claimItem(c, item('NEW'), 'k:aunt', {}, newId, undefined, groupSiblings(list, 'NEW'));
  assert.deepEqual(c.claims.map((x) => x.itemId), ['NEW']);

  // The owner's preview has no claim fields.
  assert.ok(ownerPreview(list, img).items.every((i) => !('groupTaken' in i)));

  // Bought one themselves: the whole group leaves the givers' view, and can't be claimed.
  item('OLD').gotIt = true;
  view = giverView(list, c.claims, 'k:uncle', img);
  assert.deepEqual(view.items.map((i) => i.id), ['MUG']);
  assert.deepEqual(view.groups, []);
  assert.throws(() => claimItem(c, item('NEW'), 'k:aunt', {}, newId, undefined, groupSiblings(list, 'NEW')), ClaimError);
});

test('tidy: getting one of a group takes the whole group off the list', () => {
  const d = vacuums({ OLD: 500, NEW: 650, ALT: 300 });
  const list = d.lists[0];
  const c = emptyClaims();
  claimItem(c, list.items.find((i) => i.id === 'NEW')!, 'k:aunt', { name: 'Aunt May' }, newId, new Date('2026-12-20T10:00:00Z'), groupSiblings(list, 'NEW'));
  const result = applyTidy(d, c, { decisions: { NEW: 'got' }, asOf: '2026-12-25T00:00:00Z' }, { nameFor: () => 'Someone', newId, now: new Date('2026-12-26T09:00:00Z') });
  assert.equal(result.got, 1);
  assert.deepEqual(d.lists[0].items.map((i) => i.id), ['MUG']);
  assert.deepEqual(d.lists[0].groups, []);
  assert.equal(d.received[0].items[0].title, 'Vac 2');
  assert.equal(c.claims.length, 0);
});

test('layout: a group is one block where its first item was, picked item first', () => {
  const items = [{ id: 'A', group: '' }, { id: 'B', group: 'G' }, { id: 'C', group: '' }, { id: 'D', group: 'G' }, { id: 'E', group: 'H' }];
  const rows = arrangeGroups(items, [{ id: 'G', name: 'Vac', pick: 'D', reason: 'cheaper' }]);
  assert.deepEqual(rows.map((r) => (r.kind === 'item' ? r.item.id : `[${r.items.map((i) => i.id).join(',')}]`)), ['A', '[D,B]', 'C', 'E']);
});
