'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { practiceGet, SignedOut } from '@/components/study/api';
import { useLiveSession } from '@/components/study/PartnerLink';
import { fmtDay, pct } from '@/components/study/TestRow';
import type { GridSummary, PatientCaseForHer } from '@/lib/study/practice';

// The drills that aren't tests: grids filled in from memory, and the two that take
// someone else, Quiz me and the mock patient.

export default function PracticePage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [grids, setGrids] = useState<GridSummary[]>([]);
  const [cases, setCases] = useState<PatientCaseForHer[]>([]);
  const { session } = useLiveSession();

  useEffect(() => {
    let cancelled = false;
    practiceGet<{ grids: GridSummary[]; cases: PatientCaseForHer[] }>().then((body) => {
      if (cancelled) return;
      setGrids(body.grids);
      setCases(body.cases);
      setState('ready');
    }).catch((error) => { if (!cancelled) setState(error instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to practice">Your grids and cases are only shown to your account.</SignInPrompt></div>;
  const liveHref = session?.kind === 'patient' && 'caseId' in session ? `/study/practice/patient/${session.caseId}` : '/study/practice/quiz';
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Practice</h1>
          <p>Fill it in from memory, or get someone to quiz you.</p>
        </div>
      </header>
      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your practice.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}
      {session && (
        <div className="hb-banner">
          <span>{session.finished ? 'Your last sitting is over.' : 'You have a private link open.'}</span>
          <Link className="hb-small-btn" href={liveHref}>{session.finished ? 'See how it went' : 'Back to it'}</Link>
        </div>
      )}
      {state === 'ready' && (
        <>
          <section className="sd-card">
            <h2>🧮 Comparison grids</h2>
            <p className="hb-hint">Things you mix up, side by side. Some cells are hidden and you fill them in from memory. The ones you miss come back first.</p>
            {grids.length > 0 && (
              <ul className="pr-list">
                {grids.map((g) => (
                  <li key={g.id}>
                    <Link href={`/study/practice/grids/${g.id}`}>
                      <strong>{g.title}</strong>
                      <small>
                        {g.rows.length} rows, {g.columns.length} columns{g.course ? ` · ${g.course}` : ''}
                        {g.last ? ` · last ${pct(g.last.knew, g.last.total)}% on ${fmtDay(g.last.on)}` : ' · not tried yet'}
                        {g.shaky > 0 ? ` · ${g.shaky} shaky` : ''}
                      </small>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link className={`btn ${grids.length ? 'btn-secondary' : 'btn-primary'} sd-self-start`} href="/study/practice/add?kind=grid">Make a grid</Link>
          </section>

          <section className="sd-card">
            <h2>🗣️ Quiz me</h2>
            <p className="hb-hint">Someone else’s phone shows the question and the answer. You answer out loud, and they mark it. Your results count like a review.</p>
            <Link className="btn btn-primary sd-self-start" href="/study/practice/quiz">Set up a quiz</Link>
          </section>

          <section className="sd-card">
            <h2>🧑‍⚕️ Mock patient</h2>
            <p className="hb-hint">OSCE practice. Someone plays the patient from a script that only gives things away if you ask, and scores you on a checklist.</p>
            {cases.length > 0 && (
              <ul className="pr-list">
                {cases.map((c) => {
                  const last = c.runs[c.runs.length - 1];
                  return (
                    <li key={c.id}>
                      <Link href={`/study/practice/patient/${c.id}`}>
                        <strong>{c.title}</strong>
                        <small>{c.course ? `${c.course} · ` : ''}{last ? `last ${last.right} of ${last.total} on ${fmtDay(last.on)}` : 'not tried yet'}</small>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link className={`btn ${cases.length ? 'btn-secondary' : 'btn-primary'} sd-self-start`} href="/study/practice/add?kind=case">Add cases</Link>
          </section>
        </>
      )}
    </div>
  );
}
