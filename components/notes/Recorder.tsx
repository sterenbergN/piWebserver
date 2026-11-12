'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import type { RecordingPage, RecordingRecord, StrokeElement } from '@/lib/notes/items';
import { deleteKv, getFile, getKv, kvKeys, putKv, recordingKey } from './db';
import { newId, type NotebookDoc } from './doc';
import { RecordingDetail } from './RecordingDetail';
import { findPagesForOlder, findRecordingPages, recordingPages } from './recording-pages';
import { listTranscripts, type TranscriptInfo } from './transcripts';
import { fetchFile, keepNewFile, newFileId } from './sync';

// Sound recorded while you write. Ink already knows when it was written, so nothing more is
// needed to link the two: tap a word while listening and it jumps to what was being said then.
// Each few seconds of sound goes straight into the device's database, so if the app is closed
// or the battery dies, the recording up to then is put back together next time.

const SLICE_MS = 4000;
const PREFERRED_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

const pickType = () => (typeof MediaRecorder === 'undefined' ? '' : PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '');

export function fmtDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

type Started = {
  id: string; recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; mime: string; saved: number;
  /** The page open when it started. */
  page?: string;
  /** When each piece of sound arrived, the last few: a page put to sleep gets none. */
  arrivals: number[];
  hiddenAt: number | null;
  /** When the microphone first went quiet on us (a call, Siri, the iPad taking it back). */
  mutedAt: number | null;
  /** Since when the page has been in front, so a pause in sound isn't blamed on being away. */
  shownAt: number;
  cleanup: () => void;
};

/** Away longer than this and the iPad has very likely taken the microphone. */
const AWAY_MS = 3000;
/** No sound for this long while in front means it has stopped, whatever the recorder says. */
const STALLED_MS = SLICE_MS * 3;
const MUTE_GRACE_MS = 1500;

export type Recorder = ReturnType<typeof useRecorder>;

