'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Resource, Topic } from '@/lib/skills/types';
import { skillsGet } from '../api';
import type { useAct } from './shared';

// Books in the Reader tied to resources here: link one to a resource, upload a
// PDF/EPUB directly, send a YouTube audiobook URL to Reader Audio, or add one
// from the shelf. Reading progress keeps the resource up to date (synced on load).

type Act = ReturnType<typeof useAct>['act'];
export type ShelfBook = { id: string; title: string; author: string; audio?: boolean; state: 'new' | 'reading' | 'finished'; pct: number };

const READER_CHUNK_BYTES = 32 * 1024 * 1024;
export const READER_ACCEPT = '.pdf,.epub,.cbz,.txt,.md,.html';

function makeUploadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function parseReaderResponse<T>(res: Response, fallback: string): Promise<T> {
  if (res.status === 401) throw new Error('Please sign in to use your Reader.');
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || fallback);
  return body as T;
}

/** Upload a PDF/EPUB/text book to /api/reader/upload using the two-step upload protocol. */
export async function uploadBookToReader(
  file: File,
  meta: { title?: string; author?: string } = {},
  onProgress?: (fraction: number) => void,
): Promise<ShelfBook & { format: string }> {
  if (!file.size) throw new Error('That file is empty.');
  const uploadId = makeUploadId();
  let offset = 0;

  while (offset < file.size) {
    const piece = file.slice(offset, offset + READER_CHUNK_BYTES);
    const res = await fetch(`/api/reader/upload?upload=${encodeURIComponent(uploadId)}&offset=${offset}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: piece,
    });
    const chunkBody = await parseReaderResponse<{ received: number }>(res, 'Could not upload file to Reader.');
    if (typeof chunkBody.received !== 'number' || chunkBody.received <= offset) {
      throw new Error('Reader upload stalled. Please try again.');
    }
    offset = chunkBody.received;
    onProgress?.(Math.min(1, offset / file.size));
  }

  const finalRes = await fetch(`/api/reader/upload?upload=${encodeURIComponent(uploadId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      title: meta.title ?? '',
      author: meta.author ?? '',
    }),
  });
  const finalBody = await parseReaderResponse<{ book: { id: string; title: string; author: string; format: string } }>(
    finalRes,
    'Could not finish saving book to Reader.',
  );
  return {
    id: finalBody.book.id,
    title: finalBody.book.title,
    author: finalBody.book.author,
    format: finalBody.book.format,
    audio: finalBody.book.format === 'audio',
    state: 'new',
    pct: 0,
  };
}

/** Queue a YouTube video/audiobook URL in Reader Audio downloads (/api/reader/youtube). */
export async function sendYouTubeToReaderAudio(url: string): Promise<{ jobs: unknown[] }> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('Enter a YouTube URL first.');
  const res = await fetch('/api/reader/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', url: trimmed }),
  });
  return parseReaderResponse<{ jobs: unknown[] }>(res, 'Could not add YouTube audio to Reader.');
}

/** The Reader's books, fetched once when first needed. */
export function useShelf(wanted: boolean) {
  const [books, setBooks] = useState<ShelfBook[] | null>(null);
  const [problem, setProblem] = useState('');
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setProblem('');
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!wanted) return;
    if (books && nonce === 0) return;
    let live = true;
    skillsGet<{ books: ShelfBook[] }>({ shelf: '1' })
      .then((body) => { if (live) setBooks(body.books); })
      .catch((e) => { if (live) setProblem(e instanceof Error ? e.message : 'Couldn’t load your Reader.'); });
    return () => { live = false; };
  }, [wanted, nonce]);

  return { books, problem, refresh };
}

const stateText = (b: ShelfBook) => (b.state === 'finished' ? 'finished' : b.state === 'reading' ? (b.pct >= 0.01 ? `${Math.round(b.pct * 100)}% ${b.audio ? 'listened' : 'read'}` : 'started') : 'not started');

