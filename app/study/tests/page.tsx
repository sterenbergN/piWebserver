'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet } from '@/components/study/api';
import { TestRow } from '@/components/study/TestRow';
import type { StudySummary } from '@/lib/study/study';

// Every test she's added, newest first, narrowed by class.

export default function TestsPage() {
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

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see your tests">Your tests are only shown to your account.</SignInPrompt></div>;

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Practice tests</h1>
          {summary && summary.totals.tests > 0 && <p>{summary.totals.tests} saved, {summary.totals.taken} taken</p>}
        </div>
        <Link className="btn btn-primary" href="/study/add">Add a test</Link>
      </header>

      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your tests.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {summary && (summary.tests.length === 0 ? (
        <section className="sd-card sd-done">
          <h2>No tests yet</h2>
          <p className="hb-hint">Have your AI write one from your notes, then paste it here.</p>
          <Link className="btn btn-secondary" href="/study/add">Make your first test</Link>
        </section>
      ) : (
        <section className="sd-card sd-tests">
          {summary.courses.length > 1 && (
            <div className="sd-card-head">
              <h2>{course || 'All classes'}</h2>
              <select aria-label="Filter by class" value={course} onChange={(e) => setCourse(e.target.value)}>
                <option value="">All classes</option>
                {summary.courses.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <ul className="sd-test-list">{shown.map((test) => <TestRow key={test.id} test={test} />)}</ul>
        </section>
      ))}
    </div>
  );
}
