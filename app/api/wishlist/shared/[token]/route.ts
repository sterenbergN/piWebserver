import { NextResponse } from 'next/server';
import { clientAddress, createLimiter } from '@/lib/security/rate-limit';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { ClaimError, claimItem, unclaimItem, whoFromKey } from '@/lib/wishlist/claims';
import { groupSiblings, isShareToken } from '@/lib/wishlist/model';
import { loadSharedView } from '@/lib/wishlist/shared';
import { editClaims, newId, resolveShare } from '@/lib/wishlist/store';

// The public side of a share link: no login. Anyone with the token can view and
// claim; the claim key (kept in the giver's browser, stored only as a hash) is
// what lets them undo their own claim. The signed-in owner can look but not
// claim, and is never shown claims.

const limiter = createLimiter({ max: 120, windowMs: 10 * 60_000 });
const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!isShareToken(token)) throw new ApiError(404, 'This link doesn’t work any more.');
    const limitKey = `${clientAddress(request)}:${token}`;
    if (limiter.retryAfter(limitKey)) throw new ApiError(429, 'Slow down a little.');
    limiter.hit(limitKey);

    const body = await readJsonObject(request);
    const viewer = await getAuthenticatedWorkoutUserId();
    const found = await resolveShare(token);
    if (!found) throw new ApiError(404, 'This link doesn’t work any more.');

    if (body.action === 'claim' || body.action === 'unclaim') {
      if (viewer === found.ownerId) throw new ApiError(403, 'This is your own list, so there’s nothing to claim.');
      const item = found.list.items.find((i) => i.id === body.itemId);
      if (!item || item.gotIt) throw new ApiError(404, 'That item isn’t on the list any more.');
      try {
        const who = whoFromKey(body.key);
        await editClaims(found.ownerId, (claims) => {
          if (body.action === 'claim') claimItem(claims, item, who, body, newId, undefined, groupSiblings(found.list, item.id));
          else unclaimItem(claims, item.id, who);
        });
      } catch (error) {
        if (error instanceof ClaimError) throw new ApiError(400, error.message);
        throw error;
      }
    } else if (body.action !== 'view') {
      throw new ApiError(400, 'Unknown request');
    }

    const view = await loadSharedView(token, viewer, body.key);
    if (!view) throw new ApiError(404, 'This link doesn’t work any more.');
    return NextResponse.json({ success: true, view }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Shared wishlist failed');
  }
}
