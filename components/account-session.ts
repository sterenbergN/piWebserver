'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { clearWorkoutCache } from '@/lib/workout/offline-cache';

// Signing in and out, from any page. The navbar comes from the root layout, which
// only renders on a full page load, so an open page checks that it still matches
// the account the server sees.

const CHANNEL = 'site:account';

/** Tell this browser's other tabs that the account changed. */
export function announceAccountChange() {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage('changed');
    channel.close();
  } catch { /* An older browser: they catch up when next looked at. */ }
}

/** Sign out of everything and forget what this device kept for the account. */
export async function signOut() {
  await fetch('/api/workout/auth', { method: 'DELETE' });
  clearWorkoutCache();
  // Loaded here so the navbar doesn't carry the recipe code on every page.
  await import('@/lib/recipes/grocery-client').then((m) => m.forgetKitchenCopies()).catch(() => {});
  // The Reader stops showing this account's offline books, until they sign in again.
  try { localStorage.removeItem('reader-user'); } catch { /* Nothing to forget. */ }
  announceAccountChange();
  window.location.reload();
}

const identity = (isAdmin: boolean, username: string | null | undefined) => `${isAdmin}:${username ?? ''}`;

/** Keeps a page's sign-in state true to the server: on opening it, coming back to it, and when another tab changes account. */
export function useSessionCheck(isAdmin: boolean, username: string | undefined) {
  const router = useRouter();
  const shown = useRef('');
  useEffect(() => { shown.current = identity(isAdmin, username); }, [isAdmin, username]);

  useEffect(() => {
    let active = true;
    let firstAnswer = true;
    const check = async () => {
      const res = await fetch('/api/session', { cache: 'no-store' }).catch(() => null);
      const session = res?.ok ? await res.json().catch(() => null) : null;
      if (!active || !session?.success) return; // Offline or unsure: nothing has been learned.
      const justOpened = firstAnswer;
      firstAnswer = false;
      if (identity(session.isAdmin === true, session.user?.username) === shown.current) return;
      // Just opened, the page's own data came from the right account and only the server-rendered part is off.
      // Later on, everything on screen belongs to the old account.
      if (justOpened) router.refresh();
      else window.location.reload();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) void check(); };
    const onOnline = () => { void check(); };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = onOnline;
    } catch { /* An older browser: the other triggers still work. */ }

    void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      channel?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
    };
  }, [router]);
}
