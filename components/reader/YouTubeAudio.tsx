'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import type { YouTubeJob } from '@/lib/reader/youtube';

// Audio books from YouTube, on the shelf: paste a link, and watch it download on
// the Pi. The list is asked for again every few seconds while anything is on its
// way, and the shelf refreshes as each one lands.

const POLL_MS = 3000;

async function call(init?: RequestInit) {
  const res = await fetch('/api/reader/youtube', { cache: 'no-store', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t work. Try again.');
  return body.jobs as YouTubeJob[];
}

const post = (payload: Record<string, unknown>) => call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

export function useYouTubeJobs(enabled: boolean, onLanded: () => void) {
  const [jobs, setJobs] = useState<YouTubeJob[]>([]);
  const done = useRef<Set<string> | null>(null);
  const landed = useRef(onLanded);
  useEffect(() => { landed.current = onLanded; }, [onLanded]);

  const take = useCallback((list: YouTubeJob[]) => {
    setJobs(list);
    const finished = list.filter((j) => j.status === 'done').map((j) => j.id);
    // The first answer only says what's already on the shelf.
    if (done.current && finished.some((id) => !done.current!.has(id))) landed.current();
    done.current = new Set(finished);
  }, []);

  const busy = jobs.some((j) => j.status === 'waiting' || j.status === 'working');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const tick = () => call().then((list) => { if (live) take(list); }, () => {});
    void tick();
    if (!busy) return () => { live = false; };
    const timer = window.setInterval(tick, POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [enabled, busy, take]);

  return {
    jobs,
    add: async (url: string, folder?: string) => take(await post({ action: 'add', url, folder })),
    retry: async (id: string) => take(await post({ action: 'retry', id })),
    remove: async (id: string) => take(await post({ action: 'remove', id })),
  };
}

/** The paste-a-link form, inside the shelf's add menu. */
export function YouTubeForm({ folderName, onAdd, onCancel }: { folderName?: string; onAdd: (url: string) => Promise<void>; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem('');
    try {
      await onAdd(url.trim());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    try { setUrl((await navigator.clipboard.readText()).trim()); } catch { /* Paste by hand instead. */ }
  }

  return (
    <form className="rd-yt-form" onSubmit={submit}>
      <p className="rd-menu-title">Audio from YouTube{folderName && <small>To {folderName}</small>}</p>
      <div className="rd-row">
        <input type="url" inputMode="url" autoFocus required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" aria-label="YouTube link" />
        <button type="button" className="rd-btn" onClick={paste}><Icon name="paste" /> Paste</button>
      </div>
      <p className="rd-hint">
        The Pi saves the sound, with its chapters, as an audio book you can listen to here and keep on your phone or iPad for offline.
        A playlist link brings every video in it, in a folder of its own. For videos you’re allowed to keep: your own, Creative Commons, or public domain.
      </p>
      {problem && <p className="rd-yt-problem" role="alert">{problem}</p>}
      <div className="rd-row">
        <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
        <span className="rd-grow" />
        <button type="submit" className="rd-btn is-primary" disabled={busy || !url.trim()}>{busy ? 'Adding…' : 'Save audio'}</button>
      </div>
    </form>
  );
}

const STEP_TEXT = { looking: 'Looking it up…', downloading: 'Downloading', finishing: 'Finishing…' } as const;

/** What's on its way, and what didn't make it. Finished ones are on the shelf, so they're not listed. */
export function YouTubeJobs({ jobs, onRetry, onRemove }: { jobs: YouTubeJob[]; onRetry: (id: string) => void; onRemove: (id: string) => void }) {
  const shown = jobs.filter((j) => j.status !== 'done');
  if (!shown.length) return null;
  return (
    <ul className="rd-uploads rd-yt-jobs" aria-label="Audio on its way from YouTube">
      {shown.map((job) => (
        <li key={job.id}>
          <span><Icon name="play" size="0.9em" /> {job.title ?? (job.kind === 'playlist' ? 'A YouTube playlist' : 'A YouTube video')}</span>
          {job.status === 'failed' ? (
            <>
              <em>{job.problem ?? 'That didn’t work.'}</em>
              <button type="button" className="rd-btn" onClick={() => onRetry(job.id)}>Try again</button>
              <button type="button" className="rd-icon-btn" aria-label="Remove" onClick={() => onRemove(job.id)}><Icon name="x" /></button>
            </>
          ) : job.status === 'waiting' ? (
            <>
              <em>Waiting its turn</em>
              <button type="button" className="rd-icon-btn" aria-label="Cancel" onClick={() => onRemove(job.id)}><Icon name="x" /></button>
            </>
          ) : (
            <>
              <em>{STEP_TEXT[job.step ?? 'looking']}{job.step === 'downloading' && job.fraction !== undefined ? ` ${Math.round(job.fraction * 100)}%` : ''}</em>
              {job.step === 'downloading' && <div className="rd-meter"><span style={{ width: `${Math.round((job.fraction ?? 0) * 100)}%` }} /></div>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
