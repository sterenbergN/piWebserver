'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import QuestionCard, { type Answered } from './QuestionCard';
import FormulaSheet from './FormulaSheet';
import { fetchAnalysis, readDeviceAttempts, regradeDeviceAttempt, sendAnswer, sendFeedback, type CheckResult } from './useDaily';
import type { DateKey } from '@/lib/habits/dates';
import type { PublicQuestion, QuestionStatus } from '@/lib/daily/grade';
import type { Focus } from '@/lib/daily/analysis';
import { newGeneratedId } from '@/lib/daily/generated';
import { TRACKS, TRACK_LABEL, type Formula, type Track } from '@/lib/daily/types';

type Source = 'day' | 'pool' | 'generated';
type PoolItem = { id: string; date: DateKey | null; source: 'day' | 'pool'; core: boolean; boss: boolean; track: Track; topic: string; difficulty: number; title: string; status: QuestionStatus | null };
type GenItem = { key: string; track: Track; topic: string; difficulty: number; title: string };
type Current = { id: string; date: DateKey | null; source: Source; core: boolean; boss: boolean; question: PublicQuestion; formulas: Formula[]; answered: Answered | null; tries: number };
type Show = 'all' | 'new' | 'past';

const STATUS_ICON: Record<QuestionStatus, string> = { solved: '✅', partial: '🟡', wrong: '❌', studied: '📖' };
const SHOW: { id: Show; label: string }[] = [{ id: 'all', label: 'Everything' }, { id: 'new', label: 'New questions' }, { id: 'past', label: 'Past days' }];
const fmtDay = (d: DateKey) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Practice: as many questions as you like. New questions come from the
 * generators (fresh numbers every time) and the practice-only pool; past
 * days' questions are there too. Filter by track, topic and difficulty, or
 * pick one of your focus topics from the analysis. All practice is half XP.
 */
