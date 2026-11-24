import { NextResponse } from 'next/server';
import { createLimiter } from '@/lib/security/rate-limit';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { checkPricesFor } from '@/lib/wishlist/prices';
import { ownerView } from '@/lib/wishlist/model';
import { imageUrlFor, loadWishlist } from '@/lib/wishlist/store';

// "Check my prices now": re-reads the signed-in account's linked items, once per 10 minutes.

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const limiter = createLimiter({ max: 1, windowMs: 10 * 60_000 });

export async function POST() {
  try {
    const me = await requireWorkoutUserId();
    const wait = limiter.retryAfter(me);
    if (wait > 0) throw new ApiError(429, `You just checked. Try again in ${Math.max(1, Math.ceil(wait / 60))} minute${wait > 60 ? 's' : ''}.`);
    limiter.hit(me);
    const summary = await checkPricesFor(me, { force: true });
    const data = await loadWishlist(me);
    return NextResponse.json({ success: true, me, lists: ownerView(data, imageUrlFor(me)), summary }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Check wishlist prices failed');
  }
}
