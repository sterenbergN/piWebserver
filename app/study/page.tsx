'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { Icon, KIND_GLYPH, Pancakes, type IconName } from '@/components/study/Icon';
import Plate from '@/components/study/Plate';
import { fmtDay, pct } from '@/components/study/TestRow';
import { Loading, ScoreRing, scoreTone } from '@/components/study/Ui';
import { usePlan } from '@/components/study/usePlan';
import { addDays, localToday } from '@/lib/habits/dates';
import { plateView, upcoming } from '@/lib/study/plan';
import type { MapResponse } from '@/components/study/MapTypes';
import { todaySteps, type StudySummary, type TestSummary } from '@/lib/study/study';

// PA Today: the front page of her own corner of the site. One line on where the day
// stands, the thing to do next, what's on her plate, and a clear point where it says
// she can stop.

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function nextReview(nextOn: string | null) {
  if (!nextOn) return '';
  return nextOn <= addDays(localToday(), 1) ? 'The next reviews come back tomorrow.' : `The next reviews come back ${fmtDay(nextOn)}.`;
}

const whenText = (days: number) => (days === 0 ? 'is today' : days === 1 ? 'is tomorrow' : `is in ${days} days`);
const testNote = (test: TestSummary) => [test.course, `${test.count} question${test.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

const TILES: { href: string; icon: IconName; title: string; note: (s: StudySummary) => string }[] = [
  { href: '/study/plan', icon: 'calendar', title: 'Plan', note: () => 'Dates and the work toward them' },
  { href: '/study/tests', icon: 'tests', title: 'Practice tests', note: (s) => `${s.totals.tests} saved` },
  { href: '/study/review', icon: 'review', title: 'Review misses', note: (s) => `${s.review.active} in the bank` },
  { href: '/study/games', icon: 'moon', title: 'Games', note: () => 'Study that doesn’t feel like it' },
  { href: '/study/practice', icon: 'users', title: 'Practice', note: () => 'Grids, Quiz me, mock patients' },
  { href: '/study/map', icon: 'map', title: 'PANCE map', note: () => 'Covered, studied and proven' },
  { href: '/study/classes', icon: 'cap', title: 'Classes', note: () => 'What you’ve finished' },
  { href: '/study/anki', icon: 'layers', title: 'Anki', note: (s) => (s.review.forAnki ? `${s.review.forAnki} new to send` : 'Import decks, send misses') },
  { href: '/study/add', icon: 'plus', title: 'Add a test', note: () => 'From your notes' },
];

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
      <dl className="sd-trio">
        {([['Covered', map.totals.covered], ['Studied', map.totals.studied], ['Proven', map.totals.proven]] as const).map(([name, value]) => (
          <div key={name}><dt>{name}</dt><dd><ScoreRing percent={value} size={62} label={name} tone="is-ok" /></dd></div>
        ))}
      </dl>
      <p className="hb-hint"><strong>Worth a look: {next.label}.</strong> {next.note}</p>
      <Link className="sd-more" href="/study/map">Open the map <Icon name="right" /></Link>
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
  const plate = planner.data ? plateView(planner.data.plan, planner.today, planner.data.reviewsDue) : null;
  // The plate holds the reviews and what's planned; a test left part way is the only thing besides.
  const plateClear = !!plate && plate.total === 0;
  const dateText = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const soonest = next[0];
  const hasOpen = !!today?.open.length;
  return (
    <div className="sd animate-fade-in">
      <header className="sd-head is-hero">
        <div>
          <p className="sd-eyebrow">{dateText}</p>
          <h1>{greeting()}</h1>
          {plate && (
            <p className="sd-lede">
              {plate.clean ? <>A clean plate. <strong>You can stop here.</strong></>
                : plate.total ? <><strong>{plate.total} pancake{plate.total === 1 ? '' : 's'}</strong> on your plate</>
                  : plate.dayOff ? <>A day off. Enjoy it.</> : <>Nothing on your plate</>}
              {soonest && !plate.clean && !plate.dayOff && <>{plate.total ? ', and ' : '. '}<strong>{soonest.deadline.title}</strong> {whenText(soonest.daysLeft)}.</>}
              {!soonest && !plate.clean && !plate.dayOff && '.'}
            </p>
          )}
        </div>
        <Link className="btn btn-secondary" href="/study/add"><Icon name="plus" /> Add a test</Link>
      </header>

      {state === 'loading' && <Loading />}
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
            {map?.hasAnyEvidence && <Link className="sd-more" href="/study/map">See your PANCE map <Icon name="right" /></Link>}
          </section>
        ) : (
          <>
            <div className="sd-columns">
              <div className="sd-side">
                {today.open.map((test) => (
                  <section key={test.id} className="sd-card sd-resume">
                    <p className="sd-eyebrow">Pick up where you left off</p>
                    <div className="sd-resume-row">
                      <span className="sd-test-main"><strong>{test.title}</strong><small>{test.open?.answered} of {test.open?.total} answered</small></span>
                      <Link className="btn btn-primary" href={`/study/tests/${test.id}`}>Continue <Icon name="right" /></Link>
                    </div>
                    <div className="progress" role="progressbar" aria-label="Answered so far" aria-valuemin={0} aria-valuemax={test.open?.total} aria-valuenow={test.open?.answered}>
                      <div style={{ width: `${pct(test.open?.answered ?? 0, test.open?.total ?? 0)}%` }} />
                    </div>
                  </section>
                ))}

                {planner.data && <Plate planner={planner} quiet={hasOpen} />}

                {today.next && (
                  <section className="sd-card">
                    <p className="sd-eyebrow">{plateClear ? 'If you feel like more' : 'Not taken yet'}</p>
                    {plateClear && review.active > 0 && <p className="hb-hint">{nextReview(review.nextOn)}</p>}
                    <div className="sd-resume-row">
                      <span className="sd-test-main"><strong>{today.next.title}</strong><small>{testNote(today.next)}</small></span>
                      <Link className="btn btn-secondary" href={`/study/tests/${today.next.id}`}>Open</Link>
                    </div>
                  </section>
                )}
              </div>

              <aside className="sd-side">
                <section className="sd-card">
                  <h2>Coming up</h2>
                  {next.length ? (
                    <ul className="sd-next-list">
                      {next.map(({ deadline, daysLeft, left }) => (
                        <li key={deadline.id}>
                          <span className={`sd-countdown${daysLeft <= 3 ? ' is-soon' : ''}${daysLeft <= 1 ? ' is-word' : ''}`}><strong>{daysLeft > 1 ? daysLeft : daysLeft === 1 ? 'Tmrw' : 'Today'}</strong>{daysLeft > 1 && <small>days</small>}</span>
                          <span className="sd-test-main">
                            <strong className="sd-title-icon"><Icon name={KIND_GLYPH[deadline.kind]} /> {deadline.title}</strong>
                            <small>{left ? <><Pancakes count={left} /> left</> : fmtDay(deadline.dueOn)}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="hb-hint">No dates yet. Add your exams and due dates, and your Google Calendar can fill them in.</p>}
                  <Link className="sd-more" href="/study/plan">Open your plan <Icon name="right" /></Link>
                </section>
                {map && <MapCard map={map} />}
                <section className="sd-card">
                  <h2>So far</h2>
                  <dl className="sd-trio">
                    <div><dt>Tests taken</dt><dd>{total.taken}</dd></div>
                    <div><dt>Answered</dt><dd>{total.answered.toLocaleString()}</dd></div>
                    <div><dt>Right</dt><dd>{total.answered ? `${pct(total.right, total.answered)}%` : '–'}</dd></div>
                  </dl>
                  {review.cleared > 0 && <p className="hb-hint">{review.cleared} miss{review.cleared === 1 ? '' : 'es'} cleared for good.</p>}
                </section>
                {summary.weakTopics.length > 0 && (
                  <section className="sd-card">
                    <h2>Weakest topics</h2>
                    <ul className="sd-topics">
                      {summary.weakTopics.slice(0, 6).map((t) => (
                        <li key={t.topic}>
                          <span className="progress-label"><span>{t.topic}</span><span>{t.right}/{t.total}</span></span>
                          <span className="progress" role="img" aria-label={`${pct(t.right, t.total)}% right`}><span className={`sd-bar ${scoreTone(pct(t.right, t.total))}`} style={{ width: `${pct(t.right, t.total)}%` }} /></span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </aside>
            </div>

            <nav className="sd-tiles-wrap" aria-label="Everything in Study">
              <p className="sd-eyebrow">Everything</p>
              <div className="sd-tiles">
                {TILES.map((tile) => (
                  <Link key={tile.href} href={tile.href}>
                    <span className="sd-tile-icon"><Icon name={tile.icon} /></span>
                    <span><strong>{tile.title}</strong><small>{tile.note(summary)}</small></span>
                  </Link>
                ))}
              </div>
            </nav>
          </>
        )
      )}

      {state === 'ready' && <HomeSetup home={home} onChange={changeHome} />}
    </div>
  );
}
