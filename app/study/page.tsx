'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet } from '@/components/study/api';
import { localToday } from '@/lib/habits/dates';
import type { StudySummary, TestSummary } from '@/lib/study/study';

// The study room's front door: what's due, the tests you've made, and where
// you're weakest.

const pct = (right: number, total: number) => (total ? Math.round((right / total) * 100) : 0);
const fmtDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function nextReview(nextOn: string | null) {
  if (!nextOn) return '';
  const days = Math.round((new Date(`${nextOn}T12:00:00`).getTime() - new Date(`${localToday()}T12:00:00`).getTime()) / 86400000);
  return days <= 1 ? 'The next ones come back tomorrow.' : `The next ones come back ${fmtDay(nextOn)}.`;
}

function TestRow({ test }: { test: TestSummary }) {
  return (
    <li>
      <Link className="sd-test" href={`/study/test/${test.id}`}>
        <span className="sd-test-main">
          <strong>{test.title}</strong>
          <small>{[test.course, `${test.count} question${test.count === 1 ? '' : 's'}`, fmtDay(test.createdAt)].filter(Boolean).join(' · ')}</small>
        </span>
        {test.open ? <span className="td-chip is-going">Continue · {test.open.answered}/{test.open.total}</span>
          : test.last ? <span className="sd-score">{pct(test.last.right, test.last.total)}%</span>
            : <span className="td-chip">Not taken</span>}
      </Link>
    </li>
  );
}

export default function StudyPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [course, setCourse] = useState('');

  useEffect(() => {
    let cancelled = false;
    studyGet<{ summary: StudySummary }>().then((body) => {
      if (cancelled) return;
      setSummary(body.summary);
      setState('ready');
    }).catch((error) => { if (!cancelled) setState(error instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => (summary?.tests ?? []).filter((t) => !course || t.course === course), [summary, course]);

  if (state === 'signed-out') {
    return <div className="sd"><SignInPrompt title="Sign in to study">Your tests and missed questions are only shown to your account.</SignInPrompt></div>;
  }

  const review = summary?.review;
  const total = summary?.totals;
  return (
    <div className="sd animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Study</h1>
          <p>Take the tests your AI writes, and keep the questions you miss coming back.</p>
        </div>
        <Link className="btn btn-primary" href="/study/add">Add a test</Link>
      </header>

      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your tests.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {summary && review && total && (
        total.tests === 0 ? (
          <section className="sd-card sd-welcome">
            <h2>Start with one test</h2>
            <ol>
              <li>Copy a prompt from here into your AI, along with your notes.</li>
              <li>Paste what it writes back here, and take the test.</li>
              <li>Whatever you miss comes back tomorrow, then less and less often as you get it right.</li>
            </ol>
            <Link className="btn btn-primary" href="/study/add">Make your first test</Link>
          </section>
        ) : (
          <>
            <section className={`sd-card sd-due${review.due ? ' has-due' : ''}`}>
              <div>
                <h2>{review.due ? `${review.due} question${review.due === 1 ? '' : 's'} to review` : review.doneToday ? '✨ Reviews done for today' : 'Nothing to review today'}</h2>
                <p className="hb-hint">
                  {review.due ? 'A few minutes on what you’ve missed before.' : review.active ? nextReview(review.nextOn) : 'Questions you miss on a test will show up here.'}
                  {review.cleared > 0 && ` ${review.cleared} cleared so far.`}
                </p>
              </div>
              {review.due > 0 ? <Link className="btn btn-primary" href="/study/review">Review now</Link>
                : review.active > 0 && <Link className="btn btn-secondary" href="/study/review">Miss bank</Link>}
            </section>

            <div className="sd-columns">
              <section className="sd-card sd-tests">
                <div className="sd-card-head">
                  <h2>Your tests</h2>
                  {summary.courses.length > 1 && (
                    <select aria-label="Filter by class" value={course} onChange={(e) => setCourse(e.target.value)}>
                      <option value="">All classes</option>
                      {summary.courses.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
                <ul className="sd-test-list">{shown.map((test) => <TestRow key={test.id} test={test} />)}</ul>
              </section>

              <aside className="sd-side">
                <section className="sd-card">
                  <h2>So far</h2>
                  <dl className="sd-stats">
                    <div><dt>Tests taken</dt><dd>{total.taken}</dd></div>
                    <div><dt>Questions answered</dt><dd>{total.answered.toLocaleString()}</dd></div>
                    <div><dt>Right</dt><dd>{total.answered ? `${pct(total.right, total.answered)}%` : '–'}</dd></div>
                  </dl>
                </section>
                {summary.weakTopics.length > 0 && (
                  <section className="sd-card">
                    <h2>Weakest topics</h2>
                    <ul className="sd-topics">
                      {summary.weakTopics.slice(0, 6).map((t) => (
                        <li key={t.topic}>
                          <span className="progress-label"><span>{t.topic}</span><span>{t.right}/{t.total}</span></span>
                          <span className="progress" role="img" aria-label={`${pct(t.right, t.total)}% right`}><span className="sd-bar" style={{ width: `${pct(t.right, t.total)}%` }} /></span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </aside>
            </div>
          </>
        )
      )}
    </div>
  );
}
