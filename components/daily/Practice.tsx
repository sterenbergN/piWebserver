'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QuestionCard, { type Answered } from './QuestionCard';
import FormulaSheet from './FormulaSheet';
import { fetchAnalysis, readDeviceAttempts, regradeDeviceAttempt, sendAnswer, sendFeedback, type CheckResult } from './useDaily';
import { addDays, weekStart, type DateKey } from '@/lib/habits/dates';
import type { PublicQuestion, QuestionStatus } from '@/lib/daily/grade';
import type { Focus } from '@/lib/daily/analysis';
import { newGeneratedId } from '@/lib/daily/generated';
import { TRACKS, TRACK_LABEL, type Formula, type Track } from '@/lib/daily/types';

type Source = 'day' | 'pool' | 'generated';
type PoolItem = { id: string; date: DateKey | null; added?: DateKey | null; source: 'day' | 'pool'; core: boolean; boss: boolean; track: Track; topic: string; difficulty: number; title: string; status: QuestionStatus | null };
type GenItem = { key: string; track: Track; topic: string; difficulty: number; title: string };
type Current = { id: string; date: DateKey | null; source: Source; core: boolean; boss: boolean; question: PublicQuestion; formulas: Formula[]; answered: Answered | null; tries: number };

/** One line in the list: a saved question, a past day's question, or a generator. */
type Row = { id: string; kind: View; genKey?: string; date: DateKey | null; added: DateKey | null; core: boolean; boss: boolean; track: Track; topic: string; difficulty: number; title: string; status: QuestionStatus | null; order: number };
type View = 'saved' | 'gen' | 'past';
type Status = 'any' | 'todo' | 'retry' | 'done';
type Sort = 'newest' | 'topic' | 'easy' | 'hard' | 'todo';
type Prefs = { view: View | 'all'; status: Status; sort: Sort };

const STATUS_ICON: Record<QuestionStatus, string> = { solved: '✅', partial: '🟡', wrong: '❌', studied: '📖' };
const VIEWS: { id: View | 'all'; icon: string; label: string; hint: string }[] = [
  { id: 'all', icon: '✨', label: 'All', hint: 'Every question you can practice, from every source.' },
  { id: 'saved', icon: '📚', label: 'Saved', hint: 'Extra questions added with each weekly upload, aimed at the topics people find hard. Newest first.' },
  { id: 'gen', icon: '🎲', label: 'Generators', hint: 'Endless: each one makes a fresh question with new numbers every time you open it.' },
  { id: 'past', icon: '📅', label: 'Past days', hint: 'Every daily question so far, core and bonus.' },
];
const KIND_ORDER: Record<View, number> = { saved: 0, gen: 1, past: 2 };
const KIND_LABEL: Record<View, string> = { saved: '📚 Saved practice', gen: '🎲 Generators', past: '📅 Past days' };
const STATUSES: { id: Status; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'todo', label: 'Not tried yet' },
  { id: 'retry', label: 'Worth another go' },
  { id: 'done', label: 'Solved' },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'todo', label: 'Not tried first' },
  { id: 'topic', label: 'By topic' },
  { id: 'easy', label: 'Easiest first' },
  { id: 'hard', label: 'Hardest first' },
];
const DEFAULT_PREFS: Prefs = { view: 'all', status: 'any', sort: 'newest' };
const PREFS_KEY = 'daily:practice-prefs';
const PAGE = 25;

const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);
const dots = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);
/** 0 not tried, 1 worth another go, 2 solved; generators are always fresh. */
const progressOf = (r: Row) => (r.kind === 'gen' || !r.status ? 0 : r.status === 'solved' ? 2 : 1);

function readPrefs(): Prefs | null {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (!p) return null;
    return {
      view: VIEWS.some((v) => v.id === p.view) ? p.view : DEFAULT_PREFS.view,
      status: STATUSES.some((s) => s.id === p.status) ? p.status : DEFAULT_PREFS.status,
      sort: SORTS.some((s) => s.id === p.sort) ? p.sort : DEFAULT_PREFS.sort,
    };
  } catch { return null; }
}

/**
 * Practice: as many questions as you like, from three sources: saved
 * questions added with the weekly upload, generators (fresh numbers every
 * time) and past days. Pick a source, narrow it by track, topic, difficulty,
 * status or a search, sort the list, then open one or take a random one. All
 * practice is half XP.
 */
