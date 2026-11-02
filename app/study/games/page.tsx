'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { localToday } from '@/lib/habits/dates';
import type { GameStats } from '@/lib/study/games';
import { Icon } from '@/components/study/Icon';
import { Scope } from '@/components/study/Scope';
import { Loading } from '@/components/study/Ui';

// The study games. Both draw from her own tests and lean on what she's been
// missing, and every answer counts toward her miss bank and PANCE map.

type Options = { total: number; misses: number; courses: string[]; systems: string[]; ankiCards: number; stats: GameStats; rank: string };

function DifferentialCard() {
  return (
    <section className="sd-card ns-card">
      <div className="ns-card-head">
        <span className="ns-card-icon"><Icon name="search" /></span>
        <div>
          <h2>Differential</h2>
          <p className="hb-hint">One case a day, one clue at a time. Name the diagnosis on fewer clues for more points.</p>
        </div>
      </div>
      <Link className="btn btn-primary sd-self-start" href="/study/games/differential">Today’s case</Link>
    </section>
  );
}

function SnakeCard({ options }: { options: Options }) {
  const [course, setCourse] = useState('');
  const [system, setSystem] = useState('');
  const params = new URLSearchParams();
  if (course) params.set('course', course);
  if (system) params.set('system', system);
  return (
    <section className="sd-card ns-card">
      <div className="ns-card-head">
        <span className="ns-card-icon"><Icon name="snake" /></span>
        <div>
          <h2>Study Snake</h2>
          <p className="hb-hint">Snake, but the food is lettered answers. Eat the right one to grow. The snake waits while you read, and your answers count.</p>
        </div>
      </div>
      <Scope options={options} course={course} system={system} setCourse={setCourse} setSystem={setSystem} />
      <Link className="btn btn-primary sd-self-start" href={`/study/games/snake?${params}`}>Play</Link>
    </section>
  );
}

function NightShiftCard({ options }: { options: Options }) {
  const [course, setCourse] = useState('');
  const [system, setSystem] = useState('');
  const [misses, setMisses] = useState(false);
  const [anki, setAnki] = useState(false);
  const params = new URLSearchParams();
  if (course) params.set('course', course);
  if (system) params.set('system', system);
  if (misses) params.set('misses', '1');
  if (anki) params.set('anki', '1');
  const { stats } = options;
  return (
    <section className="sd-card ns-card">
      <div className="ns-card-head">
        <span className="ns-card-icon"><Icon name="moon" /></span>
        <div>
          <h2>The Night Shift</h2>
          <p className="hb-hint">Twelve hours on call, solo. Pick a door each hour, keep your coffee going, and face the Attending at 6 am on your weakest system. Wrong answers always stop to explain.</p>
        </div>
      </div>
      {stats.runs > 0 && (
        <dl className="sd-stats">
          <div><dt>Rank</dt><dd>{options.rank}</dd></div>
          <div><dt>Best score</dt><dd>{stats.best.toLocaleString()}</dd></div>
          <div><dt>Shifts finished</dt><dd>{stats.survived} of {stats.runs}</dd></div>
        </dl>
      )}
      <Scope options={options} course={course} system={system} setCourse={setCourse} setSystem={setSystem} />
      {options.misses > 0 && (
        <label className="sd-check">
          <input type="checkbox" checked={misses} onChange={(e) => setMisses(e.target.checked)} />
          <span>Only questions in my miss bank ({options.misses})</span>
        </label>
      )}
      {options.ankiCards > 0 && (
        <label className="sd-check">
          <input type="checkbox" checked={anki} onChange={(e) => setAnki(e.target.checked)} />
          <span>Add the Anki cards I keep forgetting ({options.ankiCards}), with wrong answers borrowed from my other cards</span>
        </label>
      )}
      <Link className="btn btn-primary sd-self-start" href={`/study/games/night-shift?${params}`}>Start a shift</Link>
    </section>
  );
}

function TriviaCard({ options }: { options: Options }) {
  const router = useRouter();
  const [course, setCourse] = useState('');
  const [system, setSystem] = useState('');
  const [seconds, setSeconds] = useState(45);
  const [mode, setMode] = useState<'tv' | 'phones'>('tv');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const host = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/study/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'host-trivia', course, system, seconds, mode, today: localToday() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || 'Couldn’t open a room. Try again.');
      router.push(`/party/host/${body.roomCode}?hostId=${body.hostId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t open a room. Try again.');
      setBusy(false);
    }
  };
  return (
    <section className="sd-card ns-card">
      <div className="ns-card-head">
        <span className="ns-card-icon"><Icon name="skull" /></span>
        <div>
          <h2>Trivia Death, study edition</h2>
          <p className="hb-hint">The party game with your questions, for a study group of 3 to 8 with their phones. Everyone sees the explanation after each round, and the host can pause to talk it through. Join from a phone signed in to your account, and your answers count toward your miss bank.</p>
        </div>
      </div>
      <Scope options={options} course={course} system={system} setCourse={setCourse} setSystem={setSystem} />
      <div className="sd-fields">
        <label>Time per question
          <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            {[30, 45, 60, 90].map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
        </label>
        <label>Where it’s shown
          <select value={mode} onChange={(e) => setMode(e.target.value as 'tv' | 'phones')}>
            <option value="tv">On a TV or big screen</option>
            <option value="phones">Phones only</option>
          </select>
        </label>
      </div>
      <p className="hb-hint">Everyone in the room sees these questions, so keep it to people you’d share your notes with. Select-all questions are left out, since this game is one tap per answer.</p>
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary sd-self-start" disabled={busy} onClick={host}>{busy ? 'Opening a room…' : 'Open a room'}</button>
    </section>
  );
}

export default function GamesPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/study/games?options=1&today=${localToday()}`, { cache: 'no-store' });
      if (cancelled) return;
      if (res.status === 401) { setState('signed-out'); return; }
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.success) { setState('error'); return; }
      setOptions(body);
      setState('ready');
    })().catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to play">These games use your own questions.</SignInPrompt></div>;
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Games</h1>
          <p>Studying that doesn’t feel like it. Your answers still count.</p>
        </div>
      </header>
      {state === 'loading' && <Loading />}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your games.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}
      {options && <DifferentialCard />}
      {options && (options.total === 0 && options.ankiCards === 0 ? (
        <section className="sd-card sd-done">
          <h2>Nothing else to play with yet</h2>
          <p className="hb-hint">The other games use your own questions, so add a test first. A few dozen questions makes for a good game.</p>
          <Link className="btn btn-primary" href="/study/add">Add a test</Link>
        </section>
      ) : (
        <>
          <NightShiftCard options={options} />
          {options.total > 0 && <SnakeCard options={options} />}
          <TriviaCard options={options} />
        </>
      ))}
    </div>
  );
}
