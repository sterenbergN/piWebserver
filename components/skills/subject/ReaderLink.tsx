'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Resource, Topic } from '@/lib/skills/types';
import { skillsGet } from '../api';
import type { useAct } from './shared';

// Books in the Reader tied to resources here: link one to a resource, add one
// from the shelf, and see where you are in it. Reading progress keeps the
// resource up to date (the server does that whenever Skills loads).

type Act = ReturnType<typeof useAct>['act'];
export type ShelfBook = { id: string; title: string; author: string; state: 'new' | 'reading' | 'finished'; pct: number };

/** The Reader's books, fetched once when first needed. */
export function useShelf(wanted: boolean) {
  const [books, setBooks] = useState<ShelfBook[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (!wanted || books) return;
    let live = true;
    skillsGet<{ books: ShelfBook[] }>({ shelf: '1' })
      .then((body) => { if (live) setBooks(body.books); })
      .catch((e) => { if (live) setProblem(e instanceof Error ? e.message : 'Couldn’t load your Reader.'); });
    return () => { live = false; };
  }, [wanted, books]);
  return { books, problem };
}

const stateText = (b: ShelfBook) => (b.state === 'finished' ? 'finished' : b.state === 'reading' ? (b.pct >= 0.01 ? `${Math.round(b.pct * 100)}% read` : 'started') : 'not started');

/** On a resource card: where it's linked to, or a way to link it. */
export function ReaderLine({ resource: r, act, busy }: { resource: Resource; act: Act; busy: boolean }) {
  const [picking, setPicking] = useState(false);
  const { books, problem } = useShelf(picking || !!r.readerBookId);
  const linked = r.readerBookId ? books?.find((b) => b.id === r.readerBookId) : undefined;
  const link = (id: string | null) => act('edit-resource', { resourceId: r.id, changes: { readerBookId: id } }).then(() => setPicking(false));

  if (r.readerBookId) {
    return (
      <p className="sk-reader-line">
        <span aria-hidden>📖</span>
        <span>{books && !linked ? 'The Reader book it was linked to is gone.' : `In your Reader${linked ? `, ${stateText(linked)}` : ''}. Reading there keeps this up to date.`}</span>
        {linked && <Link href={`/reader?book=${encodeURIComponent(linked.id)}`}>Open in Reader</Link>}
        <button type="button" className="sk-text-btn" disabled={busy} onClick={() => link(null)}>Unlink</button>
      </p>
    );
  }
  if (!picking) return <button type="button" className="sk-text-btn sk-reader-start" onClick={() => setPicking(true)}>📖 Link to a book in your Reader</button>;
  return (
    <div className="sk-reader-pick">
      {problem ? <p className="sk-warning">{problem}</p> : !books ? <p className="sk-hint">Loading your Reader…</p> : !books.length ? (
        <p className="sk-hint">Your Reader is empty. <Link href="/reader">Add a book there</Link> first.</p>
      ) : (
        <label className="sk-field"><span>Which book?</span>
          <select defaultValue="" disabled={busy} onChange={(e) => e.target.value && link(e.target.value)}>
            <option value="">Choose a book…</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.title}{b.author ? `, ${b.author}` : ''} ({stateText(b)})</option>)}
          </select>
        </label>
      )}
      <button type="button" className="sk-text-btn" onClick={() => setPicking(false)}>Cancel</button>
    </div>
  );
}

/** Add a book from the Reader as a resource, tied to topics. */
export function AddFromReader({ resources, topics, act, busy }: { resources: Resource[]; topics: Topic[]; act: Act; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [bookId, setBookId] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const { books, problem } = useShelf(open);
  const taken = new Set(resources.map((r) => r.readerBookId).filter(Boolean));
  const choices = (books ?? []).filter((b) => !taken.has(b.id));
  const book = choices.find((b) => b.id === bookId);

  async function add() {
    if (!book) return;
    const ok = await act('add-resource', { kind: 'book', title: book.title, author: book.author, readerBookId: book.id, topicIds });
    if (ok) { setOpen(false); setBookId(''); setTopicIds([]); }
  }

  if (!open) return <button type="button" className="sk-small-btn" onClick={() => setOpen(true)}>📖 Add a book from your Reader</button>;
  return (
    <section className="sk-card">
      <h2>Add a book from your Reader</h2>
      {problem ? <p className="sk-warning">{problem}</p> : !books ? <p className="sk-hint">Loading your Reader…</p> : !choices.length ? (
        <p className="sk-hint">{books.length ? 'Every book in your Reader is already here.' : 'Your Reader is empty.'} <Link href="/reader">Open the Reader</Link></p>
      ) : (
        <>
          <label className="sk-field"><span>Book</span>
            <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">Choose a book…</option>
              {choices.map((b) => <option key={b.id} value={b.id}>{b.title}{b.author ? `, ${b.author}` : ''} ({stateText(b)})</option>)}
            </select>
          </label>
          {topics.length > 0 && (
            <fieldset className="sk-field sk-reader-topics">
              <legend>Topics it teaches</legend>
              {topics.map((t) => (
                <label key={t.id}>
                  <input type="checkbox" checked={topicIds.includes(t.id)} onChange={(e) => setTopicIds(e.target.checked ? [...topicIds, t.id] : topicIds.filter((id) => id !== t.id))} /> {t.name}
                </label>
              ))}
            </fieldset>
          )}
          <p className="sk-hint">Where you are in it, and finishing it, come across from the Reader by themselves.</p>
        </>
      )}
      <div className="sk-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !book} onClick={add}>Add book</button>
        <button type="button" className="sk-text-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  );
}
