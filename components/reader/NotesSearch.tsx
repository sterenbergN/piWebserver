'use client';

import { useEffect, useState } from 'react';
import { findInText } from '@/lib/notes/search';
import type { Anchor, BookMeta } from '@/lib/reader/items';
import { getItems } from './db';

// Searching every book's notes from the shelf: typed notes, and handwritten ones once the server
// has read them. It all comes from this device, so it works with no connection.

type Hit = { book: BookMeta; anchor: Anchor; text: string; handwritten: boolean };

const RESULTS = 40;

function around(text: string, at: number, length: number) {
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, at + length + 70);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export default function NotesSearch({ books, onOpen }: { books: BookMeta[]; onOpen: (book: BookMeta, at?: Anchor) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return; }
    let live = true;
    const timer = setTimeout(async () => {
      const found: Hit[] = [];
      for (const book of books) {
        for (const item of await getItems(book.id)) {
          if (item.deleted || !item.text || (item.kind !== 'note' && item.kind !== 'sketch')) continue;
          const at = findInText(item.text, query, item.kind === 'sketch');
          if (at) found.push({ book, anchor: item.anchor, text: around(item.text, at[0], at[1]), handwritten: item.kind === 'sketch' });
        }
        if (!live || found.length >= RESULTS) break;
      }
      if (live) setHits(found.slice(0, RESULTS));
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query, books]);

  return (
    <section className="rd-notes-search" aria-label="Search your notes">
      <input className="rd-input" type="search" placeholder="Search your notes in every book" aria-label="Search your notes in every book" value={query} onChange={(e) => setQuery(e.target.value)} />
      {hits && (
        hits.length ? (
          <ul className="rd-notes-results">
            {hits.map((hit, i) => (
              <li key={`${hit.book.id}/${i}`}>
                <button type="button" onClick={() => onOpen(hit.book, hit.anchor)}>
                  <strong>{hit.book.title}</strong>
                  <small>p. {hit.anchor.page}{hit.anchor.chapter ? ` · ${hit.anchor.chapter}` : ''}{hit.handwritten ? ' · handwritten' : ''}</small>
                  <span>{hit.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="rd-hint">No note says that. Handwritten notes are found once the server has read them.</p>
      )}
    </section>
  );
}
