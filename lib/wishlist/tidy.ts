// "The big day's been": after a birthday or Christmas the owner can look at what
// people marked as getting them, move the things they got into a "Received"
// history and put the rest back up for grabs. Pure logic, so it can be tested.
// This is the one deliberate place the owner sees claims; the routes that call it
// are owner-only and only ever read the owner's own claims file.

import type { ClaimsData } from './claims';
import { cleanText, isId, WishlistInputError, type ReceivedGroup, type WishlistData } from './model';

export type TidyDecision = 'got' | 'keep';

export type TidyRow = {
  listId: string;
  listName: string;
  listEmoji: string;
  itemId: string;
  title: string;
  url: string;
  /** An image id, for the route to turn into a link. */
  image: string;
  /** How many the owner wanted. */
  quantity: number;
  /** How many have been claimed in total. */
  claimedQty: number;
  givers: { name: string; qty: number; at: string }[];
  latestAt: string;
};

type Scope = { listId?: string | null; since?: string; asOf?: string };

/** A claim counts if it's within the window (claims with no date are always counted). */
const inWindow = (at: string, { since, asOf }: Scope) => !at || ((!since || at > since) && (!asOf || at <= asOf));

/** Items on the owner's own ("mine") lists that someone has claimed, newest claim first. */
export function buildTidyRows(data: WishlistData, claims: ClaimsData, scope: Scope, nameFor: (who: string) => string): TidyRow[] {
  const rows: TidyRow[] = [];
  for (const list of data.lists) {
    if (list.kind !== 'mine' || (scope.listId && list.id !== scope.listId)) continue;
    for (const item of list.items) {
      const mine = claims.claims.filter((c) => c.itemId === item.id && inWindow(c.at, scope));
      if (!mine.length) continue;
      rows.push({
        listId: list.id, listName: list.name, listEmoji: list.emoji, itemId: item.id, title: item.title, url: item.url, image: item.image, quantity: item.quantity,
        claimedQty: mine.reduce((sum, c) => sum + c.qty, 0),
        givers: mine.map((c) => ({ name: c.name || nameFor(c.who), qty: c.qty, at: c.at })),
        latestAt: mine.map((c) => c.at).sort().at(-1) ?? '',
      });
    }
  }
  return rows.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

export type TidyResult = { got: number; kept: number; group: ReceivedGroup | null };

/**
 * Apply the owner's choices (item id -> "got" or "keep") to the claims that were
 * showing when they looked (`asOf`), so a claim made a moment later isn't swept up unseen.
 * "got" moves the claimed number off the list into a Received group (the item leaves
 * the list entirely if all that was wanted were claimed); "keep" leaves the item and
 * frees its claims. Every claim that was shown is cleared either way.
 */
export function applyTidy(
  data: WishlistData,
  claims: ClaimsData,
  input: { decisions: Record<string, unknown>; asOf: string; listId?: string | null; groupName?: unknown; sinceLast?: boolean },
  deps: { nameFor: (who: string) => string; newId: () => string; now?: Date },
): TidyResult {
  const now = deps.now ?? new Date();
  const asOf = Number.isNaN(Date.parse(input.asOf)) ? now.toISOString() : input.asOf;
  if (input.listId && !isId(input.listId)) throw new WishlistInputError('That list isn’t there any more.');
  if (input.listId && !data.lists.some((l) => l.id === input.listId)) throw new WishlistInputError('That list isn’t there any more.');
  const scope: Scope = { listId: input.listId, since: data.lastTidyAt || undefined, asOf };
  const rows = buildTidyRows(data, claims, scope, deps.nameFor).filter((r) => Object.hasOwn(input.decisions, r.itemId));
  if (!rows.length) throw new WishlistInputError('There’s nothing to tidy up.');

  const group: ReceivedGroup = {
    id: deps.newId(),
    name: cleanText(input.groupName, 60) || `Received ${now.toISOString().slice(0, 10)}`,
    at: now.toISOString(),
    items: [],
  };
  const done = new Set<string>();
  let kept = 0;
  for (const row of rows) {
    done.add(row.itemId);
    if (input.decisions[row.itemId] === 'keep') {
      kept++;
      continue;
    }
    const list = data.lists.find((l) => l.id === row.listId)!;
    const index = list.items.findIndex((i) => i.id === row.itemId);
    // Already gone with the rest of its group (another of them was got).
    if (index < 0) continue;
    const item = list.items[index];
    const qty = Math.min(row.claimedQty, item.quantity);
    group.items.push({
      id: deps.newId(), title: item.title, url: item.url, image: item.image, price: item.price, currency: item.currency, store: item.store,
      quantity: qty, listName: list.name, givers: row.givers.map(({ name, qty: q }) => ({ name, qty: q })), claimedAt: row.latestAt, thanked: false,
    });
    if (item.quantity - qty > 0) item.quantity -= qty;
    else list.items.splice(index, 1);
    // Any one of a group would do, so the rest of it goes too.
    if (item.group) {
      for (const other of list.items.filter((i) => i.group === item.group)) done.add(other.id);
      list.items = list.items.filter((i) => i.group !== item.group);
      list.groups = list.groups.filter((g) => g.id !== item.group);
    }
  }

  // Clear what was shown, and nothing newer.
  claims.claims = claims.claims.filter((c) => !(done.has(c.itemId) && inWindow(c.at, scope)));
  if (group.items.length) data.received.unshift(group);
  // Only a tidy of everything moves the marker: a one-list tidy mustn't hide other lists' claims.
  if (!input.listId) data.lastTidyAt = asOf;
  return { got: group.items.length, kept, group: group.items.length ? group : null };
}

export type ReceivedAction =
  | { type: 'thank'; groupId: string; itemId: string; thanked: boolean }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'removeItem'; groupId: string; itemId: string }
  | { type: 'removeGroup'; groupId: string };

export function applyReceivedAction(data: WishlistData, action: ReceivedAction): void {
  const group = data.received.find((g) => g.id === (action as { groupId?: unknown })?.groupId);
  if (!group) throw new WishlistInputError('That isn’t in your history any more.');
  switch (action.type) {
    case 'removeGroup':
      data.received = data.received.filter((g) => g !== group);
      return;
    case 'renameGroup': {
      const name = cleanText(action.name, 60);
      if (!name) throw new WishlistInputError('Give it a name.');
      group.name = name;
      return;
    }
    case 'thank':
    case 'removeItem': {
      const item = group.items.find((i) => i.id === action.itemId);
      if (!item) throw new WishlistInputError('That isn’t in your history any more.');
      if (action.type === 'thank') item.thanked = action.thanked === true;
      else {
        group.items = group.items.filter((i) => i !== item);
        if (!group.items.length) data.received = data.received.filter((g) => g !== group);
      }
      return;
    }
    default:
      throw new WishlistInputError('That change isn’t one I know.');
  }
}
