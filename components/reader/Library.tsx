'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { formatFromName, MAX_BOOK_BYTES, notesByChapter, type Anchor, type BookMeta, type ReaderItem } from '@/lib/reader/items';
import { readBookInfo } from './bookinfo';
import { deleteFile, getCover, getProgress, listFileIds, type StoredProgress } from './db';
import NotesPanel from './NotesPanel';
import type { ReaderSettings } from './source';
import { deleteBookEverywhere, downloadBook, ReaderSignedOut, renameBookEverywhere, syncBook, uploadBook } from './sync';
import { useBookItems } from './useBookItems';

// Your books. A book can be on the server, on this device, or both, and the card says
// which. Only books kept on this device open with no connection.

type Upload = { id: number; name: string; fraction: number; error?: string };

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Hue for a book with no cover: the same every time, picked from its title. */
function coverHue(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function Cover({ book, url }: { book: BookMeta; url?: string }) {
  if (url) {
    return <img className="rd-cover" src={url} alt="" />;
  }
  return (
    <div className="rd-cover is-plain" style={{ '--hue': coverHue(book.title) } as React.CSSProperties}>
      <span>{book.title}</span>
      {book.author && <small>{book.author}</small>}
    </div>
  );
}

/** How to put the app on a home screen. Only shown where it isn't there yet. */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const installed = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem('reader-install-hint') === 'no'; } catch { /* Private browsing. */ }
    if (installed || dismissed) return;
    const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIos(appleTouch);
    if (appleTouch) setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt: () => Promise<void> });
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem('reader-install-hint', 'no'); } catch { /* Private browsing. */ }
  };
  return (
    <div className="rd-banner">
      <Icon name="device" />
      <p>{ios ? <>To read full screen with no connection, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</> : 'Add the Reader to your home screen to read full screen with no connection.'}</p>
      {prompt && <button type="button" className="rd-btn is-primary" onClick={() => { void prompt.prompt(); dismiss(); }}>Add</button>}
      <button type="button" className="rd-icon-btn" aria-label="Dismiss" onClick={dismiss}><Icon name="x" /></button>
    </div>
  );
}

/** A book's notes, from the shelf, without having to open the book. */
function BookNotes({ book, theme, onOpenAt, onClose }: { book: BookMeta; theme: ReaderSettings['theme']; onOpenAt: (anchor: Anchor) => void; onClose: () => void }) {
  const { all, version, editNote, remove, loaded } = useBookItems(book.id);
  // `version` is what says the list has changed.
  const items = useMemo<ReaderItem[]>(() => all(), [all, version]);
  const count = notesByChapter(items).reduce((n, g) => n + g.notes.length, 0);
  return (
    <div className="rd-sheet-wrap" onClick={onClose}>
      <aside className="rd-sheet" aria-label={`Notes on ${book.title}`} onClick={(e) => e.stopPropagation()}>
        <div className="rd-sheet-head">
          <div className="rd-sheet-title">
            <strong>{book.title}</strong>
            <span>{loaded ? `${count} note${count === 1 ? '' : 's'}` : 'Loading…'}</span>
          </div>
          <span className="rd-grow" />
          <button type="button" className="rd-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="rd-sheet-body">
          <NotesPanel items={items} theme={theme} onJump={onOpenAt} onEdit={editNote} onDelete={remove} />
        </div>
      </aside>
    </div>
  );
}

