'use client';

import 'katex/dist/katex.min.css';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import AnswerInput, { AnswerText, toResponse, type Draft } from '@/components/daily/AnswerInput';
import { MathText, SvgFigure } from '@/components/daily/MathText';
import { SignedOut, skillsPost } from '@/components/skills/api';
import type { PublicQuestion, QuestionStatus } from '@/lib/daily/grade';
import type { Question } from '@/lib/daily/types';
import { localToday } from '@/lib/habits/dates';
import type { QuickReason } from '@/lib/skills/quick';
import type { CardRating } from '@/lib/skills/types';
import { setInProgress, type ActivityProps } from './shared';

// One quick Skills question at a time: a recall card, a one-part pick or order
// question, or a short easy sum. Answers go through the same POST /api/skills
// ops as a review, so XP, levels and the review schedule move exactly the same.

type Base = { id: string; subjectId: string; subjectName: string; subjectIcon: string; topicName: string; reason: QuickReason };
type QuickItem = (Base & { kind: 'card'; front: string; back: string }) | (Base & { kind: 'graded'; question: PublicQuestion });
type Final = { status: QuestionStatus; question: Omit<Question, 'check'> };
type CheckResult = { final: false; tries: number; triesLeft: number };

type Session = {
  items: QuickItem[];
  index: number;
  /** Has any Skills questions at all (so an empty list can say why). */
  hasItems: boolean;
  draft: Draft;
  tries: number;
  check: CheckResult | null;
  final: Final | null;
  cardShown: boolean;
  rated: CardRating | null;
};

const REASON: Record<QuickReason, string> = { due: 'Due', weak: 'Weak spot', new: 'New', practice: 'Practice' };
const RATINGS: { rating: CardRating; label: string }[] = [
  { rating: 'again', label: 'Again' }, { rating: 'hard', label: 'Hard' }, { rating: 'good', label: 'Good' }, { rating: 'easy', label: 'Easy' },
];
const blank = { draft: {}, tries: 0, check: null, final: null, cardShown: false, rated: null };

// Kept here between rests, so a half-answered question is still there.
let kept: Session | null = null;

async function fetchQuick(): Promise<Pick<Session, 'items' | 'hasItems'>> {
  const res = await fetch(`/api/skills/quick?today=${localToday()}`, { cache: 'no-store' });
  if (res.status === 401) throw new SignedOut();
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Couldn’t load your questions. Try again.');
  return { items: body.items, hasItems: body.hasItems };
}

