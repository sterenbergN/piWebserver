'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { selectAccount } from './db';
import Library from './Library';
import NotebookView from './NotebookView';
import { prepareOffline } from './offline';
import { fetchAccount, NotesSignedOut, syncNow, USER_KEY, watchSync } from './sync';

// The notes app's one page: the library, or a notebook (?notebook=<id>). One page, not two
// routes, so there's one thing for the service worker to keep and it can open with no
// connection. The account comes from the server when it can be reached, and otherwise from
// the last one seen on this device, whose notes are stored here under its name.

type Phase = 'starting' | 'signed-out' | 'offline-new' | 'ready';

function rememberedUser() {
  try { return localStorage.getItem(USER_KEY); } catch { return null; }
}

const addressed = () => {
  const params = new URLSearchParams(window.location.search);
  const notebook = params.get('notebook');
  return notebook ? { notebook, page: params.get('page') } : null;
};

export default function NotesApp() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [signedOut, setSignedOut] = useState(false);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState<{ notebook: string; page: string | null } | null>(null);
  const userRef = useRef<string | null>(null);

  /** Ask the server who's here, and settle what state the page should be in. */
  const refresh = useCallback(async () => {
    try {
      const { userId } = await fetchAccount();
      userRef.current = userId;
      selectAccount(userId);
      try { localStorage.setItem(USER_KEY, userId); } catch { /* Offline use just won't find it. */ }
      setOnline(true);
      setSignedOut(false);
      setPhase('ready');
      void syncNow();
    } catch (error) {
      const remembered = userRef.current ?? rememberedUser();
      if (error instanceof NotesSignedOut) {
        setOnline(true);
        if (!remembered) { setPhase('signed-out'); return; }
        setSignedOut(true);
      } else {
        setOnline(false);
        if (!remembered) { setPhase('offline-new'); return; }
      }
      userRef.current = remembered;
      selectAccount(remembered);
      setPhase('ready');
    }
  }, []);

  useEffect(() => {
    setOpen(addressed());
    void refresh();
    void prepareOffline().catch(() => {});

    const onPop = () => setOpen(addressed());
    const onOnline = () => { void refresh(); };
    const onOffline = () => setOnline(false);
    // A tablet rarely closes an app: it comes back to it. Send what's waiting when it leaves, and catch up when it returns.
    const onVisible = () => {
      if (!userRef.current) return;
      if (document.visibilityState === 'hidden') void syncNow();
      else void refresh();
    };
    const stop = watchSync((state) => {
      if (state === 'signed-out') setSignedOut(true);
    });
    window.addEventListener('popstate', onPop);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const openNotebook = useCallback((notebook: string, page: string | null = null) => {
    window.history.pushState(null, '', `/notes?notebook=${encodeURIComponent(notebook)}${page ? `&page=${encodeURIComponent(page)}` : ''}`);
    setOpen({ notebook, page });
  }, []);

  const closeNotebook = useCallback(() => {
    if (addressed()) window.history.pushState(null, '', '/notes');
    setOpen(null);
    void syncNow();
  }, []);

  if (phase === 'signed-out') {
    return (
      <div className="notes-signin">
        <SignInPrompt title="Sign in to your notes">
          Your notebooks are saved to your account, and only you can see them.
        </SignInPrompt>
      </div>
    );
  }

  if (phase === 'offline-new') {
    return (
      <div className="notes-signin">
        <section className="jr-locked">
          <h2>You’re offline</h2>
          <p className="jr-hint">Sign in here once with a connection, and your notes will open without one after that.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
        </section>
      </div>
    );
  }

  return (
    <div className="notes-space">
      {phase === 'ready' && (
        open ? (
          <NotebookView key={open.notebook} notebook={open.notebook} startPage={open.page} onExit={closeNotebook} />
        ) : (
          <Library online={online} signedOut={signedOut} onOpen={openNotebook} onSignIn={() => window.dispatchEvent(new Event('site:sign-in'))} />
        )
      )}
    </div>
  );
}
