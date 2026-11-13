'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import type { Anchor, BookMeta, Folder } from '@/lib/reader/items';
import AudioView from './AudioView';
import BookView from './BookView';
import { getFolders, listBooks, selectAccount } from './db';
import Library from './Library';
import { prepareOffline } from './offline';
import type { ReaderSettings } from './source';
import { applyShelf, fetchShelf, flushEverything, flushNow, pullChangedNotes, ReaderSignedOut, USER_KEY } from './sync';

// The Reader's one page: the shelf, or a book (?book=<id>). One page, not two routes, so
// there's one thing for the service worker to keep and it can open with no connection.
// The account comes from the server when it can be reached, and otherwise from the last
// one seen on this device, whose books and notes are stored here under its name.

type Phase = 'starting' | 'signed-out' | 'offline-new' | 'ready';

const SETTINGS_KEY = 'reader-settings';

function defaultSettings(): ReaderSettings {
  const dark = typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light';
  return { theme: dark ? 'night' : 'paper', font: 'book', fontSize: 19, lineHeight: 1.5 };
}

function loadSettings(): ReaderSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved) return { ...defaultSettings(), ...saved };
  } catch { /* Private browsing, or something unreadable: defaults are fine. */ }
  return defaultSettings();
}

function rememberedUser() {
  try { return localStorage.getItem(USER_KEY); } catch { return null; }
}

const bookInUrl = () => new URLSearchParams(window.location.search).get('book');

export default function ReaderApp() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [online, setOnline] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  const [open, setOpen] = useState<{ id: string; at: Anchor | null } | null>(null);
  const userRef = useRef<string | null>(null);
  const booksRef = useRef<BookMeta[]>([]);

  const showBooks = useCallback(async () => {
    const list = await listBooks();
    booksRef.current = list;
    setBooks(list);
    setFolders(await getFolders());
  }, []);

  /** Ask the server for the shelf, and settle what state the page should be in. */
  const refresh = useCallback(async () => {
    try {
      const shelf = await fetchShelf();
      userRef.current = shelf.userId;
      selectAccount(shelf.userId);
      try { localStorage.setItem(USER_KEY, shelf.userId); } catch { /* Offline reading just won't find it. */ }
      await applyShelf(shelf);
      setOnline(true);
      setSignedOut(false);
      await showBooks();
      setPhase('ready');
      await flushEverything(booksRef.current);
      void pullChangedNotes(shelf);
      return;
    } catch (error) {
      const remembered = userRef.current ?? rememberedUser();
      if (error instanceof ReaderSignedOut) {
        setOnline(true);
        if (!remembered) { setPhase('signed-out'); return; }
        setSignedOut(true);
      } else {
        setOnline(false);
        if (!remembered) { setPhase('offline-new'); return; }
      }
      userRef.current = remembered;
      selectAccount(remembered);
      await showBooks();
      setPhase('ready');
    }
  }, [showBooks]);

  useEffect(() => {
    setSettings(loadSettings());
    const fromUrl = bookInUrl();
    if (fromUrl) setOpen({ id: fromUrl, at: null });
    void refresh();
    void prepareOffline().catch(() => {});

    const onPop = () => {
      const id = bookInUrl();
      setOpen(id ? { id, at: null } : null);
    };
    const onOnline = () => { void refresh(); };
    const onOffline = () => setOnline(false);
    // A phone rarely closes an app: it comes back to it. Send what's waiting when it leaves, and catch up when it returns.
    const onVisible = () => {
      if (document.visibilityState === 'hidden') void flushNow();
      else if (userRef.current) void refresh();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const openBook = (book: BookMeta, at?: Anchor) => {
    window.history.pushState(null, '', `/reader?book=${encodeURIComponent(book.id)}`);
    setOpen({ id: book.id, at: at ?? null });
  };

  const closeBook = () => {
    if (bookInUrl()) window.history.pushState(null, '', '/reader');
    setOpen(null);
    void showBooks();
  };

  const changeSettings = (next: ReaderSettings) => {
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* It still applies for now. */ }
  };

  const signIn = () => window.dispatchEvent(new Event('site:sign-in'));

  if (phase === 'signed-out') {
    return (
      <div className="reader-signin">
        <SignInPrompt title="Sign in to your books">
          Your books, notes and pen marks are saved to your account, and only you can see them.
        </SignInPrompt>
      </div>
    );
  }

  if (phase === 'offline-new') {
    return (
      <div className="reader-signin">
        <section className="jr-locked">
          <h2>You’re offline</h2>
          <p className="jr-hint">Sign in here once with a connection, and your books will open without one after that.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
        </section>
      </div>
    );
  }

  const openedBook = open && books.find((book) => book.id === open.id);

  return (
    <div className="reader-space">
      {settings && phase === 'ready' && (
        openedBook?.format === 'audio' ? (
          <AudioView key={openedBook.id} book={openedBook} startAt={open?.at ?? null} settings={settings} onExit={closeBook} onSignedOut={() => { closeBook(); setSignedOut(true); }} />
        ) : openedBook ? (
          <BookView key={openedBook.id} book={openedBook} startAt={open.at} settings={settings} onSettings={changeSettings} onExit={closeBook} onSignedOut={() => { closeBook(); setSignedOut(true); }} />
        ) : (
          <Library books={books} folders={folders} theme={settings.theme} online={online} signedOut={signedOut} onChanged={refresh} onOpen={openBook} onSignIn={signIn} />
        )
      )}
    </div>
  );
}
