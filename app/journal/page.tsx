'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import JournalTabs from '@/components/journal/JournalTabs';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { addDays, localToday, type DateKey } from '@/lib/habits/dates';
import { MOODS, promptFor, wordCount, writingStreak, type JournalEntry, type JournalSummary, type Mood } from '@/lib/journal/journal';
import '../habits/habits.css';
import './journal.css';

// The private journal. Entries live only in the signed-in account (never in
// this browser's storage), and the editor saves itself a moment after you stop typing.

type Mode = 'loading' | 'account' | 'signed-out' | 'error';
type SaveState = 'idle' | 'loading' | 'unsaved' | 'saving' | 'saved' | 'error';

const SAVE_DELAY = 900;
const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);

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

  // What the editor holds, for saves that run after a re-render.
  const draft = useRef({ day, text, mood, version: 0, savedVersion: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef(Promise.resolve());
  const area = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLTextAreaElement>(null);

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
    setDay(date); setText(''); setMood(null); setSave('loading');
    try {
      const res = await fetch(`/api/journal?date=${date}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      if (draft.current.day !== date || draft.current.version) return; // moved on, or already typing
      const entry = json.entry as JournalEntry | null;
      d.text = entry?.text ?? ''; d.mood = entry?.mood ?? null;
      setText(d.text); setMood(d.mood); setSave('idle');
    } catch {
      if (draft.current.day === date) setSave('error');
    }
  }, [flush]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/journal', { cache: 'no-store' });
        if (res.status === 401) { setMode('signed-out'); return; }
        const json = await res.json();
        if (!json.success) throw new Error(json.message);
        setEntries(json.entries);
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
      d.savedVersion = d.version;
      fetch('/api/journal', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: d.day, text: d.text, mood: d.mood, today: localToday() }),
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

  useLayoutEffect(() => {
    syncHeight();
  }, [text, mode, syncHeight]);

  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, syncHeight]);

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

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${day === today ? 'today’s' : 'this'} entry?`, message: 'The entry is removed for good.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const d = draft.current;
    d.text = ''; d.mood = null; d.savedVersion = ++d.version;
    setText(''); setMood(null);
    await queue.current;
    const res = await fetch(`/api/journal?date=${day}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) { putSummary(day, null); setSave('idle'); } else setSave('error');
  };

  const written = new Set(entries.map((s) => s.date));
  const streak = writingStreak(written, today);
  const monthWords = entries.filter((s) => s.date.startsWith(today.slice(0, 7))).reduce((n, s) => n + s.words, 0);
  const shown = results ?? entries;
  const hasEntry = written.has(day) || !!text.trim() || !!mood;

  return (
    <div className="jr animate-fade-in">
      {popup}
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

      {mode === 'account' && (
        <div className="jr-layout">
          <section className="jr-editor" aria-label="Entry">
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
                  <button key={face} type="button" role="radio" aria-checked={mood === value} aria-label={['Rough', 'Meh', 'Okay', 'Good', 'Great'][i]}
                    disabled={save === 'loading'} onClick={() => edit({ mood: mood === value ? null : value })}>{face}</button>
                );
              })}
            </div>

            <div className="jr-grow">
              <textarea ref={measure} className="jr-text jr-measure" value={text} aria-hidden tabIndex={-1} readOnly />
              <textarea ref={area} className="jr-text" value={text} placeholder={save === 'loading' ? '' : promptFor(day)} aria-label={`Journal entry for ${dayTitle(day, today)}`}
                disabled={save === 'loading'} onChange={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
                  if (el.scrollTop !== 0) el.scrollTop = 0;
                  edit({ text: el.value });
                }} onBlur={() => { flush(); }} spellCheck />
            </div>

            <div className="jr-foot">
              <span>{wordCount(text).toLocaleString()} words</span>
              <span className={`jr-save is-${save}`} role="status">
                {save === 'saving' ? 'Saving…' : save === 'unsaved' ? 'Editing…' : save === 'saved' ? 'Saved' : save === 'error' ? 'Couldn’t save. Keep this tab open and try again.' : ''}
              </span>
              {save === 'error' && <button type="button" className="hb-small-btn" onClick={() => { draft.current.version++; flush(); }}>Retry</button>}
              {hasEntry && save !== 'loading' && <button type="button" className="hb-text-btn jr-delete" onClick={remove}>Delete entry</button>}
            </div>
          </section>

          <aside className="jr-list" aria-label="Past entries">
            <input type="search" className="jr-search" placeholder="Search your journal" value={query} onChange={(e) => setQuery(e.target.value)} />
            {shown.length === 0 ? (
              <p className="jr-hint">{results ? 'Nothing matches that.' : 'Your entries will show up here.'}</p>
            ) : (
              <ul>
                {shown.map((s) => (
                  <li key={s.date}>
                    <button type="button" className="jr-item" aria-current={s.date === day ? 'date' : undefined} onClick={() => openDay(s.date)}>
                      <span className="jr-item-head">
                        <strong>{fmtDay(s.date, { weekday: 'short', month: 'short', day: 'numeric', ...(s.date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) })}</strong>
                        {s.mood && <span aria-label={`Mood ${s.mood} of 5`}>{MOODS[s.mood - 1]}</span>}
                      </span>
                      <span className="jr-item-preview">{s.preview || <em>No words, just a mood.</em>}</span>
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
