'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GenerateReply from '@/components/ai/GenerateReply';
import { Icon } from '@/components/study/Icon';
import { isDark, type RecordingPage, type RecordingRecord } from '@/lib/notes/items';
import {
  countSummaryTimestamps,
  formatSummaryForNotebookPage,
  parseRecordingSummary,
  slugifyNotebookTag,
  tokenizeInlineTimestamps,
  type SummaryTimestamp,
} from '@/lib/notes/recording-summary';
import { getFile } from './db';
import type { NotebookDoc } from './doc';
import { safeFileName, shareOrSave } from './export';
import { elementBox, TEXT_LINE_HEIGHT, textHeight } from './ink';
import { fmtDuration, type Recorder } from './Recorder';
import { fetchFile, sendAgain, syncNow } from './sync';
import { getTranscript, removeTranscript, startTranscript, summaryPrompt, transcriptText, type TranscriptInfo } from './transcripts';

// One recording: its name, where it was made, and what was said in it. The Pi writes down what
// was said (it starts as soon as the sound reaches it, and the text shows as it's heard); a
// summary comes from copying that into an AI and pasting its reply back, the same way the rest
// of the site uses AI.

const POLL_MS = 4000;

export function RecordingDetail({
  doc,
  notebook,
  notebookTitle,
  record,
  recorder,
  pages,
  currentPage,
  onGoToPage,
  onBack,
  onClose,
}: {
  doc: NotebookDoc;
  notebook: string;
  notebookTitle: string;
  record: RecordingRecord;
  recorder: Recorder;
  pages: (RecordingPage & { number: number })[];
  currentPage?: string;
  onGoToPage: (page: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(record.title);
  const [confirming, setConfirming] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  /** Whether the Pi has this recording's sound, and if not, whether this device does (so it can send it). */
  const [onPi, setOnPi] = useState(true);
  const [heldHere, setHeldHere] = useState<boolean | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(record.title), [record.title]);

  const refresh = useCallback(async () => {
    try {
      const out = await getTranscript(notebook, record.id);
      setTranscript(out.transcript);
      setOffline(!!out.offline);
      setOnPi(out.onPi !== false);
      setProblem('');
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [notebook, record.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  const running = transcript?.status === 'waiting' || transcript?.status === 'working';
  // The sound isn't on the Pi. If it's on this device, send it now, and keep looking until it's there.
  const sending = loaded && !onPi && !transcript;
  useEffect(() => {
    if (!sending) return;
    let live = true;
    void getFile(notebook, record.file).then(async (blob) => {
      if (!live) return;
      setHeldHere(!!blob);
      if (blob) { await sendAgain(notebook, [record.file]); void syncNow(); }
    }).catch(() => { if (live) setHeldHere(false); });
    return () => { live = false; };
  }, [sending, notebook, record.file]);
  useEffect(() => {
    if (!running && !(sending && heldHere)) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, sending, heldHere, refresh]);

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

  const playAt = useCallback((ms: number) => {
    const clamped = record.duration > 0
      ? Math.max(0, Math.min(ms, record.duration))
      : Math.max(0, ms);
    const liveIds = new Set(doc.pages.map((p) => p.id));
    const timedPages = (record.pages?.length ? record.pages : pages)
      .filter((p) => liveIds.has(p.page))
      .slice()
      .sort((a, b) => a.at - b.at);

    let targetPage: string | undefined;
    for (const p of timedPages) {
      if (p.at <= clamped + 1500) targetPage = p.page;
    }
    if (!targetPage) {
      if (record.page && liveIds.has(record.page)) targetPage = record.page;
      else targetPage = pages.find((p) => liveIds.has(p.page))?.page;
    }
    if (targetPage) onGoToPage(targetPage);
    void recorder.play(record, clamped);
    onClose();
  }, [doc.pages, onClose, onGoToPage, pages, record, recorder]);

  const recorded = new Date(record.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const hasTranscriptSegments = transcript?.status === 'done' && transcript.segments.length > 0;

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
                  onClick={() => { onGoToPage(p.page); void recorder.play(record, Math.max(0, Math.min(p.at, record.duration) - 1500)); onClose(); }}
                >
                  <Icon name="play" /> Page {p.number} <small>{fmtDuration(Math.min(p.at, record.duration))}</small>
                </button>
              ))}
            </div>
            <p className="nt-hint nt-tight">Opens the page and plays from when the writing there began. While it plays, tap any of the writing to hear what was being said as it was written.</p>
          </>
        )}

        <h3 className="nt-label nt-rec-section">What was said</h3>
        {!hasTranscriptSegments && record.summary && (
          <Summary
            key={record.id}
            doc={doc}
            record={record}
            notebookTitle={notebookTitle}
            transcript={null}
            pages={pages}
            currentPage={currentPage}
            onPlayAt={playAt}
          />
        )}
        {!loaded ? (
          <p className="nt-hint">Asking the Pi…</p>
        ) : !transcript && !onPi ? (
          <p className="nt-hint nt-tight">
            {heldHere === null ? 'Looking for its sound…'
              : heldHere ? 'The sound is on this device and hasn’t reached the Pi yet. Sending it now: keep Notes open until this changes, then it’s turned into text by itself.'
              : 'The sound for this recording hasn’t reached the Pi. It’s still on the device that recorded it: open Notes there with a connection and keep it open for a minute, and it will come across.'}
          </p>
        ) : !transcript ? (
          <>
            <p className="nt-hint nt-tight">The Pi can listen to this recording and write down what was said, then you can have your AI summarize it. It works in the background, so you can close Notes. A long lecture takes a while.</p>
            <button type="button" className="nt-btn nt-full nt-gap" disabled={busy} onClick={() => void start()}><Icon name="text" /> Turn into text</button>
          </>
        ) : transcript.status === 'waiting' || transcript.status === 'working' ? (
          <>
            <Progress transcript={transcript} />
            {transcript.segments.length > 0 && <Lines transcript={transcript} partial onPlay={(at) => playAt(Math.max(0, at - 1000))} onRedo={() => {}} />}
          </>
        ) : transcript.status === 'failed' ? (
          <>
            <p className="nt-hint is-error nt-tight">{transcript.problem || 'It couldn’t be turned into text.'}</p>
            <button type="button" className="nt-btn nt-gap" disabled={busy} onClick={() => void start()}>Try again</button>
          </>
        ) : (
          <>
            {offline && <p className="nt-hint nt-tight">The copy kept on this device: the Pi can’t be reached.</p>}
            <Summary
              key={record.id}
              doc={doc}
              record={record}
              notebookTitle={notebookTitle}
              transcript={transcript}
              pages={pages}
              currentPage={currentPage}
              onPlayAt={playAt}
            />
            <Lines transcript={transcript} onPlay={(at) => playAt(Math.max(0, at - 1000))} onRedo={() => void start(true)} />
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

function Lines({ transcript, partial, onPlay, onRedo }: { transcript: TranscriptInfo; partial?: boolean; onPlay: (at: number) => void; onRedo: () => void }) {
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
      <summary>{partial ? 'What it has heard so far' : 'Transcript'} · {transcript.words.toLocaleString()} words</summary>
      <div className="nt-row">
        <button type="button" className="nt-btn is-small" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy text'}</button>
        <span className="nt-grow" />
        {!partial && <button type="button" className="nt-btn is-small" onClick={onRedo}>Listen again</button>}
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

function TimeChip({ ts, onPlay }: { ts: SummaryTimestamp; onPlay: (ms: number) => void }) {
  return (
    <button
      type="button"
      className="nt-time-chip"
      aria-label={`Play from ${ts.label}`}
      onClick={() => onPlay(ts.ms)}
    >
      <Icon name="play" size="0.78em" />
      <span>{ts.label}</span>
    </button>
  );
}

function RichSummaryText({
  text,
  onPlay,
  skipLeadingSeconds,
}: {
  text: string;
  onPlay: (ms: number) => void;
  skipLeadingSeconds?: number;
}) {
  const tokens = useMemo(() => tokenizeInlineTimestamps(text), [text]);
  if (!tokens.length) return null;

  let startIdx = 0;
  if (
    skipLeadingSeconds !== undefined &&
    tokens[0]?.type === 'time' &&
    tokens[0].ts.seconds === skipLeadingSeconds
  ) {
    startIdx = 1;
  }

  return (
    <>
      {tokens.slice(startIdx).map((token, idx) => {
        if (token.type === 'time') {
          return <TimeChip key={`t-${idx}-${token.ts.seconds}`} ts={token.ts} onPlay={onPlay} />;
        }
        const chunk = idx === 0 && startIdx === 1 ? token.text.replace(/^\s*[-–—:]?\s*/, '') : token.text;
        return chunk ? <span key={`s-${idx}`}>{chunk}</span> : null;
      })}
    </>
  );
}

const hasInlineTime = (text: string, ts?: SummaryTimestamp) =>
  !!ts && tokenizeInlineTimestamps(text).some((tok) => tok.type === 'time' && tok.ts.seconds === ts.seconds);

function Summary({
  doc,
  record,
  notebookTitle,
  transcript,
  pages,
  currentPage,
  onPlayAt,
}: {
  doc: NotebookDoc;
  record: RecordingRecord;
  notebookTitle: string;
  transcript: TranscriptInfo | null;
  pages: (RecordingPage & { number: number })[];
  currentPage?: string;
  onPlayAt: (ms: number) => void;
}) {
  const canEdit = !!transcript && transcript.segments.length > 0;
  const [editing, setEditing] = useState(!record.summary);
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [openQAs, setOpenQAs] = useState<Record<number, boolean>>({});
  const [inserting, setInserting] = useState(false);
  const [pageNotice, setPageNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendingSkills, setSendingSkills] = useState(false);
  const [skillsSentFor, setSkillsSentFor] = useState<string | null>(null);
  const [skillsNotice, setSkillsNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const promptBox = useRef<HTMLTextAreaElement>(null);
  const replyBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (record.summary) setEditing(false);
  }, [record.summary]);

  const parsed = useMemo(
    () => (record.summary ? parseRecordingSummary(record.summary) : null),
    [record.summary],
  );
  const preview = useMemo(
    () => (reply.trim() ? parseRecordingSummary(reply) : null),
    [reply],
  );
  const previewTimestamps = useMemo(
    () => (preview ? countSummaryTimestamps(preview) : 0),
    [preview],
  );

  if (!canEdit && !record.summary) return null;

  const prompt = canEdit
    ? summaryPrompt(record.title, notebookTitle, record.startedAt, transcript.segments)
    : '';

  const copyPrompt = async () => {
    if (!prompt) return;
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
    setOpenQAs({});
    setPageNotice(null);
    setSkillsNotice(null);
    setSkillsSentFor(null);
    setEditing(false);
  };

  const copySummaryText = async () => {
    if (!record.summary || !parsed) return;
    const text = parsed.format === 'strict'
      ? formatSummaryForNotebookPage(record.title, parsed)
      : record.summary;
    try {
      await navigator.clipboard.writeText(text || record.summary);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 1800);
    } catch { /* User can select text directly. */ }
  };

  const targetPageId =
    (currentPage && doc.pages.some((p) => p.id === currentPage) ? currentPage : undefined)
    ?? pages.find((p) => doc.pages.some((dp) => dp.id === p.page))?.page
    ?? (record.page && doc.pages.some((p) => p.id === record.page) ? record.page : undefined)
    ?? doc.pages[0]?.id;

  const insertOnPage = async () => {
    if (!parsed || !targetPageId || inserting) return;
    setInserting(true);
    setPageNotice(null);
    try {
      const formatted = formatSummaryForNotebookPage(record.title, parsed).trim();
      const text = formatted || record.summary?.trim() || '';
      if (!text) return;

      await doc.ensure(targetPageId);
      const page = doc.pages.find((p) => p.id === targetPageId);
      const pageW = page?.w ?? 612;
      const pageH = page?.h ?? 792;
      const margin = Math.min(40, Math.round(pageW * 0.08));
      const boxW = Math.max(180, pageW - margin * 2);
      const size = 11;
      const font = 'sans' as const;
      const color = page && isDark(page.paper) ? '#f4f3ef' : '#1d1f27';
      const h = Math.max(size * TEXT_LINE_HEIGHT, textHeight({ text, w: boxW, size, font }));

      const existing = doc.elementsOf(targetPageId).filter((el) => !el.deleted);
      const maxBottom = existing.reduce((max, el) => {
        const b = elementBox(el);
        return Math.max(max, b.y + b.h);
      }, 0);
      const maxY = Math.max(margin, pageH - margin - Math.min(h, pageH - margin * 2));
      const y = existing.length === 0 ? margin : maxBottom + 16 <= maxY ? maxBottom + 16 : margin;

      await doc.addText(targetPageId, {
        x: margin,
        y,
        w: boxW,
        h,
        rot: 0,
        text,
        size,
        color,
        font,
      });

      const pageNumber = doc.pages.findIndex((p) => p.id === targetPageId) + 1;
      setPageNotice({ ok: true, text: `Added summary to Page ${Math.max(1, pageNumber)}.` });
    } catch (error) {
      setPageNotice({
        ok: false,
        text: error instanceof Error ? error.message : 'Couldn’t add the summary to the page.',
      });
    } finally {
      setInserting(false);
    }
  };

  const skillsEntries = useMemo(() => {
    if (!parsed) return [];
    const list: { question: string; answer: string; context: string }[] = [];
    const seen = new Set<string>();
    const addEntry = (question: string, answer: string, timeLabel?: string) => {
      const q = question.trim();
      const a = answer.trim();
      if (!q || !a) return;
      const key = q.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        question: q,
        answer: a,
        context: `Recording "${record.title}" in "${notebookTitle}"${timeLabel ? ` (${timeLabel})` : ''}`,
      });
    };
    for (const t of parsed.terms) {
      addEntry(t.term, t.definition || t.term, t.time?.label);
    }
    for (const qa of parsed.questions) {
      addEntry(qa.question, qa.answer || 'Review from recording summary.', qa.time?.label);
    }
    return list;
  }, [notebookTitle, parsed, record.title]);

  const sendToSkills = async () => {
    if (!skillsEntries.length || sendingSkills) return;
    setSendingSkills(true);
    setSkillsNotice(null);
    const notebookSlug = slugifyNotebookTag(notebookTitle);
    const tags = notebookSlug ? ['notes-recording', notebookSlug] : ['notes-recording'];
    let sent = 0;

    try {
      for (const entry of skillsEntries) {
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add-inquiry',
            question: entry.question,
            answer: entry.answer,
            context: entry.context,
            status: 'solved',
            tags,
          }),
        });
        const body = await res.json().catch(() => ({})) as { success?: boolean; message?: string };
        if (res.status === 401) {
          setSkillsNotice({
            ok: false,
            text: sent > 0
              ? `Saved ${sent} item${sent === 1 ? '' : 's'} before your session ended. Sign in to send the rest to Skills.`
              : 'Sign in to save terms and Q&As to your Skills Knowledge Base.',
          });
          return;
        }
        if (!res.ok || !body.success) {
          throw new Error(body.message || 'Couldn’t save to Skills.');
        }
        sent += 1;
      }
      setSkillsSentFor(record.summary ?? '');
      setSkillsNotice({
        ok: true,
        text: `Sent ${sent} item${sent === 1 ? '' : 's'} to your Skills Knowledge Base.`,
      });
    } catch (error) {
      setSkillsNotice({
        ok: false,
        text: sent > 0
          ? `Sent ${sent} of ${skillsEntries.length} before an error: ${error instanceof Error ? error.message : 'Couldn’t reach Skills.'}`
          : error instanceof Error ? error.message : 'Couldn’t reach the Pi to save to Skills.',
      });
    } finally {
      setSendingSkills(false);
    }
  };

  if ((!editing || !canEdit) && record.summary && parsed) {
    const alreadySentSkills = skillsSentFor === record.summary;
    const hasSkillsButton = skillsEntries.length > 0;

    const skillsButtonBlock = hasSkillsButton && (
      <div className="nt-summary-skills-bar">
        <button
          type="button"
          className="nt-btn is-small"
          disabled={sendingSkills || alreadySentSkills}
          onClick={() => void sendToSkills()}
        >
          <Icon name={alreadySentSkills ? 'check' : 'book'} />{' '}
          {sendingSkills
            ? 'Sending…'
            : alreadySentSkills
              ? `Sent ${skillsEntries.length} to Skills`
              : 'Send to Skills Knowledge Base'}
        </button>
        {skillsNotice && (
          <p className={`nt-summary-notice${skillsNotice.ok ? ' is-ok' : ' is-error'}`} role="status">
            {skillsNotice.text}
          </p>
        )}
      </div>
    );

    return (
      <section className="nt-summary">
        <div className="nt-summary-header">
          <strong className="nt-grow">Summary</strong>
          <div className="nt-summary-actions">
            {targetPageId && (
              <button
                type="button"
                className="nt-btn is-small is-primary"
                disabled={inserting}
                onClick={() => void insertOnPage()}
              >
                <Icon name="note" /> {inserting ? 'Adding…' : 'Insert on Page'}
              </button>
            )}
            <button type="button" className="nt-btn is-small" onClick={() => void copySummaryText()}>
              <Icon name={copiedSummary ? 'check' : 'copy'} /> {copiedSummary ? 'Copied' : 'Copy'}
            </button>
            {canEdit && (
              <button type="button" className="nt-btn is-small" onClick={() => setEditing(true)}>Redo</button>
            )}
          </div>
        </div>

        {pageNotice && (
          <p className={`nt-summary-notice${pageNotice.ok ? ' is-ok' : ' is-error'}`} role="status">
            {pageNotice.text}
          </p>
        )}

        {parsed.overview && (
          <div className="nt-summary-block">
            <h4 className="nt-summary-heading">Overview</h4>
            <p className="nt-summary-overview">
              <RichSummaryText text={parsed.overview} onPlay={onPlayAt} />
            </p>
          </div>
        )}

        {parsed.chapters.length > 0 && (
          <div className="nt-summary-block">
            <h4 className="nt-summary-heading">Chapters Timeline</h4>
            <ol className="nt-chapters">
              {parsed.chapters.map((ch, i) => (
                <li key={`${ch.time.seconds}-${i}`} className="nt-chapter-item">
                  <div className="nt-chapter-head">
                    <TimeChip ts={ch.time} onPlay={onPlayAt} />
                    <strong>{ch.title}</strong>
                  </div>
                  {ch.summary && (
                    <p className="nt-chapter-desc">
                      <RichSummaryText text={ch.summary} onPlay={onPlayAt} skipLeadingSeconds={ch.time.seconds} />
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {parsed.keyPoints.length > 0 && (
          <div className="nt-summary-block">
            <h4 className="nt-summary-heading">Key Points</h4>
            <ul className="nt-key-points">
              {parsed.keyPoints.map((kp, i) => (
                <li key={i} className="nt-key-point">
                  {kp.time && <TimeChip ts={kp.time} onPlay={onPlayAt} />}
                  <span className="nt-grow">
                    <RichSummaryText text={kp.text} onPlay={onPlayAt} skipLeadingSeconds={kp.time?.seconds} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {parsed.terms.length > 0 && (
          <div className="nt-summary-block">
            <div className="nt-summary-block-head">
              <h4 className="nt-summary-heading">Terms &amp; Facts</h4>
            </div>
            <ul className="nt-terms">
              {parsed.terms.map((term, i) => (
                <li key={i} className="nt-term-item">
                  <div className="nt-term-head">
                    <strong><RichSummaryText text={term.term} onPlay={onPlayAt} /></strong>
                    {term.time && !hasInlineTime(term.term, term.time) && !hasInlineTime(term.definition, term.time) && (
                      <TimeChip ts={term.time} onPlay={onPlayAt} />
                    )}
                  </div>
                  {term.definition && (
                    <p className="nt-term-def">
                      <RichSummaryText text={term.definition} onPlay={onPlayAt} />
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {skillsButtonBlock}
          </div>
        )}

        {parsed.actionItems.length > 0 && (
          <div className="nt-summary-block">
            <h4 className="nt-summary-heading">Action Items</h4>
            <ul className="nt-actions-list">
              {parsed.actionItems.map((item, i) => (
                <li key={i} className="nt-action-item">
                  {item.time && !hasInlineTime(item.task, item.time) && (
                    <TimeChip ts={item.time} onPlay={onPlayAt} />
                  )}
                  <span className="nt-grow">
                    <RichSummaryText text={item.task} onPlay={onPlayAt} skipLeadingSeconds={item.time?.seconds} />
                  </span>
                  {item.due && <span className="nt-due-badge">{item.due}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {parsed.questions.length > 0 && (
          <div className="nt-summary-block">
            <h4 className="nt-summary-heading">Self-Test Review Q&amp;As</h4>
            <div className="nt-qa-list">
              {parsed.questions.map((qa, i) => {
                const open = !!openQAs[i];
                return (
                  <div key={i} className="nt-qa-item">
                    <div className="nt-qa-head">
                      <button
                        type="button"
                        className="nt-qa-toggle"
                        aria-expanded={open}
                        onClick={() => setOpenQAs((prev) => ({ ...prev, [i]: !prev[i] }))}
                      >
                        <Icon name="chevron" size="0.95em" className={`nt-qa-caret${open ? ' is-open' : ''}`} />
                        <span>{qa.question}</span>
                      </button>
                      {qa.time && <TimeChip ts={qa.time} onPlay={onPlayAt} />}
                    </div>
                    {open && (
                      <div className="nt-qa-answer">
                        {qa.answer ? (
                          <RichSummaryText text={qa.answer} onPlay={onPlayAt} skipLeadingSeconds={qa.time?.seconds} />
                        ) : (
                          <span className="nt-muted">No answer included in the summary.</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {parsed.terms.length === 0 && skillsButtonBlock}
          </div>
        )}
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
          <GenerateReply prompt={prompt} disabled={!prompt} onReply={setReply} />
          <textarea
            ref={replyBox}
            className="nt-input nt-gap"
            rows={reply ? 8 : 3}
            value={reply}
            placeholder="Paste the AI’s JSON or text summary"
            aria-label="The AI’s summary"
            onChange={(e) => setReply(e.target.value)}
          />
          {pasteFailed && <p className="nt-hint nt-tight">This browser wants you to paste by hand: hold in the box.</p>}
          {preview && (
            <div className={`nt-parse-preview ${preview.format === 'strict' ? 'is-strict' : 'is-legacy'}`} role="status" aria-live="polite">
              {preview.format === 'strict' ? (
                <>
                  <strong>
                    ✓ Strict JSON parsed: {preview.chapters.length} chapter{preview.chapters.length === 1 ? '' : 's'} · {preview.keyPoints.length} point{preview.keyPoints.length === 1 ? '' : 's'} · {preview.terms.length} term{preview.terms.length === 1 ? '' : 's'} · {preview.questions.length} Q&amp;A{preview.questions.length === 1 ? '' : 's'}
                  </strong>
                  <small>
                    {preview.actionItems.length > 0 ? `${preview.actionItems.length} action item${preview.actionItems.length === 1 ? '' : 's'} · ` : ''}
                    {previewTimestamps} clickable timestamp{previewTimestamps === 1 ? '' : 's'} found
                  </small>
                </>
              ) : (
                <>
                  <strong>
                    Legacy text summary detected: {preview.keyPoints.length} point{preview.keyPoints.length === 1 ? '' : 's'} · {preview.terms.length} term{preview.terms.length === 1 ? '' : 's'} · {preview.actionItems.length} action{preview.actionItems.length === 1 ? '' : 's'}
                  </strong>
                  <small>
                    {previewTimestamps} clickable timestamp{previewTimestamps === 1 ? '' : 's'} found
                  </small>
                </>
              )}
            </div>
          )}
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
