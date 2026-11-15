'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import {
  booksInProgress, entrySeries, formatFromName, inSeriesOrder, MAX_BOOK_BYTES, notesByChapter, progressText, readingState, seriesOnShelf, shelfEntries,
  type Anchor, type BookMeta, type Folder, type ReaderItem, type ReadingState, type ShelfEntry,
} from '@/lib/reader/items';
import { readBookInfo } from './bookinfo';
import { deleteFile, getCover, getItems, getProgress, listFileIds, type StoredProgress } from './db';
import NotesPanel from './NotesPanel';
import NotesSearch from './NotesSearch';
import PublicLibrary, { usePublicLibrary } from './PublicLibrary';
import { ChapterEditor, CombineDialog, LinkDialog, SeriesDialog, SeriesOrderDialog } from './ShelfDialogs';
import { useYouTubeJobs, YouTubeForm, YouTubeJobs } from './YouTubeAudio';
import { spoken } from '@/lib/reader/audio';
import type { ReaderSettings } from './source';
import {
  createFolder, deleteBookEverywhere, deleteFolderEverywhere, deleteSeriesEverywhere, downloadBook, linkBooksEverywhere, markFinished, moveBooksEverywhere, orderSeriesEverywhere, ReaderSignedOut,
  renameBookEverywhere, renameFolderEverywhere, renameSeriesEverywhere, setSeriesEverywhere, syncBook, takeOffContinue, unlinkBookEverywhere, uploadBook,
} from './sync';
import { useBookItems } from './useBookItems';

// Your books. A book can be on the server, on this device, or both, and the card says
// which. Only books kept on this device open with no connection. Your own reading (where
// you are, what you've finished) works offline too; rearranging the shelf needs a
// connection, so every device always agrees on what's where.
//
// A book you have as text and as an audio book is one card, with a way into each. Books
// in a series stand together as one stack on the main shelf, and open out in their order.

type View = 'all' | 'reading' | 'finished' | 'device' | 'library' | `folder:${string}` | `series:${string}`;
type Dialog =
  | { kind: 'add' }
  | { kind: 'youtube' }
  | { kind: 'new-folder'; moving?: string[] }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'delete-folder'; folder: Folder }
  | { kind: 'move'; books: string[] }
  | { kind: 'series'; books: string[] }
  | { kind: 'rename-series'; name: string }
  | { kind: 'delete-series'; name: string }
  | { kind: 'order-series'; name: string }
  | { kind: 'link'; book: BookMeta }
  | { kind: 'combine'; books: string[] }
  | { kind: 'free-space' };

type Entry = ShelfEntry<BookMeta>;
/** What stands on the shelf: a book, or on the main shelf a whole series as one stack. */
type Shown = { kind: 'entry'; entry: Entry; number?: number } | { kind: 'stack'; name: string; entries: Entry[] };

const VIEW_KEY = 'reader-shelf-view';

function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** When you last read something, the way you'd say it. */
function fmtLastRead(ms: number, verb = 'Read', now = Date.now()) {
  const startOf = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(now) - startOf(ms)) / 86_400_000);
  if (days <= 0) return `${verb} today`;
  if (days === 1) return `${verb} yesterday`;
  if (days < 14) return `${verb} ${days} days ago`;
  return `${verb} ${fmtDay(ms)}`;
}


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
  const { all, version, editNote, makeTyped, remove, loaded } = useBookItems(book.id);
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
          <NotesPanel items={items} theme={theme} onJump={onOpenAt} onEdit={editNote} onDelete={remove} onMakeTyped={makeTyped} />
        </div>
      </aside>
    </div>
  );
}

/** Name something: a new folder, or an old one. */
function FolderForm({ title, start, action, onSave, onCancel }: { title: string; start: string; action: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(start);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
      <label className="rd-menu-title" htmlFor="rd-folder-name">{title}</label>
      <input id="rd-folder-name" className="rd-input" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
      <div className="rd-row">
        <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
        <span className="rd-grow" />
        <button type="submit" className="rd-btn is-primary" disabled={!name.trim()}>{action}</button>
      </div>
    </form>
  );
}