/** On a resource card: where it's linked to, or ways to link/upload/queue it in Reader. */
export function ReaderLine({
  resource: r,
  act,
  busy,
  onUploaded,
}: {
  resource: Resource;
  act: Act;
  busy: boolean;
  onUploaded?: (book: ShelfBook) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState(r.youtubeAudioUrl ?? '');
  const [ytBusy, setYtBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [readerErr, setReaderErr] = useState('');

  const { books, problem, refresh } = useShelf(picking || !!r.readerBookId);
  const linked = r.readerBookId ? books?.find((b) => b.id === r.readerBookId) : undefined;
  const refreshedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (r.readerBookId && books && !books.some((b) => b.id === r.readerBookId) && refreshedForRef.current !== r.readerBookId) {
      refreshedForRef.current = r.readerBookId;
      refresh();
    }
  }, [r.readerBookId, books, refresh]);

  const link = (id: string | null) => act('edit-resource', { resourceId: r.id, changes: { readerBookId: id } }).then(() => setPicking(false));

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReaderErr('');
    setStatusMsg('');
    setUploading(true);
    setUploadPct(0);
    try {
      const book = await uploadBookToReader(file, { title: r.title, author: r.author ?? '' }, setUploadPct);
      const ok = await act('edit-resource', { resourceId: r.id, changes: { readerBookId: book.id } });
      if (ok) {
        refresh();
        onUploaded?.(book);
        setStatusMsg(`Uploaded "${book.title}" and linked to Reader.`);
      }
    } catch (err) {
      setReaderErr(err instanceof Error ? err.message : 'Upload to Reader failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSendYouTube(e: React.FormEvent) {
    e.preventDefault();
    const target = ytUrl.trim();
    if (!target) {
      setReaderErr('Paste a YouTube audiobook or lecture URL.');
      return;
    }
    setReaderErr('');
    setStatusMsg('');
    setYtBusy(true);
    try {
      await sendYouTubeToReaderAudio(target);
      await act('edit-resource', { resourceId: r.id, changes: { youtubeAudioUrl: target } });
      setStatusMsg('Queued in Reader Audio downloads.');
      setYtOpen(false);
    } catch (err) {
      setReaderErr(err instanceof Error ? err.message : 'Could not send YouTube URL to Reader.');
    } finally {
      setYtBusy(false);
    }
  }

  if (r.readerBookId) {
    return (
      <div className="sk-reader-tools">
        <p className="sk-reader-line">
          <span aria-hidden>📖</span>
          <span>{books && !linked ? 'The Reader book it was linked to is gone.' : `In your Reader${linked ? `, ${stateText(linked)}` : ''}. Reading there keeps this up to date.`}</span>
          {linked && <Link href={`/reader?book=${encodeURIComponent(linked.id)}`}>Open in Reader</Link>}
          <button type="button" className="sk-text-btn" disabled={busy} onClick={() => link(null)}>Unlink</button>
        </p>
        {statusMsg && <p className="sk-hint">{statusMsg}</p>}
        {readerErr && <p className="sk-warning" role="alert">{readerErr}</p>}
      </div>
    );
  }

  return (
    <div className="sk-reader-tools">
      <div className="sk-reader-action-row">
        {!picking && (
          <button type="button" className="sk-text-btn sk-reader-start" onClick={() => setPicking(true)}>
            📖 Link to a book in your Reader
          </button>
        )}
        <label className="sk-text-btn sk-file-label" aria-disabled={busy || uploading}>
          <span>{uploading ? `Uploading (${Math.round(uploadPct * 100)}%)…` : '⬆️ Upload PDF/EPUB to Reader'}</span>
          <input
            type="file"
            accept={READER_ACCEPT}
            disabled={busy || uploading}
            onChange={handleFileUpload}
          />
        </label>
        <button
          type="button"
          className="sk-text-btn"
          aria-expanded={ytOpen}
          onClick={() => {
            setReaderErr('');
            if (!ytOpen) setYtUrl(r.youtubeAudioUrl ?? '');
            setYtOpen(!ytOpen);
          }}
        >
          🎧 {ytOpen ? 'Hide YouTube Audio' : 'Send YouTube to Reader Audio'}
        </button>
      </div>

      {picking && (
        <div className="sk-reader-pick">
          {problem ? <p className="sk-warning">{problem}</p> : !books ? <p className="sk-hint">Loading your Reader…</p> : !books.length ? (
            <p className="sk-hint">Your Reader is empty. Upload a file above or <Link href="/reader">open the Reader</Link>.</p>
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
      )}

      {ytOpen && (
        <form className="sk-finder-url-row" onSubmit={handleSendYouTube}>
          <input
            type="url"
            inputMode="url"
            value={ytUrl}
            maxLength={600}
            placeholder="https://www.youtube.com/watch?v=..."
            aria-label="YouTube audiobook or lecture URL"
            onChange={(e) => setYtUrl(e.target.value)}
          />
          <button type="submit" className="sk-small-btn" disabled={busy || ytBusy || !ytUrl.trim()}>
            {ytBusy ? 'Sending…' : 'Queue in Reader Audio'}
          </button>
          <button type="button" className="sk-text-btn" onClick={() => setYtOpen(false)}>Cancel</button>
        </form>
      )}

      {statusMsg && (
        <p className="sk-hint">
          {statusMsg} <Link href="/reader">Open Reader</Link>
        </p>
      )}
      {readerErr && <p className="sk-warning" role="alert">{readerErr}</p>}
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
    const ok = await act('add-resource', { kind: book.audio ? 'video' : 'book', title: book.title, author: book.author, readerBookId: book.id, topicIds });
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
