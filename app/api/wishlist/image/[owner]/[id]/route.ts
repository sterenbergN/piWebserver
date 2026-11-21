import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { isId, isShareToken } from '@/lib/wishlist/model';
import { loadWishlist, readImage, resolveShare, sharesHousehold } from '@/lib/wishlist/store';

// A kept product picture. Shown to its owner, to a household member (only if it's on
// one of the owner's shareable lists), or to someone holding that list's share token.

export async function GET(request: Request, context: { params: Promise<{ owner: string; id: string }> }) {
  const { owner, id } = await context.params;
  const missing = () => new NextResponse(null, { status: 404 });
  if (!isId(owner) || !isId(id)) return missing();

  const viewer = await getAuthenticatedWorkoutUserId();
  let allowed = viewer === owner;
  if (!allowed) {
    const token = new URL(request.url).searchParams.get('t');
    if (token && isShareToken(token)) {
      const found = await resolveShare(token);
      allowed = !!found && found.ownerId === owner && found.list.items.some((i) => i.image === id && !i.gotIt);
    }
  }
  if (!allowed && viewer && (await sharesHousehold(viewer, owner))) {
    const lists = (await loadWishlist(owner)).lists;
    allowed = lists.some((l) => l.kind === 'mine' && l.items.some((i) => i.image === id && !i.gotIt));
  }
  if (!allowed) return missing();

  const file = await readImage(owner, id);
  if (!file) return missing();
  return new NextResponse(new Uint8Array(file), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}
