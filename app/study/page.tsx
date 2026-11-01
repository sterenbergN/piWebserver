'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import Plate from '@/components/study/Plate';
import { fmtDay, pct } from '@/components/study/TestRow';
import { usePlan } from '@/components/study/usePlan';
import { addDays, localToday } from '@/lib/habits/dates';
import { KIND_ICON, plateView, upcoming } from '@/lib/study/plan';
import type { MapResponse } from '@/components/study/MapTypes';
import { todaySteps, type StudySummary, type TestSummary } from '@/lib/study/study';

// PA Today: the front page of her own corner of the site. What's waiting today,
// and a clear point where it says she can stop.

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function nextReview(nextOn: string | null) {
  if (!nextOn) return '';
  return nextOn <= addDays(localToday(), 1) ? 'The next reviews come back tomorrow.' : `The next reviews come back ${fmtDay(nextOn)}.`;
}

function Step({ icon, title, note, href, action, primary = false }: { icon: string; title: string; note: string; href: string; action: string; primary?: boolean }) {
  return (
    <li className="sd-step-row">
      <span className="sd-step-icon" aria-hidden>{icon}</span>
      <span className="sd-test-main"><strong>{title}</strong><small>{note}</small></span>
      <Link className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} href={href}>{action}</Link>
    </li>
  );
}

