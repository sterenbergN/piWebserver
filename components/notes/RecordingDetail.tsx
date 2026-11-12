'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import type { RecordingPage, RecordingRecord } from '@/lib/notes/items';
import { getFile } from './db';
import type { NotebookDoc } from './doc';
import { safeFileName, shareOrSave } from './export';
import { fmtDuration, type Recorder } from './Recorder';
import { fetchFile } from './sync';
import { getTranscript, removeTranscript, startTranscript, summaryPrompt, transcriptText, type TranscriptInfo } from './transcripts';

// One recording: its name, where it was made, and what was said in it. The Pi writes down what
// was said (it takes a while, in the background); a summary comes from copying that into an AI
// and pasting its reply back, the same way the rest of the site uses AI.

const POLL_MS = 4000;

export function RecordingDetail({ doc, notebook, notebookTitle, record, recorder, pages, onGoToPage, onBack, onClose }: {
  doc: NotebookDoc; notebook: string; notebookTitle: string; record: RecordingRecord; recorder: Recorder; pages: (RecordingPage & { number: number })[];
  onGoToPage: (page: string) => void; onBack: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(record.title);
  const [confirming, setConfirming] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(record.title), [record.title]);

  const refresh = useCallback(async () => {
    try {
      const out = await getTranscript(notebook, record.id);
      setTranscript(out.transcript);
      setOffline(!!out.offline);
      setProblem('');
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [notebook, record.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  const running = transcript?.status === 'waiting' || transcript?.status === 'working';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const saveName = () => {
    const title = name.trim();
    if (title && title !== record.title) doc.updateRecording(record, { title });
    else setName(record.title);
  };

  const start = async (again = false) => {
    setBusy(true);
    try {
      setTranscript(await startTranscript(notebook, record.id, again));
      setProblem('');
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const blob = (await getFile(notebook, record.file)) ?? (await fetchFile(notebook, record.file).catch(() => null));
    if (blob) void shareOrSave(new Blob([blob], { type: record.mime }), `${safeFileName(record.title)}.${record.mime.includes('mp4') ? 'm4a' : record.mime.includes('ogg') ? 'ogg' : 'webm'}`);
  };

  const remove = () => {
    doc.deleteRecording(record);
    void removeTranscript(notebook, record.id).catch(() => {});
    onBack();
  };

  const recorded = new Date(record.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <div className="nt-sheet-head">
        <button type="button" className="nt-icon-btn" aria-label="All recordings" onClick={onBack}><Icon name="left" /></button>
        <strong className="nt-grow nt-rec-head">{record.title}</strong>
        <button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="nt-sheet-body">
        <label className="nt-label" htmlFor="nt-rec-name">Name</label>
        <input
          id="nt-rec-name"
          className="nt-input"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setName(record.title); }}
        />
        <p className="nt-hint">{recorded} · {fmtDuration(record.duration)}</p>
        <div className="nt-row is-wrap">
          <button type="button" className="nt-btn is-primary" onClick={() => { void recorder.play(record); onClose(); }}><Icon name="play" /> Play</button>
          <button type="button" className="nt-btn" onClick={() => void share()}><Icon name="share" /> Share</button>
          <span className="nt-grow" />
          {confirming ? (
            <>
              <button type="button" className="nt-btn is-small" onClick={() => setConfirming(false)}>Keep</button>
              <button type="button" className="nt-btn is-small is-danger" onClick={remove}>Delete for good</button>
            </>
          ) : (
            <button type="button" className="nt-icon-btn" aria-label={`Delete ${record.title}`} onClick={() => setConfirming(true)}><Icon name="trash" /></button>
          )}
        </div>

        {pages.length > 0 && (
          <>
            <h3 className="nt-label nt-rec-section">{pages.length === 1 ? 'Written on' : `Written on ${pages.length} pages`}</h3>
            <div className="nt-rec-pages">
              {pages.map((p) => (
                <button
                  type="button"
                  key={p.page}
                  className="nt-chip"
                  aria-label={`Go to page ${p.number} and play from ${fmtDuration(p.at)}`}
                  onClick={() => { onGoToPage(p.page); void recorder.play(record, Math.max(0, Math.min(p.at, record.duration) - 1500)); }}
                >
                  <Icon name="play" /> Page {p.number} <small>{fmtDuration(Math.min(p.at, record.duration))}</small>
                </button>
              ))}
            </div>
            <p className="nt-hint nt-tight">Opens the page and plays from when the writing there began. While it plays, tap any of the writing to hear what was being said as it was written.</p>
          </>
        )}

        <h3 className="nt-label nt-rec-section">What was said</h3>
        {!loaded ? (
          <p className="nt-hint">Asking the Pi…</p>
        ) : !transcript ? (
          <>
            <p className="nt-hint nt-tight">The Pi can listen to this recording and write down what was said, then you can have your AI summarize it. It works in the background, so you can close Notes. A long lecture takes a while.</p>
            <button type="button" className="nt-btn nt-full nt-gap" disabled={busy} onClick={() => void start()}><Icon name="text" /> Turn into text</button>
          </>
        ) : transcript.status === 'waiting' || transcript.status === 'working' ? (
          <Progress transcript={transcript} />
        ) : transcript.status === 'failed' ? (
          <>
            <p className="nt-hint is-error nt-tight">{transcript.problem || 'It couldn’t be turned into text.'}</p>
            <button type="button" className="nt-btn nt-gap" disabled={busy} onClick={() => void start()}>Try again</button>
          </>
        ) : (
          <>
            {offline && <p className="nt-hint nt-tight">The copy kept on this device: the Pi can’t be reached.</p>}
            <Summary doc={doc} record={record} notebookTitle={notebookTitle} transcript={transcript} />
            <Lines transcript={transcript} onPlay={(at) => { void recorder.play(record, Math.max(0, at - 1000)); onClose(); }} onRedo={() => void start(true)} />
          </>
        )}
        {problem && <p className="nt-hint is-error">{problem}</p>}
      </div>
    </>
  );
}

function Progress({ transcript }: { transcript: TranscriptInfo }) {
  const share = transcript.duration ? Math.min(1, transcript.heardTo / transcript.duration) : 0;
  const left = transcript.left !== null ? Math.max(1, Math.round(transcript.left / 60_000)) : null;
  return (
    <div className="nt-gap">
      <progress className="nt-progress" max={1} value={transcript.status === 'waiting' ? undefined : share} aria-label="How far the Pi has got" />
      <p className="nt-hint nt-tight">
        {transcript.status === 'waiting'
          ? 'Waiting its turn on the Pi…'
          : `Listening: ${fmtDuration(transcript.heardTo)} of ${fmtDuration(transcript.duration)}${left !== null ? `, about ${left} min left` : ''}. You can close Notes; it carries on.`}
      </p>
    </div>
  );
}

function Lines({ transcript, onPlay, onRedo }: { transcript: TranscriptInfo; onPlay: (at: number) => void; onRedo: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText(transcript.segments, false));
      setCopied(true);
    } catch { /* The text is on screen to select. */ }
  };
  if (!transcript.segments.length) {
    return (
      <>
        <p className="nt-hint nt-tight">No speech was heard in this recording.</p>
        <button type="button" className="nt-btn is-small nt-gap" onClick={onRedo}>Listen again</button>
      </>
    );
  }
  return (
    <details className="nt-transcript" open>
      <summary>Transcript · {transcript.words.toLocaleString()} words</summary>
      <div className="nt-row">
        <button type="button" className="nt-btn is-small" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy text'}</button>
        <span className="nt-grow" />
        <button type="button" className="nt-btn is-small" onClick={onRedo}>Listen again</button>
      </div>
      <ol className="nt-lines">
        {transcript.segments.map((segment) => (
          <li key={segment.start}>
            <button type="button" className="nt-chip" aria-label={`Play from ${fmtDuration(segment.start)}`} onClick={() => onPlay(segment.start)}>{fmtDuration(segment.start)}</button>
            <p>{segment.text}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Summary({ doc, record, notebookTitle, transcript }: { doc: NotebookDoc; record: RecordingRecord; notebookTitle: string; transcript: TranscriptInfo }) {
  const [editing, setEditing] = useState(!record.summary);
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pasteFailed, setPasteFailed] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  const replyBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (record.summary) setEditing(false); }, [record.summary]);
  if (!transcript.segments.length) return null;

  const prompt = summaryPrompt(record.title, notebookTitle, record.startedAt, transcript.segments);
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      setCopied('failed');
      setTimeout(() => { promptBox.current?.focus(); promptBox.current?.select(); }, 0);
    }
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasteFailed(false);
      if (text) setReply(text);
    } catch {
      setPasteFailed(true);
      replyBox.current?.focus();
    }
  };
  const save = () => {
    const summary = reply.trim();
    if (!summary) return;
    doc.updateRecording(record, { summary });
    setReply('');
    setCopied('idle');
    setEditing(false);
  };

  if (!editing && record.summary) {
    return (
      <section className="nt-summary">
        <div className="nt-row nt-tight-row">
          <strong className="nt-grow">Summary</strong>
          <button type="button" className="nt-btn is-small" onClick={() => void navigator.clipboard.writeText(record.summary!).catch(() => {})}><Icon name="copy" /> Copy</button>
          <button type="button" className="nt-btn is-small" onClick={() => setEditing(true)}>Redo</button>
        </div>
        <div className="nt-summary-text">{record.summary}</div>
      </section>
    );
  }

  return (
    <section className="nt-summary">
      <strong>Summarize it with your AI</strong>
      <ol className="nt-steps">
        <li>
          <button type="button" className={`nt-btn is-small${copied === 'copied' ? '' : ' is-primary'}`} onClick={() => void copyPrompt()}>
            <Icon name={copied === 'copied' ? 'check' : 'copy'} /> {copied === 'copied' ? 'Copied' : 'Copy the prompt'}
          </button>
          <span className="nt-hint nt-inline-hint">It has the whole transcript in it. Paste it into your AI app.</span>
          {copied === 'failed' && <textarea ref={promptBox} className="nt-input nt-gap" readOnly rows={5} value={prompt} aria-label="The prompt to copy" />}
        </li>
        <li>
          <div className="nt-row nt-tight-row">
            <span className="nt-grow">Paste its reply here</span>
            <button type="button" className="nt-btn is-small" onClick={() => void paste()}><Icon name="paste" /> Paste</button>
          </div>
          <textarea ref={replyBox} className="nt-input nt-gap" rows={reply ? 8 : 3} value={reply} placeholder="The AI’s summary" aria-label="The AI’s summary" onChange={(e) => setReply(e.target.value)} />
          {pasteFailed && <p className="nt-hint nt-tight">This browser wants you to paste by hand: hold in the box.</p>}
          <div className="nt-row">
            {record.summary && <button type="button" className="nt-btn is-small" onClick={() => { setEditing(false); setReply(''); }}>Cancel</button>}
            <span className="nt-grow" />
            <button type="button" className="nt-btn is-small is-primary" disabled={!reply.trim()} onClick={save}>Save summary</button>
          </div>
        </li>
      </ol>
    </section>
  );
}