export default function Practice({ today, signedIn, onAnswered, initialFocus }: { today: DateKey; signedIn: boolean; onAnswered: () => void; initialFocus?: { track: Track; topic: string } | null }) {
  const [pool, setPool] = useState<PoolItem[] | null>(null);
  const [gens, setGens] = useState<GenItem[]>([]);
  const [generatedDone, setGeneratedDone] = useState(0);
  const [focus, setFocus] = useState<Focus[]>([]);
  const [error, setError] = useState('');
  // The source, status and sort you last used on this device (a focus link starts from everything).
  // Nothing renders from these until the questions load, so reading storage here is safe.
  const [prefs] = useState(() => ({ ...DEFAULT_PREFS, ...(typeof window === 'undefined' ? null : readPrefs()) }));
  const [view, setView] = useState<View | 'all'>(initialFocus ? 'all' : prefs.view);
  const [status, setStatus] = useState<Status>(prefs.status);
  const [sort, setSort] = useState<Sort>(prefs.sort);
  const [track, setTrack] = useState<Track | 'all'>(initialFocus?.track ?? 'all');
  const [topic, setTopic] = useState(initialFocus?.topic ?? 'all');
  const [difficulty, setDifficulty] = useState(0);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [current, setCurrent] = useState<Current | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [session, setSession] = useState({ done: 0, xp: 0 });
  const listTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view, status, sort })); } catch { /* not kept */ }
  }, [view, status, sort]);

  useEffect(() => {
    fetch(`/api/daily/practice?today=${today}`, { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      if (!data.success) throw new Error(data.message);
      let questions: PoolItem[] = data.questions;
      let genDone: number = data.generatedDone ?? 0;
      if (!data.signedIn) {
        const kept = readDeviceAttempts();
        const mine = new Map(kept.map((a) => [a.questionId, a.result.status]));
        questions = questions.map((q) => ({ ...q, status: mine.get(q.id) ?? null }));
        genDone = kept.filter((a) => a.questionId.startsWith('gen-')).length;
      }
      setPool(questions);
      setGens(data.generators);
      setGeneratedDone(genDone);
    }).catch(() => setError('Couldn’t load the practice questions.'));
    fetchAnalysis(today).then(({ analysis }) => setFocus(analysis.focus.slice(0, 4))).catch(() => { /* no focus chips */ });
  }, [today, signedIn]);

  const rows = useMemo<Row[]>(() => [
    ...(pool ?? []).map((q, i) => ({
      id: q.id, kind: (q.source === 'pool' ? 'saved' : 'past') as View, date: q.date, added: q.added ?? null, core: q.core, boss: q.boss,
      track: q.track, topic: q.topic, difficulty: q.difficulty, title: q.title, status: q.status, order: i,
    })),
    ...gens.map((g, i) => ({
      id: `gen:${g.key}`, kind: 'gen' as const, genKey: g.key, date: null, added: null, core: false, boss: false,
      track: g.track, topic: g.topic, difficulty: g.difficulty, title: g.title, status: null, order: i,
    })),
  ], [pool, gens]);

  // Each filter, so the counts beside a choice can leave that choice out.
  const needle = search.trim().toLowerCase();
  const matches = useCallback((r: Row, except?: 'view' | 'topic') =>
    (except === 'view' || view === 'all' || r.kind === view)
    && (track === 'all' || r.track === track)
    && (except === 'topic' || topic === 'all' || r.topic === topic)
    && (!difficulty || r.difficulty === difficulty)
    && (status === 'any' || (status === 'todo' ? progressOf(r) === 0 : r.kind !== 'gen' && progressOf(r) === (status === 'done' ? 2 : 1)))
    && (!needle || `${r.title} ${r.topic} ${TRACK_LABEL[r.track]}`.toLowerCase().includes(needle)),
  [view, track, topic, difficulty, status, needle]);

  const viewCounts = useMemo(() => {
    const counts: Record<View | 'all', number> = { all: 0, saved: 0, gen: 0, past: 0 };
    for (const r of rows) if (matches(r, 'view')) { counts.all++; counts[r.kind]++; }
    return counts;
  }, [rows, matches]);
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (matches(r, 'topic')) counts.set(r.topic, (counts.get(r.topic) ?? 0) + 1);
    if (topic !== 'all' && !counts.has(topic)) counts.set(topic, 0);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, matches, topic]);

  const recent = addDays(today, -7);
  const isNew = (r: Row) => r.kind === 'saved' && !!r.added && r.added > recent;

  /** The list in the chosen order, each row with the heading it sits under. */
  const shown = useMemo(() => {
    const list = rows.filter((r) => matches(r));
    const byNewest = (a: Row, b: Row) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order;
    const byTitle = (a: Row, b: Row) => a.title.localeCompare(b.title);
    const compare: Record<Sort, (a: Row, b: Row) => number> = {
      newest: byNewest,
      todo: (a, b) => progressOf(a) - progressOf(b) || byNewest(a, b),
      topic: (a, b) => a.topic.localeCompare(b.topic) || a.difficulty - b.difficulty || byTitle(a, b),
      easy: (a, b) => a.difficulty - b.difficulty || byNewest(a, b),
      hard: (a, b) => b.difficulty - a.difficulty || byNewest(a, b),
    };
    const groupOf = (r: Row): string => {
      if (sort === 'topic') return r.topic;
      if (sort === 'easy' || sort === 'hard') return `${dots(r.difficulty)}  Difficulty ${r.difficulty}`;
      if (sort === 'todo') return ['Not tried yet', 'Worth another go', 'Solved'][progressOf(r)];
      if (view === 'all') return KIND_LABEL[r.kind];
      if (r.kind === 'saved') return r.added ? `Added the week of ${fmtDay(weekStart(r.added), { month: 'short', day: 'numeric' })}` : 'Added earlier';
      if (r.kind === 'past') return fmtDay(r.date!, { month: 'long', year: 'numeric' });
      return '';
    };
    const sorted = [...list].sort(compare[sort]);
    const sizes = new Map<string, number>();
    const items = sorted.map((r) => { const group = groupOf(r); sizes.set(group, (sizes.get(group) ?? 0) + 1); return { row: r, group }; });
    return { items, sizes };
  }, [rows, matches, sort, view]);

  // A new filter starts the list from the top.
  useEffect(() => setLimit(PAGE), [view, track, topic, difficulty, status, sort, needle]);

  const open = useCallback(async (id: string) => {
    setLoadingQ(true);
    setError('');
    try {
      const data = await fetch(`/api/daily/practice?today=${today}&id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then((r) => r.json());
      if (!data.success) throw new Error(data.message);
      let answered: Answered | null = data.answered;
      if (!signedIn) {
        const kept = readDeviceAttempts().find((a) => a.questionId === id);
        if (kept) answered = await regradeDeviceAttempt(kept).catch(() => null);
      }
      setCurrent({ id, date: data.date, source: data.source, core: data.core, boss: data.boss, question: data.question, formulas: data.formulas, answered, tries: data.tries ?? 0 });
      setSeen((s) => (s.includes(id) ? s : [...s, id]));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('Couldn’t open that question.');
    } finally {
      setLoadingQ(false);
    }
  }, [today, signedIn]);

  const openRow = (r: Row) => (r.genKey ? open(newGeneratedId(r.genKey)) : open(r.id));

  /**
   * A random question from what the filters show: half the time a generated
   * one (when any match), otherwise a saved or past one, preferring ones you
   * haven't tried and haven't seen this session.
   */
  const next = () => {
    const pickable = shown.items.map((x) => x.row).filter((r) => r.id !== current?.id);
    const generators = pickable.filter((r) => r.kind === 'gen');
    const stored = pickable.filter((r) => r.kind !== 'gen');
    const unseen = stored.filter((r) => !seen.includes(r.id));
    const fresh = unseen.filter((r) => !r.status);
    const from = fresh.length ? fresh : unseen.length ? unseen : stored;
    const pick = generators.length && (!from.length || Math.random() < 0.5) ? generators : from;
    if (pick.length) openRow(pick[Math.floor(Math.random() * pick.length)]);
  };
  const canNext = shown.items.some((x) => x.row.id !== current?.id);

  const answer = async (responses: Parameters<typeof sendAnswer>[0]['responses'], hints: number): Promise<CheckResult | null> => {
    if (!current) return null;
    setError('');
    try {
      const data = await sendAnswer({ date: current.date ?? today, questionId: current.id, responses, hints, tries: current.tries, today });
      if (!data.final) {
        setCurrent((c) => (c && c.id === current.id ? { ...c, tries: data.tries } : c));
        return data;
      }
      setCurrent((c) => (c && c.id === current.id ? { ...c, answered: data } : c));
      setPool((p) => p?.map((q) => (q.id === current.id ? { ...q, status: data.status } : q)) ?? p);
      if (current.source === 'generated') setGeneratedDone((n) => n + 1);
      setSession((s) => ({ done: s.done + 1, xp: s.xp + data.xp }));
      onAnswered();
      return null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check that answer.');
      return null;
    }
  };

  const filtered = track !== 'all' || topic !== 'all' || difficulty !== 0 || status !== 'any' || needle !== '';
  const clearFilters = () => { setTrack('all'); setTopic('all'); setDifficulty(0); setStatus('any'); setSearch(''); };
  const useFocus = (f: Focus) => { setView('all'); setTrack(f.track); setTopic(f.topic); setDifficulty(0); setStatus('any'); setSearch(''); };
  const backToList = () => { setCurrent(null); setTimeout(() => listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };

  if (error && !pool) return <p className="dq-hint">{error}</p>;
  if (!pool) return <p className="dq-hint">Loading questions…</p>;

  const banner = error && <div className="dq-banner is-error" role="alert"><span>{error}</span><button type="button" className="dq-small-btn" onClick={() => setError('')}>OK</button></div>;
  const sessionNote = session.done > 0 && <span className="dq-pq-session">This session: {session.done} done · +{session.xp} XP</span>;

  // One question at a time, with a way back to the list.
  if (current) {
    const from = current.source === 'generated' ? '🎲 Generated: fresh numbers, half XP'
      : current.source === 'pool' ? '📚 Saved practice question, half XP'
        : <>📅 From {fmtDay(current.date!)}{current.core ? '' : ' (bonus)'}{current.date! < today ? ' · catching up, half XP' : ''}</>;
    return (
      <div className="dq-practice">
        <div className="dq-pq-bar">
          <button type="button" className="dq-small-btn" onClick={backToList}>← All questions</button>
          <span className="dq-pq-from">{from}</span>
          {!current.answered && canNext && <button type="button" className="dq-small-btn" disabled={loadingQ} onClick={next}>{loadingQ ? 'Loading…' : 'Skip →'}</button>}
        </div>
        {sessionNote && <p className="dq-hint dq-practice-from">{sessionNote}</p>}
        {banner}
        <FormulaSheet formulas={current.formulas} />
        <QuestionCard key={current.id} q={current.question} kind={current.source === 'day' ? (current.core ? 'core' : 'bonus') : 'practice'} boss={current.boss}
          late={current.source === 'day' && current.date! < today}
          answered={current.answered ?? undefined} tries={current.tries} formulas={current.formulas} signedIn={signedIn}
          onAnswer={(r, h) => answer(r, h)} onReveal={(h) => answer(null, h)}
          onFeedback={async (patch) => {
            try {
              const feedback = await sendFeedback(current.id, patch);
              setCurrent((c) => (c?.answered ? { ...c, answered: { ...c.answered, feedback } } : c));
            } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t save that.'); }
          }} />
        {current.answered && (
          <div className="dq-actions dq-pq-after">
            {canNext && <button type="button" className="btn btn-primary" disabled={loadingQ} onClick={next}>{loadingQ ? 'Loading…' : 'Next question →'}</button>}
            <button type="button" className="btn btn-secondary" onClick={backToList}>Back to the list</button>
          </div>
        )}
      </div>
    );
  }

  const stored = shown.items.filter((x) => x.row.kind !== 'gen').map((x) => x.row);
  const solvedHere = stored.filter((r) => r.status === 'solved').length;
  const untried = stored.filter((r) => !r.status).length;
  const genCount = shown.items.length - stored.length;
  const page = shown.items.slice(0, limit);
  const viewInfo = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="dq-practice">
      {focus.length > 0 && (
        <section className="dq-practice-focus" aria-label="Your focus topics">
          <span className="dq-hint">🎯 Your focus</span>
          {focus.map((f) => (
            <button key={`${f.track}/${f.topic}`} type="button" className="dq-chip" aria-pressed={track === f.track && topic === f.topic} onClick={() => useFocus(f)} title={f.reason}>
              {f.topic} <small>· {TRACK_LABEL[f.track]}</small>
            </button>
          ))}
          <a className="dq-text-btn" href="/daily/report">Full report →</a>
        </section>
      )}

      <section className="dq-practice-filters" aria-label="Choose questions">
        <div className="dq-pq-sources" role="tablist" aria-label="Where the questions come from">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>
              <span aria-hidden>{v.icon}</span>
              <span>{v.label}</span>
              <small>{viewCounts[v.id]}</small>
            </button>
          ))}
        </div>
        <p className="dq-hint dq-pq-source-hint">
          {viewInfo.hint}
          {view === 'gen' && generatedDone > 0 && ` You’ve answered ${generatedDone} generated question${generatedDone === 1 ? '' : 's'} so far.`}
        </p>

        <label className="dq-pq-search">
          <span aria-hidden>🔍</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles and topics" aria-label="Search questions" />
        </label>

        <div className="dq-seg" role="radiogroup" aria-label="Track">
          {(['all', ...TRACKS] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={track === t} onClick={() => { setTrack(t); setTopic('all'); }}>
              {t === 'all' ? 'All' : TRACK_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="dq-practice-row">
          <label className="dq-practice-field">
            <span>Topic</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="all">All topics</option>
              {topics.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
            </select>
          </label>
          <label className="dq-practice-field">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
              <option value={0}>Any</option>
              {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{dots(d)} {d}</option>)}
            </select>
          </label>
          <label className="dq-practice-field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="dq-practice-field">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <div className="dq-pq-summary">
          <span>
            <strong>{shown.items.length}</strong> question{shown.items.length === 1 ? '' : 's'}
            {stored.length > 0 && <> · {untried} not tried · {solvedHere} solved</>}
            {genCount > 0 && <> · {genCount} endless</>}
          </span>
          {filtered && <button type="button" className="dq-text-btn" onClick={clearFilters}>Clear filters</button>}
        </div>
        {stored.length > 0 && (
          <div className="dq-pq-progress" role="progressbar" aria-label="Solved of the questions shown" aria-valuemin={0} aria-valuemax={stored.length} aria-valuenow={solvedHere}>
            <span style={{ width: `${(solvedHere / stored.length) * 100}%` }} />
          </div>
        )}
        {sessionNote && <p className="dq-hint" style={{ margin: 0 }}>{sessionNote}</p>}

        <div className="dq-actions" style={{ marginTop: '0.1rem' }}>
          <button type="button" className="btn btn-primary" disabled={!canNext || loadingQ} onClick={next}>
            {loadingQ ? 'Loading…' : '🎲 Start practicing'}
          </button>
        </div>
      </section>

      {banner}

      <div ref={listTop} className="dq-pq-list-top" />
      {shown.items.length === 0 ? (
        <p className="dq-hint dq-pq-empty">
          {status === 'todo' && rows.some((r) => matches({ ...r, status: null }))
            ? 'You’ve tried every question here. Set Status to “Any” to look back at them, or widen the filters.'
            : view === 'saved' && !rows.some((r) => r.kind === 'saved')
              ? 'No saved questions yet. They arrive with the weekly upload.'
              : 'Nothing matches those filters.'}
          {filtered && <> <button type="button" className="dq-text-btn" onClick={clearFilters}>Clear filters</button></>}
        </p>
      ) : (
        <ul className="dq-archive dq-practice-list">
          {page.map(({ row: r, group }, i) => (
            <li key={r.id}>
              {group && group !== page[i - 1]?.group && (
                <h4 className="dq-pq-group">{group} <small>{shown.sizes.get(group)}</small></h4>
              )}
              <button type="button" className={`is-${r.track}`} disabled={loadingQ} onClick={() => openRow(r)}>
                <span className="dq-archive-date">
                  {r.kind === 'gen' ? '🎲 Endless' : r.kind === 'saved' ? (r.added ? `📚 ${fmtDay(r.added, { month: 'short', day: 'numeric' })}` : '📚 Saved') : fmtDay(r.date!)}
                </span>
                <span className="dq-archive-title">
                  <span>{r.boss ? '👹 ' : ''}{r.title}{isNew(r) && <span className="dq-pq-new">New</span>}</span>
                  <small>
                    <i className="dq-dot" aria-hidden /> {TRACK_LABEL[r.track]} · {r.topic} · <span className="dq-pq-dots" title={`Difficulty ${r.difficulty} of 5`}>{dots(r.difficulty)}</span>
                    {r.kind === 'past' && !r.core ? ' · bonus' : ''}
                    {r.kind === 'gen' ? ' · new numbers each time' : ''}
                  </small>
                </span>
                <span className="dq-archive-status">
                  {r.kind === 'gen' ? <span className="dq-hint">∞</span> : r.status ? <span title={r.status}>{STATUS_ICON[r.status]}</span> : <span className="dq-hint">Not tried</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.items.length > limit && (
        <button type="button" className="btn btn-secondary dq-pq-more" onClick={() => setLimit((n) => n + PAGE * 2)}>
          Show more ({shown.items.length - limit} left)
        </button>
      )}
    </div>
  );
}
