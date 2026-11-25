// What someone other than the owner is shown, built in one place so the share
// page, its API and the in-app "Shared with me" all follow the same rules.

import { whoFromKey, whoFromUser } from './claims';
import { giverView, ownerPreview, type GiverList, type WishList } from './model';
import { imageUrlFor, loadClaims, loadWishlist, ownerName, resolveShare } from './store';

export type SharedView = { ownerName: string; isOwner: boolean; list: GiverList };

function safeWho(key: unknown): string | null {
  try {
    return whoFromKey(key);
  } catch {
    return null;
  }
}

/**
 * A shared list for whoever holds `token`. The signed-in owner opening their own
 * link gets the plain list: no claims and no claim fields, same as everywhere else.
 */
export async function loadSharedView(token: string, viewerId: string | null, key: unknown): Promise<SharedView | null> {
  const found = await resolveShare(token);
  if (!found) return null;
  const imageUrl = imageUrlFor(found.ownerId, token);
  const name = await ownerName(found.ownerId);
  if (viewerId && viewerId === found.ownerId) return { ownerName: name, isOwner: true, list: ownerPreview(found.list, imageUrl) };
  const claims = (await loadClaims(found.ownerId)).claims;
  return { ownerName: name, isOwner: false, list: giverView(found.list, claims, safeWho(key), imageUrl) };
}

/** A household member's own "mine" lists as the other person sees them (not ones they hid from the household). */
export async function householdLists(ownerId: string, viewerId: string): Promise<GiverList[]> {
  const [data, claims] = await Promise.all([loadWishlist(ownerId), loadClaims(ownerId)]);
  const imageUrl = imageUrlFor(ownerId);
  return data.lists.filter((l: WishList) => l.kind === 'mine' && !l.householdHidden).map((l) => giverView(l, claims.claims, whoFromUser(viewerId), imageUrl));
}
