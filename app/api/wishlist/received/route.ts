import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { WishlistInputError } from '@/lib/wishlist/model';
import { applyReceivedAction, type ReceivedAction } from '@/lib/wishlist/tidy';
import { editWishlist, imageUrlFor, loadWishlist, sweepImages } from '@/lib/wishlist/store';

// The owner's "Received" history, kept apart from /api/wishlist so that route stays
// free of anything about who gave what. It's the owner's own data, filled by a tidy-up.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

function present(me: string, received: Awaited<ReturnType<typeof loadWishlist>>['received']) {
  const imageUrl = imageUrlFor(me);
  return received.map((g) => ({ ...g, items: g.items.map(({ image, ...item }) => ({ ...item, imageUrl: image ? imageUrl(image) : null })) }));
}

export async function GET() {
  try {
    const me = await requireWorkoutUserId();
    const data = await loadWishlist(me);
    return NextResponse.json({ success: true, groups: present(me, data.received), lastTidyAt: data.lastTidyAt }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load received failed');
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const action = body.action as ReceivedAction;
    if (!action || typeof action !== 'object') throw new ApiError(400, 'Missing change');
    let data;
    try {
      ({ data } = await editWishlist(me, (next) => applyReceivedAction(next, action)));
    } catch (error) {
      if (error instanceof WishlistInputError) throw new ApiError(400, error.message);
      throw error;
    }
    await sweepImages(me, data);
    return NextResponse.json({ success: true, groups: present(me, data.received), lastTidyAt: data.lastTidyAt }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save received failed');
  }
}
