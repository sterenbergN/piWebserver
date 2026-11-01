'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import type { RecordingRecord, StrokeElement } from '@/lib/notes/items';
import { deleteKv, getFile, getKv, kvKeys, putKv, recordingKey } from './db';
import { newId, type NotebookDoc } from './doc';
import { safeFileName, shareOrSave } from './export';
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

type Started = { id: string; recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; mime: string; saved: number };

export type Recorder = ReturnType<typeof useRecorder>;

export function useRecorder(notebook: string, doc: NotebookDoc, say: (text: string, ms?: number) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState<{ record: RecordingRecord; at: number; paused: boolean } | null>(null);
  const started = useRef<Started | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = useCallback(async (id: string, chunks: Blob[], mime: string, startedAt: number, duration: number) => {
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: mime });
    const file = newFileId();
    await keepNewFile(notebook, file, blob);
    const now = Date.now();
    const title = new Date(startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const record: RecordingRecord = { id: newId(), kind: 'recording', file, startedAt, duration, title, mime, createdAt: now, updatedAt: now };
    doc.saveRecording(record);
    for (const key of await kvKeys(`${recordingKey(notebook, id)}:`)) await deleteKv(key);
  }, [doc, notebook]);

  // Anything left from a recording that never got to stop properly.
  useEffect(() => {
    void (async () => {
      const keys = await kvKeys(`recording:${notebook}:`);
      const ids = new Set(keys.map((key) => key.split(':')[2]));
      for (const id of ids) {
        const meta = await getKv<{ startedAt: number; mime: string; lastAt: number }>(`${recordingKey(notebook, id)}:meta`);
        if (!meta) continue;
        const parts = keys.filter((key) => key.startsWith(`${recordingKey(notebook, id)}:`) && !key.endsWith(':meta')).sort((a, b) => Number(a.split(':')[3]) - Number(b.split(':')[3]));
        const chunks: Blob[] = [];
        for (const key of parts) {
          const chunk = await getKv<ArrayBuffer>(key);
          if (chunk) chunks.push(new Blob([chunk]));
        }
        await finish(id, chunks, meta.mime, meta.startedAt, meta.lastAt - meta.startedAt);
        say('A recording that was cut off has been saved.', 4000);
      }
    })().catch(() => {});
  }, [notebook]);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      say('This browser can’t record sound.', 3000);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      const mime = pickType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const id = newId();
      const state: Started = { id, recorder, stream, chunks: [], startedAt: Date.now(), mime: recorder.mimeType || mime || 'audio/mp4', saved: 0 };
      started.current = state;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        state.chunks.push(event.data);
        const part = state.saved++;
        void event.data.arrayBuffer().then((bytes) => putKv(`${recordingKey(notebook, id)}:${part}`, bytes)).catch(() => {});
        void putKv(`${recordingKey(notebook, id)}:meta`, { startedAt: state.startedAt, mime: state.mime, lastAt: Date.now() }).catch(() => {});
      };
      recorder.start(SLICE_MS);
      setRecording(true);
      setElapsed(0);
      tick.current = setInterval(() => setElapsed(Date.now() - state.startedAt), 500);
    } catch (error) {
      const denied = (error as Error).name === 'NotAllowedError';
      say(denied ? 'Notes isn’t allowed to use the microphone. It can be turned on in Settings.' : 'The microphone wouldn’t start.', 4000);
    }
  }, [notebook, say]);

  const stop = useCallback(async () => {
    const state = started.current;
    if (!state) return;
    started.current = null;
    if (tick.current) clearInterval(tick.current);
    setRecording(false);
    await new Promise<void>((resolve) => {
      state.recorder.onstop = () => resolve();
      try { state.recorder.stop(); } catch { resolve(); }
    });
    for (const track of state.stream.getTracks()) track.stop();
    await finish(state.id, state.chunks, state.mime, state.startedAt, Date.now() - state.startedAt);
    say('Recording saved');
  }, [finish, say]);

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

  return { recording, elapsed, playing, start, stop, play, togglePause, seek, seekToStroke, closePlayer };
}

export function RecordingBar({ recorder, onOpen }: { recorder: Recorder; onOpen: () => void }) {
  const { recording, elapsed, playing } = recorder;
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

export function RecordingsPanel({ doc, notebook, recorder, onClose }: { doc: NotebookDoc; notebook: string; recorder: Recorder; onClose: () => void }) {
  const [, setTick] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => doc.subscribe(() => setTick((t) => t + 1)), [doc]);
  const download = async (record: RecordingRecord) => {
    const blob = (await getFile(notebook, record.file)) ?? (await fetchFile(notebook, record.file).catch(() => null));
    if (blob) void shareOrSave(new Blob([blob], { type: record.mime }), `${safeFileName(record.title)}.${record.mime.includes('mp4') ? 'm4a' : record.mime.includes('ogg') ? 'ogg' : 'webm'}`);
  };
  return (
    <>
      <div className="nt-sheet-head"><strong>Recordings</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="nt-sheet-body">
        {recorder.recording ? (
          <button type="button" className="nt-btn is-danger nt-full" onClick={() => void recorder.stop()}><Icon name="stop" /> Stop recording ({fmtDuration(recorder.elapsed)})</button>
        ) : (
          <button type="button" className="nt-btn is-primary nt-full" onClick={() => { void recorder.start(); onClose(); }}><Icon name="mic" /> Start recording</button>
        )}
        <p className="nt-hint">Record a lecture while you write. Afterwards, play it back and tap anything you wrote to hear what was being said at the time. Keep the app open: an iPad stops recording when you leave it.</p>
        <ul className="nt-recordings">
          {doc.recordings.map((record) => (
            <li key={record.id}>
              <button type="button" className="nt-icon-btn" aria-label={`Play ${record.title}`} onClick={() => { void recorder.play(record); onClose(); }}><Icon name="play" /></button>
              <div className="nt-grow">
                <strong>{record.title}</strong>
                <small>{fmtDuration(record.duration)}</small>
              </div>
              <button type="button" className="nt-icon-btn" aria-label={`Share ${record.title}`} onClick={() => void download(record)}><Icon name="share" /></button>
              {confirming === record.id ? (
                <button type="button" className="nt-btn is-small is-danger" onClick={() => { doc.deleteRecording(record); setConfirming(null); }}>Delete</button>
              ) : (
                <button type="button" className="nt-icon-btn" aria-label={`Delete ${record.title}`} onClick={() => setConfirming(record.id)}><Icon name="trash" /></button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