export function useRecorder(notebook: string, doc: NotebookDoc, say: (text: string, ms?: number) => void, currentPage: () => string | undefined = () => undefined) {
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /** A recording that stopped without being asked to: how much was kept. */
  const [cutOff, setCutOff] = useState<{ kept: number } | null>(null);
  const [playing, setPlaying] = useState<{ record: RecordingRecord; at: number; paused: boolean } | null>(null);
  const started = useRef<Started | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = useCallback(async (id: string, chunks: Blob[], mime: string, startedAt: number, duration: number, page?: string) => {
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: mime });
    const file = newFileId();
    await keepNewFile(notebook, file, blob);
    const now = Date.now();
    const title = new Date(startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    // The pages written on meanwhile, once the last strokes are put away.
    await doc.settled();
    const pages = await findRecordingPages(notebook, { startedAt, duration }).catch(() => []);
    const record: RecordingRecord = { id: newId(), kind: 'recording', file, startedAt, duration, title, mime, createdAt: now, updatedAt: now, ...(page ? { page } : {}), pages };
    doc.saveRecording(record);
    for (const key of await kvKeys(`${recordingKey(notebook, id)}:`)) await deleteKv(key);
  }, [doc, notebook]);

  // Anything left from a recording that never got to stop properly.
  useEffect(() => {
    void (async () => {
      const keys = await kvKeys(`recording:${notebook}:`);
      const ids = new Set(keys.map((key) => key.split(':')[2]));
      for (const id of ids) {
        const meta = await getKv<{ startedAt: number; mime: string; lastAt: number; page?: string }>(`${recordingKey(notebook, id)}:meta`);
        if (!meta) continue;
        const parts = keys.filter((key) => key.startsWith(`${recordingKey(notebook, id)}:`) && !key.endsWith(':meta')).sort((a, b) => Number(a.split(':')[3]) - Number(b.split(':')[3]));
        const chunks: Blob[] = [];
        for (const key of parts) {
          const chunk = await getKv<ArrayBuffer>(key);
          if (chunk) chunks.push(new Blob([chunk]));
        }
        await finish(id, chunks, meta.mime, meta.startedAt, meta.lastAt - meta.startedAt, meta.page);
        say('A recording that was cut off has been saved.', 4000);
      }
    })().catch(() => {});
  }, [notebook]);

  /**
   * End a recording and keep it. `endAt` is when the sound really stopped, which is earlier
   * than now when the iPad took the microphone: its length has to match the sound, or tapping
   * ink after that point would jump to the wrong moment.
   */
  const end = useCallback(async (state: Started, endAt: number, how: 'asked' | 'cut') => {
    if (started.current !== state) return;
    started.current = null;
    state.cleanup();
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    setRecording(false);
    await new Promise<void>((resolve) => {
      state.recorder.onstop = () => resolve();
      state.recorder.onerror = () => resolve();
      if (state.recorder.state === 'inactive') resolve();
      else try { state.recorder.stop(); } catch { resolve(); }
    });
    for (const track of state.stream.getTracks()) track.stop();
    const kept = Math.max(0, endAt - state.startedAt);
    await finish(state.id, state.chunks, state.mime, state.startedAt, kept, state.page);
    if (how === 'asked') say('Recording saved');
    else setCutOff({ kept: state.chunks.length ? kept : 0 });
  }, [finish, say]);

  /** Whether the microphone is still really recording, and if not, when it stopped. */
  const check = useCallback((state: Started) => {
    const now = Date.now();
    const track = state.stream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended' || state.recorder.state === 'inactive') return state.hiddenAt ?? state.mutedAt ?? (state.arrivals.at(-1) ?? now);
    // A blink of quiet is fine (the recording carries on through it); longer is a real gap.
    if (state.mutedAt !== null && now - state.mutedAt > MUTE_GRACE_MS) return state.mutedAt;
    // Only once sound has come in pieces at all: a browser that keeps it all to the end can't be judged by this.
    const last = state.arrivals.at(-1);
    if (last !== undefined && document.visibilityState === 'visible' && now - Math.max(last, state.shownAt) > STALLED_MS) return last;
    return null;
  }, []);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      say('This browser can’t record sound.', 3000);
      return;
    }
    if (started.current) return;
    setCutOff(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      const mime = pickType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const id = newId();
      const now = Date.now();
      const state: Started = {
        id, recorder, stream, chunks: [], startedAt: now, mime: recorder.mimeType || mime || 'audio/mp4', saved: 0, page: pageRef.current(),
        arrivals: [], hiddenAt: null, mutedAt: null, shownAt: now, cleanup: () => {},
      };
      started.current = state;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        state.arrivals = [...state.arrivals.slice(-15), Date.now()];
        state.chunks.push(event.data);
        const part = state.saved++;
        void event.data.arrayBuffer().then((bytes) => putKv(`${recordingKey(notebook, id)}:${part}`, bytes)).catch(() => {});
        void putKv(`${recordingKey(notebook, id)}:meta`, { startedAt: state.startedAt, mime: state.mime, lastAt: Date.now(), page: state.page }).catch(() => {});
      };

      // An iPad takes the microphone back when Notes goes to the background or the screen locks,
      // without always saying so: the recorder can still claim to be recording. So whenever the
      // page comes back, look at whether sound kept coming while it was away.
      const track = stream.getAudioTracks()[0];
      const cut = (at: number) => void end(state, at, 'cut');
      const onEnded = () => cut(state.hiddenAt ?? Date.now());
      const onMute = () => { state.mutedAt ??= Date.now(); };
      const onUnmute = () => {
        if (state.mutedAt !== null && state.hiddenAt === null && Date.now() - state.mutedAt <= MUTE_GRACE_MS) state.mutedAt = null;
      };
      const onStopped = () => cut(state.hiddenAt ?? state.arrivals.at(-1) ?? Date.now());
      const onBack = () => {
        const now = Date.now();
        const away = state.hiddenAt;
        state.hiddenAt = null;
        state.shownAt = now;
        if (away !== null && now - away > AWAY_MS && state.arrivals.length) {
          // Sound that came while away, not in the rush of what was held up until now.
          const whileAway = state.arrivals.filter((t) => t > away + 500 && t < now - 500).length;
          if (!whileAway) { cut(away); return; }
        }
        const stoppedAt = check(state);
        if (stoppedAt !== null) cut(stoppedAt);
      };
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') state.hiddenAt ??= Date.now();
        else onBack();
      };
      const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) onBack(); };
      track?.addEventListener('ended', onEnded);
      track?.addEventListener('mute', onMute);
      track?.addEventListener('unmute', onUnmute);
      recorder.addEventListener('stop', onStopped);
      recorder.addEventListener('error', onStopped);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', onPageShow);
      state.cleanup = () => {
        track?.removeEventListener('ended', onEnded);
        track?.removeEventListener('mute', onMute);
        track?.removeEventListener('unmute', onUnmute);
        recorder.removeEventListener('stop', onStopped);
        recorder.removeEventListener('error', onStopped);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', onPageShow);
      };

      recorder.start(SLICE_MS);
      setRecording(true);
      setElapsed(0);
      tick.current = setInterval(() => {
        setElapsed(Date.now() - state.startedAt);
        if (document.visibilityState !== 'visible') return;
        const stoppedAt = check(state);
        if (stoppedAt !== null) cut(stoppedAt);
      }, 500);
    } catch (error) {
      started.current = null;
      const denied = (error as Error).name === 'NotAllowedError';
      say(denied ? 'Notes isn’t allowed to use the microphone. It can be turned on in Settings.' : 'The microphone wouldn’t start.', 4000);
    }
  }, [check, end, notebook, say]);

  const stop = useCallback(async () => {
    const state = started.current;
    if (state) await end(state, Date.now(), 'asked');
  }, [end]);

  const dismissCutOff = useCallback(() => setCutOff(null), []);

  const closePlayer = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlaying(null);
  }, []);

  const play = useCallback(async (record: RecordingRecord, at = 0) => {
    closePlayer();
    const blob = (await getFile(notebook, record.file)) ?? (await fetchFile(notebook, record.file).catch(() => null));
    if (!blob) {
      say('This recording isn’t on this device yet.', 3000);
      return;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: record.mime || blob.type }));
    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.currentTime = at / 1000;
    const update = () => setPlaying({ record, at: audio.currentTime * 1000, paused: audio.paused });
    audio.addEventListener('timeupdate', update);
    audio.addEventListener('pause', update);
    audio.addEventListener('play', update);
    audio.addEventListener('ended', update);
    setPlaying({ record, at, paused: false });
    await audio.play().catch(() => setPlaying({ record, at, paused: true }));
  }, [closePlayer, notebook, say]);

  const togglePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Math.max(0, ms / 1000);
  }, []);

  /** Tapped a stroke while listening: go to when it was written, with a moment to catch the sentence. */
  const seekToStroke = (stroke: StrokeElement) => {
    if (!playing) return;
    const at = stroke.createdAt - playing.record.startedAt;
    if (at >= 0 && at <= playing.record.duration + 2000) seek(at - 1500);
  };

  useEffect(() => () => {
    closePlayer();
    if (started.current) void stop();
    if (tick.current) clearInterval(tick.current);
    // Leaving the notebook ends whatever's going.
  }, []);

  return { recording, elapsed, cutOff, playing, start, stop, dismissCutOff, play, togglePause, seek, seekToStroke, closePlayer };
}

