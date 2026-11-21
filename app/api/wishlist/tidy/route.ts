import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isId, WishlistInputError } from '@/lib/wishlist/model';
import { applyTidy, buildTidyRows } from '@/lib/wishlist/tidy';
import { editClaims, editWishlist, imageUrlFor, loadClaims, loadWishlist, newId, ownerName, sweepImages } from '@/lib/wishlist/store';

// The owner's "after the big day" tidy-up. This is the ONE place the owner is shown
// who claimed what, and only on purpose: they asked for it and confirmed. It reads
// only the signed-in account's own claims file, never anyone else's.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

/** Names for household members who claimed as themselves (they don't type one). */
async function nameLookup(claimWhos: string[]): Promise<(who: string) => string> {
  const names = new Map<string, string>();
  for (const who of new Set(claimWhos)) {
    if (who.startsWith('u:') && isId(who.slice(2))) names.set(who, await ownerName(who.slice(2)));
  }
  return (who) => names.get(who) ?? 'Someone';
}

export async function POST(request: Request) {
  try {
    const me = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const listId = typeof body.listId === 'string' && body.listId ? body.listId : null;
    if (listId && !isId(listId)) throw new ApiError(400, 'That list isn’t there any more.');

    if (body.op === 'preview') {
      const asOf = new Date().toISOString();
      const [data, claims] = await Promise.all([loadWishlist(me), loadClaims(me)]);
      const nameFor = await nameLookup(claims.claims.map((c) => c.who));
      const imageUrl = imageUrlFor(me);
      const rows = buildTidyRows(data, claims, { listId, since: data.lastTidyAt || undefined, asOf }, nameFor)
        .map(({ image, ...row }) => ({ ...row, imageUrl: image ? imageUrl(image) : null }));
      return NextResponse.json({ success: true, asOf, lastTidyAt: data.lastTidyAt, rows }, { headers: PRIVATE });
    }

    if (body.op === 'apply') {
      const decisions = body.decisions && typeof body.decisions === 'object' && !Array.isArray(body.decisions) ? (body.decisions as Record<string, unknown>) : null;
      if (!decisions || typeof body.asOf !== 'string') throw new ApiError(400, 'Missing choices');
      const claims = await loadClaims(me);
      const before = new Set(claims.claims.map((c) => c.id));
      const nameFor = await nameLookup(claims.claims.map((c) => c.who));
      let result;
      try {
        ({ result } = await editWishlist(me, (data) => applyTidy(data, claims, { decisions, asOf: body.asOf as string, listId, groupName: body.groupName }, { nameFor, newId })));
      } catch (error) {
        if (error instanceof WishlistInputError) throw new ApiError(400, error.message);
        throw error;
      }
      // Remove only the claims that were just handled, so one made a moment ago survives.
      const handled = new Set([...before].filter((id) => !claims.claims.some((c) => c.id === id)));
      await editClaims(me, (stored) => { stored.claims = stored.claims.filter((c) => !handled.has(c.id)); });
      await sweepImages(me, await loadWishlist(me));
      return NextResponse.json({ success: true, got: result.got, kept: result.kept }, { headers: PRIVATE });
    }

    throw new ApiError(400, 'That isn’t something I can do.');
  } catch (error) {
    return handleApiError(error, 'Tidy up failed');
  }
}