export default function Practice({ today, signedIn, onAnswered, initialFocus }: { today: DateKey; signedIn: boolean; onAnswered: () => void; initialFocus?: { track: Track; topic: string } | null }) {
  const [pool, setPool] = useState<PoolItem[] | null>(null);
  const [gens, setGens] = useState<GenItem[]>([]);
  const [focus, setFocus] = useState<Focus[]>([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [track, setTrack] = useState<Track | 'all'>(initialFocus?.track ?? 'all');
  const [topic, setTopic] = useState(initialFocus?.topic ?? 'all');
  const [difficulty, setDifficulty] = useState(0);
  const [onlyNew, setOnlyNew] = useState(true);
  const [current, setCurrent] = useState<Current | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [session, setSession] = useState({ done: 0, xp: 0 });
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    fetch(`/api/daily/practice?today=${today}`, { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      if (!data.success) throw new Error(data.message);
      let questions: PoolItem[] = data.questions;
      if (!data.signedIn) {
        const mine = new Map(readDeviceAttempts().map((a) => [a.questionId, a.result.status]));
        questions = questions.map((q) => ({ ...q, status: mine.get(q.id) ?? null }));
      }
      setPool(questions);
      setGens(data.generators);
    }).catch(() => setError('Couldn’t load the practice questions.'));
    fetchAnalysis(today).then(({ analysis }) => setFocus(analysis.focus.slice(0, 4))).catch(() => { /* no focus chips */ });
  }, [today, signedIn]);

  const matchesFilters = (q: { track: Track; topic: string; difficulty: number }) =>
    (track === 'all' || q.track === track) && (topic === 'all' || q.topic === topic) && (!difficulty || q.difficulty === difficulty);
  const stored = useMemo(() => (pool ?? []).filter((q) => (show === 'all' || (show === 'new' ? q.source === 'pool' : q.source === 'day')) && matchesFilters(q)),
    [pool, show, track, topic, difficulty]);
  const genMatches = useMemo(() => (show === 'past' ? [] : gens.filter(matchesFilters)), [gens, show, track, topic, difficulty]);
  const fresh = stored.filter((q) => !q.status);
  const candidates = onlyNew ? fresh : stored;
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of [...(pool ?? []), ...gens]) if (track === 'all' || q.track === track) counts.set(q.topic, (counts.get(q.topic) ?? 0) + 1);
    if (topic !== 'all' && !counts.has(topic)) counts.set(topic, 0);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [pool, gens, track, topic]);

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

  const openGenerated = (key: string) => open(newGeneratedId(key));

  /**
   * Another question from the filters: half the time a generated one (when
   * any match), otherwise a stored one not yet shown this session.
   */
  const next = () => {
    const unseen = candidates.filter((q) => !seen.includes(q.id) && q.id !== current?.id);
    const storedFrom = unseen.length ? unseen : candidates.filter((q) => q.id !== current?.id);
    const useGen = genMatches.length > 0 && (storedFrom.length === 0 || Math.random() < (show === 'new' ? 0.6 : 0.5));
    if (useGen) openGenerated(genMatches[Math.floor(Math.random() * genMatches.length)].key);
    else if (storedFrom.length) open(storedFrom[Math.floor(Math.random() * storedFrom.length)].id);
  };
  const canNext = candidates.length > 0 || genMatches.length > 0;

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
      setSession((s) => ({ done: s.done + 1, xp: s.xp + data.xp }));
      onAnswered();
      return null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check that answer.');
      return null;
    }
  };

  const useFocus = (f: Focus) => { setShow('all'); setTrack(f.track); setTopic(f.topic); setDifficulty(0); setOnlyNew(true); setBrowsing(false); };

  if (error && !pool) return <p className="dq-hint">{error}</p>;
  if (!pool) return <p className="dq-hint">Loading questions…</p>;

  const solved = pool.filter((q) => q.status === 'solved').length;
  const noneHere = !candidates.length && !genMatches.length;

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
        <div className="dq-seg" role="radiogroup" aria-label="Which questions">
          {SHOW.map((s) => <button key={s.id} type="button" role="radio" aria-checked={show === s.id} onClick={() => setShow(s.id)}>{s.label}</button>)}
        </div>
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
              {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'●'.repeat(d)}{'○'.repeat(5 - d)} {d}</option>)}
            </select>
          </label>
          <button type="button" className="dq-chip" aria-pressed={onlyNew} onClick={() => setOnlyNew((v) => !v)}>Skip ones I’ve done</button>
        </div>
        <p className="dq-hint" style={{ margin: 0 }}>
          {stored.length} saved question{stored.length === 1 ? '' : 's'} ({fresh.length} not done)
          {genMatches.length > 0 && <> · <strong>{genMatches.length} generator{genMatches.length === 1 ? '' : 's'}</strong> with endless fresh numbers</>}
          {' '}· {solved} of {pool.length} saved solved
          {session.done > 0 && <> · <strong>this session: {session.done} done, +{session.xp} XP</strong></>}
        </p>
        <div className="dq-actions" style={{ marginTop: '0.25rem' }}>
          <button type="button" className="btn btn-primary" disabled={!canNext || loadingQ} onClick={next}>
            {loadingQ ? 'Loading…' : current ? 'Next question →' : 'Start practising'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setBrowsing((b) => !b)}>{browsing ? 'Hide the list' : 'Pick from the list'}</button>
        </div>
        {noneHere && (
          <p className="dq-hint" style={{ margin: 0 }}>
            {onlyNew && stored.length ? 'You’ve done every saved question here. Turn off “Skip ones I’ve done” to look back at them, or widen the filters.' : 'Nothing matches those filters yet.'}
          </p>
        )}
      </section>

      {error && <div className="dq-banner is-error" role="alert"><span>{error}</span><button type="button" className="dq-small-btn" onClick={() => setError('')}>OK</button></div>}

      {browsing && (
        <ul className="dq-archive dq-practice-list">
          {genMatches.map((g) => (
            <li key={g.key}>
              <button type="button" className={`is-${g.track}`} onClick={() => { setBrowsing(false); openGenerated(g.key); }}>
                <span className="dq-archive-date">🎲 New</span>
                <span className="dq-archive-title">
                  {g.title}
                  <small><i className="dq-dot" aria-hidden /> {TRACK_LABEL[g.track]} · {g.topic} · difficulty {g.difficulty} · fresh numbers each time</small>
                </span>
                <span className="dq-archive-status"><span className="dq-hint">∞</span></span>
              </button>
            </li>
          ))}
          {(onlyNew ? fresh : stored).map((q) => (
            <li key={q.id}>
              <button type="button" className={`is-${q.track}`} onClick={() => { setBrowsing(false); open(q.id); }}>
                <span className="dq-archive-date">{q.date ? fmtDay(q.date) : '🆕 Practice'}</span>
                <span className="dq-archive-title">
                  {q.boss ? '👹 ' : ''}{q.title}
                  <small><i className="dq-dot" aria-hidden /> {TRACK_LABEL[q.track]} · {q.topic} · difficulty {q.difficulty}{q.source === 'day' && !q.core ? ' · bonus' : ''}</small>
                </span>
                <span className="dq-archive-status">{q.status ? STATUS_ICON[q.status] : <span className="dq-hint">New</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {current && (
        <>
          <p className="dq-hint dq-practice-from">
            {current.source === 'generated' ? '🎲 Generated for you — fresh numbers, half XP'
              : current.source === 'pool' ? '🆕 Practice question, half XP'
                : <>From {fmtDay(current.date!)}{current.core ? '' : ' (bonus)'}{current.date! < today ? ' · catching up, half XP' : ''}</>}
          </p>
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
          {current.answered && canNext && (
            <button type="button" className="btn btn-primary dq-practice-next" onClick={next}>Next question →</button>
          )}
        </>
      )}
    </div>
  );
}