export function RecordingBar({ recorder, onOpen }: { recorder: Recorder; onOpen: () => void }) {
  const { recording, elapsed, cutOff, playing } = recorder;
  if (cutOff && !recording) {
    return (
      <div className="nt-player is-cut" role="alert">
        <button type="button" className="nt-player-time" onClick={onOpen}>
          {cutOff.kept ? `Recording stopped while Notes was in the background. The first ${fmtDuration(cutOff.kept)} is saved.` : 'Recording stopped while Notes was in the background.'}
        </button>
        <button type="button" className="nt-btn is-small" onClick={() => void recorder.start()}><Icon name="mic" /> Record again</button>
        <button type="button" className="nt-icon-btn is-small" aria-label="Dismiss" onClick={recorder.dismissCutOff}><Icon name="x" /></button>
      </div>
    );
  }
  if (recording) {
    return (
      <div className="nt-player is-recording" role="status">
        <i className="nt-rec-dot" />
        <button type="button" className="nt-player-time" onClick={onOpen}>Recording {fmtDuration(elapsed)}</button>
        <button type="button" className="nt-btn is-small" onClick={() => void recorder.stop()}><Icon name="stop" /> Stop</button>
      </div>
    );
  }
  if (!playing) return null;
  const { record, at, paused } = playing;
  return (
    <div className="nt-player">
      <button type="button" className="nt-icon-btn is-small" aria-label={paused ? 'Play' : 'Pause'} onClick={recorder.togglePause}><Icon name={paused ? 'play' : 'pause'} /></button>
      <button type="button" className="nt-btn is-small" aria-label="Back 15 seconds" onClick={() => recorder.seek(at - 15000)}>−15</button>
      <input type="range" className="nt-player-slider" aria-label="Move through the recording" min={0} max={Math.max(1, record.duration)} value={Math.min(at, record.duration)} onChange={(e) => recorder.seek(Number(e.target.value))} />
      <span className="nt-player-time">{fmtDuration(at)} / {fmtDuration(record.duration)}</span>
      <button type="button" className="nt-btn is-small" aria-label="Forward 15 seconds" onClick={() => recorder.seek(at + 15000)}>+15</button>
      <button type="button" className="nt-icon-btn is-small" aria-label="Close the player" onClick={recorder.closePlayer}><Icon name="x" /></button>
    </div>
  );
}

