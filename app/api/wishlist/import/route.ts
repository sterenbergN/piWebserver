import { NextResponse } from 'next/server';
import { ImportFetchError } from '@/lib/recipes/import-fetch';
import { createLimiter } from '@/lib/security/rate-limit';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { importFromLink } from '@/lib/wishlist/fetch-product';
import { cleanUrl } from '@/lib/wishlist/model';
import { saveImageFromUrl } from '@/lib/wishlist/store';

// Look up a product link (or just download a picture from a link). Nothing is
// saved to a list here; the page adds the item with what comes back.

const limiter = createLimiter({ max: 30, windowMs: 10 * 60_000 });

export async function POST(request: Request) {
  try {
    const me = await requireWorkoutUserId();
    if (limiter.retryAfter(me)) throw new ApiError(429, 'That’s a lot of lookups. Try again in a few minutes.');
    const body = await readJsonObject(request);
    limiter.hit(me);

    if (typeof body.imageUrl === 'string') {
      const url = cleanUrl(body.imageUrl);
      if (!url) throw new ApiError(400, 'That doesn’t look like a web address.');
      const image = await saveImageFromUrl(me, url);
      if (!image) throw new ApiError(422, 'Couldn’t use a picture from that link.');
      return NextResponse.json({ success: true, image });
    }
    if (typeof body.url !== 'string') throw new ApiError(400, 'Missing link');
    try {
      return NextResponse.json({ success: true, result: await importFromLink(me, body.url) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof ImportFetchError) throw new ApiError(400, error.message);
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Wishlist import failed');
  }
}
