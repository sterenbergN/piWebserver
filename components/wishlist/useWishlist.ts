'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GiverList, OwnerList, WishlistAction } from '@/lib/wishlist/model';

export type SharedWithMe = { ownerId: string; ownerName: string; lists: GiverList[] };
export type ShareAction = { type: 'share'; listId: string; op: 'create' | 'revoke' | 'regenerate' };

export type ImportResult = {
  url: string; title: string; description: string; price: number | null; currency: string; store: string; image: string;
  missing: string[]; warning: string;
};

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (res.status === 401) throw Object.assign(new Error('Sign in to use your wishlist.'), { signedOut: true });
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Something went wrong.');
  return json as T;
}

/** The account's lists. Changes are saved on the server, and what it sends back replaces the local copy. */
export function useWishlist() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [lists, setLists] = useState<OwnerList[]>([]);
  const [shared, setShared] = useState<SharedWithMe[]>([]);
  const [me, setMe] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const body = await call<{ me: string; lists: OwnerList[]; shared: SharedWithMe[] }>('/api/wishlist');
      setMe(body.me);
      setLists(body.lists);
      setShared(body.shared);
      setStatus('ready');
    } catch (e) {
      setStatus((e as { signedOut?: boolean }).signedOut ? 'signed-out' : 'error');
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Make a change; resolves to true if it saved, and otherwise sets `error`. Changes go one at a time, in order. */
  const act = useCallback((action: WishlistAction | ShareAction): Promise<boolean> => {
    setBusy((n) => n + 1);
    const run = queue.current.then(async () => {
      try {
        const body = await call<{ lists: OwnerList[] }>('/api/wishlist', { action });
        setLists(body.lists);
        setError('');
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setBusy((n) => n - 1);
      }
    });
    queue.current = run;
    return run;
  }, []);

  const importLink = useCallback((url: string) => call<{ result: ImportResult }>('/api/wishlist/import', { url }).then((b) => b.result), []);
  const importImage = useCallback((imageUrl: string) => call<{ image: string }>('/api/wishlist/import', { imageUrl }).then((b) => b.image), []);

  const householdClaim = useCallback(async (ownerId: string, listId: string, itemId: string, action: 'claim' | 'unclaim', extra: { qty?: number; name?: string; note?: string } = {}) => {
    const body = await call<{ lists: GiverList[] }>('/api/wishlist/household', { action, ownerId, listId, itemId, ...extra });
    setShared((all) => all.map((s) => (s.ownerId === ownerId ? { ...s, lists: body.lists } : s)));
  }, []);

  return { status, me, lists, shared, error, setError, busy: busy > 0, act, load, importLink, importImage, householdClaim };
}

export type Wishlist = ReturnType<typeof useWishlist>;
