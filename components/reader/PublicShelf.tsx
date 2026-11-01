'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { formatFromName, type BookMeta } from '@/lib/reader/items';
import type { LibraryDocument } from '@/lib/site-content';
import { readBookInfo } from './bookinfo';
import { downloadBook, importBook, ReaderSignedOut, saveBookDetails } from './sync';

// Bringing a book over from the public Library. The two stay separate on purpose: this
// makes a private copy on your account, and nothing you do with it shows on the Library.

export default function PublicShelf({ books, folder, onClose, onImported, onSignIn }: {
  books: BookMeta[];
  /** Where new books land: the folder you're looking at. */
  folder?: string;
  onClose: () => void;
  onImported: () => Promise<void>;
  onSignIn: () => void;
}) {
  const [documents, setDocuments] = useState<LibraryDocument[] | null>(null);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    fetch('/api/library', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => { if (live) setDocuments(Array.isArray(body.documents) ? body.documents : []); })
      .catch(() => { if (live) setFailed('The Library couldn’t be reached. Try again when you’re online.'); });
    return () => { live = false; };
  }, []);

  const held = useMemo(() => new Set(books.map((book) => book.source)), [books]);
  const terms = query.trim().toLowerCase();
  const shown = (documents ?? []).filter((doc) => !terms || `${doc.name} ${doc.category ?? ''} ${doc.note ?? ''}`.toLowerCase().includes(terms));

  const add = async (doc: LibraryDocument) => {
    setErrors(({ [doc.url]: _gone, ...rest }) => rest);
    setBusy((b) => ({ ...b, [doc.url]: 0 }));
    try {
      const { book, already } = await importBook(doc.url, folder);
      if (!already) {
        // Only the device can read a file to draw its cover. It's kept here as well, ready to read.
        try {
          const blob = await downloadBook(book, (fraction) => setBusy((b) => ({ ...b, [doc.url]: fraction })));
          const info = await readBookInfo(new File([blob], `book.${book.format}`));
          if (info.cover || info.author) await saveBookDetails(book.id, info.cover, info.author);
        } catch (error) {
          if (error instanceof ReaderSignedOut) throw error;
          /* The book's on the shelf. It can do without a cover. */
        }
      }
      await onImported();
    } catch (error) {
      if (error instanceof ReaderSignedOut) { onSignIn(); return; }
      setErrors((e) => ({ ...e, [doc.url]: error instanceof TypeError ? 'No connection.' : error instanceof Error ? error.message : 'That didn’t work.' }));
    }
    setBusy(({ [doc.url]: _done, ...rest }) => rest);
  };

  return (
    <div className="rd-sheet-wrap" onClick={onClose}>
      <aside className="rd-sheet" aria-label="Add from the Library" onClick={(e) => e.stopPropagation()}>
        <div className="rd-sheet-head">
          <div className="rd-sheet-title">
            <strong>Add from the Library</strong>
            <span>{documents ? `${documents.length} book${documents.length === 1 ? '' : 's'}` : 'Loading…'}</span>
          </div>
          <span className="rd-grow" />
          <button type="button" className="rd-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="rd-sheet-body">
          <p className="rd-hint rd-hint-top">Adding makes your own private copy. What you read and write stays in the Reader, and nothing shows on the public Library.</p>
          {(documents?.length ?? 0) > 6 && (
            <input className="rd-input" type="search" placeholder="Search the Library" aria-label="Search the Library" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          {failed && <p className="rd-empty">{failed}</p>}
          {documents && !documents.length && <p className="rd-empty">There’s nothing in the Library yet.</p>}
          {documents && documents.length > 0 && !shown.length && <p className="rd-empty">Nothing matches that.</p>}
          <ul className="rd-public">
            {shown.map((doc) => {
              const readable = !!formatFromName(doc.url);
              const fraction = busy[doc.url];
              return (
                <li key={doc.url}>
                  <div className="rd-public-text">
                    <strong>{doc.name}</strong>
                    {doc.category && <span>{doc.category}</span>}
                    {errors[doc.url] && <em role="alert">{errors[doc.url]}</em>}
                  </div>
                  {held.has(doc.url) ? (
                    <span className="rd-public-done"><Icon name="check" /> Added</span>
                  ) : !readable ? (
                    <span className="rd-public-done">Can’t open</span>
                  ) : fraction !== undefined ? (
                    <span className="rd-public-done">{fraction ? `${Math.round(fraction * 100)}%` : 'Adding…'}</span>
                  ) : (
                    <button type="button" className="rd-btn is-small" aria-label={`Add ${doc.name}`} onClick={() => void add(doc)}><Icon name="plus" /> Add</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}