const testNote = (test: TestSummary) => [test.course, `${test.count} question${test.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

/** Make this the place she lands, and put it on her home screen. */
function HomeSetup({ home, onChange }: { home: boolean; onChange: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggle = async (on: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await onChange(on);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="sd-card sd-setup">
      <summary><h2>Make this your home</h2></summary>
      <label className="sd-check">
        <input type="checkbox" checked={home} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <strong>Start on PA Today</strong>
          <small>The logo brings you back here, signing in from the home page lands here, and Study comes first in Explore. Everything else on the site is still in Explore.</small>
        </span>
      </label>
      {failed && <p className="sd-warning" role="alert">That didn’t save. Try again.</p>}
      <div>
        <p className="sd-setup-title">Put it on your home screen</p>
        <ul className="sd-setup-list">
          <li><strong>iPhone:</strong> open this page in Safari, tap Share, then Add to Home Screen. You’ll sign in once more inside the app.</li>
          <li><strong>Android:</strong> open this page in Chrome, open the ⋮ menu, then Add to Home screen.</li>
        </ul>
      </div>
    </details>
  );
}

/** Where the PANCE map stands, or the way in if there's nothing on it yet. */
function MapCard({ map }: { map: MapResponse['coverage'] }) {
  if (!map.hasAnyEvidence) {
    return (
      <section className="sd-card">
        <h2>Catch up on what you’ve done</h2>
        <p className="hb-hint">Tell the PANCE map about your classes so far. It takes about a minute, and shows which parts of the exam have the least behind them.</p>
        <Link className="btn btn-secondary sd-self-start" href="/study/classes">Add your classes</Link>
      </section>
    );
  }
  const next = map.next[0];
  return (
    <section className="sd-card">
      <h2>PANCE map</h2>
      <dl className="sd-stats">
        <div><dt>Covered</dt><dd>{map.totals.covered}%</dd></div>
        <div><dt>Studied</dt><dd>{map.totals.studied}%</dd></div>
        <div><dt>Proven</dt><dd>{map.totals.proven}%</dd></div>
      </dl>
      <p className="hb-hint"><strong>Worth a look: {next.label}.</strong> {next.note}</p>
      <Link className="btn btn-secondary sd-self-start" href="/study/map">Open the map</Link>
    </section>
  );
}

export default function PaTodayPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [home, setHome] = useState(false);
  const [map, setMap] = useState<MapResponse['coverage'] | null>(null);
  const planner = usePlan();

  useEffect(() => {
    let cancelled = false;
    studyGet<{ summary: StudySummary; home: boolean }>().then((body) => {
      if (cancelled) return;
      setSummary(body.summary);
      setHome(body.home);
      setState('ready');
    }).catch((error) => { if (!cancelled) setState(error instanceof SignedOut ? 'signed-out' : 'error'); });
    fetch('/api/study/map', { cache: 'no-store' }).then((r) => r.json()).then((body) => {
      if (!cancelled && body.success) setMap(body.coverage);
    }).catch(() => { /* the card just stays away */ });
    return () => { cancelled = true; };
  }, []);

  const changeHome = async (on: boolean) => {
    await studyPost('set-home', { on });
    setHome(on);
    router.refresh(); // The header takes its logo and pins from the account.
  };

  if (state === 'signed-out') {
    return <div className="sd"><SignInPrompt title="Sign in to study">Your tests and missed questions are only shown to your account.</SignInPrompt></div>;
  }

  const review = summary?.review;
  const total = summary?.totals;
  const today = summary ? todaySteps(summary) : null;
  const plan = planner.data?.plan;
  const next = plan ? upcoming(plan, planner.today).slice(0, 3) : [];
  const hasPlan = !!plan && (plan.tasks.length > 0 || plan.deadlines.length > 0);
  // The plate holds the reviews and what's planned; a test left part way is the only thing besides.
  const plateClear = !!planner.data && plateView(planner.data.plan, planner.today, planner.data.reviewsDue).total === 0;
  const dateText = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="sd animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>{greeting()}</h1>
          <p>{dateText}</p>
        </div>
        <Link className="btn btn-primary" href="/study/add">Add a test</Link>
      </header>

      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your day.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {summary && review && total && today && (
        total.tests === 0 && !hasPlan ? (
          <section className="sd-card sd-welcome">
            <h2>Start with one test</h2>
            <ol>
              <li>Copy a prompt from here into your AI, along with your notes.</li>
              <li>Paste what it writes back here, and take the test.</li>
              <li>Whatever you miss comes back tomorrow, then less and less often as you get it right.</li>
            </ol>
            <Link className="btn btn-primary" href="/study/add">Make your first test</Link>
            {map && !map.hasAnyEvidence && <p className="hb-hint">Already 5 months in? <Link href="/study/classes">Add your classes</Link> and <Link href="/study/anki">import from Anki</Link> to fill in the <Link href="/study/map">PANCE map</Link>.</p>}
            {map?.hasAnyEvidence && <Link className="sd-more" href="/study/map">See your PANCE map →</Link>}
          </section>
        ) : (
          <div className="sd-columns">
            <div className="sd-side">
              {planner.data && <Plate planner={planner} />}

              {(today.open.length > 0 || today.next) && (
                <section className={`sd-card sd-today${plateClear && !today.open.length ? ' is-clear' : ''}`}>
                  <h2>{today.open.length ? 'Pick up where you left off' : plateClear ? 'If you feel like more' : 'Not taken yet'}</h2>
                  {plateClear && !today.open.length && review.active > 0 && <p className="hb-hint">{nextReview(review.nextOn)}</p>}
                  {today.open.length > 0 && (
                    <ul className="sd-step-list">
                      {today.open.map((test) => <Step key={test.id} icon="📝" title={test.title} note={`Part way through: ${test.open?.answered} of ${test.open?.total} answered`} href={`/study/tests/${test.id}`} action="Continue" primary />)}
                    </ul>
                  )}
                  {today.next && (
                    <ul className="sd-step-list">
                      <Step icon="🆕" title={today.next.title} note={testNote(today.next)} href={`/study/tests/${today.next.id}`} action="Open" />
                    </ul>
                  )}
                </section>
              )}

              <nav className="sd-tiles" aria-label="Study">
                <Link href="/study/plan"><span aria-hidden>🥞</span><strong>Plan</strong><small>Dates and the work toward them</small></Link>
                <Link href="/study/tests"><span aria-hidden>📝</span><strong>Practice tests</strong><small>{total.tests} saved</small></Link>
                <Link href="/study/review"><span aria-hidden>🔁</span><strong>Review misses</strong><small>{review.active} in the bank</small></Link>
                <Link href="/study/games"><span aria-hidden>🌙</span><strong>Games</strong><small>Study that doesn’t feel like it</small></Link>
                <Link href="/study/practice"><span aria-hidden>🧑‍⚕️</span><strong>Practice</strong><small>Grids, Quiz me, mock patients</small></Link>
                <Link href="/study/map"><span aria-hidden>🗺️</span><strong>PANCE map</strong><small>What’s covered, studied and proven</small></Link>
                <Link href="/study/classes"><span aria-hidden>🎓</span><strong>Classes</strong><small>What you’ve finished</small></Link>
                <Link href="/study/anki"><span aria-hidden>🗂️</span><strong>Anki</strong><small>{review.forAnki ? `${review.forAnki} new to send` : 'Import decks, send misses'}</small></Link>
                <Link href="/study/add"><span aria-hidden>➕</span><strong>Add a test</strong><small>From your notes</small></Link>
              </nav>
            </div>

            <aside className="sd-side">
              <section className="sd-card">
                <h2>Coming up</h2>
                {next.length ? (
                  <ul className="sd-next-list">
                    {next.map(({ deadline, daysLeft, left }) => (
                      <li key={deadline.id}>
                        <span className="sd-countdown"><strong>{daysLeft > 1 ? daysLeft : daysLeft === 1 ? 'Tmrw' : 'Today'}</strong>{daysLeft > 1 && <small>days</small>}</span>
                        <span className="sd-test-main"><strong>{KIND_ICON[deadline.kind]} {deadline.title}</strong><small>{left ? `${left} 🥞 left` : fmtDay(deadline.dueOn)}</small></span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="hb-hint">No dates yet. Add your exams and due dates, and your Google Calendar can fill them in.</p>}
                <Link className="sd-more" href="/study/plan">Open your plan →</Link>
              </section>
              {map && <MapCard map={map} />}
              <section className="sd-card">
                <h2>So far</h2>
                <dl className="sd-stats">
                  <div><dt>Tests taken</dt><dd>{total.taken}</dd></div>
                  <div><dt>Questions answered</dt><dd>{total.answered.toLocaleString()}</dd></div>
                  <div><dt>Right</dt><dd>{total.answered ? `${pct(total.right, total.answered)}%` : '–'}</dd></div>
                  {review.cleared > 0 && <div><dt>Misses cleared</dt><dd>{review.cleared}</dd></div>}
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
        )
      )}

      {state === 'ready' && <HomeSetup home={home} onChange={changeHome} />}
    </div>
  );
}
