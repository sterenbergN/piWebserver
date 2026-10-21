'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import QuestionCard, { type Answered } from './QuestionCard';
import FormulaSheet from './FormulaSheet';
import { readDeviceAttempts, regradeDeviceAttempt, sendAnswer, sendFeedback, type CheckResult } from './useDaily';
import type { DateKey } from '@/lib/habits/dates';
import type { PublicQuestion, QuestionStatus } from '@/lib/daily/grade';
import { TRACKS, TRACK_LABEL, type Formula, type Track } from '@/lib/daily/types';

type PoolItem = { id: string; date: DateKey; core: boolean; boss: boolean; track: Track; topic: string; difficulty: number; title: string; status: QuestionStatus | null };
type Current = { id: string; date: DateKey; core: boolean; boss: boolean; question: PublicQuestion; formulas: Formula[]; answered: Answered | null; tries: number };

const STATUS_ICON: Record<QuestionStatus, string> = { solved: '✅', partial: '🟡', wrong: '❌', studied: '📖' };
const fmtDay = (d: DateKey) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Practice: as many questions as you like from every past day, filtered by
 * track, topic and difficulty. New ones come first. Answers count as catching
 * up (half XP), and each question can only be done once, like on its day.
 */
export default function Practice({ today, signedIn, onAnswered }: { today: DateKey; signedIn: boolean; onAnswered: () => void }) {
  const [pool, setPool] = useState<PoolItem[] | null>(null);
  const [error, setError] = useState('');
  const [track, setTrack] = useState<Track | 'all'>('all');
  const [topic, setTopic] = useState('all');
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
    }).catch(() => setError('Couldn’t load the practice questions.'));
  }, [today, signedIn]);

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of pool ?? []) if (track === 'all' || q.track === track) counts.set(q.topic, (counts.get(q.topic) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [pool, track]);
  const matches = useMemo(() => (pool ?? []).filter((q) =>
    (track === 'all' || q.track === track)
    && (topic === 'all' || q.topic === topic)
    && (!difficulty || q.difficulty === difficulty)), [pool, track, topic, difficulty]);
  const fresh = matches.filter((q) => !q.status);
  const candidates = onlyNew ? fresh : matches;

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
      setCurrent({ id, date: data.date, core: data.core, boss: data.boss, question: data.question, formulas: data.formulas, answered, tries: data.tries ?? 0 });
      setSeen((s) => (s.includes(id) ? s : [...s, id]));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('Couldn’t open that question.');
    } finally {
      setLoadingQ(false);
    }
  }, [today, signedIn]);

  /** A random question from the filters, skipping ones already shown this session where possible. */
  const next = () => {
    const unseen = candidates.filter((q) => !seen.includes(q.id) && q.id !== current?.id);
    const from = unseen.length ? unseen : candidates.filter((q) => q.id !== current?.id);
    if (!from.length) return;
    open(from[Math.floor(Math.random() * from.length)].id);
  };

  const answer = async (responses: Parameters<typeof sendAnswer>[0]['responses'], hints: number): Promise<CheckResult | null> => {
    if (!current) return null;
    setError('');
    try {
      const data = await sendAnswer({ date: current.date, questionId: current.id, responses, hints, tries: current.tries, today });
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

  if (error && !pool) return <p className="dq-hint">{error}</p>;
  if (!pool) return <p className="dq-hint">Loading questions…</p>;
  if (!pool.length) return <p className="dq-hint">No questions to practise yet.</p>;

  const solved = pool.filter((q) => q.status === 'solved').length;

  return (
    <div className="dq-practice">
      <section className="dq-practice-filters" aria-label="Choose questions">
        <div className="dq-practice-row">
          <div className="dq-seg" role="radiogroup" aria-label="Track">
            {(['all', ...TRACKS] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={track === t} onClick={() => { setTrack(t); setTopic('all'); }}>
                {t === 'all' ? 'All' : TRACK_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="dq-practice-row">
          <label className="dq-practice-field">
            <span>Topic</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="all">All topics</option>
              {topics.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
            </select>
          </label>
          <label className="dq-practice-field">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
              <option value={0}>Any</option>
              {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'●'.repeat(d)}{'○'.repeat(5 - d)} {d}</option>)}
            </select>
          </label>
          <button type="button" className="dq-chip" aria-pressed={onlyNew} onClick={() => setOnlyNew((v) => !v)}>Only ones I haven’t done</button>
        </div>
        <p className="dq-hint" style={{ margin: 0 }}>
          {matches.length} question{matches.length === 1 ? '' : 's'} · {fresh.length} new · {solved} of {pool.length} solved overall
          {session.done > 0 && <> · <strong>this session: {session.done} done, +{session.xp} XP</strong></>}
        </p>
        <div className="dq-actions" style={{ marginTop: '0.25rem' }}>
          <button type="button" className="btn btn-primary" disabled={!candidates.length || loadingQ} onClick={next}>
            {loadingQ ? 'Loading…' : current ? 'Next question →' : 'Start practising'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setBrowsing((b) => !b)}>{browsing ? 'Hide the list' : 'Pick from the list'}</button>
        </div>
        {!candidates.length && <p className="dq-hint" style={{ margin: 0 }}>{onlyNew && matches.length ? 'You’ve done every question here. Turn off “Only ones I haven’t done” to look back at them.' : 'Nothing matches those filters.'}</p>}
      </section>

      {error && <div className="dq-banner is-error" role="alert"><span>{error}</span><button type="button" className="dq-small-btn" onClick={() => setError('')}>OK</button></div>}

      {browsing && (
        <ul className="dq-archive dq-practice-list">
          {(onlyNew ? fresh : matches).map((q) => (
            <li key={q.id}>
              <button type="button" className={`is-${q.track}`} onClick={() => { setBrowsing(false); open(q.id); }}>
                <span className="dq-archive-date">{fmtDay(q.date)}</span>
                <span className="dq-archive-title">
                  {q.boss ? '👹 ' : ''}{q.title}
                  <small><i className="dq-dot" aria-hidden /> {TRACK_LABEL[q.track]} · {q.topic} · difficulty {q.difficulty}{q.core ? '' : ' · bonus'}</small>
                </span>
                <span className="dq-archive-status">{q.status ? STATUS_ICON[q.status] : <span className="dq-hint">New</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {current && (
        <>
          <p className="dq-hint dq-practice-from">From {fmtDay(current.date)}{current.core ? '' : ' (bonus)'}{current.date < today ? ' · catching up, half XP' : ''}</p>
          <FormulaSheet formulas={current.formulas} />
          <QuestionCard key={current.id} q={current.question} kind={current.core ? 'core' : 'bonus'} boss={current.boss} late={current.date < today}
            answered={current.answered ?? undefined} tries={current.tries} formulas={current.formulas} signedIn={signedIn}
            onAnswer={(r, h) => answer(r, h)} onReveal={(h) => answer(null, h)}
            onFeedback={async (patch) => {
              try {
                const feedback = await sendFeedback(current.id, patch);
                setCurrent((c) => (c?.answered ? { ...c, answered: { ...c.answered, feedback } } : c));
              } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t save that.'); }
            }} />
          {current.answered && candidates.some((q) => q.id !== current.id) && (
            <button type="button" className="btn btn-primary dq-practice-next" onClick={next}>Next question →</button>
          )}
        </>
      )}
    </div>
  );
}
