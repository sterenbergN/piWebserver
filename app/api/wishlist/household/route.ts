import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { ClaimError, claimItem, unclaimItem, whoFromUser } from '@/lib/wishlist/claims';
import { isId } from '@/lib/wishlist/model';
import { householdLists } from '@/lib/wishlist/shared';
import { editClaims, loadWishlist, newId, sharesHousehold } from '@/lib/wishlist/store';

// A household member claiming a gift from the other's list, as themselves.
// The list's owner can't see it: this only touches the claims file.

export async function POST(request: Request) {
  try {
    const me = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const { ownerId, listId, itemId } = body;
    if (!isId(ownerId) || !isId(listId) || !isId(itemId)) throw new ApiError(400, 'Missing item');
    if (!(await sharesHousehold(me, ownerId))) throw new ApiError(403, 'That isn’t a list you can see.');
    const list = (await loadWishlist(ownerId)).lists.find((l) => l.id === listId && l.kind === 'mine');
    const item = list?.items.find((i) => i.id === itemId);
    if (!list || !item || item.gotIt) throw new ApiError(404, 'That item isn’t on the list any more.');

    try {
      await editClaims(ownerId, (claims) => {
        if (body.action === 'claim') claimItem(claims, item, whoFromUser(me), body, newId);
        else if (body.action === 'unclaim') unclaimItem(claims, item.id, whoFromUser(me));
        else throw new ClaimError('That isn’t something I can do.');
      });
    } catch (error) {
      if (error instanceof ClaimError) throw new ApiError(400, error.message);
      throw error;
    }
    const lists = await householdLists(ownerId, me);
    return NextResponse.json({ success: true, ownerId, lists }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Wishlist claim failed');
  }
}
