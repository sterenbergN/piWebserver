'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SharedView } from '@/lib/wishlist/shared';
import GiverList, { type ClaimInput } from './GiverList';
import './wishlist.css';

// The share-link page. The claim key is a random string kept only in this browser
// (the server stores just a hash of it): it's how "Undo" knows which claims are yours.

function claimKey(token: string): string {
  const name = `wishlist-claim-key:${token}`;
  try {
    const existing = localStorage.getItem(name);
    if (existing && /^[\w-]{16,100}$/.test(existing)) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(name, key);
    return key;
  } catch {
    // Private browsing: a key for this visit only, so claims still work but can't be undone later.
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export default function PublicWishlist({ token, initial }: { token: string; initial: SharedView }) {
  const [view, setView] = useState<SharedView>(initial);
  const [key, setKey] = useState('');
  const [gone, setGone] = useState(false);

  const send = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/wishlist/shared/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (res.status === 404) { setGone(true); throw new Error(json?.message || 'This link doesn’t work any more.'); }
    if (!res.ok || !json?.success) throw new Error(json?.message || 'Something went wrong. Try again.');
    setView(json.view);
  }, [token]);

  // Once this browser's key is known, ask again so its own claims show.
  useEffect(() => {
    const k = claimKey(token);
    setKey(k);
    if (!initial.isOwner) void send({ action: 'view', key: k }).catch(() => {});
  }, [token, initial.isOwner, send]);

  if (gone) return <p className="wl-empty">This list isn’t shared any more.</p>;
  const { list } = view;
  return (
    <div className="wl-page wl-public animate-fade-in">
      <header className="wl-public-head">
        <h1><span aria-hidden>{list.emoji}</span> {list.name}</h1>
        <p className="wl-sub">
          {view.ownerName}’s wishlist{list.occasion ? ` · ${list.occasion}` : ''}{list.date ? ` · ${new Date(`${list.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}
        </p>
        {list.note && <p className="wl-note">{list.note}</p>}
        {view.isOwner
          ? <p className="wl-banner">This is how your list looks to others. Nothing you do here, and nothing anyone does there, shows up on your side.</p>
          : <p className="wl-banner">Tap “I’m getting this” on something so nobody doubles up. {view.ownerName} won’t see who picks what.</p>}
      </header>
      <GiverList
        list={list}
        askName
        readOnly={view.isOwner}
        onClaim={(itemId, input: ClaimInput) => send({ action: 'claim', key, itemId, ...input })}
        onUnclaim={(itemId) => send({ action: 'unclaim', key, itemId })}
      />
    </div>
  );
}
