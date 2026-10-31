'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import type { MapResponse } from '@/components/study/MapTypes';
import { pct } from '@/components/study/TestRow';
import { MIN_PROVEN, type SystemCoverage } from '@/lib/study/coverage';

// The PANCE map: every organ system by its weight on the exam, with the three
// kinds of evidence kept apart so being taught something never reads as knowing it.

const COVERED = { none: 'Not yet', started: 'In progress', done: 'Done' };
const PROVEN = { none: 'No results', thin: 'Too few to say', shaky: 'Keep working', solid: 'Strong' };

/** One kind of evidence: 0 is nothing, 1 is some, 2 is plenty. */
function Level({ name, text, level }: { name: string; text: string; level: 0 | 1 | 2 }) {
  return (
    <span className={`sd-level is-${level}`}>
      <small>{name}</small>
      <span>{text}</span>
    </span>
  );
}

function studiedText(s: SystemCoverage['studied']) {
  if (!s.cards) return 'No cards';
  return `${pct(s.reviewed, s.cards)}% reviewed`;
}

function SystemRow({ c }: { c: SystemCoverage }) {
  const studyLevel = !c.studied.reviewed ? 0 : c.studied.mature / c.studied.cards >= 0.5 ? 2 : 1;
  const provenLevel = c.proven.level === 'solid' ? 2 : c.proven.level === 'none' ? 0 : 1;
  const focus = encodeURIComponent(c.label);
  return (
    <li>
      <details className="sd-system">
        <summary>
          <span className="sd-weight" aria-label={`${c.weight}% of the exam`}>{c.weight}%</span>
          <span className="sd-system-name">
            <strong>{c.label}</strong>
            <small>{c.note}</small>
          </span>
          <span className="sd-levels">
            <Level name="Covered" text={COVERED[c.covered]} level={c.covered === 'done' ? 2 : c.covered === 'started' ? 1 : 0} />
            <Level name="Studied" text={studiedText(c.studied)} level={studyLevel} />
            <Level name="Proven" text={c.proven.total ? `${PROVEN[c.proven.level]} · ${pct(c.proven.right, c.proven.total)}%` : PROVEN.none} level={provenLevel} />
          </span>
        </summary>
        <div className="sd-system-body">
          <div>
            <h3>Covered in class</h3>
            {c.classes.length ? (
              <ul>{c.classes.map((k) => <li key={k.name}>{k.name}: {k.done ? 'finished' : 'in progress'}{k.score !== undefined ? `, exam average ${k.score}%` : ''}</li>)}</ul>
            ) : <p className="hb-hint">No classes marked. <Link href="/study/classes">Add your classes</Link></p>}
          </div>
          <div>
            <h3>Studied in Anki</h3>
            {c.studied.cards ? (
              <p>
                {c.studied.cards.toLocaleString()} cards: {c.studied.reviewed.toLocaleString()} reviewed, {c.studied.mature.toLocaleString()} mature.
                {c.studied.retention !== null && ` You pass ${Math.round(c.studied.retention * 100)}% of reviews.`}
                {c.studied.suspended > 0 && ` ${c.studied.suspended.toLocaleString()} suspended.`}
              </p>
            ) : <p className="hb-hint">No cards matched here. <Link href="/study/anki">Match your decks</Link></p>}
          </div>
          <div>
            <h3>Proven on tests</h3>
            {c.proven.total ? (
              <>
                <p>{c.proven.right} of {c.proven.total} right, counting your latest answer to each question.{c.proven.total < MIN_PROVEN && ` It takes ${MIN_PROVEN} answers to judge.`}</p>
                {c.topics.length > 0 && (
                  <ul className="sd-topics">
                    {c.topics.slice(0, 8).map((t) => (
                      <li key={t.topic}>
                        <span className="progress-label"><span>{t.topic}</span><span>{t.right}/{t.total}</span></span>
                        <span className="progress" role="img" aria-label={`${pct(t.right, t.total)}% right`}><span className="sd-bar" style={{ width: `${pct(t.right, t.total)}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className="hb-hint">No answers yet on this system.</p>}
          </div>
          <Link className="btn btn-secondary sd-self-start" href={`/study/add?focus=${focus}`}>Make a test on this</Link>
        </div>
      </details>
    </li>
  );
}

export default function MapPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [data, setData] = useState<MapResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/study/map', { cache: 'no-store' });
      if (cancelled) return;
      if (res.status === 401) { setState('signed-out'); return; }
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.success) { setState('error'); return; }
      setData(body);
      setState('ready');
    })().catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see your map">Your map is only shown to your account.</SignInPrompt></div>;

  const coverage = data?.coverage;
  const hasClasses = !!data?.classes.length;
  const hasAnki = !!data?.anki;
  const hasTests = !!coverage?.systems.some((s) => s.proven.total);
  return (
    <div className="sd animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>PANCE map</h1>
          <p>Every organ system on the exam, by how much of it you’ve covered, studied and proven.</p>
        </div>
      </header>

      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your map.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {coverage && (
        <>
          {(!hasClasses || !hasAnki || !hasTests) && (
            <section className="sd-card">
              <h2>Fill in what you’ve already done</h2>
              <ul className="sd-setup-steps">
                <li className={hasClasses ? 'is-done' : ''}>
                  <span aria-hidden>{hasClasses ? '✅' : '1️⃣'}</span>
                  <span className="sd-test-main"><strong>Add your classes</strong><small>About a minute. Fills in Covered.</small></span>
                  <Link className={`btn ${hasClasses ? 'btn-secondary' : 'btn-primary'}`} href="/study/classes">{hasClasses ? 'Edit' : 'Add'}</Link>
                </li>
                <li className={hasAnki ? 'is-done' : ''}>
                  <span aria-hidden>{hasAnki ? '✅' : '2️⃣'}</span>
                  <span className="sd-test-main"><strong>Import from Anki</strong><small>One export. Fills in Studied.</small></span>
                  <Link className="btn btn-secondary" href="/study/anki">{hasAnki ? 'Open' : 'Import'}</Link>
                </li>
                <li className={hasTests ? 'is-done' : ''}>
                  <span aria-hidden>{hasTests ? '✅' : '3️⃣'}</span>
                  <span className="sd-test-main"><strong>Take a test</strong><small>Fills in Proven. Old AI tests can be converted and retaken too.</small></span>
                  <Link className="btn btn-secondary" href="/study/add">Add a test</Link>
                </li>
              </ul>
            </section>
          )}

          <section className="sd-card">
            <h2>Across the blueprint</h2>
            <div className="sd-totals">
              {([['Covered', coverage.totals.covered], ['Studied', coverage.totals.studied], ['Proven', coverage.totals.proven]] as const).map(([name, value]) => (
                <div key={name}>
                  <span className="progress-label"><span>{name}</span><span>{value}%</span></span>
                  <span className="progress" role="img" aria-label={`${name}: ${value}% of the blueprint`}><span className="sd-bar" style={{ width: `${value}%` }} /></span>
                </div>
              ))}
            </div>
            <p className="hb-hint">Share of the exam, by weight. A system counts as proven with {MIN_PROVEN} or more answers and at least 75% right, which is a guide and not a prediction of your score.</p>
          </section>

          {coverage.hasAnyEvidence && (
            <section className="sd-card">
              <h2>Worth looking at next</h2>
              <ul className="sd-step-list">
                {coverage.next.map((c) => (
                  <li key={c.system} className="sd-step-row">
                    <span className="sd-weight">{c.weight}%</span>
                    <span className="sd-test-main"><strong>{c.label}</strong><small>{c.note}</small></span>
                    <Link className="btn btn-secondary" href={`/study/add?focus=${encodeURIComponent(c.label)}`}>Make a test</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ul className="sd-system-list">{coverage.systems.map((c) => <SystemRow key={c.system} c={c} />)}</ul>

          {coverage.unassigned > 0 && <p className="hb-hint">{coverage.unassigned} answer{coverage.unassigned === 1 ? '' : 's'} came from questions with no organ system, so they aren’t counted here.</p>}
          <p className="hb-hint">Weights are from NCCPA’s 2025 PANCE content blueprint, and add up to 94%.</p>
        </>
      )}
    </div>
  );
}
