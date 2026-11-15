'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { formatFromName, publicLibraryFile, type BookMeta } from '@/lib/reader/items';
import type { LibraryDocument } from '@/lib/site-content';
import { uploadWithProgress } from '@/lib/upload-client';
import { readShelvedBookInfo } from './bookinfo';
import type { ReaderSettings } from './source';
import { importBook, ReaderSignedOut, saveBookDetails } from './sync';

// The Library: the books, manuals and papers on the site that anyone can read. It used to be
// a page of its own that opened PDFs in a browser tab; now it's a shelf in the Reader.
// Signed in, reading one puts your own private copy on your shelf, so your place, notes and
// pen marks are yours and nothing you do shows here. With no account it opens straight from
// the Library, to read and nothing more. The site's admin adds to it and tidies it from here.

export type PublicDoc = LibraryDocument & { size?: number };

const UNCATEGORIZED = 'Uncategorized';

/** What's in the Library, asked for once it's wanted. */
export function usePublicLibrary(enabled: boolean) {
  const [docs, setDocs] = useState<PublicDoc[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => fetch('/api/library', { cache: 'no-store' })
    .then((res) => res.json())
    .then((body) => {
      setDocs(Array.isArray(body.documents) ? body.documents : []);
      setIsAdmin(body.isAdmin === true);
      setFailed(false);
    })
    .catch(() => setFailed(true)), []);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  return { docs, setDocs, isAdmin, failed, reload };
}

export type PublicLibraryState = ReturnType<typeof usePublicLibrary>;

/** A Library document as a book for someone with no account: read from the Library itself, nothing kept on an account. */
export function publicBook(doc: PublicDoc): BookMeta | null {
  const format = formatFromName(doc.url);
  const name = publicLibraryFile(doc.url);
  if (!format || !name) return null;
  return {
    id: `lib-${name.replace(/[^\w-]+/g, '-').slice(0, 58)}`, title: doc.name, author: '', format, size: doc.size ?? 0,
    addedAt: doc.date ?? new Date(0).toISOString(), hasCover: false, publicUrl: doc.url,
  };
}

