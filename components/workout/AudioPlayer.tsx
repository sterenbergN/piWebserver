'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { Icon } from '@/components/study/Icon';
import { loadListenShelf, readBookStart, readSpeed, SAVE_EVERY_MS, saveListenPosition, SPEEDS, streamUrl, writeSpeed, type ListenShelf } from '@/components/reader/audio-core';
import { getCover } from '@/components/reader/db';
import { chapterAt, clock } from '@/lib/reader/audio';
import { fractionDone, LISTEN_LAST_KEY, nowPlayingLabel, resumeSeconds } from '@/lib/reader/audio-player';
import { progressText, type BookMeta } from '@/lib/reader/items';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import './audio-player.css';

// An audio book to listen to between sets, without leaving the workout. One <audio>
// element lives here for as long as a book is open, so switching lifts or opening a
// sheet never stops it. It saves its place the way the Reader's player does (same
// functions), so the Reader, Skills and other devices pick it up. The rest chime plays
// through Web Audio, which mixes with this on its own: nothing here touches that.

type View = 'none' | 'picker' | 'full';

function lastBookId(userId: string) {
  try {
    const saved = JSON.parse(readPref(LISTEN_LAST_KEY) || 'null');
    return saved?.u === userId && typeof saved.b === 'string' ? (saved.b as string) : null;
  } catch { return null; }
}

