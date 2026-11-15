'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { clock, MAX_CHAPTERS, readClock, sharedTitle, spoken, type AudioChapter } from '@/lib/reader/audio';
import type { BookMeta } from '@/lib/reader/items';
import { saveChaptersEverywhere } from './sync';

// The shelf's smaller dialogs: putting a book and its audio book together, series,
// joining audio books into one, and an audio book's chapters. Each of the first few
// is the inside of the shelf's centred menu; the chapter editor is a sheet of its own.

/** A list you put in order with up and down. */
function OrderList({ items, onMove }: { items: { id: string; label: string; sub?: string }[]; onMove: (from: number, to: number) => void }) {
  return (
    <ol className="rd-order">
      {items.map((item, i) => (
        <li key={item.id}>
          <span className="rd-order-n">{i + 1}</span>
          <span className="rd-order-text"><strong>{item.label}</strong>{item.sub && <small>{item.sub}</small>}</span>
          <button type="button" className="rd-icon-btn" aria-label={`Move ${item.label} up`} disabled={i === 0} onClick={() => onMove(i, i - 1)}><Icon name="chevron" className="rd-turn-up" /></button>
          <button type="button" className="rd-icon-btn" aria-label={`Move ${item.label} down`} disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)}><Icon name="chevron" className="rd-turn-down" /></button>
        </li>
      ))}
    </ol>
  );
}

function moved<T>(list: T[], from: number, to: number) {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

const words = (title: string) => new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2));

/** Pick the other form of a book: the audio book for a text, or the text for an audio book. */
export function LinkDialog({ book, books, onLink, onCancel }: { book: BookMeta; books: BookMeta[]; onLink: (other: BookMeta) => void; onCancel: () => void }) {
  const [query, setQuery] = useState('');
  const isAudio = book.format === 'audio';
  const candidates = useMemo(() => {
    const mine = words(book.title);
    const score = (other: BookMeta) => [...words(other.title)].filter((word) => mine.has(word)).length;
    return books
      .filter((other) => other.id !== book.id && (other.format === 'audio') !== isAudio && !(book.work && other.work === book.work))
      .map((other) => ({ other, score: score(other) }))
      .sort((a, b) => b.score - a.score || a.other.title.localeCompare(b.other.title));
  }, [book, books, isAudio]);
  const wanted = query.trim().toLowerCase();
  const shown = candidates.filter(({ other }) => !wanted || `${other.title} ${other.author}`.toLowerCase().includes(wanted));
  return (
    <>
      <p className="rd-menu-title">{isAudio ? 'Which book is this the audio of?' : 'Which audio book is this?'}<small>{book.title}</small></p>
      {candidates.length > 6 && <input className="rd-input" type="search" placeholder="Find it by title" aria-label="Find it by title" value={query} onChange={(e) => setQuery(e.target.value)} />}
      {!candidates.length && <p className="rd-hint">{isAudio ? 'Add the EPUB or PDF of it to your shelf first, then put them together here.' : 'Add its audio book to your shelf first, then put them together here.'}</p>}
      <div className="rd-menu-scroll">
        {shown.map(({ other }) => (
          <button type="button" key={other.id} onClick={() => onLink(other)}>
            <Icon name={other.format === 'audio' ? 'play' : 'book'} />
            <span className="rd-menu-two"><strong>{other.title}</strong><small>{other.format === 'audio' ? `Audio · ${spoken(other.audio?.duration ?? 0)}` : other.format.toUpperCase()}{other.author ? ` · ${other.author}` : ''}</small></span>
          </button>
        ))}
      </div>
      <p className="rd-hint">They share one place on the shelf, under the book’s title, and you can switch between reading and listening.</p>
      <div className="rd-row"><span className="rd-grow" /><button type="button" className="rd-btn" onClick={onCancel}>Cancel</button></div>
    </>
  );
}

