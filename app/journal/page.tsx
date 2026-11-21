'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import JournalTabs from '@/components/journal/JournalTabs';
import SignInPrompt from '@/components/journal/SignInPrompt';
import JournalMarkdown from '@/components/journal/JournalMarkdown';
import TalkSheet from '@/components/journal/TalkSheet';
import { applyFormat, type FormatAction } from '@/lib/blog/markdown-format';
import { addDays, localToday, type DateKey } from '@/lib/habits/dates';
import { MOOD_NAMES, MOODS, MAX_SUMMARY, promptFor, wordCount, writingStreak, type JournalEntry, type JournalSummary, type JournalTalk, type Mood, type OpenFollowUp } from '@/lib/journal/journal';
import { continueList } from '@/lib/journal/markdown';
import { isTalkMode, MAX_TOPIC, TALK_MODES, transcriptTurns, type TalkMode, type TalkReply } from '@/lib/journal/talk';
import '../habits/habits.css';
import './journal.css';

// The private journal. Entries live only in the signed-in account (never in
// this browser's storage), and the editor saves itself a moment after you stop typing.

type Mode = 'loading' | 'account' | 'signed-out' | 'error';
type SaveState = 'idle' | 'loading' | 'unsaved' | 'saving' | 'saved' | 'error';
type DayView = 'written' | 'talk' | 'split';

const SAVE_DELAY = 900;
const TALK_MODE_OPTIONS = Object.keys(TALK_MODES) as TalkMode[];
const QUICK_MODES: { mode: TalkMode; label: string }[] = [
  { mode: 'explore', label: 'Explore' },
  { mode: 'debate', label: 'Debate me' },
  { mode: 'decide', label: 'Make a decision' },
  { mode: 'brainstorm', label: 'Brainstorm' },
  { mode: 'reflect', label: 'Look back' },
];
const TOOLS: { action: FormatAction; label: string; title: string }[] = [
  { action: 'bold', label: 'B', title: 'Bold (Ctrl+B)' },
  { action: 'italic', label: 'I', title: 'Italic (Ctrl+I)' },
  { action: 'h3', label: 'H', title: 'Heading' },
  { action: 'ul', label: '•', title: 'Bulleted list' },
  { action: 'ol', label: '1.', title: 'Numbered list' },
  { action: 'quote', label: '❝', title: 'Quote' },
];
const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);
/** How many open follow-ups the To do strip shows before "Show all". */
const TODO_SHOWN = 4;

