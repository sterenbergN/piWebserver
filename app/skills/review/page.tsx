'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QuestionCard, { type Answered, type Feedback } from '@/components/daily/QuestionCard';
import type { CheckResult } from '@/components/daily/useDaily';
import type { PartResponse } from '@/lib/daily/types';
import type { CardRating } from '@/lib/skills/types';
import type { QueueReason } from '@/lib/skills/model';
import { skillsGet, skillsPost, SignedOut, type AnswerResponse, type Ask, type ReviewResponse } from '@/components/skills/api';
import { ErrorNote, Loading, SignedOutCard } from '@/components/skills/Ui';
import RecallCard from '@/components/skills/review/RecallCard';
import SessionSummary, { type Outcome } from '@/components/skills/review/SessionSummary';

// Review: one question at a time from the server’s queue (due, fading, new),
// graded questions in the daily card and recall cards in their own. The session
// lives in state; a reload asks the server for a fresh queue.

const REASON: Record<QueueReason, string> = {
  due: '🔁 Due',
  fading: '🍂 Fading — keep it fresh',
  new: '✨ New',
  weak: '⚠️ Weak spot',
  practice: '🎯 Practice',
};
const MODES = [['due', 'Due today'], ['weak', 'Weak spots'], ['all', 'Everything']] as const;
type Mode = (typeof MODES)[number][0];

const FEEDBACK_HINT = 'Both optional. “Too easy” or “too hard” tunes the next questions you ask your AI for; reporting a problem retires the question so it stops counting toward your level.';