/** Put books in a series: one there already, or a new one. */
export function SeriesDialog({ count, series, current, onChoose, onCancel }: {
  count: number; series: { name: string; count: number }[]; current?: string; onChoose: (name: string | null) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <>
      <p className="rd-menu-title">Series{count > 1 && <small>{count} books, in the order they’re on the shelf</small>}</p>
      <div className="rd-menu-scroll">
        {series.map((s) => (
          <button type="button" key={s.name} onClick={() => onChoose(s.name)}>
            <Icon name="layers" /> {s.name} <small className="rd-menu-count">{s.count}</small>
            {current === s.name && <Icon name="check" className="rd-menu-check" />}
          </button>
        ))}
      </div>
      <form className="rd-row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onChoose(name.trim()); }}>
        <input className="rd-input" value={name} maxLength={80} placeholder="New series" aria-label="New series" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="rd-btn is-primary" disabled={!name.trim()}>Add</button>
      </form>
      <div className="rd-row">
        {current && <button type="button" className="rd-btn" onClick={() => onChoose(null)}>Take out of {current}</button>}
        <span className="rd-grow" />
        <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

/** The order a series is read in. */
export function SeriesOrderDialog({ name, items, onSave, onCancel }: { name: string; items: { id: string; label: string; sub?: string }[]; onSave: (order: string[]) => void; onCancel: () => void }) {
  const [order, setOrder] = useState(items);
  return (
    <>
      <p className="rd-menu-title">Order of {name}</p>
      <OrderList items={order} onMove={(from, to) => setOrder((held) => moved(held, from, to))} />
      <div className="rd-row">
        <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
        <span className="rd-grow" />
        <button type="button" className="rd-btn is-primary" onClick={() => onSave(order.map((item) => item.id))}>Save</button>
      </div>
    </>
  );
}

/** Join audio books into one, a chapter for each: for a book that came as a video per chapter. */
export function CombineDialog({ books, onStart, onCancel }: { books: BookMeta[]; onStart: (order: string[], title: string, removeParts: boolean) => Promise<void>; onCancel: () => void }) {
  const [order, setOrder] = useState(() => [...books].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })));
  const [title, setTitle] = useState(() => sharedTitle(books.map((b) => b.title)) || books[0]?.title || '');
  const [removeParts, setRemoveParts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const total = order.reduce((sum, b) => sum + (b.audio?.duration ?? 0), 0);

  const start = async () => {
    setBusy(true);
    setProblem('');
    try {
      await onStart(order.map((b) => b.id), title.trim(), removeParts);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t start.');
      setBusy(false);
    }
  };

  return (
    <>
      <p className="rd-menu-title">Join into one audio book<small>{order.length} parts · {spoken(total)}</small></p>
      <label className="rd-label" htmlFor="rd-join-title">Title</label>
      <input id="rd-join-title" className="rd-input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      <p className="rd-label">In this order, a chapter for each</p>
      <OrderList items={order.map((b) => ({ id: b.id, label: b.title, sub: spoken(b.audio?.duration ?? 0) }))} onMove={(from, to) => setOrder((held) => moved(held, from, to))} />
      <label className="rd-check"><input type="checkbox" checked={removeParts} onChange={(e) => setRemoveParts(e.target.checked)} /> Take the separate parts off the shelf afterwards</label>
      <p className="rd-hint">The Pi does the joining, and it shows above your books while it works. {removeParts ? 'Where you’d got to in the parts, and notes on them, go with them.' : 'The parts stay as they are.'}</p>
      {problem && <p className="rd-yt-problem" role="alert">{problem}</p>}
      <div className="rd-row">
        <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
        <span className="rd-grow" />
        <button type="button" className="rd-btn is-primary" disabled={busy || !title.trim() || order.length < 2} onClick={() => void start()}>{busy ? 'Starting…' : 'Join'}</button>
      </div>
    </>
  );
}

type Row = { key: number; time: string; title: string };

/**
 * An audio book's chapters: rename them, move where they start, add and remove. `now` is
 * where the player is, for "a chapter starts here".
 */