function dayTitle(day: DateKey, today: DateKey) {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

export default function JournalPage() {
  const { confirm, popup } = useSitePopup();
  const [mode, setMode] = useState<Mode>('loading');
  const [today, setToday] = useState<DateKey>(() => localToday());
  const [day, setDay] = useState<DateKey>(() => localToday());
  const [entries, setEntries] = useState<JournalSummary[]>([]);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<Mood | null>(null);
  const [save, setSave] = useState<SaveState>('loading');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JournalSummary[] | null>(null);
  const [talks, setTalks] = useState<JournalTalk[]>([]);
  // Open follow-ups and questions from the last two weeks' talks.
  const [todo, setTodo] = useState<OpenFollowUp[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [allTodo, setAllTodo] = useState(false);
  const [todoError, setTodoError] = useState('');
  // A day whose "Set the mood from the talk?" offer was turned down.
  const [moodDeclined, setMoodDeclined] = useState<DateKey | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [talkSheet, setTalkSheet] = useState<{ open: boolean; initialMode?: TalkMode }>({ open: false });
  const [editingTalk, setEditingTalk] = useState<{
    id: string;
    topic: string;
    summary: string;
    mode: TalkMode | '';
    saving: boolean;
    error: string;
  } | null>(null);
  const [dayView, setDayView] = useState<DayView>('split');
  const [isDesktop, setIsDesktop] = useState(true);
  // Written in Markdown, read formatted: the entry shows as it reads until you tap into it.
  const [editing, setEditing] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the editor holds, for saves that run after a re-render.
  const draft = useRef({ day, text, mood, version: 0, savedVersion: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef(Promise.resolve());
  const area = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const effectiveView: DayView = isDesktop ? dayView : (dayView === 'talk' ? 'talk' : 'written');
  const showWrittenPane = effectiveView === 'written' || effectiveView === 'split';
  const showTalkPane = effectiveView === 'talk' || effectiveView === 'split';

  const putSummary = (date: DateKey, summary: JournalSummary | null) => setEntries((list) => {
    const rest = list.filter((s) => s.date !== date);
    return (summary ? [...rest, summary] : rest).sort((a, b) => b.date.localeCompare(a.date));
  });

  /** Send what the editor holds now, if it changed since the last save. Saves go out one at a time. */
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    queue.current = queue.current.then(async () => {
      const d = draft.current;
      if (d.version === d.savedVersion) return;
      const { day: date, text: body, mood: m, version } = d;
      setSave('saving');
      try {
        const res = await fetch('/api/journal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, text: body, mood: m, today: localToday() }),
        });
        const json = await res.json().catch(() => ({}));
        if (!json.success) throw new Error(json.message);
        d.savedVersion = Math.max(d.savedVersion, version);
        putSummary(date, json.summary);
        if (draft.current.version === version) setSave('saved');
      } catch {
        setSave('error');
      }
    });
    return queue.current;
  }, []);

  const edit = (next: { text?: string; mood?: Mood | null }) => {
    const d = draft.current;
    if (next.text !== undefined) { d.text = next.text; setText(next.text); }
    if (next.mood !== undefined) { d.mood = next.mood; setMood(next.mood); }
    d.version++;
    setSave('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  /** Save what's open, then open another day. */
  const openDay = useCallback(async (date: DateKey) => {
    await flush();
    const d = draft.current;
    d.day = date; d.text = ''; d.mood = null; d.version = 0; d.savedVersion = 0;
    setDay(date); setText(''); setMood(null); setTalks([]); setEditingTalk(null); setEditing(false); setSave('loading');
    try {
      const res = await fetch(`/api/journal?date=${date}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      if (draft.current.day !== date || draft.current.version) return; // moved on, or already typing
      const entry = json.entry as JournalEntry | null;
      d.text = entry?.text ?? ''; d.mood = entry?.mood ?? null;
      setText(d.text); setMood(d.mood); setTalks(entry?.talks ?? []); setSave('idle');
    } catch {
      if (draft.current.day === date) setSave('error');
    }
  }, [flush]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/journal?today=${localToday()}`, { cache: 'no-store' });
        if (res.status === 401) { setMode('signed-out'); return; }
        const json = await res.json();
        if (!json.success) throw new Error(json.message);
        setEntries(json.entries);
        setTodo(json.todo ?? []);
        setQuestions(json.questions ?? []);
        setMode('account');
        openDay(localToday());
      } catch {
        setMode('error');
      }
    })();
  }, [openDay]);

  // Leaving the page or switching apps: send any unsaved words right away.
  useEffect(() => {
    const sendNow = () => {
      const d = draft.current;
      if (d.version === d.savedVersion) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      const date = d.day;
      const sentVersion = d.version;
      fetch('/api/journal', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, text: d.text, mood: d.mood, today: localToday() }),
      }).then((res) => {
        if (res.ok && draft.current.day === date) {
          d.savedVersion = Math.max(d.savedVersion, sentVersion);
        }
      }).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sendNow();
      else setToday(localToday());
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', sendNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', sendNow);
    };
  }, []);

  // Grow the page with the writing instead of scrolling inside a box. A hidden
  // twin with height 0 measures the text so the real textarea never collapses to
  // `auto` (which would clamp and reset the page's scroll position on phones).
  const syncHeight = useCallback(() => {
    const el = area.current;
    const m = measure.current;
    if (!el || !m) return;
    const border = el.offsetHeight - el.clientHeight;
    const target = Math.max(m.scrollHeight + border, 280);
    if (el.offsetHeight !== target) {
      const x = window.scrollX;
      const y = window.scrollY;
      el.style.height = `${target}px`;
      if (el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight + border}px`;
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    }
    if (el.scrollTop !== 0) el.scrollTop = 0;
  }, []);

  const reading = !editing && !!text.trim() && save !== 'loading';

  useLayoutEffect(() => {
    syncHeight();
  }, [text, mode, reading, showWrittenPane, syncHeight]);

  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, reading, showWrittenPane, syncHeight]);

  /** Open the entry for writing, with the caret at the end (where most writing goes). */
  const startEditing = () => {
    setEditing(true);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const keepEditing = () => {
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; }
  };

  // Where the caret goes after a formatting change, set as soon as React has put the
  // new text in (not a frame later, when a quick next keystroke could already have landed).
  const pendingSelection = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    const sel = pendingSelection.current;
    if (!el || !sel) return;
    pendingSelection.current = null;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.setSelectionRange(sel[0], sel[1]);
  }, [text]);

  /** Put the textarea's text and selection back after a formatting change. */
  const applyEdit = (next: { text: string; selStart: number; selEnd: number }) => {
    keepEditing();
    pendingSelection.current = [next.selStart, next.selEnd];
    edit({ text: next.text });
  };

  const format = (action: FormatAction) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = applyFormat(el.value, start, end, action);
    // A list or heading started with nothing selected: carry on typing at the end of the line.
    const lineAction = action !== 'bold' && action !== 'italic';
    applyEdit(lineAction && start === end ? { ...next, selStart: next.selEnd } : next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      format(e.key === 'b' ? 'bold' : 'italic');
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && el.selectionStart === el.selectionEnd) {
      const next = continueList(el.value, el.selectionStart);
      if (next) { e.preventDefault(); applyEdit(next); }
    }
  };

  // Search runs on the server, so the list never needs every entry's full text.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/journal?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal: ctrl.signal })
        .then((r) => r.json())
        .then((json) => { if (json.success) setResults(json.entries); })
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  /** Save a talked-through session into this day's dedicated Talk It Through space without modifying the written entry. */
  const addTalk = async (reply: TalkReply, keep: boolean, talkMode: TalkMode) => {
    const date = draft.current.day;
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          mode: talkMode,
          topic: reply.topic,
          summary: reply.summary,
          transcript: keep ? reply.transcript : '',
          headline: reply.headline,
          tags: reply.tags,
          people: reply.people,
          followUps: reply.followUps,
          questions: reply.questions,
          quote: reply.quote,
          mood: reply.mood,
          today: localToday(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message);
      if (draft.current.day === date) {
        setTalks((list) => [...list, json.talk]);
        if (dayView === 'written') setDayView(isDesktop ? 'split' : 'talk');
      }
      putSummary(date, json.summary);
      if (json.todo) setTodo(json.todo);
      if (reply.questions?.length) setQuestions((list) => [...new Set([...(reply.questions ?? []), ...list])].slice(0, 10));
      return true;
    } catch {
      return false;
    }
  };

  const startEditTalk = (t: JournalTalk) => {
    setEditingTalk({
      id: t.id,
      topic: t.topic,
      summary: t.summary ?? '',
      mode: t.mode && isTalkMode(t.mode) ? t.mode : '',
      saving: false,
      error: '',
    });
  };

  const saveEditTalk = async (t: JournalTalk) => {
    if (!editingTalk || editingTalk.id !== t.id) return;
    if (!editingTalk.summary.trim() && !t.transcript.trim()) {
      setEditingTalk({ ...editingTalk, error: 'Add a summary before saving (since the conversation isn’t kept).' });
      return;
    }
    const date = draft.current.day;
    setEditingTalk({ ...editingTalk, saving: true, error: '' });
    try {
      const res = await fetch('/api/journal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          talkId: t.id,
          topic: editingTalk.topic,
          summary: editingTalk.summary,
          mode: editingTalk.mode || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Couldn’t save changes.');
      if (draft.current.day === date) {
        setTalks((list) => list.map((item) => (item.id === t.id ? json.talk : item)));
        setEditingTalk(null);
      }
      putSummary(date, json.summary);
      if (json.todo) setTodo(json.todo);
    } catch (err) {
      setEditingTalk((cur) => (cur && cur.id === t.id ? { ...cur, saving: false, error: err instanceof Error ? err.message : 'Couldn’t save changes.' } : cur));
    }
  };

  const removeTalk = async (talk: JournalTalk) => {
    const ok = await confirm({ title: 'Delete this talk session?', message: 'This talk session (its summary and conversation) is removed for good.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const date = day;
    const res = await fetch(`/api/journal?date=${date}&talk=${encodeURIComponent(talk.id)}`, { method: 'DELETE' }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (!json?.success) { setSave('error'); return; }
    if (draft.current.day === date) {
      setTalks((list) => list.filter((t) => t.id !== talk.id));
      if (editingTalk?.id === talk.id) setEditingTalk(null);
    }
    putSummary(date, json.summary);
    setTodo((list) => list.filter((f) => f.talkId !== talk.id));
  };

  /**
   * Tick (or untick) one of a talk's follow-ups, from its card or the To do strip.
   * It shows at once and goes back if the save fails.
   */
  const setFollowUpDone = async (date: DateKey, talkId: string, index: number, done: boolean) => {
    const mark = (list: JournalTalk[]) => list.map((t) => (t.id !== talkId || !t.followUps ? t : {
      ...t,
      followUps: t.followUps.map((f, i) => (i === index ? { ...f, done } : f)),
    }));
    const before = { talks, todo };
    setTodoError('');
    if (draft.current.day === date) setTalks(mark);
    if (done) setTodo((list) => list.filter((f) => !(f.talkId === talkId && f.index === index)));
    try {
      const res = await fetch('/api/journal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, talkId, followUp: index, done, today: localToday() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message);
      if (draft.current.day === date) setTalks((list) => list.map((t) => (t.id === talkId ? json.talk : t)));
      if (json.todo) setTodo(json.todo);
    } catch {
      if (draft.current.day === date) setTalks(before.talks);
      setTodo(before.todo);
      setTodoError('Couldn’t save that tick. Check your connection and try again.');
    }
  };

  /** A tag or name on a talk card: look for it across the journal. */
  const searchFor = (term: string) => {
    setQuery(term);
    searchBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${day === today ? 'today’s' : 'this'} entry?`, message: talks.length ? 'The entry and its kept conversations are removed for good.' : 'The entry is removed for good.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const d = draft.current;
    d.text = ''; d.mood = null; d.savedVersion = ++d.version;
    setText(''); setMood(null); setTalks([]);
    await queue.current;
    const res = await fetch(`/api/journal?date=${day}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) { putSummary(day, null); setSave('idle'); } else setSave('error');
  };

  const written = new Set(entries.map((s) => s.date));
  const streak = writingStreak(written, today);
  const monthWords = entries.filter((s) => s.date.startsWith(today.slice(0, 7))).reduce((n, s) => n + s.words, 0);
  const shown = results ?? entries;
  const hasEntry = written.has(day) || !!text.trim() || !!mood || talks.length > 0;
  const entryName = day === today ? 'today’s entry' : day === addDays(today, -1) ? 'yesterday’s entry' : 'this day’s entry';
  // The day has no mood yet but a talk read one: offer it rather than setting it quietly.
  const talkMood = !mood && save !== 'loading' && moodDeclined !== day ? [...talks].reverse().find((t) => t.mood)?.mood : undefined;
  const shownTodo = allTodo ? todo : todo.slice(0, TODO_SHOWN);
  const threads = useMemo(() => ({ followUps: todo.map((f) => f.text), questions }), [todo, questions]);
  const shortDay = (d: DateKey) => (d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' }));

  return (
    <div className="jr animate-fade-in">
      {popup}
      {talkSheet.open && (
        <TalkSheet
          day={day}
          entryName={entryName}
          written={text}
          threads={threads}
          initialMode={talkSheet.initialMode}
          onClose={() => setTalkSheet({ open: false })}
          onAdd={addTalk}
        />
      )}
      <header className="jr-head">
        <div>
          <h1>Journal</h1>
          <p><span aria-hidden>🔒</span> Private to your account. Nobody else can read it.</p>
        </div>
        {mode === 'account' && (
          <dl className="jr-stats">
            <div><dt>Entries</dt><dd>{entries.length}</dd></div>
            <div><dt>Streak</dt><dd>🔥 {streak}</dd></div>
            <div><dt>Words this month</dt><dd>{monthWords.toLocaleString()}</dd></div>
          </dl>
        )}
      </header>

      <JournalTabs current="entries" />

      {mode === 'loading' && <p className="jr-hint">Opening your journal…</p>}
      {mode === 'error' && <div className="hb-banner is-error" role="alert"><span>Couldn’t open your journal.</span><button type="button" className="hb-small-btn" onClick={() => location.reload()}>Try again</button></div>}
      {mode === 'signed-out' && (
        <SignInPrompt title="Sign in to open your journal">Your journal is kept in your account and only you can read it. Nothing is saved on this device.</SignInPrompt>
      )}

      {mode === 'account' && todo.length > 0 && (
        <section className="jr-todo" aria-label="To do from your talks">
          <div className="jr-todo-head">
            <h2><span aria-hidden>✅</span> To do</h2>
            <small>From your talks in the last two weeks</small>
          </div>
          <ul>
            {shownTodo.map((f) => (
              <li key={`${f.talkId}-${f.index}`}>
                <label>
                  <input type="checkbox" checked={false} onChange={() => setFollowUpDone(f.date, f.talkId, f.index, true)} />
                  <span>{f.text}{f.when && <small> · {f.when}</small>}</span>
                </label>
                <button type="button" className="jr-todo-day" title={f.topic ? `From “${f.topic}”` : undefined} onClick={() => openDay(f.date)}>{shortDay(f.date)}</button>
              </li>
            ))}
          </ul>
          {todo.length > TODO_SHOWN && (
            <button type="button" className="hb-text-btn jr-todo-more" onClick={() => setAllTodo((v) => !v)}>
              {allTodo ? 'Show fewer' : `Show all ${todo.length}`}
            </button>
          )}
          {todoError && <p className="jr-talk-error" role="alert">{todoError}</p>}
        </section>
      )}

      {mode === 'account' && (
        <div className="jr-layout">
          <div className="jr-day-workspace">
            <header className="jr-day-head-card">
              <div className="jr-daybar">
                <button type="button" className="jr-arrow" aria-label="Previous day" onClick={() => openDay(addDays(day, -1))}>‹</button>
                <div className="jr-day">
                  <h2>{dayTitle(day, today)}</h2>
                  <label className="jr-date">
                    <span className="sr-only">Pick a day</span>
                    <input type="date" value={day} max={today} onChange={(e) => e.target.value && e.target.value <= today && openDay(e.target.value)} />
                  </label>
                </div>
                <button type="button" className="jr-arrow" aria-label="Next day" disabled={day >= today} onClick={() => openDay(addDays(day, 1))}>›</button>
              </div>
              {day !== today && <button type="button" className="hb-text-btn jr-back" onClick={() => openDay(today)}>Back to today</button>}

              <div className="jr-moods" role="radiogroup" aria-label="Mood">
                {MOODS.map((face, i) => {
                  const value = (i + 1) as Mood;
                  return (
                    <button key={face} type="button" role="radio" aria-checked={mood === value} aria-label={MOOD_NAMES[i]}
                      disabled={save === 'loading'} onMouseDown={keepEditing} onPointerDown={keepEditing} onClick={() => edit({ mood: mood === value ? null : value })}>{face}</button>
                  );
                })}
              </div>
              {talkMood && (
                <p className="jr-mood-offer">
                  <span>Set {day === today ? 'today’s' : 'this day’s'} mood to {MOODS[talkMood - 1]} {MOOD_NAMES[talkMood - 1]}? <small>From your talk.</small></span>
                  <button type="button" className="hb-small-btn" onClick={() => edit({ mood: talkMood })}>Set it</button>
                  <button type="button" className="hb-text-btn" onClick={() => setMoodDeclined(day)}>No thanks</button>
                </p>
              )}

              <div className="jr-view-tabs" role="tablist" aria-label="Day view">
                <button type="button" role="tab" aria-selected={effectiveView === 'written'} onClick={() => setDayView('written')}>
                  <span aria-hidden>✍️</span> Written Entry
                </button>
                <button type="button" role="tab" aria-selected={effectiveView === 'talk'} onClick={() => setDayView('talk')}>
                  <span aria-hidden>🎙️</span> Talk It Through ({talks.length})
                </button>
                <button type="button" role="tab" className="jr-view-split-btn" aria-selected={effectiveView === 'split'} onClick={() => setDayView('split')}>
                  Split
                </button>
              </div>
            </header>

            <div className={`jr-day-panes${effectiveView === 'split' ? ' is-split' : ''}`}>
              {showWrittenPane && (
                <section className="jr-editor jr-pane-written" aria-label="Written Entry">
                  <div className="jr-pane-head">
                    <h3><span aria-hidden>✍️</span> Written Entry</h3>
                  </div>

                  <div className="jr-tools">
                    {reading ? (
                      <button type="button" className="hb-small-btn" onClick={startEditing}><span aria-hidden>✏️</span> Edit</button>
                    ) : (
                      <div className="jr-format" role="toolbar" aria-label="Formatting">
                        {TOOLS.map((t) => (
                          <button key={t.action} type="button" className={`jr-format-${t.action}`} title={t.title} aria-label={t.title} disabled={save === 'loading'}
                            onMouseDown={(e) => e.preventDefault()} onPointerDown={keepEditing} onClick={() => format(t.action)}>{t.label}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {reading ? (
                    // Tapping the words opens them for writing; links in them still open.
                    <div className="jr-read" onClick={(e) => { if (!(e.target as HTMLElement).closest('a, input')) startEditing(); }}>
                      <JournalMarkdown text={text} />
                    </div>
                  ) : (
                    <div className="jr-grow">
                      <textarea ref={measure} className="jr-text jr-measure" value={text} aria-hidden tabIndex={-1} readOnly />
                      <textarea ref={area} className="jr-text" value={text} placeholder={save === 'loading' ? '' : promptFor(day)} aria-label={`Journal entry for ${dayTitle(day, today)}`}
                        disabled={save === 'loading'} onChange={(e) => {
                          const el = e.currentTarget;
                          if (el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
                          if (el.scrollTop !== 0) el.scrollTop = 0;
                          // Typing means writing, even if focus came back without a focus event.
                          keepEditing();
                          if (!editing) setEditing(true);
                          edit({ text: el.value });
                        }}
                        onKeyDown={onKeyDown}
                        onFocus={() => { keepEditing(); setEditing(true); }}
                        onBlur={() => {
                          flush();
                          // A moment's grace, so a tap on the formatting bar doesn't close the editor.
                          keepEditing();
                          blurTimer.current = setTimeout(() => { blurTimer.current = null; setEditing(false); }, 250);
                        }}
                        spellCheck />
                    </div>
                  )}

                  <div className="jr-foot">
                    <span>{wordCount(text).toLocaleString()} words</span>
                    <span className={`jr-save is-${save}`} role="status">
                      {save === 'saving' ? 'Saving…' : save === 'unsaved' ? 'Editing…' : save === 'saved' ? 'Saved' : save === 'error' ? 'Couldn’t save. Keep this tab open and try again.' : ''}
                    </span>
                    {save === 'error' && <button type="button" className="hb-small-btn" onClick={() => { draft.current.version++; flush(); }}>Retry</button>}
                    {hasEntry && save !== 'loading' && <button type="button" className="hb-text-btn jr-delete" onClick={remove}>Delete entry</button>}
                  </div>
                </section>
              )}

              {showTalkPane && (
                <section className="jr-talk-space jr-pane-talk" aria-label="Talk It Through">
                  <div className="jr-talk-space-head">
                    <div>
                      <h3><span aria-hidden>🎙️</span> Talk It Through</h3>
                      <p className="jr-hint">Hands-free AI talks kept in their own space.</p>
                    </div>
                    <button type="button" className="btn btn-primary jr-new-talk-btn" disabled={save === 'loading'} onClick={() => setTalkSheet({ open: true })}>
                      <span aria-hidden>🎙️</span> New Talk Session
                    </button>
                  </div>

                  <div className="jr-quickstart" role="group" aria-label="Quick-start talk modes">
                    {QUICK_MODES.map((item) => (
                      <button
                        key={item.mode}
                        type="button"
                        className="jr-mode-chip"
                        disabled={save === 'loading'}
                        onClick={() => setTalkSheet({ open: true, initialMode: item.mode })}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  {talks.length === 0 ? (
                    <div className="jr-talk-empty">
                      <p className="jr-hint">
                        No talks saved for {day === today ? 'today' : dayTitle(day, today)} yet. Pick a mode above or start a new talk session — summaries live here without overwriting your written entry.
                      </p>
                    </div>
                  ) : (
                    <div className="jr-talk-cards">
                      {talks.map((t) => {
                        const isEditingThis = editingTalk?.id === t.id;
                        const turns = t.transcript.trim() ? transcriptTurns(t.transcript) : [];
                        const modeLabel = t.mode && isTalkMode(t.mode) ? TALK_MODES[t.mode].label : null;
                        return (
                          <article key={t.id} className="jr-talk-card">
                            <div className="jr-talk-card-head">
                              <div className="jr-talk-card-meta">
                                {modeLabel && <span className="jr-talk-badge">{modeLabel}</span>}
                                {t.mood && <span className="jr-talk-mood" title={`Mood: ${MOOD_NAMES[t.mood - 1]}`} aria-label={`Mood: ${MOOD_NAMES[t.mood - 1]}`}>{MOODS[t.mood - 1]}</span>}
                                {t.createdAt && (
                                  <small className="jr-talk-time">
                                    {new Date(t.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                                  </small>
                                )}
                              </div>
                              {!isEditingThis && (
                                <div className="jr-talk-card-actions">
                                  <button type="button" className="jr-talk-action" onClick={() => startEditTalk(t)} aria-label={`Edit ${t.topic || 'talk session'}`}>
                                    <span aria-hidden>✏️</span> Edit
                                  </button>
                                  <button type="button" className="jr-talk-action is-danger" onClick={() => removeTalk(t)} aria-label={`Delete ${t.topic || 'talk session'}`}>
                                    <span aria-hidden>🗑️</span> Delete
                                  </button>
                                </div>
                              )}
                            </div>

                            {isEditingThis ? (
                              <div className="jr-talk-edit">
                                <label className="hb-label" htmlFor={`jr-edit-mode-${t.id}`}>Mode</label>
                                <select
                                  id={`jr-edit-mode-${t.id}`}
                                  className="jr-talk-input"
                                  value={editingTalk.mode}
                                  disabled={editingTalk.saving}
                                  onChange={(e) => setEditingTalk({ ...editingTalk, mode: e.target.value as TalkMode | '' })}
                                >
                                  <option value="">No mode</option>
                                  {TALK_MODE_OPTIONS.map((m) => (
                                    <option key={m} value={m}>{TALK_MODES[m].label}</option>
                                  ))}
                                </select>

                                <label className="hb-label" htmlFor={`jr-edit-topic-${t.id}`}>Topic</label>
                                <input
                                  id={`jr-edit-topic-${t.id}`}
                                  className="jr-talk-input"
                                  value={editingTalk.topic}
                                  maxLength={MAX_TOPIC}
                                  disabled={editingTalk.saving}
                                  onChange={(e) => setEditingTalk({ ...editingTalk, topic: e.target.value })}
                                />

                                <label className="hb-label" htmlFor={`jr-edit-summary-${t.id}`}>Summary</label>
                                <textarea
                                  id={`jr-edit-summary-${t.id}`}
                                  className="jr-talk-input"
                                  rows={Math.min(12, Math.max(4, editingTalk.summary.split('\n').length + 1))}
                                  maxLength={MAX_SUMMARY}
                                  value={editingTalk.summary}
                                  disabled={editingTalk.saving}
                                  onChange={(e) => setEditingTalk({ ...editingTalk, summary: e.target.value, error: '' })}
                                />

                                {editingTalk.error && <p className="jr-talk-error" role="alert">{editingTalk.error}</p>}

                                <div className="jr-talk-edit-actions">
                                  <button type="button" className="hb-small-btn" disabled={editingTalk.saving} onClick={() => setEditingTalk(null)}>
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="hb-small-btn is-primary"
                                    disabled={editingTalk.saving || (!editingTalk.summary.trim() && !t.transcript.trim())}
                                    onClick={() => saveEditTalk(t)}
                                  >
                                    {editingTalk.saving ? 'Saving…' : 'Save changes'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <h4 className="jr-talk-topic">{t.topic || 'Untitled talk'}</h4>
                                {t.headline && <p className="jr-talk-headline">{t.headline}</p>}
                                {t.summary && (
                                  <div className="jr-talk-summary">
                                    <JournalMarkdown text={t.summary} />
                                  </div>
                                )}
                                {t.quote && <blockquote className="jr-talk-quote">{t.quote}</blockquote>}
                                {!!t.followUps?.length && (
                                  <div className="jr-talk-list">
                                    <h5>Follow-ups</h5>
                                    <ul className="jr-talk-followups">
                                      {t.followUps.map((f, i) => (
                                        <li key={i} className={f.done ? 'is-done' : undefined}>
                                          <label>
                                            <input type="checkbox" checked={!!f.done} onChange={(e) => setFollowUpDone(day, t.id, i, e.target.checked)} />
                                            <span>{f.text}{f.when && <small> · {f.when}</small>}</span>
                                          </label>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {!!t.questions?.length && (
                                  <div className="jr-talk-list">
                                    <h5>Still thinking about</h5>
                                    <ul className="jr-talk-questions">
                                      {t.questions.map((q, i) => <li key={i}>{q}</li>)}
                                    </ul>
                                  </div>
                                )}
                                {(!!t.tags?.length || !!t.people?.length) && (
                                  <div className="jr-talk-chips" aria-label="Find in your journal">
                                    {t.tags?.map((tag) => (
                                      <button key={`t-${tag}`} type="button" className="jr-talk-chip" title={`Search your journal for ${tag}`} onClick={() => searchFor(tag)}>#{tag}</button>
                                    ))}
                                    {t.people?.map((p) => (
                                      <button key={`p-${p}`} type="button" className="jr-talk-chip is-person" title={`Search your journal for ${p}`} onClick={() => searchFor(p)}><span aria-hidden>👤</span> {p}</button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}

                            {turns.length > 0 && (
                              <details className="jr-talk-convo">
                                <summary>
                                  <span>💬 Conversation ({turns.length} {turns.length === 1 ? 'turn' : 'turns'})</span>
                                  <span className="jr-talk-convo-hint" aria-hidden />
                                </summary>
                                <ol className="jr-turns">
                                  {turns.map((turn, i) => (
                                    <li key={i} className={`is-${turn.who}`}><b>{turn.who === 'me' ? 'Me' : 'AI'}</b>{turn.text}</li>
                                  ))}
                                </ol>
                              </details>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>

          <aside className="jr-list" aria-label="Past entries">
            <input ref={searchBox} type="search" className="jr-search" placeholder="Search your journal" value={query} onChange={(e) => setQuery(e.target.value)} />
            {shown.length === 0 ? (
              <p className="jr-hint">{results ? 'Nothing matches that.' : 'Your entries will show up here.'}</p>
            ) : (
              <ul>
                {shown.map((s) => (
                  <li key={s.date}>
                    <button type="button" className="jr-item" aria-current={s.date === day ? 'date' : undefined} onClick={() => openDay(s.date)}>
                      <span className="jr-item-head">
                        <strong>{fmtDay(s.date, { weekday: 'short', month: 'short', day: 'numeric', ...(s.date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) })}</strong>
                        <span>
                          {s.talks ? <span aria-label={`${s.talks} kept ${s.talks === 1 ? 'conversation' : 'conversations'}`}>🎙</span> : null}
                          {s.mood && <span aria-label={`Mood ${s.mood} of 5`}>{MOODS[s.mood - 1]}</span>}
                        </span>
                      </span>
                      <span className="jr-item-preview">{s.preview || <em>{s.talks ? 'A kept conversation.' : 'No words, just a mood.'}</em>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