function Review() {
  const router = useRouter();
  const params = useSearchParams();
  const subject = params.get('subject') ?? undefined;
  const topic = params.get('topic') ?? undefined;
  const rawMode = params.get('mode');
  const mode: Mode = rawMode === 'weak' || rawMode === 'all' || rawMode === 'due' ? rawMode : topic ? 'all' : 'due';

  const [queue, setQueue] = useState<Ask[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [tries, setTries] = useState(0);
  const [answered, setAnswered] = useState<Answered | undefined>();
  const [scope, setScope] = useState<{ subjectName?: string; subjectIcon?: string; topicName?: string }>({});

  const load = useCallback(async () => {
    setQueue(null); setError(''); setIndex(0); setOutcomes([]); setTries(0); setAnswered(undefined);
    try {
      const res = await skillsGet<ReviewResponse>({ review: '1', subject, topic, mode, limit: '20' });
      setQueue(res.queue);
      const first = res.queue[0];
      if (first) setScope({ subjectName: first.subjectName, subjectIcon: first.subjectIcon, topicName: first.topicName });
    } catch (e) {
      if (e instanceof SignedOut) setSignedOut(true);
      else setError(e instanceof Error ? e.message : 'Couldn’t load your questions.');
    }
  }, [subject, topic, mode]);
  useEffect(() => { void load(); }, [load]);

  const entry = queue?.[index];
  const done = !!queue && queue.length > 0 && index >= queue.length;

  // A fresh question starts at the top, with no leftover checks.
  useEffect(() => { window.scrollTo({ top: 0 }); setTries(0); setAnswered(undefined); }, [index]);

  const advance = useCallback(() => setIndex((i) => i + 1), []);
  const record = useCallback((e: Ask, right: boolean) => {
    setOutcomes((all) => [...all, { id: e.id, title: e.kind === 'graded' ? e.question.title : e.front.slice(0, 80), subjectId: e.subjectId, subjectName: e.subjectName, subjectIcon: e.subjectIcon, topicName: e.topicName, right }]);
  }, []);

  // Enter moves on after a graded question, unless you’re typing or on a control.
  useEffect(() => {
    if (!answered) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.key !== 'Enter' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.tagName === 'A' || t.isContentEditable)) return;
      ev.preventDefault();
      advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered, advance]);

  const setMode = (m: Mode) => {
    const q = new URLSearchParams(params.toString());
    q.set('mode', m);
    router.replace(`/skills/review?${q}`);
  };

  async function submit(e: Ask, responses: Record<string, PartResponse> | null, hints: number) {
    const { result } = await skillsPost<AnswerResponse>('answer', { itemId: e.id, responses, hints, tries });
    if (!result.final) { setTries(result.tries); return result as CheckResult; }
    const { final, ...rest } = result;
    void final;
    // The server sends any votes or report already on this question.
    setAnswered({ ...rest, feedback: rest.feedback ?? { rating: null, difficulty: null, report: null } });
    record(e, rest.status === 'solved');
    return result;
  }

  async function sendFeedback(e: Ask, patch: Partial<Feedback>) {
    await skillsPost('feedback', { itemId: e.id, changes: patch });
    setAnswered((a) => a && { ...a, feedback: { rating: null, difficulty: null, report: null, ...a.feedback, ...patch } });
  }

  const scoped = !!subject && !!scope.subjectName;
  const right = outcomes.filter((o) => o.right).length;
  const total = queue?.length ?? 0;
  const shown = Math.min(index + 1, total);

  const keepGoing = () => {
    if (mode === 'all') void load();
    else setMode('all');
  };

  return (
    <main className="sk sk-narrow sk-review">
      <header className="sk-head">
        <div>
          {scoped ? <Link href={`/skills/${subject}`} className="sk-back">← {scope.subjectIcon} {scope.subjectName}</Link> : <Link href="/skills" className="sk-back">← Skills</Link>}
          <h1>{topic && scope.topicName ? scope.topicName : 'Review'}</h1>
        </div>
        {!topic && (
          <div className="sk-modes" role="group" aria-label="What to review">
            {MODES.map(([m, label]) => (
              <button key={m} type="button" className="sk-small-btn" aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
        )}
      </header>

      {signedOut && <SignedOutCard />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!signedOut && !error && !queue && <Loading rows={2} />}

      {queue && queue.length === 0 && (
        <section className="sk-card sk-review-empty">
          <h2>{mode === 'all' ? 'No questions here yet' : 'Nothing due right now'}</h2>
          <p className="sk-hint">{mode === 'all' ? 'There’s nothing to ask yet. Write some questions and they’ll show up here.' : 'You’re all caught up. You can still practise the shaky spots, or test yourself on everything.'}</p>
          <div className="sk-actions">
            {mode !== 'weak' && <button type="button" className="btn btn-primary" onClick={() => setMode('weak')}>Weak spots</button>}
            {mode !== 'all' && <button type="button" className="btn btn-secondary" onClick={() => setMode('all')}>Everything</button>}
            <Link href={subject ? `/skills/${subject}/questions` : '/skills'} className="btn btn-secondary">Write questions</Link>
          </div>
        </section>
      )}

      {queue && queue.length > 0 && !done && entry && (
        <>
          <div className="sk-progress">
            <div className="sk-progress-text"><span>{shown} of {total}</span><span>{right} right so far</span></div>
            <div className="sk-progress-bar" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}>
              <span style={{ width: `${(index / total) * 100}%` }} />
            </div>
          </div>

          {entry.kind === 'graded' ? (
            <>
              <QuestionCard key={entry.id} q={entry.question} kind="practice" boss={false} late={false} formulas={[]} signedIn
                tries={tries} answered={answered}
                elsewhere={{ label: `${entry.subjectIcon} ${entry.subjectName}`, kindLabel: REASON[entry.reason], feedbackHint: FEEDBACK_HINT }}
                onAnswer={(responses, hints) => submit(entry, responses, hints)}
                onReveal={(hints) => submit(entry, null, hints)}
                onFeedback={(patch) => sendFeedback(entry, patch)} />
              {answered && (
                <div className="sk-actions sk-next">
                  <button type="button" className="btn btn-primary" autoFocus onClick={advance}>{index + 1 >= total ? 'Finish' : 'Next question'}</button>
                </div>
              )}
            </>
          ) : (
            <RecallCard key={entry.id} entry={entry} badge={REASON[entry.reason]}
              onRate={async (rating: CardRating) => {
                await skillsPost('rate-card', { itemId: entry.id, rating });
                record(entry, rating === 'good' || rating === 'easy');
                advance();
              }}
              onReport={async (note) => {
                await skillsPost('feedback', { itemId: entry.id, changes: { report: { kind: 'wrong-answer', note } } });
                advance();
              }} />
          )}
        </>
      )}

      {done && <SessionSummary outcomes={outcomes} subjectId={scoped ? subject : undefined} subjectName={scope.subjectName} onKeepGoing={keepGoing} />}
    </main>
  );
}

export default function ReviewPage() {
  return <Suspense><Review /></Suspense>;
}
