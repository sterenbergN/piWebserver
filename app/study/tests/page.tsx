'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { EmptyState, Loading } from '@/components/study/Ui';
import { pct, TestRow } from '@/components/study/TestRow';
import { DIFFICULTIES } from '@/lib/study/prompt';
import type { SetSummary } from '@/lib/study/sets';
import type { StudySummary } from '@/lib/study/study';

// Every test she's added: sets first, each one a subject she can keep making new
// tests on, then anything not in a set. All of it can be narrowed by class.

function SetCard({ set }: { set: SetSummary }) {
  const level = DIFFICULTIES[set.difficulty - 1];
  return (
    <li className="sd-set-card">
      <Link className="sd-set-link" href={`/study/tests/sets/${set.id}`}>
        <span className="sd-test-main">
          <strong>{set.title}</strong>
          <small>{[set.course, `${set.tests} test${set.tests === 1 ? '' : 's'}`, `${set.questions} questions`, level?.label].filter(Boolean).join(' · ')}</small>
        </span>
        {set.trend.length > 0 && (
          <span className="sd-trend" role="img" aria-label={`Scores, oldest first: ${set.trend.join('%, ')}%`}>
            {set.trend.slice(-8).map((score, i) => <span key={i} title={`${score}%`} style={{ height: `${Math.max(10, score)}%` }} />)}
          </span>
        )}
        {set.score ? <span className="sd-score">{pct(set.score.right, set.score.total)}%</span> : <span className="td-chip">Not taken</span>}
      </Link>
      <Link className="sd-more sd-set-next" href={`/study/add?set=${set.id}`}><Icon name="plus" /> Make the next test</Link>
    </li>
  );
}

export default function TestsPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [course, setCourse] = useState('');

  useEffect(() => {
    let cancelled = false;
    studyGet<{ summary: StudySummary; sets: SetSummary[] }>().then((body) => {
      if (cancelled) return;
      setSummary(body.summary);
      setSets(body.sets);
      setState('ready');
    }).catch((error) => { if (!cancelled) setState(error instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
  }, []);

  const loose = useMemo(() => (summary?.tests ?? []).filter((t) => !t.setId && (!course || t.course === course)), [summary, course]);
  const shownSets = useMemo(() => sets.filter((s) => !course || s.course === course), [sets, course]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see your tests">Your tests are only shown to your account.</SignInPrompt></div>;

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Practice tests</h1>
          {summary && summary.totals.tests > 0 && <p>{summary.totals.tests} saved, {summary.totals.taken} taken</p>}
        </div>
        <Link className="btn btn-primary" href="/study/add"><Icon name="plus" /> Add a test</Link>
      </header>

      {state === 'loading' && <Loading />}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your tests.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {summary && (summary.tests.length === 0 && sets.length === 0 ? (
        <EmptyState icon="tests" title="No tests yet" action={{ href: '/study/add', label: 'Make your first test' }}>
          Have your AI write one from your notes, then paste it here.
        </EmptyState>
      ) : (
        <>
          {summary.courses.length > 1 && (
            <div className="sd-filter">
              <select aria-label="Filter by class" value={course} onChange={(e) => setCourse(e.target.value)}>
                <option value="">All classes</option>
                {summary.courses.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <section className="sd-card">
            <h2>Sets</h2>
            {shownSets.length > 0 ? (
              <ul className="sd-set-list">{shownSets.map((set) => <SetCard key={set.id} set={set} />)}</ul>
            ) : (
              <p className="hb-hint">A set keeps several tests on one subject together. Each new test tells your AI what’s been asked and how you did, so it won’t repeat itself and aims at what you need.</p>
            )}
          </section>
          {loose.length > 0 && (
            <section className="sd-card sd-tests">
              <h2>Not in a set</h2>
              <ul className="sd-test-list">{loose.map((test) => <TestRow key={test.id} test={test} />)}</ul>
              <p className="hb-hint">Open a test to move it into a set.</p>
            </section>
          )}
        </>
      ))}
    </div>
  );
}
