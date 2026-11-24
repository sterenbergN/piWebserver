// "I'm getting this": who has claimed what from someone's list. Kept apart from
// the list itself (.data/wishlist/claims/<owner>.json) and only ever read by
// the pages givers see, so the owner's side has no way to learn of them.

import crypto from 'crypto';
import { cleanText, MAX_QUANTITY, type Claim, type WishItem } from './model';

export class ClaimError extends Error {}

export type ClaimsData = { claims: Claim[] };
export const emptyClaims = (): ClaimsData => ({ claims: [] });
export const MAX_CLAIMS = 1000;

/** The claim key a browser keeps is never stored, only its hash. */
export function whoFromKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw new ClaimError('This browser’s claim key is missing. Reload the page and try again.');
  return `k:${crypto.createHash('sha256').update(key).digest('hex')}`;
}

/** A signed-in household member claims as their account. */
export const whoFromUser = (userId: string) => `u:${userId}`;

export function normalizeClaims(raw: unknown): ClaimsData {
  const source = raw && typeof raw === 'object' && Array.isArray((raw as ClaimsData).claims) ? (raw as ClaimsData).claims : [];
  const claims: Claim[] = [];
  for (const c of source.slice(0, MAX_CLAIMS)) {
    if (!c || typeof c.itemId !== 'string' || typeof c.who !== 'string' || typeof c.id !== 'string') continue;
    claims.push({
      id: c.id,
      itemId: c.itemId,
      who: c.who,
      name: cleanText(c.name, 40),
      note: cleanText(c.note, 200),
      qty: Math.min(MAX_QUANTITY, Math.max(1, Math.round(Number(c.qty)) || 1)),
      at: typeof c.at === 'string' ? c.at : '',
    });
  }
  return { claims };
}

/**
 * Claim `qty` of an item (replacing this person's earlier claim on it). You can't
 * take more than are still wanted after everyone else's claims. `siblings` are the
 * other items in its group: one claim covers them all, so nobody else may claim
 * one, and this person's claim on another moves to this one.
 */
export function claimItem(
  data: ClaimsData,
  item: Pick<WishItem, 'id' | 'quantity' | 'gotIt'>,
  who: string,
  input: { qty?: unknown; name?: unknown; note?: unknown },
  newId: () => string,
  now = new Date(),
  siblings: Pick<WishItem, 'id' | 'gotIt'>[] = [],
): void {
  if (item.gotIt || siblings.some((s) => s.gotIt)) throw new ClaimError('That one isn’t on the list any more.');
  const siblingIds = new Set(siblings.map((s) => s.id));
  if (data.claims.some((c) => siblingIds.has(c.itemId) && c.who !== who)) throw new ClaimError('Someone is already getting one of these.');
  const qty = Math.round(Number(input.qty ?? 1));
  if (!Number.isFinite(qty) || qty < 1) throw new ClaimError('Pick how many you’re getting.');
  const others = data.claims.filter((c) => c.itemId === item.id && c.who !== who).reduce((sum, c) => sum + c.qty, 0);
  const left = item.quantity - others;
  if (left < 1) throw new ClaimError('Someone has just claimed the last one.');
  if (qty > left) throw new ClaimError(left === 1 ? 'Only 1 is still wanted.' : `Only ${left} are still wanted.`);
  data.claims = data.claims.filter((c) => !(siblingIds.has(c.itemId) && c.who === who));
  const mine = data.claims.find((c) => c.itemId === item.id && c.who === who);
  if (!mine && data.claims.length >= MAX_CLAIMS) throw new ClaimError('This list has too many claims.');
  const next: Claim = { id: mine?.id ?? newId(), itemId: item.id, who, name: cleanText(input.name, 40), note: cleanText(input.note, 200), qty, at: now.toISOString() };
  if (mine) Object.assign(mine, next);
  else data.claims.push(next);
}

/** Undo this person's claim on an item (nothing happens if they hadn't claimed it). */
export function unclaimItem(data: ClaimsData, itemId: string, who: string): void {
  data.claims = data.claims.filter((c) => !(c.itemId === itemId && c.who === who));
}

/** Forget claims on items that are no longer in the list. */
export function pruneClaims(data: ClaimsData, itemIds: Set<string>): void {
  data.claims = data.claims.filter((c) => itemIds.has(c.itemId));
}