export default function Library({ books, folders, theme, online, signedOut, onChanged, onOpen, onSignIn }: {
  books: BookMeta[];
  folders: Folder[];
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
  const [chaptersFor, setChaptersFor] = useState<BookMeta | null>(null);
  const [renaming, setRenaming] = useState<{ title: string; author: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  // Audio on its way from YouTube, or being joined; the shelf refreshes as each one lands.
  const youtube = useYouTubeJobs(online && !signedOut, () => void onChanged());
  const [storage, setStorage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [view, setViewState] = useState<View>('all');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverUrls = useRef<Record<string, string>>({});
  // The public Library: a shelf here like any other, that anyone on the site can read from.
  const publicLibrary = usePublicLibrary(online);

  const refreshLocal = useCallback(async () => {
    const ids = await listFileIds();
    setKept(new Set(ids));
    const counts = await Promise.all(books.map(async (book) => [book.id, (await getItems(book.id)).filter((item) => !item.deleted && item.kind !== 'ink').length] as const));
    setNoteCounts(Object.fromEntries(counts));
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

  useEffect(() => {
    // /library used to be its own page, and now lands here.
    if (new URLSearchParams(window.location.search).get('shelf') === 'library') { setViewState('library'); return; }
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved) setViewState(saved as View);
    } catch { /* Private browsing: start on All. */ }
  }, []);

  const setView = (next: View) => {
    setViewState(next);
    // Arrived by the old Library address: once another shelf is picked, a reload shouldn't come back to it.
    if (window.location.search.includes('shelf=')) window.history.replaceState(null, '', '/reader');
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* It still applies for now. */ }
  };

  const seriesList = useMemo(() => seriesOnShelf(books), [books]);
  const currentFolder = view.startsWith('folder:') ? folders.find((f) => `folder:${f.id}` === view) : undefined;
  const currentSeries = view.startsWith('series:') ? seriesList.find((s) => `series:${s.name}` === view)?.name : undefined;
  // A folder or series removed on another device, or nothing left on this one.
  const shownView: View = (view.startsWith('folder:') && !currentFolder) || (view.startsWith('series:') && !currentSeries) || (view === 'device' && !kept.size) ? 'all' : view;

  /** Rearranging the shelf: says so plainly if it can't be done, then shows the new shelf. */
  const organize = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      setDialog(null);
      setSelected(null);
      await onChanged();
    } catch (e) {
      if (e instanceof ReaderSignedOut) onSignIn();
      else setError(e instanceof TypeError ? 'Organizing your books needs a connection.' : e instanceof Error ? e.message : 'That didn’t save.');
      setDialog(null);
    }
  };

  const moveTo = (ids: string[], folder: string | null) => organize(() => moveBooksEverywhere(ids, folder));

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
        await uploadBook(file, { ...details, folder: currentFolder?.id }, (fraction) => setUploads((u) => u.map((row) => (row.id === id ? { ...row, fraction } : row))));
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

  const keepMany = async (list: BookMeta[]) => {
    for (const book of list) if (!kept.has(book.id)) await keepHere(book);
  };

  // Audio books are big: each is kept on purpose, from its own menu or by selecting it, never all at once.
  const missing = books.filter((book) => !kept.has(book.id) && book.format !== 'audio');

  /** Off this device only. They stay in the account, with their notes and your place. */
  const removeHere = async (ids: string[]) => {
    for (const id of ids) await deleteFile(id);
    setMenuFor(null);
    setDialog(null);
    setSelected(null);
    await refreshLocal();
  };

  const clearContinue = async (ids: string[]) => {
    await takeOffContinue(ids);
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
  const entries = useMemo(() => shelfEntries(ordered), [ordered]);

  const canAdd = online && !signedOut;

  /** A book in two forms is being read if either is, and finished once one is. */
  const stateOf = (entry: Entry): ReadingState => {
    const states = entry.books.map((book) => readingState(progress[book.id]));
    return states.includes('reading') ? 'reading' : states.includes('finished') ? 'finished' : 'new';
  };
  /** The form you last had open: the text, until you've listened more recently. */
  const currentOf = (entry: Entry) => entry.books.reduce((best, book) => ((progress[book.id]?.at ?? 0) > (progress[best.id]?.at ?? 0) ? book : best), entry.books[0]);
  const inSeries = (name: string) => inSeriesOrder(entries.filter((entry) => entrySeries(entry)?.name === name));

  const readingCount = entries.filter((entry) => stateOf(entry) === 'reading').length;
  const finishedCount = entries.filter((entry) => stateOf(entry) === 'finished').length;
  const deviceCount = entries.filter((entry) => entry.books.some((book) => kept.has(book.id))).length;
  const notesTotal = Object.values(noteCounts).reduce((sum, n) => sum + n, 0);
  const continuing = booksInProgress(ordered, progress);

  const shown: Shown[] = (() => {
    if (currentSeries) return inSeries(currentSeries).map((entry, i) => ({ kind: 'entry' as const, entry, number: i + 1 }));
    if (shownView === 'all') {
      const out: Shown[] = [];
      const stacked = new Set<string>();
      for (const entry of entries) {
        const series = entrySeries(entry);
        const together = series ? inSeries(series.name) : [];
        if (!series || together.length < 2) out.push({ kind: 'entry', entry });
        else if (!stacked.has(series.name)) {
          stacked.add(series.name);
          out.push({ kind: 'stack', name: series.name, entries: together });
        }
      }
      return out;
    }
    const belongs = (entry: Entry) => {
      if (shownView === 'device') return entry.books.some((book) => kept.has(book.id));
      if (shownView === 'reading' || shownView === 'finished') return stateOf(entry) === shownView;
      return entry.books.some((book) => book.folder === currentFolder?.id);
    };
    return entries.filter(belongs).map((entry) => ({ kind: 'entry' as const, entry }));
  })();
  const shownBooks = shown.flatMap((item) => (item.kind === 'entry' ? item.entry.books : item.entries.flatMap((entry) => entry.books)));

  /** Selecting takes every form of a book, and a whole stack, together. */
  const toggleSelected = (ids: string[]) => setSelected((held) => {
    const next = new Set(held);
    const all = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    return next;
  });

  const selectedBooks = selected ? ordered.filter((book) => selected.has(book.id)) : [];
  const canJoin = selectedBooks.length >= 2 && selectedBooks.every((book) => book.format === 'audio');
  const selectedHere = selectedBooks.filter((book) => kept.has(book.id));
  const menuForms = menuFor ? entries.find((entry) => entry.books.some((book) => book.id === menuFor.id))?.books ?? [menuFor] : [];
  const dialogSeries = dialog?.kind === 'series' ? [...new Set(books.filter((book) => dialog.books.includes(book.id)).map((book) => book.series))] : [];

  const describe = (entry: Entry) => {
    const kinds = entry.books.map((book) => (book.format === 'audio' ? `Audio · ${spoken(book.audio?.duration ?? 0)}` : book.format.toUpperCase()));
    return `${kinds.join(' + ')} · ${fmtSize(entry.books.reduce((sum, book) => sum + book.size, 0))}`;
  };

  const pickMark = (picked: boolean) => <span className="rd-card-pick" aria-hidden>{picked && <Icon name="check" size="0.9em" />}</span>;

  const entryCard = (entry: Entry, number?: number) => {
    const first = entry.books[0];
    const current = currentOf(entry);
    const place = progress[current.id];
    const state = stateOf(entry);
    const ids = entry.books.map((book) => book.id);
    const picked = !!selected && ids.every((id) => selected.has(id));
    const here = entry.books.filter((book) => kept.has(book.id));
    const downloading = entry.books.map((book) => downloads[book.id]).find((d) => d !== undefined);
    const notes = entry.books.reduce((n, book) => n + (noteCounts[book.id] ?? 0), 0);
    // With no connection, the form that's on this device is the one that opens.
    const opens = online || kept.has(current.id) ? current : here[0];
    return (
      <li key={entry.key} className={`rd-card${picked ? ' is-picked' : ''}`}>
        <button
          type="button" className="rd-card-open" aria-pressed={selected ? picked : undefined}
          aria-label={selected ? `Select ${first.title}` : `Open ${first.title}`}
          disabled={!selected && !opens}
          onClick={() => (selected ? toggleSelected(ids) : opens && onOpen(opens))}
        >
          <Cover book={first} url={covers[(entry.books.find((book) => covers[book.id]) ?? first).id]} />
          {state === 'reading' && place && <span className="rd-card-progress"><span style={{ width: `${Math.round(place.pct * 100)}%` }} /></span>}
          {state === 'finished' && <span className="rd-card-badge" title="Finished"><Icon name="check" size="0.9em" /></span>}
          {number !== undefined && <span className="rd-card-number" aria-label={`Number ${number} in the series`}>{number}</span>}
          {selected && pickMark(picked)}
        </button>
        <div className="rd-card-meta">
          <div>
            <strong>{first.title}</strong>
            {entry.books.length > 1 && !selected ? (
              <span className="rd-forms">
                {entry.books.map((book) => {
                  const at = progress[book.id];
                  const reads = readingState(at);
                  const label = book.format === 'audio' ? 'Listen' : 'Read';
                  return (
                    <button type="button" key={book.id} className={`rd-form${book.id === current.id ? ' is-current' : ''}`} disabled={!online && !kept.has(book.id)} aria-label={`${label}: ${book.title}`} onClick={() => onOpen(book)}>
                      <Icon name={book.format === 'audio' ? 'play' : 'book'} size="0.95em" /> {label}{reads === 'reading' && at ? ` ${Math.round(at.pct * 100)}%` : ''}{reads === 'finished' && <Icon name="check" size="0.85em" />}
                    </button>
                  );
                })}
              </span>
            ) : <span className="rd-card-state">{progressText(place, current.format)}</span>}
            <span>
              {here.length === entry.books.length ? <><Icon name="device" size="0.95em" /> On this device</>
                : downloading !== undefined ? `Downloading ${Math.round(downloading * 100)}%`
                : here.length ? <><Icon name="device" size="0.95em" /> {here[0].format === 'audio' ? 'Audio' : 'Text'} on this device</>
                : describe(entry)}
            </span>
            {notes > 0 && <span><Icon name="note" size="0.95em" /> {notes} note{notes === 1 ? '' : 's'}</span>}
          </div>
          {!selected && <button type="button" className="rd-icon-btn" aria-label={`More for ${first.title}`} onClick={() => setMenuFor(current)}><Icon name="more" /></button>}
        </div>
      </li>
    );
  };

  const stackCard = (name: string, list: Entry[]) => {
    const next = list.find((entry) => stateOf(entry) !== 'finished');
    const front = next ?? list[0];
    const done = list.filter((entry) => stateOf(entry) === 'finished').length;
    const ids = list.flatMap((entry) => entry.books.map((book) => book.id));
    const picked = !!selected && ids.every((id) => selected.has(id));
    return (
      <li key={`series:${name}`} className={`rd-card is-stack${picked ? ' is-picked' : ''}`}>
        <button
          type="button" className="rd-card-open" aria-pressed={selected ? picked : undefined}
          aria-label={selected ? `Select the ${name} series` : `Open the ${name} series`}
          onClick={() => (selected ? toggleSelected(ids) : setView(`series:${name}`))}
        >
          <Cover book={front.books[0]} url={covers[(front.books.find((book) => covers[book.id]) ?? front.books[0]).id]} />
          <span className="rd-card-count"><Icon name="layers" size="0.9em" /> {list.length}</span>
          {selected && pickMark(picked)}
        </button>
        <div className="rd-card-meta">
          <div>
            <strong>{name}</strong>
            <span className="rd-card-state">{list.length} books{done ? ` · ${done} finished` : ''}</span>
            {next && <span>{done || stateOf(next) === 'reading' ? 'Next' : 'Starts with'}: {next.books[0].title}</span>}
          </div>
        </div>
      </li>
    );
  };

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
          <a className="rd-home" href="/today"><Icon name="chevron" className="is-flipped" /> Noah Stuf</a>
          <h1>Reader</h1>
          {books.length > 0 && (
            <p className="rd-lib-stats">{[`${readingCount} reading`, `${finishedCount} finished`, `${notesTotal} note${notesTotal === 1 ? '' : 's'}`].join(' · ')}</p>
          )}
        </div>
        <span className="rd-grow" />
        <button type="button" className="rd-btn is-primary" disabled={!canAdd} onClick={() => setDialog({ kind: 'add' })}><Icon name="plus" /> Add a book</button>
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

      <YouTubeJobs jobs={youtube.jobs} onRetry={(id, skipMissing) => void youtube.retry(id, skipMissing).catch((e) => setError(e.message))} onRemove={(id) => void youtube.remove(id).catch((e) => setError(e.message))} />

      {!books.length && !uploads.length && shownView !== 'library' && (
        <div className="rd-welcome">
          <Icon name="book" size="2.5em" />
          <h2>Nothing on the shelf yet</h2>
          <p>Add an EPUB, PDF, CBZ, text, Markdown or HTML file, or read something from the Library. What you add is saved to your account, so it’s on your phone and your iPad, and only you can see it.</p>
          <button type="button" className="rd-btn" onClick={() => setView('library')}><Icon name="book" /> Open the Library</button>
        </div>
      )}

      {books.length > 0 && !selected && <NotesSearch books={books} onOpen={onOpen} />}

      {shownView === 'all' && !selected && continuing.length > 0 && (
        <section className="rd-continue" aria-label="Continue reading">
          <div className="rd-continue-head">
            <h2>Continue reading</h2>
            <span className="rd-grow" />
            <button type="button" className="rd-btn is-small" title="Your place in each book is kept" onClick={() => void clearContinue(continuing.map((book) => book.id))}>Clear</button>
          </div>
          <ul>
            {continuing.slice(0, 3).map((book) => {
              const place = progress[book.id];
              return (
                <li key={book.id}>
                  <button type="button" className="rd-continue-open" onClick={() => onOpen(book)} disabled={!kept.has(book.id) && !online}>
                    <Cover book={book} url={covers[book.id]} />
                    <span className="rd-continue-text">
                      <strong>{book.title}</strong>
                      <span>{progressText(place, book.format)}</span>
                      <span className="rd-meter"><span style={{ width: `${Math.round(place.pct * 100)}%` }} /></span>
                      <small>{fmtLastRead(place.at, book.format === 'audio' ? 'Listened' : 'Read')}</small>
                    </span>
                  </button>
                  <button type="button" className="rd-icon-btn rd-continue-x" aria-label={`Take ${book.title} off Continue reading`} onClick={() => void clearContinue([book.id])}><Icon name="x" /></button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="rd-filter" aria-label="Your shelves">
          {([['all', 'All', entries.length], ['reading', 'Reading', readingCount], ['finished', 'Finished', finishedCount]] as const).map(([id, label, count]) => (
            <button type="button" key={id} className={shownView === id ? 'is-on' : ''} aria-pressed={shownView === id} onClick={() => setView(id)}>{label} <small>{count}</small></button>
          ))}
          {deviceCount > 0 && (
            <button type="button" className={shownView === 'device' ? 'is-on' : ''} aria-pressed={shownView === 'device'} onClick={() => setView('device')}><Icon name="device" size="1em" /> On this device <small>{deviceCount}</small></button>
          )}
          <button type="button" className={shownView === 'library' ? 'is-on' : ''} aria-pressed={shownView === 'library'} onClick={() => { setSelected(null); setView('library'); }}>
            <Icon name="book" size="1em" /> Library{publicLibrary.docs ? <small>{publicLibrary.docs.length}</small> : null}
          </button>
          <span className="rd-filter-gap" aria-hidden />
          {folders.map((folder) => {
            const id: View = `folder:${folder.id}`;
            return (
              <button type="button" key={folder.id} className={shownView === id ? 'is-on' : ''} aria-pressed={shownView === id} onClick={() => setView(id)}>
                <Icon name="folder" size="1em" /> {folder.name} <small>{entries.filter((entry) => entry.books.some((book) => book.folder === folder.id)).length}</small>
              </button>
            );
          })}
          {seriesList.map((series) => {
            const id: View = `series:${series.name}`;
            return (
              <button type="button" key={id} className={shownView === id ? 'is-on' : ''} aria-pressed={shownView === id} onClick={() => setView(id)}>
                <Icon name="layers" size="1em" /> {series.name} <small>{series.count}</small>
              </button>
            );
          })}
          <button type="button" className="is-add" disabled={!canAdd} onClick={() => setDialog({ kind: 'new-folder' })}><Icon name="plus" size="1em" /> New folder</button>
      </nav>

      {(currentFolder || currentSeries || books.length > 0 || shownView === 'library') && (
        <div className="rd-shelf-head">
          {shownView === 'library' ? <h2>Library</h2> : currentFolder ? (
            <>
              <h2>{currentFolder.name}</h2>
              <button type="button" className="rd-icon-btn" aria-label={`Rename ${currentFolder.name}`} disabled={!canAdd} onClick={() => setDialog({ kind: 'rename-folder', folder: currentFolder })}><Icon name="pencil" /></button>
              <button type="button" className="rd-icon-btn" aria-label={`Delete ${currentFolder.name}`} disabled={!canAdd} onClick={() => setDialog({ kind: 'delete-folder', folder: currentFolder })}><Icon name="trash" /></button>
            </>
          ) : currentSeries ? (
            <>
              <h2>{currentSeries}</h2>
              <button type="button" className="rd-icon-btn" aria-label={`Rename ${currentSeries}`} disabled={!canAdd} onClick={() => setDialog({ kind: 'rename-series', name: currentSeries })}><Icon name="pencil" /></button>
              <button type="button" className="rd-icon-btn" aria-label={`Change the order of ${currentSeries}`} disabled={!canAdd || shown.length < 2} onClick={() => setDialog({ kind: 'order-series', name: currentSeries })}><Icon name="list" /></button>
              <button type="button" className="rd-icon-btn" aria-label={`Remove the series ${currentSeries}`} disabled={!canAdd} onClick={() => setDialog({ kind: 'delete-series', name: currentSeries })}><Icon name="trash" /></button>
            </>
          ) : <h2>{shownView === 'reading' ? 'Reading' : shownView === 'finished' ? 'Finished' : shownView === 'device' ? 'On this device' : 'All books'}</h2>}
          <span className="rd-grow" />
          {books.length > 0 && shownView !== 'library' && (
            selected
              ? <button type="button" className="rd-btn is-small" onClick={() => setSelected(null)}>Cancel</button>
              : <button type="button" className="rd-btn is-small" onClick={() => setSelected(new Set())}>Select</button>
          )}
        </div>
      )}

      {shownView === 'library' && (
        <PublicLibrary library={publicLibrary} books={books} guest={false} canAdd={canAdd} onOpen={onOpen} onChanged={onChanged} onSignIn={onSignIn} />
      )}

      {books.length > 0 && !shown.length && shownView !== 'library' && (
        <p className="rd-empty">
          {currentFolder ? 'Nothing in this folder yet. Use Select, or a book’s ⋯ menu, to move books here.' : shownView === 'reading' ? 'Nothing on the go. Open a book to start it.' : 'Nothing finished yet. A book counts when you reach its last page, or mark it in its ⋯ menu.'}
        </p>
      )}

      {shownView !== 'library' && (
        <ul className="rd-shelf">
          {shown.map((item) => (item.kind === 'stack' ? stackCard(item.name, item.entries) : entryCard(item.entry, item.number)))}
        </ul>
      )}

      {selected && (
        <div className="rd-select-bar" role="toolbar" aria-label="Selected books">
          <span>{selectedBooks.length ? `${shelfEntries(selectedBooks).length} selected` : 'Tap books to select them'}</span>
          <span className="rd-grow" />
          <button type="button" className="rd-btn is-small" onClick={() => setSelected(new Set(shownBooks.map((book) => book.id)))}>All</button>
          <button type="button" className="rd-btn is-small" disabled={!selected.size || !canAdd} onClick={() => setDialog({ kind: 'move', books: [...selected] })}><Icon name="folder" /> Move</button>
          <button type="button" className="rd-btn is-small" disabled={!selected.size || !canAdd} onClick={() => setDialog({ kind: 'series', books: selectedBooks.map((book) => book.id) })}><Icon name="layers" /> Series</button>
          {canJoin && <button type="button" className="rd-btn is-small" disabled={!canAdd} onClick={() => setDialog({ kind: 'combine', books: selectedBooks.map((book) => book.id) })}><Icon name="link" /> Join</button>}
          {selectedBooks.length > selectedHere.length && (
            <button type="button" className="rd-btn is-small" disabled={!canAdd || Object.keys(downloads).length > 0} onClick={() => { const list = selectedBooks; setSelected(null); void keepMany(list); }}><Icon name="download" /> Keep here</button>
          )}
          {selectedHere.length > 0 && <button type="button" className="rd-btn is-small" onClick={() => void removeHere(selectedHere.map((book) => book.id))}><Icon name="device" /> Remove from device</button>}
        </div>
      )}

      {dialog && (
        <div className="rd-sheet-wrap is-center" onClick={() => setDialog(null)}>
          <div className="rd-menu" role="dialog" aria-label="Your shelves" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === 'add' && (
              <>
                <p className="rd-menu-title">Add a book{currentFolder && <small>To {currentFolder.name}</small>}</p>
                <button type="button" onClick={() => { setDialog(null); fileInput.current?.click(); }}><Icon name="device" /> A file from this device</button>
                <button type="button" onClick={() => { setDialog(null); setView('library'); }}><Icon name="book" /> From the Library</button>
                <button type="button" onClick={() => setDialog({ kind: 'youtube' })}><Icon name="play" /> Audio from YouTube</button>
              </>
            )}
            {dialog.kind === 'youtube' && (
              <YouTubeForm folderName={currentFolder?.name} onCancel={() => setDialog(null)}
                onAdd={async (url, joined) => { await youtube.add(url, currentFolder?.id, joined); setDialog(null); }} />
            )}
            {dialog.kind === 'new-folder' && (
              <FolderForm
                title="New folder" start="" action="Create" onCancel={() => setDialog(null)}
                onSave={(name) => void organize(async () => {
                  const folder = await createFolder(name);
                  if (dialog.moving) await moveBooksEverywhere(dialog.moving, folder.id);
                  else setView(`folder:${folder.id}`);
                })}
              />
            )}
            {dialog.kind === 'rename-folder' && (
              <FolderForm title="Rename folder" start={dialog.folder.name} action="Save" onCancel={() => setDialog(null)} onSave={(name) => void organize(() => renameFolderEverywhere(dialog.folder.id, name))} />
            )}
            {dialog.kind === 'delete-folder' && (
              <>
                <p className="rd-menu-title">Delete {dialog.folder.name}?</p>
                <p className="rd-hint">Only the folder goes. Its books stay in All books, with their notes.</p>
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setDialog(null)}>Keep it</button>
                  <span className="rd-grow" />
                  <button type="button" className="rd-btn is-danger" onClick={() => void organize(() => deleteFolderEverywhere(dialog.folder.id))}>Delete folder</button>
                </div>
              </>
            )}
            {dialog.kind === 'move' && (
              <>
                <p className="rd-menu-title">Move {dialog.books.length === 1 ? 'to' : `${dialog.books.length} books to`}</p>
                {folders.map((folder) => (
                  <button type="button" key={folder.id} onClick={() => void moveTo(dialog.books, folder.id)}>
                    <Icon name="folder" /> {folder.name}
                    {dialog.books.length === 1 && books.find((book) => book.id === dialog.books[0])?.folder === folder.id && <Icon name="check" className="rd-menu-check" />}
                  </button>
                ))}
                <button type="button" onClick={() => setDialog({ kind: 'new-folder', moving: dialog.books })}><Icon name="plus" /> New folder</button>
                <button type="button" onClick={() => void moveTo(dialog.books, null)}><Icon name="x" /> Not in a folder</button>
              </>
            )}
            {dialog.kind === 'series' && (
              <SeriesDialog
                count={shelfEntries(books.filter((book) => dialog.books.includes(book.id))).length} series={seriesList}
                current={dialogSeries.length === 1 ? dialogSeries[0] : undefined}
                onCancel={() => setDialog(null)}
                onChoose={(name) => void organize(async () => {
                  await setSeriesEverywhere(dialog.books, name);
                  if (name && dialog.books.length > 1) setView(`series:${seriesList.find((s) => s.name.toLowerCase() === name.toLowerCase())?.name ?? name}`);
                })}
              />
            )}
            {dialog.kind === 'rename-series' && (
              <FolderForm
                title="Rename series" start={dialog.name} action="Save" onCancel={() => setDialog(null)}
                onSave={(name) => void organize(async () => { await renameSeriesEverywhere(dialog.name, name); setView(`series:${name}`); })}
              />
            )}
            {dialog.kind === 'delete-series' && (
              <>
                <p className="rd-menu-title">Remove the series {dialog.name}?</p>
                <p className="rd-hint">Only the series goes. Its books stay on the shelf, on their own.</p>
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setDialog(null)}>Keep it</button>
                  <span className="rd-grow" />
                  <button type="button" className="rd-btn is-danger" onClick={() => void organize(() => deleteSeriesEverywhere(dialog.name))}>Remove series</button>
                </div>
              </>
            )}
            {dialog.kind === 'order-series' && (
              <SeriesOrderDialog
                name={dialog.name} items={inSeries(dialog.name).map((entry) => ({ id: entry.books[0].id, label: entry.books[0].title, sub: entry.books[0].author }))}
                onCancel={() => setDialog(null)} onSave={(order) => void organize(() => orderSeriesEverywhere(dialog.name, order))}
              />
            )}
            {dialog.kind === 'link' && (
              <LinkDialog book={dialog.book} books={books} onCancel={() => setDialog(null)} onLink={(other) => void organize(() => linkBooksEverywhere([dialog.book.id, other.id]))} />
            )}
            {dialog.kind === 'combine' && (
              <CombineDialog
                books={books.filter((book) => dialog.books.includes(book.id))} onCancel={() => setDialog(null)}
                onStart={async (order, title, removeParts) => { await youtube.combine(order, title, removeParts); setDialog(null); setSelected(null); }}
              />
            )}
            {dialog.kind === 'free-space' && (
              <>
                <p className="rd-menu-title">Take every book off this device?</p>
                <p className="rd-hint">They stay in your account, with your notes and your place in each, and open again whenever you have a connection. Only the copies kept here for offline go.</p>
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setDialog(null)}>Keep them</button>
                  <span className="rd-grow" />
                  <button type="button" className="rd-btn is-danger" onClick={() => void removeHere([...kept])}>Remove from device</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {books.length > 0 && (
        <footer className="rd-lib-foot">
          {online && !signedOut && missing.length > 0 && (
            <button type="button" className="rd-btn" disabled={Object.keys(downloads).length > 0} onClick={() => void keepMany(missing)}><Icon name="download" /> Keep all {missing.length} on this device</button>
          )}
          {kept.size > 0 && <button type="button" className="rd-btn" onClick={() => setDialog({ kind: 'free-space' })}><Icon name="device" /> Remove all from this device</button>}
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
                <p className="rd-menu-title">Delete this {menuFor.format === 'audio' ? 'audio book' : 'book'} from your account?</p>
                <p className="rd-hint">{menuFor.title}, with all its notes and pen marks, goes from every device. This can’t be undone.{menuForms.length > 1 && ` Its ${menuFor.format === 'audio' ? 'text' : 'audio book'} stays.`}</p>
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
                  <span className="rd-grow" />
                  <button type="button" className="rd-btn is-danger" onClick={() => void deleteForGood()}>Delete</button>
                </div>
              </>
            ) : (
              <>
                <p className="rd-menu-title">{menuFor.title}{menuFor.author && <small>{menuFor.author}</small>}</p>
                {menuForms.length > 1 && (
                  <div className="rd-tabs rd-menu-forms" role="tablist" aria-label="Which form of the book">
                    {menuForms.map((book) => (
                      <button type="button" role="tab" key={book.id} aria-selected={book.id === menuFor.id} className={book.id === menuFor.id ? 'is-on' : ''} onClick={() => setMenuFor(book)}>
                        {book.format === 'audio' ? 'Audio book' : book.format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => { const book = menuFor; closeMenu(); setNotesFor(book); }}><Icon name="note" /> Notes</button>
                <button type="button" disabled={!canAdd} onClick={() => { const forms = menuForms.map((book) => book.id); closeMenu(); setDialog({ kind: 'move', books: forms }); }}><Icon name="folder" /> Move to a folder</button>
                <button type="button" disabled={!canAdd} onClick={() => { const book = menuFor; closeMenu(); setDialog({ kind: 'series', books: [book.id] }); }}>
                  <Icon name="layers" /> {menuFor.series ? `Series: ${menuFor.series}` : 'Add to a series'}
                </button>
                {menuFor.work && menuForms.length > 1
                  ? <button type="button" disabled={!canAdd} onClick={() => { const book = menuFor; closeMenu(); void organize(() => unlinkBookEverywhere(book.id)); }}><Icon name="scissors" /> Separate from its {menuFor.format === 'audio' ? 'book' : 'audio book'}</button>
                  : <button type="button" disabled={!canAdd} onClick={() => { const book = menuFor; closeMenu(); setDialog({ kind: 'link', book }); }}><Icon name="link" /> {menuFor.format === 'audio' ? 'It’s the audio of a book here' : 'Put with its audio book'}</button>}
                {menuFor.format === 'audio' && <button type="button" disabled={!canAdd} onClick={() => { const book = menuFor; closeMenu(); setChaptersFor(book); }}><Icon name="list" /> Edit chapters</button>}
                <button type="button" onClick={() => { const { id } = menuFor; const finished = readingState(progress[id]) !== 'finished'; closeMenu(); void markFinished(id, finished).then(refreshLocal); }}>
                  <Icon name="check" /> {readingState(progress[menuFor.id]) === 'finished' ? 'Mark as not finished' : 'Mark as finished'}
                </button>
                {kept.has(menuFor.id)
                  ? <button type="button" onClick={() => void removeHere([menuFor.id])}><Icon name="device" /> Remove from this device</button>
                  : <button type="button" disabled={!online || signedOut} onClick={() => { const book = menuFor; closeMenu(); void keepHere(book); }}><Icon name="download" /> Keep on this device</button>}
                <button type="button" disabled={!online || signedOut} onClick={() => setRenaming({ title: menuFor.title, author: menuFor.author })}><Icon name="pencil" /> Rename</button>
                <button type="button" className="is-danger" disabled={!online || signedOut} onClick={() => setConfirmDelete(true)}><Icon name="trash" /> Delete</button>
              </>
            )}
          </div>
        </div>
      )}

      {notesFor && <BookNotes book={notesFor} theme={theme} onClose={() => setNotesFor(null)} onOpenAt={(anchor) => { const book = notesFor; setNotesFor(null); onOpen(book, anchor); }} />}
      {chaptersFor && <ChapterEditor book={chaptersFor} onClose={() => setChaptersFor(null)} onSaved={() => { setChaptersFor(null); void onChanged(); }} />}
    </div>
  );
}
