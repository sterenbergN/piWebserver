'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { chapterAt, clock, spoken } from '@/lib/reader/audio';
import type { Anchor, BookMeta } from '@/lib/reader/items';
import { getCover, getFile, getProgress } from './db';
import type { ReaderSettings } from './source';
import { downloadBook, flushNow, ReaderSignedOut, saveProgressHere } from './sync';

// An audio book: play it, skip about, jump between chapters, change the speed,
// set a sleep timer. It plays from this device when it's been kept here, and
// streams from the Pi otherwise. Where you are is saved like a page in a book
// (the anchor's page is the second you're at), so it syncs across devices and a
// Skills resource linked to it moves along too. The lock screen and headphones
// control it through Media Session.

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SPEED_KEY = 'reader-audio-speed';
const SAVE_EVERY_MS = 10_000;
/** This close to the end counts as finished. */
const END_SECONDS = 30;
const SLEEP_CHOICES = [{ label: 'Off', minutes: 0 }, { label: '15 min', minutes: 15 }, { label: '30 min', minutes: 30 }, { label: '1 hour', minutes: 60 }, { label: 'End of chapter', minutes: -1 }];

type Sleep = { until: number } | { chapterEnd: number } | null;

function readSpeed() {
  try { const v = Number(localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(v) ? v : 1; } catch { return 1; }
}

export default function AudioView({ book, startAt, settings, onExit, onSignedOut }: {
  book: BookMeta;
  startAt: Anchor | null;
  settings: ReaderSettings;
  onExit: () => void;
  onSignedOut: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [cover, setCover] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(book.audio?.duration ?? 0);
  const [speed, setSpeed] = useState(1);
  const [sleep, setSleep] = useState<Sleep>(null);
  const [panel, setPanel] = useState<'chapters' | 'sleep' | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const lastSave = useRef(0);
  const startRef = useRef<number | null>(null);
  const chapters = book.audio?.chapters ?? [];
  const chapter = chapterAt(chapters, time);

  // Where to start, and what to play from.
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    (async () => {
      setSpeed(readSpeed());
      const [file, progress, coverBlob] = await Promise.all([getFile(book.id), getProgress(book.id), book.hasCover ? getCover(book.id) : null]);
      if (!live) return;
      const total = book.audio?.duration ?? 0;
      const saved = startAt?.page ?? progress?.anchor.page ?? 0;
      // Finished, or right at the end: start again from the top.
      startRef.current = progress?.finishedAt || (total && saved > total - END_SECONDS) ? 0 : saved;
      if (coverBlob) { made = URL.createObjectURL(coverBlob); setCover(made); }
      if (file) {
        setKept(true);
        setSrc(URL.createObjectURL(file));
        return;
      }
      if (!navigator.onLine) { setProblem('This one isn’t on this device yet, and there’s no connection. Keep it here next time you’re online to listen offline.'); return; }
      setSrc(`/api/reader/file?book=${encodeURIComponent(book.id)}`);
    })().catch(() => setProblem('This couldn’t be opened.'));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [book, startAt]);

  useEffect(() => () => { if (src?.startsWith('blob:')) URL.revokeObjectURL(src); }, [src]);

  /** Save where you are (sent up soon, or now when `now`). */
  const save = useCallback(async (now = false) => {
    const el = audio.current;
    const total = duration || el?.duration || 0;
    if (!el || !total || startRef.current !== null) return;
    const t = el.currentTime;
    lastSave.current = Date.now();
    const at = chapterAt(chapters, t);
    await saveProgressHere(book.id, {
      anchor: { page: Math.max(1, Math.floor(t)), ...(at >= 0 ? { chapter: chapters[at].title } : {}) },
      pct: Math.min(1, t / total), total: Math.ceil(total), atEnd: total - t <= END_SECONDS,
    }).catch(() => {});
    if (now) void flushNow().catch(() => {});
  }, [book.id, chapters, duration]);

  const seek = useCallback((t: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, (duration || el.duration || t) - 0.5));
    setTime(el.currentTime);
  }, [duration]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setProblem('It wouldn’t play. Tap play again.'));
    else el.pause();
  }, []);

  const skipChapter = useCallback((step: 1 | -1) => {
    if (!chapters.length) return seek(time + step * 30);
    const here = chapterAt(chapters, time);
    // Back within the first few seconds of a chapter goes to the one before; otherwise to its start.
    const target = step > 0 ? here + 1 : time - (chapters[here]?.start ?? 0) > 3 ? here : here - 1;
    if (target >= 0 && target < chapters.length) seek(chapters[target].start);
    else if (target < 0) seek(0);
  }, [chapters, time, seek]);

  // Save when the page goes away or is hidden (phones rarely close an app: they leave it).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void save(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); void save(true); };
  }, [save]);

  // Lock screen and headphone controls.
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session) return;
    session.metadata = new MediaMetadata({ title: chapter >= 0 ? chapters[chapter].title : book.title, artist: book.author || undefined, album: book.title, artwork: cover ? [{ src: cover, sizes: '600x600', type: 'image/jpeg' }] : [] });
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => { try { session.setActionHandler(action, handler); } catch { /* Not offered here. */ } };
    set('play', () => void audio.current?.play());
    set('pause', () => audio.current?.pause());
    set('seekbackward', (d) => seek(time - (d.seekOffset ?? 15)));
    set('seekforward', (d) => seek(time + (d.seekOffset ?? 30)));
    set('seekto', (d) => { if (d.seekTime !== undefined) seek(d.seekTime); });
    set('previoustrack', chapters.length ? () => skipChapter(-1) : null);
    set('nexttrack', chapters.length ? () => skipChapter(1) : null);
    return () => { for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) set(a, null); };
  }, [book, chapter, chapters, cover, seek, skipChapter, time]);

  useEffect(() => {
    try { if (duration && navigator.mediaSession?.setPositionState) navigator.mediaSession.setPositionState({ duration, position: Math.min(time, duration), playbackRate: speed }); } catch { /* Old browsers. */ }
  }, [duration, time, speed]);

  // Keyboard, on a computer: space plays, arrows skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') seek(time - 15);
      else if (e.key === 'ArrowRight') seek(time + 30);
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, time, onExit]);

  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
    try { localStorage.setItem(SPEED_KEY, String(next)); } catch { /* Just for now, then. */ }
  };

  const chooseSleep = (minutes: number) => {
    setPanel(null);
    if (!minutes) setSleep(null);
    else if (minutes < 0) {
      const next = chapters[chapter + 1];
      setSleep({ chapterEnd: next ? next.start : duration });
    } else setSleep({ until: Date.now() + minutes * 60_000 });
  };

  async function keepHere() {
    setSaving(0);
    try {
      await downloadBook(book, (f) => setSaving(f));
      setKept(true);
    } catch (e) {
      if (e instanceof ReaderSignedOut) onSignedOut();
      else setProblem(e instanceof Error ? e.message : 'That didn’t download.');
    } finally {
      setSaving(null);
    }
  }

  const left = duration ? duration - time : 0;
  const sleepText = !sleep ? null : 'until' in sleep ? `Sleep in ${spoken(Math.max(0, (sleep.until - Date.now()) / 1000))}` : 'Sleep at chapter end';

  return (
    <div className="rd-listen" data-rd-theme={settings.theme}>
      <header className="rd-bar rd-top">
        <button type="button" className="rd-back" onClick={onExit} aria-label="Back to your books"><Icon name="chevron" className="is-flipped" /><span>Books</span></button>
        <span className="rd-grow" />
        {kept ? <span className="rd-listen-kept"><Icon name="device" size="0.95em" /> On this device</span>
          : saving !== null ? <span className="rd-listen-kept">Keeping {Math.round(saving * 100)}%</span>
          : <button type="button" className="rd-btn is-small" onClick={keepHere}><Icon name="download" /> Keep for offline</button>}
      </header>

      <main className="rd-listen-main">
        <div className="rd-listen-art">
          {cover ? <img src={cover} alt="" /> : <span aria-hidden><Icon name="play" size="3em" /></span>}
        </div>
        <h1>{book.title}</h1>
        {book.author && <p className="rd-listen-author">{book.author}</p>}
        {chapter >= 0 && <button type="button" className="rd-listen-chapter" onClick={() => setPanel('chapters')}>{chapters[chapter].title} <small>{chapter + 1} of {chapters.length}</small></button>}

        {problem && <p className="rd-yt-problem" role="alert">{problem}</p>}

        <div className="rd-listen-scrub">
          <input type="range" min={0} max={Math.max(1, Math.floor(duration))} step={1} value={Math.floor(time)} aria-label="Position"
            onChange={(e) => seek(Number(e.target.value))} disabled={!src} />
          <div className="rd-listen-times"><span>{clock(time)}</span><span>−{clock(left)}</span></div>
        </div>

        <div className="rd-listen-controls">
          <button type="button" className="rd-icon-btn" aria-label={chapters.length ? 'Previous chapter' : 'Back 30 seconds'} onClick={() => skipChapter(-1)} disabled={!src}><Icon name="left" /><Icon name="left" /></button>
          <button type="button" className="rd-listen-skip" aria-label="Back 15 seconds" onClick={() => seek(time - 15)} disabled={!src}>−15</button>
          <button type="button" className="rd-listen-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={!src}><Icon name={playing ? 'pause' : 'play'} size="1.8em" /></button>
          <button type="button" className="rd-listen-skip" aria-label="Forward 30 seconds" onClick={() => seek(time + 30)} disabled={!src}>+30</button>
          <button type="button" className="rd-icon-btn" aria-label={chapters.length ? 'Next chapter' : 'Forward 30 seconds'} onClick={() => skipChapter(1)} disabled={!src}><Icon name="right" /><Icon name="right" /></button>
        </div>

        <div className="rd-listen-extras">
          <button type="button" className="rd-btn is-small" onClick={changeSpeed} aria-label={`Speed ${speed} times, tap to change`}>{speed}×</button>
          <button type="button" className={`rd-btn is-small${sleep ? ' is-primary' : ''}`} onClick={() => setPanel(panel === 'sleep' ? null : 'sleep')}><Icon name="moon" /> {sleepText ?? 'Sleep timer'}</button>
          {chapters.length > 0 && <button type="button" className="rd-btn is-small" onClick={() => setPanel(panel === 'chapters' ? null : 'chapters')}><Icon name="list" /> Chapters</button>}
          {book.link && <a className="rd-btn is-small" href={book.link} target="_blank" rel="noopener noreferrer">YouTube</a>}
        </div>

        {panel === 'sleep' && (
          <div className="rd-listen-panel" role="group" aria-label="Sleep timer">
            {SLEEP_CHOICES.filter((c) => c.minutes >= 0 || chapters.length).map((c) => (
              <button key={c.label} type="button" className="rd-btn is-small" onClick={() => chooseSleep(c.minutes)}>{c.label}</button>
            ))}
          </div>
        )}
        {panel === 'chapters' && (
          <ol className="rd-listen-chapters">
            {chapters.map((c, i) => (
              <li key={c.start}>
                <button type="button" className={i === chapter ? 'is-here' : ''} onClick={() => { seek(c.start); setPanel(null); if (audio.current?.paused) toggle(); }}>
                  <span>{c.title}</span><small>{clock(c.start)}</small>
                </button>
              </li>
            ))}
          </ol>
        )}
      </main>

      {src && (
        <audio ref={audio} src={src} preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
            el.playbackRate = speed;
            if (startRef.current !== null) { el.currentTime = startRef.current; setTime(startRef.current); startRef.current = null; }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => { setPlaying(false); void save(true); }}
          onEnded={() => { setPlaying(false); void save(true); }}
          onSeeked={() => void save()}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setTime(t);
            if (Date.now() - lastSave.current > SAVE_EVERY_MS) void save();
            if (sleep && (('until' in sleep && Date.now() >= sleep.until) || ('chapterEnd' in sleep && t >= sleep.chapterEnd - 0.5))) {
              e.currentTarget.pause();
              setSleep(null);
            }
          }}
          onError={() => setProblem(navigator.onLine ? 'This audio wouldn’t play.' : 'No connection, and this one isn’t kept on this device.')} />
      )}
    </div>
  );
}