export default function AudioPlayer({ userId, openSignal }: { userId: string; /** Goes up each time the headphones button is tapped. */ openSignal: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [view, setView] = useState<View>('none');
  const [shelf, setShelf] = useState<ListenShelf | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [book, setBook] = useState<BookMeta | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [online, setOnline] = useState(true);

  const bookRef = useRef<BookMeta | null>(null);
  bookRef.current = book;
  const startRef = useRef<number | null>(null);
  const wantPlay = useRef(false);
  const loadToken = useRef(0);
  const lastSave = useRef(0);
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  durationRef.current = duration;
  const chapters = book?.audio?.chapters ?? [];
  const chapter = chapterAt(chapters, time);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  /** Save where you are (sent up soon, or now when `now`). Reads refs only, so it's safe from any handler. */
  const save = useCallback((now = false) => {
    const b = bookRef.current;
    const el = audioRef.current;
    // Until the saved place has been seeked to, "now" is the top of the book: don't write that over it.
    if (!b || startRef.current !== null) return Promise.resolve();
    const total = durationRef.current || (el && Number.isFinite(el.duration) ? el.duration : 0);
    if (!total) return Promise.resolve();
    lastSave.current = Date.now();
    return saveListenPosition(b.id, el ? el.currentTime : timeRef.current, total, b.audio?.chapters ?? [], now);
  }, []);

  // Phones leave an app rather than close it: save when the page is hidden or goes away, and on the way out.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void save(true); };
    const onGone = () => { void save(true); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onGone);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onGone);
      void save(true);
    };
  }, [save]);

  // Blob URLs are released when they're replaced or this goes away.
  useEffect(() => () => { if (src?.startsWith('blob:')) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover); }, [cover]);
  useEffect(() => () => { for (const url of Object.values(covers)) URL.revokeObjectURL(url); }, [covers]);

  // Lets the tracker leave room under its controls and lift its toasts above the player.
  useEffect(() => {
    if (!book) return;
    document.body.classList.add('wap-on');
    return () => document.body.classList.remove('wap-on');
  }, [book]);

  // The books on offer: what's on this device now, and the Pi's word when it answers.
  const openPicker = useCallback(() => {
    setView('picker');
    setShelf(null);
    void loadListenShelf(userId, setShelf).catch(() => setShelf((s) => s ?? { books: [], progress: {}, kept: [], signedOut: false }));
  }, [userId]);

  const lastSignal = useRef(0);
  useEffect(() => {
    if (!openSignal || openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    if (bookRef.current) setView((v) => (v === 'full' ? 'none' : 'full'));
    else openPicker();
  }, [openSignal, openPicker]);

  // Covers for the picker.
  useEffect(() => {
    if (view !== 'picker' || !shelf) return;
    let live = true;
    (async () => {
      const made: Record<string, string> = {};
      for (const b of shelf.books) {
        if (!b.hasCover) continue;
        const blob = await getCover(b.id).catch(() => null);
        if (blob) made[b.id] = URL.createObjectURL(blob);
      }
      if (live) setCovers(made); else for (const url of Object.values(made)) URL.revokeObjectURL(url);
    })();
    return () => { live = false; };
  }, [view, shelf]);

  /** Close what's playing, saving where it got to. */
  const stop = useCallback(() => {
    audioRef.current?.pause();
    void save(true);
    loadToken.current += 1;
    startRef.current = null;
    wantPlay.current = false;
    setBook(null); setSrc(null); setCover(null); setPlaying(false); setProblem(''); setTime(0); setDuration(0);
    setView('none');
    const session = navigator.mediaSession;
    if (session) { try { session.metadata = null; session.playbackState = 'none'; } catch { /* Not offered here. */ } }
  }, [save]);

  /** Open a book. It starts as soon as it can; if the phone won't let it, play is one tap away. */
  const start = useCallback(async (next: BookMeta) => {
    audioRef.current?.pause();
    await save(true);
    const token = ++loadToken.current;
    startRef.current = null;
    wantPlay.current = true;
    setBook(next); setSrc(null); setCover(null); setPlaying(false); setProblem(''); setView('none');
    const total = next.audio?.duration ?? 0;
    setDuration(total); setTime(0); setSpeed(readSpeed());
    savePref(LISTEN_LAST_KEY, JSON.stringify({ u: userId, b: next.id }));
    try {
      const { file, progress, cover: coverBlob } = await readBookStart(next);
      if (token !== loadToken.current) return;
      const from = resumeSeconds(progress, total);
      startRef.current = from;
      timeRef.current = from;
      setTime(from);
      if (coverBlob) setCover(URL.createObjectURL(coverBlob));
      if (file) setSrc(URL.createObjectURL(file));
      else if (!navigator.onLine) setProblem('This one isn’t on this device, and there’s no connection. Keep it for offline in the Reader.');
      else setSrc(streamUrl(next.id));
    } catch {
      if (token === loadToken.current) setProblem('That couldn’t be opened.');
    }
  }, [save, userId]);

  const seek = useCallback((t: number) => {
    const el = audioRef.current;
    if (!el) return;
    const total = durationRef.current || el.duration || t;
    el.currentTime = Math.max(0, Math.min(t, total - 0.5));
    timeRef.current = el.currentTime;
    setTime(el.currentTime);
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setProblem('It wouldn’t play. Tap play again.'));
    else el.pause();
  }, []);

  const skipChapter = useCallback((step: 1 | -1) => {
    const list = bookRef.current?.audio?.chapters ?? [];
    const cur = timeRef.current;
    if (!list.length) return seek(cur + step * 30);
    const here = chapterAt(list, cur);
    // Back within the first few seconds of a chapter goes to the one before; otherwise to its start.
    const target = step > 0 ? here + 1 : cur - (list[here]?.start ?? 0) > 3 ? here : here - 1;
    if (target >= 0 && target < list.length) seek(list[target].start);
    else if (target < 0) seek(0);
  }, [seek]);

  // Lock screen and AirPods controls.
  const label = nowPlayingLabel(chapters, time, book?.title ?? '');
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session || !book) return;
    session.metadata = new MediaMetadata({ title: label, artist: 'Audiobook', album: book.title, artwork: cover ? [{ src: cover, sizes: '600x600', type: 'image/jpeg' }] : [] });
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => { try { session.setActionHandler(action, handler); } catch { /* Not offered here. */ } };
    set('play', () => void audioRef.current?.play().catch(() => {}));
    set('pause', () => audioRef.current?.pause());
    set('seekbackward', (d) => seek(timeRef.current - (d.seekOffset ?? 15)));
    set('seekforward', (d) => seek(timeRef.current + (d.seekOffset ?? 30)));
    set('seekto', (d) => { if (d.seekTime !== undefined) seek(d.seekTime); });
    return () => { for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) set(a, null); };
  }, [book, label, cover, seek]);

  useEffect(() => {
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch { /* Old browsers. */ }
  }, [playing]);
  useEffect(() => {
    try { if (duration && navigator.mediaSession?.setPositionState) navigator.mediaSession.setPositionState({ duration, position: Math.min(time, duration), playbackRate: speed }); } catch { /* Old browsers. */ }
  }, [duration, time, speed]);

  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
    writeSpeed(next);
  };

  const left = duration ? Math.max(0, duration - time) : 0;
  const shown = shelf ?? { books: [], progress: {}, kept: [], signedOut: false };
  const keptHere = new Set(shown.kept);
  const last = lastBookId(userId);
  const resume = shelf?.books.find((b) => b.id === last && (online || keptHere.has(b.id)));

  const controls = (big: boolean) => (
    <div className={`wap-controls${big ? ' is-big' : ''}`}>
      {big && <button type="button" className="wap-skip" aria-label={chapters.length ? 'Previous chapter' : 'Back 30 seconds'} onClick={() => skipChapter(-1)} disabled={!src}><Icon name="left" /><Icon name="left" /></button>}
      <button type="button" className="wap-skip" aria-label="Back 15 seconds" onClick={() => seek(timeRef.current - 15)} disabled={!src}>−15</button>
      <button type="button" className="wap-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={!src}><Icon name={playing ? 'pause' : 'play'} size="1.3em" /></button>
      <button type="button" className="wap-skip" aria-label="Forward 30 seconds" onClick={() => seek(timeRef.current + 30)} disabled={!src}>+30</button>
      {big && <button type="button" className="wap-skip" aria-label={chapters.length ? 'Next chapter' : 'Forward 30 seconds'} onClick={() => skipChapter(1)} disabled={!src}><Icon name="right" /><Icon name="right" /></button>}
    </div>
  );

  return (
    <>
      {book && (
        <div className="wap-mini" role="region" aria-label="Audio book player">
          <div className="wap-line" aria-hidden><div style={{ width: `${fractionDone(time, duration) * 100}%` }} /></div>
          <div className="wap-row">
            <button type="button" className="wap-info" onClick={() => setView('full')} aria-label={`${book.title}. Open the player`}>
              {cover ? <img className="wap-art" src={cover} alt="" /> : <span className="wap-art" aria-hidden>🎧</span>}
              <span className="wap-text">
                <strong>{label}</strong>
                <small className={problem ? 'is-problem' : ''}>{problem || `${clock(time)} of ${clock(duration)}`}</small>
              </span>
            </button>
            {controls(false)}
            <button type="button" className="wap-close" aria-label="Close the audio player" title="Close (pauses and saves your place)" onClick={stop}>✕</button>
          </div>
        </div>
      )}
      {book && <div className="wap-spacer" aria-hidden />}

      {book && src && (
        <audio ref={audioRef} key={book.id + src} src={src} preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (Number.isFinite(el.duration) && el.duration > 0) { durationRef.current = el.duration; setDuration(el.duration); }
            el.playbackRate = speed;
            if (startRef.current !== null) {
              el.currentTime = startRef.current;
              timeRef.current = startRef.current;
              setTime(startRef.current);
              startRef.current = null;
            }
            // The phone may refuse a play that no tap started. Then it simply waits for the play button.
            if (wantPlay.current) { wantPlay.current = false; void el.play().catch(() => {}); }
          }}
          onPlay={() => { setPlaying(true); setProblem(''); }}
          onPause={() => { setPlaying(false); void save(true); }}
          onEnded={() => { setPlaying(false); void save(true); }}
          onSeeked={() => void save()}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            timeRef.current = t;
            setTime(t);
            if (Date.now() - lastSave.current > SAVE_EVERY_MS) void save();
          }}
          onError={() => setProblem(navigator.onLine ? 'This audio wouldn’t play.' : 'No connection, and this one isn’t kept on this device.')} />
      )}

      {view === 'picker' && (
        <Sheet title="Audio books" subtitle="Plays right here while you lift." onClose={() => setView('none')}>
          {!shelf && <p className="workout-hint">Looking for your books…</p>}
          {shelf?.signedOut && <p className="wap-note">Sign in to the Reader first. <a href="/reader" target="_blank" rel="noopener">Open the Reader</a></p>}
          {shelf && !shelf.signedOut && shelf.books.length === 0 && (
            <p className="wap-note">No audio books yet: <a href="/reader" target="_blank" rel="noopener">add one in the Reader</a>.</p>
          )}
          {resume && (
            <button type="button" className="btn btn-primary wap-resume" onClick={() => void start(resume)}>▶ Resume {resume.title}</button>
          )}
          {shelf && shelf.books.length > 0 && !online && <p className="workout-hint">No connection: only books kept on this device will play.</p>}
          <ul className="wap-list">
            {shown.books.map((b) => {
              const here = keptHere.has(b.id);
              const blocked = !online && !here;
              return (
                <li key={b.id}>
                  <button type="button" className={`wap-pick${book?.id === b.id ? ' is-open' : ''}`} disabled={blocked} onClick={() => void start(b)}>
                    {covers[b.id] ? <img className="wap-art" src={covers[b.id]} alt="" /> : <span className="wap-art" aria-hidden>🎧</span>}
                    <span className="wap-text">
                      <strong>{b.title}</strong>
                      <small>{blocked ? 'Not on this device, and no connection' : progressText(shown.progress[b.id], 'audio')}{here && !blocked ? ' · on this device' : ''}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}

      {view === 'full' && book && (
        <Sheet
          title={book.title}
          subtitle={book.author || undefined}
          onClose={() => setView('none')}
          footer={<button type="button" className="btn btn-secondary" onClick={stop}>Close player</button>}
        >
          <div className="wap-full">
            {cover && <img className="wap-cover" src={cover} alt="" />}
            {chapter >= 0 && <p className="wap-chapter">{chapters[chapter].title} <small>{chapter + 1} of {chapters.length}</small></p>}
            {problem && <p className="wap-problem" role="alert">{problem}</p>}
            <input className="wap-scrub" type="range" min={0} max={Math.max(1, Math.floor(duration))} step={1} value={Math.floor(time)} aria-label="Position" disabled={!src} onChange={(e) => seek(Number(e.target.value))} />
            <div className="wap-times"><span>{clock(time)}</span><span>−{clock(left)}</span></div>
            {controls(true)}
            <div className="wap-extras">
              <button type="button" className="btn btn-secondary" onClick={changeSpeed} aria-label={`Speed ${speed} times, tap to change`}>{speed}×</button>
              <button type="button" className="btn btn-secondary" onClick={openPicker}>Change book</button>
              <a className="btn btn-secondary" href={`/reader?book=${encodeURIComponent(book.id)}`} target="_blank" rel="noopener" onClick={() => { audioRef.current?.pause(); }}>Open in Reader</a>
            </div>
            {chapters.length > 0 && (
              <ol className="wap-chapters">
                {chapters.map((c, i) => (
                  <li key={c.start}>
                    <button type="button" className={i === chapter ? 'is-here' : ''} onClick={() => { seek(c.start); if (audioRef.current?.paused) toggle(); }}>
                      <span>{c.title}</span><small>{clock(c.start)}</small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
