'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { chapterAt, clock, spoken } from '@/lib/reader/audio';
import { audioTimeSeconds, type Anchor, type BookMeta } from '@/lib/reader/items';
import { deleteFile, getCover, getFile, getProgress } from './db';
import { ChapterEditor } from './ShelfDialogs';
import type { ReaderSettings } from './source';
import { downloadBook, flushNow, ReaderSignedOut, saveProgressHere } from './sync';
import { useBookItems } from './useBookItems';

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

type Sleep = { until: number } | { chapterIndex: number } | null;

function readSpeed() {
  try { const v = Number(localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(v) ? v : 1; } catch { return 1; }
}

export default function AudioView({ book, startAt, settings, other, onSwitch, onEdited, onExit, onSignedOut }: {
  book: BookMeta;
  startAt: Anchor | null;
  settings: ReaderSettings;
  /** The book this is the audio of, if you have it too. */
  other?: BookMeta;
  onSwitch?: (book: BookMeta) => void;
  /** Its chapters were changed: the shelf's copy needs reading again. */
  onEdited?: () => void;
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
  const [panel, setPanel] = useState<'chapters' | 'sleep' | 'notes' | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: string; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { all, version, addNote, editNote, remove } = useBookItems(book.id);
  const audioNotes = useMemo(
    () => all()
      .filter((item) => !item.deleted && item.kind === 'note' && item.text)
      .sort((a, b) => audioTimeSeconds(a.anchor) - audioTimeSeconds(b.anchor) || a.createdAt - b.createdAt),
    [all, version],
  );
  const lastSave = useRef(0);
  const startRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(book.audio?.duration ?? 0);
  durationRef.current = duration;
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const chapters = book.audio?.chapters ?? [];
  const chapter = chapterAt(chapters, time);

  // Where to start, and what to play from. Only when another book is opened: a change to
  // this one's chapters mustn't start it loading again.
  const opened = useRef(book);
  opened.current = book;
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    (async () => {
      const book = opened.current;
      setSpeed(readSpeed());
      const [file, progress, coverBlob] = await Promise.all([getFile(book.id), getProgress(book.id), book.hasCover ? getCover(book.id) : null]);
      if (!live) return;
      const total = book.audio?.duration ?? 0;
      const saved = startAt ? audioTimeSeconds(startAt) : (progress?.anchor.page ?? 0);
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
  }, [book.id, startAt]);

  useEffect(() => () => { if (src?.startsWith('blob:')) URL.revokeObjectURL(src); }, [src]);

  /** Save where you are (sent up soon, or now when `now`). */
  const save = useCallback(async (now = false) => {
    const el = audio.current;
    const total = durationRef.current || el?.duration || 0;
    if (!total || startRef.current !== null) return;
    const t = el ? el.currentTime : currentTimeRef.current;
    lastSave.current = Date.now();
    const at = chapterAt(chapters, t);
    await saveProgressHere(book.id, {
      anchor: { page: Math.max(1, Math.floor(t)), ...(at >= 0 ? { chapter: chapters[at].title } : {}) },
      pct: Math.min(1, t / total), total: Math.ceil(total), atEnd: total - t <= END_SECONDS,
    }).catch(() => {});
    if (now) void flushNow().catch(() => {});
  }, [book.id, chapters]);

  const seek = useCallback((t: number) => {
    const el = audio.current;
    if (!el) return;
    const total = durationRef.current || el.duration || t;
    el.currentTime = Math.max(0, Math.min(t, total - 0.5));
    currentTimeRef.current = el.currentTime;
    setTime(el.currentTime);
  }, []);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setProblem('It wouldn’t play. Tap play again.'));
    else el.pause();
  }, []);

  const skipChapter = useCallback((step: 1 | -1) => {
    const cur = currentTimeRef.current;
    if (!chapters.length) return seek(cur + step * 30);
    const here = chapterAt(chapters, cur);
    // Back within the first few seconds of a chapter goes to the one before; otherwise to its start.
    const target = step > 0 ? here + 1 : cur - (chapters[here]?.start ?? 0) > 3 ? here : here - 1;
    if (target >= 0 && target < chapters.length) seek(chapters[target].start);
    else if (target < 0) seek(0);
  }, [chapters, seek]);

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
    set('seekbackward', (d) => seek(currentTimeRef.current - (d.seekOffset ?? 15)));
    set('seekforward', (d) => seek(currentTimeRef.current + (d.seekOffset ?? 30)));
    set('seekto', (d) => { if (d.seekTime !== undefined) seek(d.seekTime); });
    set('previoustrack', chapters.length ? () => skipChapter(-1) : null);
    set('nexttrack', chapters.length ? () => skipChapter(1) : null);
    return () => { for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) set(a, null); };
  }, [book, chapter, chapters, cover, seek, skipChapter]);

  useEffect(() => {
    try { if (duration && navigator.mediaSession?.setPositionState) navigator.mediaSession.setPositionState({ duration, position: Math.min(time, duration), playbackRate: speed }); } catch { /* Old browsers. */ }
  }, [duration, time, speed]);

  // Keyboard, on a computer: space plays, arrows skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') seek(currentTimeRef.current - 15);
      else if (e.key === 'ArrowRight') seek(currentTimeRef.current + 30);
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, onExit]);

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
      if (!chapters.length) return;
      const curIndex = chapterAt(chapters, currentTimeRef.current);
      if (curIndex >= chapters.length - 1 && durationRef.current <= 0) return;
      setSleep({ chapterIndex: Math.max(0, curIndex) });
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

  /** Off this device, to make room. It carries on from the Pi, from the same place. */
  async function removeHere() {
    const el = audio.current;
    if (el) { startRef.current = el.currentTime; el.pause(); }
    await deleteFile(book.id).catch(() => {});
    setKept(false);
    setSrc(`/api/reader/file?book=${encodeURIComponent(book.id)}`);
  }

  const left = duration ? duration - time : 0;
  const sleepText = !sleep ? null : 'until' in sleep ? `Sleep in ${spoken(Math.max(0, (sleep.until - Date.now()) / 1000))}` : 'Sleep at chapter end';

  const saveAudioNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    const t = audio.current ? audio.current.currentTime : currentTimeRef.current;
    const at = chapterAt(chapters, t);
    addNote(
      {
        page: Math.max(1, Math.floor(t)),
        o: Math.floor(t * 1000),
        ...(at >= 0 ? { chapter: chapters[at].title } : {}),
      },
      text,
    );
    setNoteDraft('');
  };

  const jumpToTimestamp = (seconds: number) => {
    seek(seconds);
    const el = audio.current;
    if (el && el.paused) {
      void el.play().catch(() => setProblem('It wouldn’t play. Tap play again.'));
    }
  };

  return (
    <div className="rd-listen" data-rd-theme={settings.theme}>
      <header className="rd-bar rd-top">
        <button type="button" className="rd-back" onClick={onExit} aria-label="Back to your books"><Icon name="chevron" className="is-flipped" /><span>Books</span></button>
        <span className="rd-grow" />
        {other && onSwitch && <button type="button" className="rd-btn is-small" onClick={() => onSwitch(other)}><Icon name="book" /> Read</button>}
        {kept ? <button type="button" className="rd-btn is-small" disabled={!online} title="Take it off this device to make room. It plays from the Pi instead." onClick={() => void removeHere()}><Icon name="device" /> On this device · Remove</button>
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
          <button type="button" className="rd-icon-btn" aria-label={chapters.length ? 'Previous chapter' : 'Skip back 30 seconds'} onClick={() => skipChapter(-1)} disabled={!src}><Icon name="left" /><Icon name="left" /></button>
          <button type="button" className="rd-listen-skip" aria-label="Back 15 seconds" onClick={() => seek(currentTimeRef.current - 15)} disabled={!src}>−15</button>
          <button type="button" className="rd-listen-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={!src}><Icon name={playing ? 'pause' : 'play'} size="1.8em" /></button>
          <button type="button" className="rd-listen-skip" aria-label="Forward 30 seconds" onClick={() => seek(currentTimeRef.current + 30)} disabled={!src}>+30</button>
          <button type="button" className="rd-icon-btn" aria-label={chapters.length ? 'Next chapter' : 'Skip forward 30 seconds'} onClick={() => skipChapter(1)} disabled={!src}><Icon name="right" /><Icon name="right" /></button>
        </div>

        <div className="rd-listen-extras">
          <button type="button" className="rd-btn is-small" onClick={changeSpeed} aria-label={`Speed ${speed} times, tap to change`}>{speed}×</button>
          <button type="button" className={`rd-btn is-small${sleep ? ' is-primary' : ''}`} onClick={() => setPanel(panel === 'sleep' ? null : 'sleep')}><Icon name="moon" /> {sleepText ?? 'Sleep timer'}</button>
          <button type="button" className={`rd-btn is-small${panel === 'chapters' ? ' is-primary' : ''}`} onClick={() => setPanel(panel === 'chapters' ? null : 'chapters')}><Icon name="list" /> Chapters</button>
          <button type="button" className={`rd-btn is-small${panel === 'notes' ? ' is-primary' : ''}`} aria-pressed={panel === 'notes'} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}>
            <Icon name="note" /> Notes{audioNotes.length > 0 ? ` (${audioNotes.length})` : ''}
          </button>
          {book.link && <a className="rd-btn is-small" href={book.link} target="_blank" rel="noopener noreferrer">YouTube</a>}
        </div>

        {panel === 'sleep' && (
          <div className="rd-listen-panel" role="group" aria-label="Sleep timer">
            {SLEEP_CHOICES.filter((c) => c.minutes >= 0 || (chapters.length > 0 && (chapter < chapters.length - 1 || duration > 0))).map((c) => (
              <button key={c.label} type="button" className="rd-btn is-small" onClick={() => chooseSleep(c.minutes)}>{c.label}</button>
            ))}
          </div>
        )}
        {panel === 'chapters' && (
          <div className="rd-listen-panel">
            {!chapters.length && <p className="rd-hint">This one has no chapters. Add them to skip between its parts.</p>}
            <button type="button" className="rd-btn is-small" disabled={!online} onClick={() => { setPanel(null); setEditing(true); }}><Icon name="pencil" /> {chapters.length ? 'Edit chapters' : 'Add chapters'}</button>
          </div>
        )}
        {panel === 'chapters' && chapters.length > 0 && (
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
        {panel === 'notes' && (
          <section className="rd-listen-notes" aria-label="Timestamped Notes">
            <div className="rd-listen-notes-head">
              <strong>📝 Timestamped Notes</strong>
              <span>{audioNotes.length} {audioNotes.length === 1 ? 'note' : 'notes'}</span>
            </div>
            <form
              className="rd-listen-note-form"
              onSubmit={(e) => { e.preventDefault(); saveAudioNote(); }}
            >
              <textarea
                className="rd-input"
                rows={2}
                placeholder={`Write a note for ${clock(time)}…`}
                aria-label="Timestamped note"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div className="rd-row">
                <span className="rd-grow" />
                <button type="submit" className="rd-btn is-primary is-small" disabled={!noteDraft.trim()}>
                  + Add note at {clock(time)}
                </button>
              </div>
            </form>
            {audioNotes.length === 0 ? (
              <p className="rd-hint">No notes yet. Add one above to jump straight back to any moment.</p>
            ) : (
              <ul className="rd-listen-note-list">
                {audioNotes.map((item) => {
                  const sec = audioTimeSeconds(item.anchor);
                  const isEditing = editingNote?.id === item.id;
                  return (
                    <li key={item.id} className="rd-listen-note-item">
                      <div className="rd-listen-note-meta">
                        <button
                          type="button"
                          className="rd-listen-time-pill"
                          onClick={() => jumpToTimestamp(sec)}
                          title={`Jump to ${clock(sec)} and play`}
                        >
                          ▶ {clock(sec)}
                        </button>
                        {item.anchor.chapter && <span className="rd-listen-note-chap">{item.anchor.chapter}</span>}
                        <span className="rd-grow" />
                        {!isEditing && (
                          <button
                            type="button"
                            className="rd-icon-btn"
                            aria-label="Edit note"
                            onClick={() => setEditingNote({ id: item.id, text: item.text ?? '' })}
                          >
                            <Icon name="pencil" />
                          </button>
                        )}
                        {confirmDeleteId === item.id ? (
                          <button
                            type="button"
                            className="rd-btn is-danger is-small"
                            onClick={() => { remove(item); setConfirmDeleteId(null); }}
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rd-icon-btn"
                            aria-label="Delete note"
                            onClick={() => setConfirmDeleteId(item.id)}
                          >
                            <Icon name="trash" />
                          </button>
                        )}
                      </div>
                      {isEditing ? (
                        <form
                          className="rd-listen-note-edit"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (editingNote.text.trim()) {
                              editNote(item, editingNote.text.trim());
                              setEditingNote(null);
                            }
                          }}
                        >
                          <textarea
                            className="rd-input"
                            rows={2}
                            autoFocus
                            value={editingNote.text}
                            onChange={(e) => setEditingNote({ ...editingNote, text: e.target.value })}
                          />
                          <div className="rd-row">
                            <button type="button" className="rd-btn is-small" onClick={() => setEditingNote(null)}>Cancel</button>
                            <span className="rd-grow" />
                            <button type="submit" className="rd-btn is-primary is-small" disabled={!editingNote.text.trim()}>Save</button>
                          </div>
                        </form>
                      ) : (
                        <p className="rd-listen-note-text">{item.text}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>

      {editing && <ChapterEditor book={book} now={time} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onEdited?.(); }} />}

      {src && (
        <audio ref={audio} src={src} preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (Number.isFinite(el.duration) && el.duration > 0) {
              durationRef.current = el.duration;
              setDuration(el.duration);
            }
            el.playbackRate = speed;
            if (startRef.current !== null) {
              el.currentTime = startRef.current;
              currentTimeRef.current = startRef.current;
              setTime(startRef.current);
              startRef.current = null;
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => { setPlaying(false); void save(true); }}
          onEnded={() => { setPlaying(false); void save(true); }}
          onSeeked={() => void save()}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            currentTimeRef.current = t;
            setTime(t);
            if (Date.now() - lastSave.current > SAVE_EVERY_MS) void save();
            if (sleep) {
              if ('until' in sleep && Date.now() >= sleep.until) {
                e.currentTarget.pause();
                setSleep(null);
              } else if ('chapterIndex' in sleep) {
                const next = chapters[sleep.chapterIndex + 1];
                const dur = durationRef.current || e.currentTarget.duration || 0;
                const target = next ? next.start : (Number.isFinite(dur) && dur > 0 ? dur : 0);
                if (target > 0 && t >= target - 0.5) {
                  e.currentTarget.pause();
                  setSleep(null);
                }
              }
            }
          }}
          onError={() => setProblem(navigator.onLine ? 'This audio wouldn’t play.' : 'No connection, and this one isn’t kept on this device.')} />
      )}
    </div>
  );
}
