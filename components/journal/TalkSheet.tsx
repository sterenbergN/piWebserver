'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import HabitSheet from '@/components/habits/HabitSheet';
import JournalMarkdown from '@/components/journal/JournalMarkdown';
import type { DateKey } from '@/lib/habits/dates';
import { MOOD_NAMES, MOODS } from '@/lib/journal/journal';
import { buildTalkPrompt, isTalkMode, parseTalkReply, TalkReplyError, TALK_MODES, transcriptTurns, type TalkMode, type TalkReply, type TalkThreads } from '@/lib/journal/talk';

// Talk something through with your own AI, hands-free in its voice mode, then bring
// back what it wrote. Copying happens before the drive and pasting after, often
// with the sheet closed in between, so both steps are always on the page, and the
// kind of talk is remembered on this device for when the reply comes back.

const MODE_KEY = 'journal:talk-mode';
const MODES = Object.keys(TALK_MODES) as TalkMode[];
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function TalkSheet({ day, entryName, written, threads, initialMode, onClose, onAdd }: {
  day: DateKey;
  /** "today’s entry", "yesterday’s entry"… */
  entryName: string;
  /** What's written in the day's entry so far, offered to the AI as context. */
  written: string;
  /** Open follow-ups and questions from recent talks, offered to the AI to ask after. */
  threads?: TalkThreads;
  /** Optional mode preselected when launched from a quick-start chip. */
  initialMode?: TalkMode;
  onClose: () => void;
  onAdd: (reply: TalkReply, keepConversation: boolean, mode: TalkMode) => Promise<boolean>;
}) {
  const [mode, setModeState] = useState<TalkMode>(() => (initialMode && isTalkMode(initialMode) ? initialMode : 'explore'));
  const [picked, setPicked] = useState<string>('');
  const [own, setOwn] = useState('');
  const [share, setShare] = useState(false);
  const openCount = (threads?.followUps.length ?? 0) + (threads?.questions.length ?? 0);
  const [remind, setRemind] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showPrompt, setShowPrompt] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const [replyText, setReplyText] = useState('');
  const [pasteFailed, setPasteFailed] = useState(false);
  const replyBox = useRef<HTMLTextAreaElement>(null);
  const [reply, setReply] = useState<TalkReply | null>(null);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialMode && isTalkMode(initialMode)) {
      setModeState(initialMode);
      return;
    }
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (isTalkMode(saved)) setModeState(saved);
    } catch {
      // No storage (private window): start from Explore.
    }
  }, [initialMode]);

  const setMode = (next: TalkMode) => {
    setModeState(next);
    setPicked('');
    setCopied('idle');
    try { localStorage.setItem(MODE_KEY, next); } catch { /* not remembered, that's all */ }
  };

  const info = TALK_MODES[mode];
  const topic = own.trim() || picked;
  const prompt = useMemo(
    () => buildTalkPrompt({ date: day, mode, topic, written: share ? written : '', threads: remind ? threads : undefined }),
    [day, mode, topic, share, written, remind, threads],
  );
  const turns = useMemo(() => (reply ? transcriptTurns(reply.transcript).length : 0), [reply]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      // Some phones refuse the clipboard: show it, selected, to copy by hand.
      setShowPrompt(true);
      setCopied('failed');
      window.setTimeout(() => { promptBox.current?.focus(); promptBox.current?.select(); }, 0);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasteFailed(false);
      // A long conversation comes back in parts: each paste goes after the last.
      if (text) { setReplyText((now) => (now.trim() ? `${now.trimEnd()}\n${text}` : text)); setError(''); }
    } catch {
      setPasteFailed(true);
      replyBox.current?.focus();
    }
  };

  const read = () => {
    setError('');
    try {
      setReply(parseTalkReply(replyText, topic));
    } catch (err) {
      setError(err instanceof TalkReplyError ? err.message : 'I couldn’t read that. Ask your AI for the “summary” reply again.');
    }
  };

  const add = async () => {
    if (!reply) return;
    setSaving(true);
    setError('');
    const ok = await onAdd(reply, keep && !!reply.transcript, mode);
    setSaving(false);
    if (ok) onClose();
    else setError('Couldn’t save it. Check your connection and try again.');
  };

  const pick = (value: string) => { setPicked(value); setOwn(''); setCopied('idle'); };

  return (
    <HabitSheet
      title={reply ? 'Check the summary' : 'Talk it through'}
      onClose={onClose}
      footer={reply ? (
        <>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setReply(null)}>Back</button>
          <button type="button" className="btn btn-primary" disabled={saving || !reply.summary.trim()} onClick={add}>{saving ? 'Saving…' : 'Save to Talk It Through'}</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={!replyText.trim()} onClick={read}>Read the reply</button>
        </>
      )}
    >
      {error && <p className="jr-talk-error" role="alert">{error}</p>}

      {reply ? (
        <div className="jr-talk-check">
          {reply.more && (
            <p className="jr-talk-warn" role="status">Your AI said there’s more of the conversation. Send it “more”, then go Back and paste that reply under this one.</p>
          )}
          <div className="jr-talk-read" aria-label="What was read">
            <p className="jr-talk-read-topic">{reply.topic || 'No topic'}</p>
            {reply.headline &&<p className="jr-talk-headline">{reply.headline}</p>}
            <ul className="jr-talk-counts">
              <li>{count(reply.followUps?.length ?? 0, 'follow-up')}</li>
              <li>{count(turns, 'turn')}</li>
              {!!reply.questions?.length && <li>{count(reply.questions.length, 'open question')}</li>}
              {reply.mood && <li>Mood {MOODS[reply.mood - 1]} {MOOD_NAMES[reply.mood - 1]}</li>}
              {reply.quote && <li>A quote</li>}
            </ul>
            {(!!reply.tags?.length || !!reply.people?.length) && (
              <div className="jr-talk-chips">
                {reply.tags?.map((t) => <span key={`t-${t}`} className="jr-talk-chip">#{t}</span>)}
                {reply.people?.map((p) => <span key={`p-${p}`} className="jr-talk-chip is-person"><span aria-hidden>👤</span> {p}</span>)}
              </div>
            )}
          </div>
          <label className="hb-label" htmlFor="jr-talk-mode">Kind of talk</label>
          <select id="jr-talk-mode" className="jr-talk-input" value={mode} onChange={(e) => setMode(e.target.value as TalkMode)}>
            {MODES.map((m) => <option key={m} value={m}>{TALK_MODES[m].label}</option>)}
          </select>
          <label className="hb-label" htmlFor="jr-talk-topic">Topic</label>
          <input id="jr-talk-topic" className="jr-talk-input" value={reply.topic} maxLength={300} onChange={(e) => setReply({ ...reply, topic: e.target.value })} />
          <label className="hb-label" htmlFor="jr-talk-summary">Summary, saved to this day’s Talk It Through space</label>
          <textarea id="jr-talk-summary" className="jr-talk-input" rows={Math.min(12, reply.summary.split('\n').length + 2)} value={reply.summary} onChange={(e) => setReply({ ...reply, summary: e.target.value })} />
          <div className="jr-talk-preview" aria-label="How it will read">
            <JournalMarkdown text={reply.summary} />
          </div>
          {reply.transcript ? (
            <label className="jr-talk-toggle">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              <span>Keep the full conversation<small>{count(turns, 'turn')}, tucked inside this talk card. Uncheck to save only the topic, summary and the rest.</small></span>
            </label>
          ) : (
            <p className="jr-hint">There’s no conversation in what you pasted, so only the topic, summary and the rest will be saved.</p>
          )}
          <p className="jr-hint">Saved to {entryName} in Talk It Through — your written entry stays untouched, and you can edit this summary anytime.</p>
        </div>
      ) : (
        <>
          <p className="jr-hint">Hold the conversation in your own AI app’s voice mode, hands-free. It won’t just agree with you: it keeps facts apart from opinions, brings up the other side and keeps replies short.</p>

          <section className={`jr-talk-step${copied === 'copied' ? ' is-done' : ''}`}>
            <h3><span className="jr-talk-num">{copied === 'copied' ? '✓' : 1}</span> Pick the kind of talk</h3>
            <div className="hb-chips" role="group" aria-label="Kind of talk">
              {MODES.map((m) => (
                <button key={m} type="button" className="hb-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{TALK_MODES[m].label}</button>
              ))}
            </div>
            <p className="jr-hint">{info.blurb}</p>
            <h4 className="jr-talk-sub">What about?</h4>
            <div className="hb-chips" role="group" aria-label="Topic">
              <button type="button" className="hb-chip" aria-pressed={!own.trim() && picked === ''} onClick={() => pick('')}>Let it ask me</button>
              {info.topics.map((t) => (
                <button key={t} type="button" className="hb-chip" aria-pressed={!own.trim() && picked === t} onClick={() => pick(t)}>{t}</button>
              ))}
            </div>
            <input className="jr-talk-input" value={own} maxLength={300} placeholder={`Or in your own words. ${info.placeholder}`} aria-label="Topic in your own words" onChange={(e) => { setOwn(e.target.value); setCopied('idle'); }} />
            {written.trim() && (
              <label className="jr-talk-toggle">
                <input type="checkbox" checked={share} onChange={(e) => { setShare(e.target.checked); setCopied('idle'); }} />
                <span>Give it what I’ve written in this entry<small>So it knows the day so far.</small></span>
              </label>
            )}
            {openCount > 0 && (
              <label className="jr-talk-toggle">
                <input type="checkbox" checked={remind} onChange={(e) => { setRemind(e.target.checked); setCopied('idle'); }} />
                <span>Remind it of what’s still open<small>{count(openCount, 'follow-up or question', 'follow-ups and questions')} from the last two weeks, so it can ask how they’re going.</small></span>
              </label>
            )}
            <div className="jr-talk-actions">
              <button type="button" className={`btn ${copied === 'copied' ? 'btn-secondary' : 'btn-primary'}`} onClick={copy}>{copied === 'copied' ? 'Copied' : 'Copy prompt'}</button>
              <button type="button" className="hb-text-btn" aria-expanded={showPrompt} onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? 'Hide the prompt' : 'Read the prompt'}</button>
            </div>
            {copied === 'copied' && <p className="jr-hint">Paste it into a new chat, then switch to voice mode before you set off. Say “wrap up” when you’re done.</p>}
            {copied === 'failed' && <p className="jr-talk-error">Couldn’t reach the clipboard. It’s selected below, so copy it from there.</p>}
            {showPrompt && <textarea ref={promptBox} className="jr-talk-input jr-talk-prompt" readOnly rows={8} value={prompt} aria-label="The prompt to copy" />}
          </section>

          <section className="jr-talk-step">
            <div className="jr-talk-step-head">
              <h3><span className="jr-talk-num">2</span> Once you’re parked</h3>
              <button type="button" className="hb-small-btn" onClick={paste}>Paste</button>
            </div>
            <p className="jr-hint">Type <strong>summary</strong> in the same chat. It replies in JSON (a block of text in curly brackets): copy all of it and paste it here. If it ends with <strong>&quot;more&quot;: true</strong>, send “more”, then paste that reply too: each paste goes after the last.</p>
            <textarea ref={replyBox} className="jr-talk-input" rows={replyText ? 6 : 3} value={replyText} placeholder="Paste the whole reply here" aria-label="The AI’s reply"
              onChange={(e) => { setReplyText(e.target.value); setError(''); }} />
            {pasteFailed && <p className="jr-hint">This browser wants you to paste by hand. Hold or right-click in the box.</p>}
          </section>
        </>
      )}
    </HabitSheet>
  );
}
