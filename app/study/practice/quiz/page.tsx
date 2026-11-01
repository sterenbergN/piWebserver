'use client';

import Link from 'next/link';
import { Loading } from '@/components/study/Ui';
import { useEffect, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { practicePost } from '@/components/study/api';
import { PartnerLink, useLiveSession } from '@/components/study/PartnerLink';
import { Scope } from '@/components/study/Scope';
import { localToday } from '@/lib/habits/dates';
import { QUIZ_SIZES, type OwnerSessionView } from '@/lib/study/partner';

// Her side of Quiz me: pick what to be asked, hand over the link, and answer out
// loud. Her screen only shows the score, so it can stay out on the table.

type Options = { total: number; misses: number; courses: string[]; systems: string[] };

export default function QuizPage() {
  const { session, setSession, loaded, signedOut } = useLiveSession();
  const [options, setOptions] = useState<Options | null>(null);
  const [course, setCourse] = useState('');
  const [system, setSystem] = useState('');
  const [missesOnly, setMissesOnly] = useState(false);
  const [size, setSize] = useState(QUIZ_SIZES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/study/games?options=1&today=${localToday()}`, { cache: 'no-store' }).then((r) => r.json()).then((body) => {
      if (!cancelled && body.success) setOptions(body);
    }).catch(() => { /* the form just waits */ });
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const body = await practicePost<{ session: OwnerSessionView }>('start-quiz', { course, system, missesOnly, size });
      setSession(body.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start a quiz. Try again.');
    }
    setBusy(false);
  };
  const end = async () => {
    try {
      await practicePost('end-session');
      setSession(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t end it. Try again.');
    }
  };

  if (signedOut) return <div className="sd"><SignInPrompt title="Sign in to be quizzed">These are your own questions.</SignInPrompt></div>;
  const quiz = session?.kind === 'quiz' && 'total' in session ? session : null;
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/practice">← Practice</Link>
          <h1>Quiz me</h1>
          <p>You answer out loud. They mark it.</p>
        </div>
      </header>
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
      {!loaded && <Loading rows={2} />}

      {loaded && session?.kind === 'patient' && (
        <div className="hb-banner">
          <span>A mock patient link is open. Starting a quiz will end it.</span>
        </div>
      )}

      {quiz && !quiz.finished && (
        <>
          <PartnerLink token={quiz.token} who="Whoever’s quizzing you" onEnd={end} />
          <section className="sd-card pr-live" aria-live="polite">
            <p className="pr-live-big">{quiz.index === 0 ? 'Waiting for the first question' : `${quiz.index} of ${quiz.total} asked`}</p>
            <p className="hb-hint">{quiz.right} right, {quiz.wrong} wrong so far. This page keeps up by itself.</p>
          </section>
        </>
      )}

      {quiz?.finished && (
        <section className="sd-card sd-done">
          <h2>{quiz.right} right, {quiz.wrong} wrong</h2>
          {'missedStems' in quiz && !!quiz.missedStems?.length && (
            <>
              <p className="hb-hint">These went in your miss bank:</p>
              <ul className="pr-missed">{quiz.missedStems.map((stem) => <li key={stem}><MathText>{stem}</MathText></li>)}</ul>
            </>
          )}
          <div className="sd-actions">
            <button type="button" className="btn btn-primary" onClick={end}>Done</button>
            {quiz.wrong > 0 && <Link className="btn btn-secondary" href="/study/review">Review misses</Link>}
          </div>
        </section>
      )}

      {loaded && !quiz && options && (options.total === 0 ? (
        <section className="sd-card sd-done">
          <h2>No questions yet</h2>
          <p className="hb-hint">Quiz me uses your own questions, so add a test first.</p>
          <Link className="btn btn-primary" href="/study/add">Add a test</Link>
        </section>
      ) : (
        <section className="sd-card">
          <h2>What to be asked</h2>
          <Scope options={options} course={course} system={system} setCourse={setCourse} setSystem={setSystem} />
          <div className="sd-fields">
            <label>Questions
              <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {QUIZ_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          {options.misses > 0 && (
            <label className="sd-check">
              <input type="checkbox" checked={missesOnly} onChange={(e) => setMissesOnly(e.target.checked)} />
              <span>Only questions in my miss bank ({options.misses})</span>
            </label>
          )}
          <p className="hb-hint">What’s due for review comes first. You’ll get a link and a QR code for their phone, and they don’t need an account.</p>
          <button type="button" className="btn btn-primary sd-self-start" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Get a link'}</button>
        </section>
      ))}
    </div>
  );
}