export function ChapterEditor({ book, now, onSaved, onClose }: { book: BookMeta; now?: number; onSaved: (book: BookMeta) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => (book.audio?.chapters ?? []).map((c, i) => ({ key: i, time: clock(c.start), title: c.title })));
  const [nextKey, setNextKey] = useState(rows.length);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const duration = book.audio?.duration ?? 0;

  const change = (key: number, patch: Partial<Row>) => setRows((held) => held.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = (at: number) => {
    setRows((held) => [...held, { key: nextKey, time: clock(at), title: '' }].sort((a, b) => (readClock(a.time) ?? Infinity) - (readClock(b.time) ?? Infinity)));
    setNextKey((n) => n + 1);
  };
  const bad = (row: Row) => {
    const at = readClock(row.time);
    return at === null || (duration > 0 && at >= duration);
  };

  const save = async () => {
    const named = rows.filter((row) => row.title.trim());
    if (named.some(bad)) { setProblem(`Times look like 1:02:03 or 4:05, and have to be inside the ${clock(duration)} it runs for.`); return; }
    const chapters: AudioChapter[] = named.map((row) => ({ start: readClock(row.time)!, title: row.title.trim() }));
    setBusy(true);
    setProblem('');
    try {
      onSaved(await saveChaptersEverywhere(book.id, chapters));
    } catch (error) {
      setProblem(error instanceof TypeError ? 'Changing chapters needs a connection.' : error instanceof Error ? error.message : 'That didn’t save.');
      setBusy(false);
    }
  };

  return (
    <div className="rd-sheet-wrap" onClick={onClose}>
      <aside className="rd-sheet" aria-label={`Chapters of ${book.title}`} onClick={(e) => e.stopPropagation()}>
        <div className="rd-sheet-head">
          <div className="rd-sheet-title"><strong>Chapters</strong><span>{book.title}</span></div>
          <span className="rd-grow" />
          <button type="button" className="rd-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="rd-sheet-body">
          {!rows.length && <p className="rd-hint rd-hint-top">No chapters yet. Add one where each part starts, and the player can skip between them.</p>}
          <ul className="rd-chapter-rows">
            {rows.map((row) => (
              <li key={row.key}>
                <input className={`rd-input rd-chapter-time${bad(row) ? ' is-bad' : ''}`} value={row.time} inputMode="numeric" aria-label="Starts at" onChange={(e) => change(row.key, { time: e.target.value })} />
                <input className="rd-input" value={row.title} maxLength={200} placeholder="Chapter name" aria-label="Chapter name" onChange={(e) => change(row.key, { title: e.target.value })} />
                <button type="button" className="rd-icon-btn" aria-label={`Remove ${row.title || 'this chapter'}`} onClick={() => setRows((held) => held.filter((r) => r.key !== row.key))}><Icon name="trash" /></button>
              </li>
            ))}
          </ul>
          <div className="rd-row is-wrap">
            {now !== undefined && <button type="button" className="rd-btn is-small" disabled={rows.length >= MAX_CHAPTERS} onClick={() => add(Math.floor(now))}><Icon name="plus" /> A chapter starts here ({clock(now)})</button>}
            <button type="button" className="rd-btn is-small" disabled={rows.length >= MAX_CHAPTERS} onClick={() => add(rows.length ? Math.min(Math.max(0, duration - 1), (readClock(rows[rows.length - 1].time) ?? 0) + 60) : 0)}><Icon name="plus" /> Add a chapter</button>
          </div>
          <p className="rd-hint">A chapter with no name is left out. Times are hours:minutes:seconds from the start.</p>
          {problem && <p className="rd-yt-problem" role="alert">{problem}</p>}
          <div className="rd-row">
            <button type="button" className="rd-btn" onClick={onClose}>Cancel</button>
            <span className="rd-grow" />
            <button type="button" className="rd-btn is-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save chapters'}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
