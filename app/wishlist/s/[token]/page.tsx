import type { Metadata } from 'next';
import '@/components/wishlist/wishlist.css';
import PublicWishlist from '@/components/wishlist/PublicWishlist';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { isShareToken } from '@/lib/wishlist/model';
import { loadSharedView } from '@/lib/wishlist/shared';

// No login needed: whoever has the link sees the list. Kept out of search, and the
// referrer is hidden so the link's secret never leaks to the shops it points at.
export const metadata: Metadata = { title: 'Wishlist', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function SharedWishlistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = isShareToken(token) ? await loadSharedView(token, await getAuthenticatedWorkoutUserId(), null) : null;
  if (!view) {
    return (
      <div className="wl-page">
        <h1>Wishlist</h1>
        <p>This link doesn’t work any more. Ask them for a fresh one.</p>
      </div>
    );
  }
  return <PublicWishlist token={token} initial={view} />;
}
