import { NextResponse } from 'next/server';
import { findHousehold } from '@/lib/chores/households';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { pruneClaims } from '@/lib/wishlist/claims';
import { applyWishlistAction, ownerView, setShareToken, WishlistInputError, type WishlistAction } from '@/lib/wishlist/model';
import { householdLists } from '@/lib/wishlist/shared';
import {
  editClaims, editWishlist, forgetShare, imageUrlFor, loadWishlist, newId, newToken, ownerName, registerShare, sweepImages,
} from '@/lib/wishlist/store';

// The signed-in account's wishlists. This route (and the owner's page) never
// reads the claims file: who is getting what must not reach the list's owner.
// The "shared" part is other household members' lists, as a giver sees them.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const me = await requireWorkoutUserId();
    const data = await loadWishlist(me);
    const household = await findHousehold(me);
    const shared = await Promise.all(
      (household?.members ?? []).filter((id) => id !== me).map(async (id) => ({ ownerId: id, ownerName: await ownerName(id), lists: await householdLists(id, me) })),
    );
    return NextResponse.json(
      { success: true, me, lists: ownerView(data, imageUrlFor(me)), shared: shared.filter((s) => s.lists.length > 0) },
      { headers: PRIVATE },
    );
  } catch (error) {
    return handleApiError(error, 'Load wishlist failed');
  }
}

type ShareAction = { type: 'share'; listId: string; op: 'create' | 'revoke' | 'regenerate' };

export async function POST(request: Request) {
  try {
    const me = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const action = body.action as WishlistAction | ShareAction;
    if (!action || typeof action !== 'object') throw new ApiError(400, 'Missing change');

    let token: string | null = null;
    let dropped: string | null = null;
    let data;
    try {
      ({ data } = await editWishlist(me, (next) => {
        if (action.type === 'share') {
          const list = next.lists.find((l) => l.id === action.listId);
          if (!list) throw new WishlistInputError('That list isn’t there any more.');
          const before = list.shareToken;
          if (action.op === 'revoke') token = null;
          else if (action.op === 'regenerate' || !before) token = newToken();
          else token = before;
          setShareToken(next, action.listId, token);
          if (before && before !== token) dropped = before;
          return;
        }
        // Deleting a list that was shared ends its link too.
        if (action.type === 'removeList') dropped = next.lists.find((l) => l.id === action.id)?.shareToken ?? null;
        applyWishlistAction(next, action as WishlistAction, newId);
      }));
    } catch (error) {
      if (error instanceof WishlistInputError) throw new ApiError(400, error.message);
      throw error;
    }

    if (action.type === 'share' && token) await registerShare(token, me, action.listId);
    if (dropped) await forgetShare(dropped);
    if (['removeItem', 'removeList', 'updateItem'].includes(action.type)) {
      const ids = new Set(data.lists.flatMap((l) => l.items.map((i) => i.id)));
      await editClaims(me, (claims) => pruneClaims(claims, ids));
      await sweepImages(me, data);
    }
    return NextResponse.json({ success: true, me, lists: ownerView(data, imageUrlFor(me)) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save wishlist failed');
  }
}