export default function SkillsQuestion({ canStartNew, onSwitch }: ActivityProps) {
  const [session, setSession] = useState<Session | null>(() => kept);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(session);

  const update = useCallback((next: Session | null) => {
    sessionRef.current = next;
    kept = next;
    setSession(next);
  }, []);
  const patch = (changes: Partial<Session>) => sessionRef.current && update({ ...sessionRef.current, ...changes });

  const item = session?.items[session.index];
  const answered = !!session && (!!session.final || !!session.rated);
  useEffect(() => { setInProgress('skills', !!item && !answered); }, [item, answered]);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      update({ ...(await fetchQuick()), index: 0, ...blank });
    } catch (e) {
      if (e instanceof SignedOut) setSignedOut(true);
      else setError(e instanceof Error ? e.message : 'Couldn’t load your questions. Try again.');
    } finally {
      setBusy(false);
    }
  }, [update]);

  useEffect(() => { if (!sessionRef.current) void load(); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  };

  const next = () => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.index + 1 < s.items.length) update({ ...s, index: s.index + 1, ...blank });
    else void load();
  };

  const others = (
    <span className="rest-suggest">
      Or try{' '}
      <button type="button" className="rest-link" onClick={() => onSwitch('chess')}>a chess puzzle</button> or{' '}
      <button type="button" className="rest-link" onClick={() => onSwitch('math')}>quick math</button>.
    </span>
  );

  if (signedOut) return <p className="rest-note">Sign in to answer your <Link href="/skills">Skills</Link> questions here. {others}</p>;
  if (!session) {
    return error
      ? <p className="rest-note">{error} <button type="button" className="rest-link" onClick={load}>Try again</button></p>
      : <p className="rest-note">Loading…</p>;
  }
  if (!item) {
    return session.hasItems
      ? <p className="rest-note">Nothing quick to answer right now — you’re up to date. {others}</p>
      : <p className="rest-note">No Skills questions yet. Add some in <Link href="/skills">Skills</Link>. {others}</p>;
  }

  const head = (
    <p className="rest-skill-head">
      <span>{item.subjectIcon} {item.subjectName} · {item.topicName}</span>
      <span className="rest-muted">{REASON[item.reason]}</span>
    </p>
  );
  const more = canStartNew
    ? <button type="button" className="rest-btn" disabled={busy} onClick={next}>Next question</button>
    : <p className="rest-note">That’s the rest. Go!</p>;

  if (item.kind === 'card') {
    const rate = (rating: CardRating) => run(async () => {
      await skillsPost('rate-card', { itemId: item.id, rating });
      patch({ rated: rating });
    });
    return (
      <div className="rest-skill">
        {head}
        <MathText className="rest-skill-text">{item.front}</MathText>
        {!session.cardShown ? (
          <button type="button" className="rest-btn is-primary" onClick={() => patch({ cardShown: true })}>Show answer</button>
        ) : (
          <>
            <div className="rest-skill-back"><MathText>{item.back}</MathText></div>
            {session.rated ? (
              <>
                <p className="rest-result">
                  {session.rated === 'good' || session.rated === 'easy' ? <strong className="rest-right">✓ Got it</strong> : <strong>Saved — it’ll come back soon</strong>}{' '}
                  <Link href={`/skills/${item.subjectId}?tab=questions`}>See it in Skills</Link>
                </p>
                {more}
              </>
            ) : (
              <div className="rest-rate" role="group" aria-label="How well did you know it?">
                {RATINGS.map((r) => (
                  <button key={r.rating} type="button" className={`rest-btn is-${r.rating}`} disabled={busy} onClick={() => rate(r.rating)}>{r.label}</button>
                ))}
              </div>
            )}
          </>
        )}
        {error && <p className="rest-note is-wrong">{error}</p>}
      </div>
    );
  }

  const { question } = item;
  const part = question.parts[0];
  const response = toResponse(part.input, session.draft);
  const final = session.final;
  const submit = (responses: Record<string, unknown> | null) => run(async () => {
    const out = await skillsPost<{ result: CheckResult | ({ final: true } & Final) }>('answer', { itemId: item.id, responses, tries: sessionRef.current?.tries ?? 0 });
    if (out.result.final) patch({ final: { status: out.result.status, question: out.result.question }, check: null });
    else patch({ check: out.result, tries: out.result.tries });
  });
  const verdict = final && (final.status === 'solved' ? <strong className="rest-right">✓ Right</strong>
    : final.status === 'partial' ? <strong>Partly right</strong>
    : <strong className="rest-wrong">✗ Not this time</strong>);

  return (
    <div className="rest-skill">
      {head}
      <MathText className="rest-skill-text">{question.prompt}</MathText>
      {question.figure && <SvgFigure svg={question.figure} alt={question.figureAlt ?? 'Figure for the question'} />}
      {part.prompt && <MathText className="rest-skill-text">{part.prompt}</MathText>}
      <span id={`rest-q-${item.id}-label`} className="rest-sr">Your answer</span>
      <AnswerInput id={`rest-q-${item.id}`} input={part.input} draft={session.draft} locked={!!final || busy} onChange={(draft) => patch({ draft, check: null })} />
      {final ? (
        <>
          <p className="rest-result">
            {verdict} <span className="rest-muted">Answer:</span> <AnswerText answer={final.question.parts[0].answer} />
          </p>
          <p className="rest-note"><Link href={`/skills/${item.subjectId}?tab=questions`}>See the full solution in Skills</Link></p>
          {more}
        </>
      ) : (
        <div className="rest-actions">
          <button type="button" className="rest-btn is-primary" disabled={!response || busy} onClick={() => submit({ [part.id]: response })}>Check</button>
          {session.check && <span className="rest-note is-wrong">Not quite — {session.check.triesLeft} more {session.check.triesLeft === 1 ? 'try' : 'tries'}.</span>}
          <button type="button" className="rest-link" disabled={busy} onClick={() => submit(null)}>Show answer</button>
        </div>
      )}
      {error && <p className="rest-note is-wrong">{error}</p>}
    </div>
  );
}