const dayLabel = (at: number) => {
  const day = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (day.toDateString() === today.toDateString()) return 'Today';
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};

export function RecordingsPanel({ doc, notebook, title, recorder, currentPage, onGoToPage, onClose }: {
  doc: NotebookDoc; notebook: string; title: string; recorder: Recorder; currentPage?: string; onGoToPage: (page: string) => void; onClose: () => void;
}) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyHere, setOnlyHere] = useState(false);
  const [texts, setTexts] = useState<Record<string, TranscriptInfo>>({});
  const [found, setFound] = useState<Record<string, RecordingPage[]>>({});
  useEffect(() => doc.subscribe(() => setTick((t) => t + 1)), [doc]);
  const count = doc.recordings.length;
  useEffect(() => {
    let live = true;
    void findPagesForOlder(notebook, doc.recordings).then((pages) => { if (live) setFound(pages); }).catch(() => {});
    return () => { live = false; };
  }, [doc, notebook, count]);
  const pagesOf = (record: RecordingRecord) => recordingPages(record, found[record.id]);
  useEffect(() => {
    let live = true;
    void listTranscripts(notebook).then((items) => { if (live) setTexts(items); }).catch(() => {});
    return () => { live = false; };
  }, [notebook, open]);

  const opened = open ? doc.recordings.find((r) => r.id === open) : undefined;
  if (opened) {
    return (
      <RecordingDetail
        doc={doc}
        notebook={notebook}
        notebookTitle={title}
        record={opened}
        recorder={recorder}
        pages={numbered(doc, pagesOf(opened))}
        onGoToPage={onGoToPage}
        onBack={() => setOpen(null)}
        onClose={onClose}
      />
    );
  }

  const isHere = (record: RecordingRecord) => !!currentPage && pagesOf(record).some((p) => p.page === currentPage);
  const hereCount = doc.recordings.filter(isHere).length;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = [...doc.recordings]
    .filter((r) => !onlyHere || isHere(r))
    .filter((r) => {
      if (!words.length) return true;
      const hay = `${r.title} ${r.summary ?? ''} ${dayLabel(r.startedAt)}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    })
    .sort((a, b) => b.startedAt - a.startedAt);
  const groups: { label: string; items: RecordingRecord[] }[] = [];
  for (const record of shown) {
    const label = dayLabel(record.startedAt);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(record);
    else groups.push({ label, items: [record] });
  }

  return (
    <>
      <div className="nt-sheet-head"><strong>Recordings</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="nt-sheet-body">
        {recorder.recording ? (
          <button type="button" className="nt-btn is-danger nt-full" onClick={() => void recorder.stop()}><Icon name="stop" /> Stop recording ({fmtDuration(recorder.elapsed)})</button>
        ) : (
          <button type="button" className="nt-btn is-primary nt-full" onClick={() => { void recorder.start(); onClose(); }}><Icon name="mic" /> Start recording</button>
        )}
        <p className="nt-hint">Record a lecture while you write. Afterwards, play it back and tap anything you wrote to hear what was being said at the time. Keep Notes open: an iPad stops recording when you leave it or lock the screen.</p>
        {doc.recordings.length > 0 && (
          <>
            {doc.recordings.length > 4 && (
              <input type="search" className="nt-input nt-gap" placeholder="Find a recording by name or summary" aria-label="Find a recording" value={query} onChange={(e) => setQuery(e.target.value)} />
            )}
            {hereCount > 0 && hereCount < doc.recordings.length && (
              <div className="nt-tabs is-small nt-gap" role="tablist">
                <button type="button" role="tab" aria-selected={!onlyHere} className={onlyHere ? '' : 'is-on'} onClick={() => setOnlyHere(false)}>All ({doc.recordings.length})</button>
                <button type="button" role="tab" aria-selected={onlyHere} className={onlyHere ? 'is-on' : ''} onClick={() => setOnlyHere(true)}>This page ({hereCount})</button>
              </div>
            )}
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className="nt-label nt-rec-day">{group.label}</h3>
                <ul className="nt-recordings">
                  {group.items.map((record) => {
                    const text = texts[record.id];
                    const pages = numbered(doc, pagesOf(record)).map((p) => p.number).sort((a, b) => a - b);
                    return (
                      <li key={record.id}>
                        <button type="button" className="nt-icon-btn" aria-label={`Play ${record.title}`} onClick={() => { void recorder.play(record); onClose(); }}><Icon name="play" /></button>
                        <button type="button" className="nt-rec-open" onClick={() => setOpen(record.id)}>
                          <strong>{record.title}</strong>
                          <small>
                            {new Date(record.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {fmtDuration(record.duration)}
                            {pages.length ? ` · ${pageList(pages)}` : ''}
                            {record.summary ? ' · summary' : text?.status === 'done' ? ' · text' : text?.status === 'working' || text?.status === 'waiting' ? ' · turning into text…' : ''}
                          </small>
                        </button>
                        <button type="button" className="nt-icon-btn" aria-label={`Open ${record.title}`} onClick={() => setOpen(record.id)}><Icon name="chevron" /></button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {!shown.length && <p className="nt-hint">No recording matches that.</p>}
          </>
        )}
      </div>
    </>
  );
}

/** Pages with their numbers in the notebook as it is now, leaving out any since deleted. */
function numbered(doc: NotebookDoc, pages: RecordingPage[]) {
  const index = new Map(doc.pages.map((p, i) => [p.id, i + 1]));
  return pages.flatMap((p) => (index.has(p.page) ? [{ ...p, number: index.get(p.page)! }] : []));
}

/** "page 3", "pages 3, 4, 7", or "pages 3, 4, 7 and 5 more". */
function pageList(numbers: number[]) {
  if (numbers.length === 1) return `page ${numbers[0]}`;
  const shown = numbers.slice(0, 4).join(', ');
  return numbers.length > 4 ? `pages ${shown} and ${numbers.length - 4} more` : `pages ${shown}`;
}