export default function Library({ books, theme, online, signedOut, onChanged, onOpen, onSignIn }: {
  books: BookMeta[];
  theme: ReaderSettings['theme'];
  online: boolean;
  signedOut: boolean;
  onChanged: () => Promise<void>;
  onOpen: (book: BookMeta, at?: Anchor) => void;
  onSignIn: () => void;
}) {
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, StoredProgress>>({});
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [downloads, setDownloads] = useState<Record<string, number>>({});
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [menuFor, setMenuFor] = useState<BookMeta | null>(null);
  const [notesFor, setNotesFor] = useState<BookMeta | null>(null);
  const [renaming, setRenaming] = useState<{ title: string; author: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverUrls = useRef<Record<string, string>>({});

  const refreshLocal = useCallback(async () => {
    const ids = await listFileIds();
    setKept(new Set(ids));
    const entries = await Promise.all(books.map(async (book) => [book.id, await getProgress(book.id)] as const));
    setProgress(Object.fromEntries(entries.filter((entry): entry is readonly [string, StoredProgress] => !!entry[1])));
    for (const book of books) {
      if (!book.hasCover || coverUrls.current[book.id]) continue;
      const blob = await getCover(book.id);
      if (blob) coverUrls.current[book.id] = URL.createObjectURL(blob);
    }
    setCovers({ ...coverUrls.current });
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    setStorage(estimate?.usage ? fmtSize(estimate.usage) : '');
  }, [books]);

  useEffect(() => { void refreshLocal(); }, [refreshLocal]);

  useEffect(() => () => {
    for (const url of Object.values(coverUrls.current)) URL.revokeObjectURL(url);
  }, []);

  const addFiles = async (files: File[]) => {
    setError('');
    for (const file of files) {
      const id = Date.now() + Math.random();
      if (!formatFromName(file.name)) {
        setUploads((u) => [...u, { id, name: file.name, fraction: 0, error: 'Books can be EPUB, PDF, CBZ, TXT, Markdown or HTML.' }]);
        continue;
      }
      if (file.size > MAX_BOOK_BYTES) {
        setUploads((u) => [...u, { id, name: file.name, fraction: 0, error: 'That book is over the 1 GB limit.' }]);
        continue;
      }
      setUploads((u) => [...u, { id, name: file.name, fraction: 0 }]);
      try {
        const details = await readBookInfo(file);
        await uploadBook(file, details, (fraction) => setUploads((u) => u.map((row) => (row.id === id ? { ...row, fraction } : row))));
        setUploads((u) => u.filter((row) => row.id !== id));
        await onChanged();
      } catch (e) {
        if (e instanceof ReaderSignedOut) { onSignIn(); return; }
        const message = e instanceof TypeError ? 'No connection. Try again when you’re online.' : e instanceof Error ? e.message : 'That didn’t upload.';
        setUploads((u) => u.map((row) => (row.id === id ? { ...row, error: message } : row)));
      }
    }
  };

  const keepHere = async (book: BookMeta) => {
    setDownloads((d) => ({ ...d, [book.id]: 0 }));
    try {
      await downloadBook(book, (fraction) => setDownloads((d) => ({ ...d, [book.id]: fraction })));
      await syncBook(book.id).catch(() => false);
    } catch (e) {
      if (e instanceof ReaderSignedOut) onSignIn();
      else setError(e instanceof TypeError ? 'No connection. Try again when you’re online.' : e instanceof Error ? e.message : 'That didn’t download.');
    }
    setDownloads((d) => {
      const { [book.id]: _done, ...rest } = d;
      return rest;
    });
    await refreshLocal();
  };

  const missing = books.filter((book) => !kept.has(book.id));
  const keepAll = async () => {
    for (const book of missing) await keepHere(book);
  };

  const removeHere = async (book: BookMeta) => {
    await deleteFile(book.id);
    setMenuFor(null);
    await refreshLocal();
  };

  const saveRename = async () => {
    if (!menuFor || !renaming) return;
    try {
      await renameBookEverywhere(menuFor, renaming.title, renaming.author);
      closeMenu();
      await onChanged();
    } catch (e) {
      setError(e instanceof TypeError ? 'Renaming needs a connection.' : e instanceof Error ? e.message : 'That didn’t save.');
    }
  };

  const deleteForGood = async () => {
    if (!menuFor) return;
    try {
      await deleteBookEverywhere(menuFor.id);
      closeMenu();
      await onChanged();
    } catch (e) {
      setError(e instanceof TypeError ? 'Deleting a book needs a connection.' : e instanceof Error ? e.message : 'That didn’t delete.');
      closeMenu();
    }
  };

  const closeMenu = () => {
    setMenuFor(null);
    setRenaming(null);
    setConfirmDelete(false);
  };

  // What you were last reading, first.
  const ordered = useMemo(() => [...books].sort((a, b) => {
    const at = (book: BookMeta) => progress[book.id]?.at ?? Date.parse(book.addedAt);
    return at(b) - at(a);
  }), [books, progress]);

  const canAdd = online && !signedOut;

  return (
    <div
      className={`rd-library${dragging ? ' is-dragging' : ''}`}
      data-rd-theme={theme}
      onDragOver={(e) => { e.preventDefault(); if (canAdd) setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (canAdd) void addFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="rd-lib-head">
        <div>
          <a className="rd-site-link" href="/today"><Icon name="left" size="0.9em" /> Noah Stuf</a>
          <h1>Reader</h1>
        </div>
        <span className="rd-grow" />
        <button type="button" className="rd-btn is-primary" disabled={!canAdd} onClick={() => fileInput.current?.click()}><Icon name="plus" /> Add a book</button>
        {/* No `accept`: iPhones grey out file types they don't recognise, like .cbz. Checked after picking instead. */}
        <input
          ref={fileInput} type="file" multiple hidden aria-label="Choose books"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void addFiles(files);
          }}
        />
      </header>

      <InstallHint />

      {!online && <div className="rd-banner"><Icon name="offline" /><p>You’re offline. Books on this device still open, and your notes will go up when you’re back.</p></div>}
      {online && signedOut && (
        <div className="rd-banner">
          <Icon name="user" />
          <p>Your sign-in has run out. Reading works, but nothing goes up to your account until you sign back in.</p>
          <button type="button" className="rd-btn is-primary" onClick={onSignIn}>Sign in</button>
        </div>
      )}
      {error && <div className="rd-banner is-error" role="alert"><Icon name="alert" /><p>{error}</p><button type="button" className="rd-icon-btn" aria-label="Dismiss" onClick={() => setError('')}><Icon name="x" /></button></div>}

      {uploads.length > 0 && (
        <ul className="rd-uploads">
          {uploads.map((row) => (
            <li key={row.id}>
              <span>{row.name}</span>
              {row.error ? (
                <>
                  <em>{row.error}</em>
                  <button type="button" className="rd-icon-btn" aria-label="Dismiss" onClick={() => setUploads((u) => u.filter((r) => r.id !== row.id))}><Icon name="x" /></button>
                </>
              ) : <div className="rd-meter"><span style={{ width: `${Math.round(row.fraction * 100)}%` }} /></div>}
            </li>
          ))}
        </ul>
      )}

      {!books.length && !uploads.length && (
        <div className="rd-welcome">
          <Icon name="book" size="2.5em" />
          <h2>Nothing on the shelf yet</h2>
          <p>Add an EPUB, PDF, CBZ, text, Markdown or HTML file. It’s saved to your account, so it’s on your phone and your iPad, and only you can see it.</p>
        </div>
      )}

      <ul className="rd-shelf">
        {ordered.map((book) => {
          const place = progress[book.id];
          const downloading = downloads[book.id];
          return (
            <li key={book.id} className="rd-card">
              <button type="button" className="rd-card-open" onClick={() => onOpen(book)} aria-label={`Open ${book.title}`} disabled={!kept.has(book.id) && !online}>
                <Cover book={book} url={covers[book.id]} />
                {place && <span className="rd-card-progress"><span style={{ width: `${Math.round(place.pct * 100)}%` }} /></span>}
              </button>
              <div className="rd-card-meta">
                <div>
                  <strong>{book.title}</strong>
                  <span>
                    {kept.has(book.id) ? <><Icon name="device" size="0.95em" /> On this device</> : downloading !== undefined ? `Downloading ${Math.round(downloading * 100)}%` : `${book.format.toUpperCase()} · ${fmtSize(book.size)}`}
                  </span>
                </div>
                <button type="button" className="rd-icon-btn" aria-label={`More for ${book.title}`} onClick={() => setMenuFor(book)}><Icon name="more" /></button>
              </div>
            </li>
          );
        })}
      </ul>

      {books.length > 0 && (
        <footer className="rd-lib-foot">
          {online && !signedOut && missing.length > 0 && (
            <button type="button" className="rd-btn" disabled={Object.keys(downloads).length > 0} onClick={() => void keepAll()}><Icon name="download" /> Keep all {missing.length} on this device</button>
          )}
          {storage && <span>Using {storage} on this device</span>}
        </footer>
      )}

      {menuFor && (
        <div className="rd-sheet-wrap is-center" onClick={closeMenu}>
          <div className="rd-menu" role="dialog" aria-label={menuFor.title} onClick={(e) => e.stopPropagation()}>
            {renaming ? (
              <form onSubmit={(e) => { e.preventDefault(); void saveRename(); }}>
                <label className="rd-label" htmlFor="rd-title">Title</label>
                <input id="rd-title" className="rd-input" value={renaming.title} autoFocus onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
                <label className="rd-label" htmlFor="rd-author">Author</label>
                <input id="rd-author" className="rd-input" value={renaming.author} onChange={(e) => setRenaming({ ...renaming, author: e.target.value })} />
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setRenaming(null)}>Cancel</button>
                  <span className="rd-grow" />
                  <button type="submit" className="rd-btn is-primary" disabled={!renaming.title.trim()}>Save</button>
                </div>
              </form>
            ) : confirmDelete ? (
              <>
                <p className="rd-menu-title">Delete this book from your account?</p>
                <p className="rd-hint">{menuFor.title}, with all its notes and pen marks, goes from every device. This can’t be undone.</p>
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
                  <span className="rd-grow" />
                  <button type="button" className="rd-btn is-danger" onClick={() => void deleteForGood()}>Delete</button>
                </div>
              </>
            ) : (
              <>
                <p className="rd-menu-title">{menuFor.title}{menuFor.author && <small>{menuFor.author}</small>}</p>
                <button type="button" onClick={() => { const book = menuFor; closeMenu(); setNotesFor(book); }}><Icon name="note" /> Notes</button>
                {kept.has(menuFor.id)
                  ? <button type="button" onClick={() => void removeHere(menuFor)}><Icon name="device" /> Remove from this device</button>
                  : <button type="button" disabled={!online || signedOut} onClick={() => { const book = menuFor; closeMenu(); void keepHere(book); }}><Icon name="download" /> Keep on this device</button>}
                <button type="button" disabled={!online || signedOut} onClick={() => setRenaming({ title: menuFor.title, author: menuFor.author })}><Icon name="pencil" /> Rename</button>
                <button type="button" className="is-danger" disabled={!online || signedOut} onClick={() => setConfirmDelete(true)}><Icon name="trash" /> Delete</button>
              </>
            )}
          </div>
        </div>
      )}

      {notesFor && <BookNotes book={notesFor} theme={theme} onClose={() => setNotesFor(null)} onOpenAt={(anchor) => { const book = notesFor; setNotesFor(null); onOpen(book, anchor); }} />}
    </div>
  );
}