const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round(bytes / (1024 * 1024))} MB`);
const fmtDate = (date?: string) => (date ? new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

type Form = { url?: string; name: string; category: string; note: string; file?: File | null };

/** Admin: add a PDF to the Library, or change one's title, shelf and note. */
function DocForm({ start, categories, onSaved, onCancel }: { start: Form; categories: string[]; onSaved: (doc: PublicDoc) => void; onCancel: () => void }) {
  const [form, setForm] = useState(start);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState('');
  const adding = !start.url;
  const busy = progress !== null;

  const pick = (file: File | null) => setForm((held) => ({
    ...held, file,
    // Start the title from the file name; it can be changed before uploading.
    name: file && !held.name.trim() ? file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim() : held.name,
  }));

  const save = async () => {
    setProblem('');
    setProgress(0);
    try {
      const name = form.name.trim();
      const category = form.category.trim();
      const note = form.note.trim();
      if (adding) {
        const body = new FormData();
        body.append('type', 'library');
        body.append('file', form.file as File);
        body.append('name', name);
        body.append('category', category);
        body.append('note', note);
        const data = await uploadWithProgress(body, setProgress);
        if (!data.success || typeof data.url !== 'string') throw new Error(data.message || 'That didn’t upload.');
        onSaved({ url: data.url, name, category: category || UNCATEGORIZED, ...(note ? { note } : {}), date: new Date().toISOString(), size: form.file?.size });
      } else {
        const res = await fetch('/api/edit', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'library', url: form.url, name, category, note }) });
        if (!(await res.json()).success) throw new Error('That didn’t save.');
        onSaved({ url: form.url!, name, category, note });
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work.');
      setProgress(null);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="rd-menu-title">{adding ? 'Add to the Library' : 'Edit'}<small>Anyone visiting the site can read what’s here.</small></p>
      {adding && (
        <>
          <label className="rd-label" htmlFor="rd-doc-file">PDF (up to 30 MB)</label>
          <input id="rd-doc-file" className="rd-input" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </>
      )}
      <label className="rd-label" htmlFor="rd-doc-name">Title</label>
      <input id="rd-doc-name" className="rd-input" value={form.name} disabled={busy} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="rd-label" htmlFor="rd-doc-category">Category</label>
      <input id="rd-doc-category" className="rd-input" value={form.category} list="rd-doc-categories" placeholder="e.g. Hardware" disabled={busy} onChange={(e) => setForm({ ...form, category: e.target.value })} />
      <datalist id="rd-doc-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <label className="rd-label" htmlFor="rd-doc-note">Public note</label>
      <textarea id="rd-doc-note" className="rd-input" rows={3} value={form.note} placeholder="What it is, for anyone browsing" disabled={busy} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      {busy && adding && <div className="rd-meter rd-doc-meter"><span style={{ width: `${progress}%` }} /></div>}
      {problem && <p className="rd-yt-problem" role="alert">{problem}</p>}
      <div className="rd-row">
        <button type="button" className="rd-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <span className="rd-grow" />
        <button type="submit" className="rd-btn is-primary" disabled={busy || !form.name.trim() || (adding && !form.file)}>{busy ? (adding ? 'Uploading…' : 'Saving…') : adding ? 'Upload' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function PublicLibrary({ library, books, guest, canAdd, folder, onOpen, onChanged, onSignIn }: {
  library: PublicLibraryState;
  /** Your own shelf, to tell which of these you already have. */
  books: BookMeta[];
  /** No account: books open straight from the Library. */
  guest: boolean;
  /** Whether your shelf can be added to right now (signed in, with a connection). */
  canAdd: boolean;
  /** Where new books land: the folder you were looking at. */
  folder?: string;
  onOpen: (book: BookMeta) => void;
  /** Your shelf changed. */
  onChanged: () => Promise<void>;
  onSignIn: () => void;
}) {
  const { docs, setDocs, isAdmin, failed } = library;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [menuFor, setMenuFor] = useState<PublicDoc | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<PublicDoc | null>(null);

  const mine = useMemo(() => new Map(books.filter((book) => book.source).map((book) => [book.source as string, book])), [books]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of docs ?? []) counts.set(doc.category || UNCATEGORIZED, (counts.get(doc.category || UNCATEGORIZED) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [docs]);

  const terms = query.trim().toLowerCase();
  const visible = (docs ?? []).filter((doc) =>
    (!category || (doc.category || UNCATEGORIZED) === category)
    && (!terms || `${doc.name} ${doc.category ?? ''} ${doc.note ?? ''}`.toLowerCase().includes(terms)));
  // Shelf by shelf when browsing everything; one list while narrowing it down.
  const groups: [string, PublicDoc[]][] = category || terms || categories.length < 2
    ? [['', visible]]
    : categories.map(([name]) => [name, visible.filter((doc) => (doc.category || UNCATEGORIZED) === name)]);

  /** Open one. Signed in, that's your own copy of it, made the first time. */
  const read = async (doc: PublicDoc) => {
    const held = mine.get(doc.url);
    if (held) { onOpen(held); return; }
    if (guest) {
      const book = publicBook(doc);
      if (book) onOpen(book);
      return;
    }
    setErrors(({ [doc.url]: _gone, ...rest }) => rest);
    setBusy((b) => new Set(b).add(doc.url));
    try {
      const { book, already } = await importBook(doc.url, folder);
      await onChanged();
      onOpen(book);
      // Only a device can draw a cover from the file. It reads just the first page for it.
      if (!already) {
        void readShelvedBookInfo(book)
          .then(async (info) => { if (info.cover || info.author) { await saveBookDetails(book.id, info.cover, info.author); await onChanged(); } })
          .catch(() => { /* It's on the shelf. It can do without a cover. */ });
      }
    } catch (error) {
      if (error instanceof ReaderSignedOut) onSignIn();
      else setErrors((e) => ({ ...e, [doc.url]: error instanceof TypeError ? 'No connection.' : error instanceof Error ? error.message : 'That didn’t work.' }));
    }
    setBusy((b) => { const next = new Set(b); next.delete(doc.url); return next; });
  };

  const remove = async (doc: PublicDoc) => {
    setDeleting(null);
    const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'library', id: doc.url }) }).then((r) => r.json()).catch(() => null);
    if (res?.success) setDocs((held) => (held ?? []).filter((d) => d.url !== doc.url));
    else setErrors((e) => ({ ...e, [doc.url]: 'That didn’t delete.' }));
  };

  const row = (doc: PublicDoc) => {
    const readable = !!formatFromName(doc.url);
    const held = mine.get(doc.url);
    const details = [(category || terms) && categories.length > 1 ? doc.category || UNCATEGORIZED : '', fmtDate(doc.date), doc.size ? fmtSize(doc.size) : ''].filter(Boolean);
    return (
      <li key={doc.url}>
        <span className="rd-public-icon" aria-hidden><Icon name="file" /></span>
        <div className="rd-public-text">
          <strong>{doc.name}</strong>
          {details.length > 0 && <span>{details.join(' · ')}</span>}
          {doc.note && <p>{doc.note}</p>}
          {held && <span className="rd-public-mine"><Icon name="check" size="0.9em" /> On your shelf</span>}
          {errors[doc.url] && <em role="alert">{errors[doc.url]}</em>}
        </div>
        {readable
          ? <button type="button" className="rd-btn is-small is-primary" disabled={busy.has(doc.url) || (!guest && !held && !canAdd)} aria-label={`Read ${doc.name}`} onClick={() => void read(doc)}>{busy.has(doc.url) ? 'Opening…' : 'Read'}</button>
          : <a className="rd-btn is-small" href={doc.url} download>Download</a>}
        <button type="button" className="rd-icon-btn" aria-label={`More for ${doc.name}`} onClick={() => setMenuFor(doc)}><Icon name="more" /></button>
      </li>
    );
  };

  return (
    <div className="rd-public-shelf">
      <p className="rd-hint rd-hint-top">
        {guest
          ? 'Books, manuals and papers anyone can read here.'
          : 'Books, manuals and papers anyone on the site can read. Reading one puts your own copy on your shelf: your place, notes and pen marks stay private.'}
      </p>
      <div className="rd-row is-wrap rd-public-tools">
        {(docs?.length ?? 0) > 6 && <input className="rd-input" type="search" placeholder="Search the Library" aria-label="Search the Library" value={query} onChange={(e) => setQuery(e.target.value)} />}
        {isAdmin && <button type="button" className="rd-btn" onClick={() => setForm({ name: '', category: '', note: '', file: null })}><Icon name="plus" /> Add to the Library</button>}
      </div>
      {categories.length > 1 && (
        <div className="rd-chips rd-public-chips" role="group" aria-label="Category">
          <button type="button" className={`rd-chip${category ? '' : ' is-on'}`} aria-pressed={!category} onClick={() => setCategory(null)}>All {docs?.length}</button>
          {categories.map(([name, count]) => (
            <button type="button" key={name} className={`rd-chip${category === name ? ' is-on' : ''}`} aria-pressed={category === name} onClick={() => setCategory(category === name ? null : name)}>{name} {count}</button>
          ))}
        </div>
      )}

      {failed && !docs && <p className="rd-empty">The Library couldn’t be reached. Try again when you’re online.</p>}
      {!docs && !failed && <p className="rd-empty">Opening the Library…</p>}
      {docs && !docs.length && <p className="rd-empty">{isAdmin ? 'Nothing in the Library yet. Add the first PDF.' : 'There’s nothing in the Library yet.'}</p>}
      {docs && docs.length > 0 && !visible.length && <p className="rd-empty">Nothing matches that.</p>}

      {groups.filter(([, list]) => list.length).map(([name, list]) => (
        <section key={name || 'all'}>
          {name && <h3 className="rd-public-category">{name} <small>{list.length}</small></h3>}
          <ul className="rd-public">{list.map(row)}</ul>
        </section>
      ))}

      {(menuFor || form || deleting) && (
        <div className="rd-sheet-wrap is-center" onClick={() => { setMenuFor(null); setDeleting(null); if (!form?.file) setForm(null); }}>
          <div className="rd-menu" role="dialog" aria-label="The Library" onClick={(e) => e.stopPropagation()}>
            {form ? (
              <DocForm
                start={form} categories={categories.map(([name]) => name).filter((name) => name !== UNCATEGORIZED)} onCancel={() => setForm(null)}
                onSaved={(doc) => { setDocs((held) => (form.url ? (held ?? []).map((d) => (d.url === doc.url ? { ...d, ...doc } : d)) : [doc, ...(held ?? [])])); setForm(null); }}
              />
            ) : deleting ? (
              <>
                <p className="rd-menu-title">Delete this from the Library?</p>
                <p className="rd-hint">{deleting.name} goes for everyone. Copies people already have on their own shelves stay.</p>
                <div className="rd-row">
                  <button type="button" className="rd-btn" onClick={() => setDeleting(null)}>Keep it</button>
                  <span className="rd-grow" />
                  <button type="button" className="rd-btn is-danger" onClick={() => void remove(deleting)}>Delete</button>
                </div>
              </>
            ) : menuFor && (
              <>
                <p className="rd-menu-title">{menuFor.name}{menuFor.category && <small>{menuFor.category}</small>}</p>
                <a href={menuFor.url} download onClick={() => setMenuFor(null)}><Icon name="download" /> Download the file</a>
                <a href={menuFor.url} target="_blank" rel="noreferrer" onClick={() => setMenuFor(null)}><Icon name="share" /> Open in a browser tab</a>
                {isAdmin && <button type="button" onClick={() => { setForm({ url: menuFor.url, name: menuFor.name, category: menuFor.category ?? '', note: menuFor.note ?? '' }); setMenuFor(null); }}><Icon name="pencil" /> Edit</button>}
                {isAdmin && <button type="button" className="is-danger" onClick={() => { setDeleting(menuFor); setMenuFor(null); }}><Icon name="trash" /> Delete from the Library</button>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The Reader for someone with no account: the Library, and a way to sign in for the rest. */
export function GuestShelf({ library, theme, onOpen, onSignIn }: { library: PublicLibraryState; theme: ReaderSettings['theme']; onOpen: (book: BookMeta) => void; onSignIn: () => void }) {
  return (
    <div className="rd-library" data-rd-theme={theme}>
      <header className="rd-lib-head">
        <div>
          <Link className="rd-home" href="/"><Icon name="chevron" className="is-flipped" /> Noah Stuf</Link>
          <h1>Reader</h1>
          <p className="rd-lib-stats">The Library{library.docs ? ` · ${library.docs.length} to read` : ''}</p>
        </div>
      </header>
      <div className="rd-banner">
        <Icon name="user" />
        <p>Sign in to keep your own books here too, with your notes, pen marks and your place in each on every device.</p>
        <button type="button" className="rd-btn is-primary" onClick={onSignIn}>Sign in</button>
      </div>
      <PublicLibrary library={library} books={[]} guest canAdd={false} onOpen={onOpen} onChanged={async () => {}} onSignIn={onSignIn} />
    </div>
  );
}
