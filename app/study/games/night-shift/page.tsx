'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { MathText } from '@/components/daily/MathText';
import { InlineMath } from '@/components/study/InlineMath';
import { Choices, Explanation } from '@/components/study/QuestionView';
import { localToday } from '@/lib/habits/dates';
import { BLUEPRINT } from '@/lib/study/coverage';
import type { GameQuestion } from '@/lib/study/games';
import {
  answerQuestion, clockFor, defibResult, defibZone, DOORS, enterDoor, MAX_COFFEE, proceed, QUICK_SECONDS, questionOf, SECOND_OPINION, SHIFT_ROOMS, spendConsult, spendOpinion, startRun, type Run,
} from '@/lib/study/night-shift';
import type { PanceSystem } from '@/lib/study/study';

// The Night Shift. The rules are in lib/study/night-shift.ts; this draws them and
// saves each answer as it's given, so a run left halfway still counted. The run
// itself only lives on this page.

const Confetti = dynamic(() => import('@/components/habits/Confetti'), { ssr: false });

const QUIPS = {
  doors: ['Pick a door. Neither of them is going to be easy.', 'The overhead page goes off again. Where to?', 'Your pager buzzes. It’s always your pager.', 'Someone’s call light has been on for a while.', 'The vending machine ate your dollar. Moving on.'],
  right: ['The Attending nods, almost imperceptibly.', 'Nicely reasoned. Don’t let it go to your head.', 'Correct. The patient may never know how close that was.', 'Right. Somebody write that down.'],
  wrong: ['The Attending clicks a pen, slowly.', 'Interesting choice. Let’s look at why it isn’t.', 'Well. That’s why they call it practice.', 'Nobody saw that. Except the Attending.'],
};

const pickQuip = (list: string[], seed: number) => list[Math.abs(seed) % list.length];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

async function send(payload: Record<string, unknown>) {
  const res = await fetch('/api/study/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ today: localToday(), ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t save.');
  return body;
}

function Status({ run }: { run: Run }) {
  const hour = Math.min(run.hour, 12);
  return (
    <div className="ns-status">
      <div className="ns-clock" aria-label={`The time is ${clockFor(hour)}`}>🕖 {clockFor(hour)}</div>
      <div className="ns-coffee" aria-label={`${run.coffee} coffee left`}>
        {Array.from({ length: Math.max(run.coffee, 3) }, (_, i) => <span key={i} className={i < run.coffee ? '' : 'is-gone'} aria-hidden>☕</span>)}
      </div>
      <div className="ns-score"><strong>{run.score.toLocaleString()}</strong>{run.streak > 1 && <small>🔥 {run.streak} in a row</small>}</div>
      <div className="ns-hours" aria-hidden>
        {Array.from({ length: SHIFT_ROOMS + 1 }, (_, i) => <span key={i} className={i < run.hour ? 'is-done' : i === run.hour ? 'is-now' : ''} />)}
      </div>
    </div>
  );
}

/** The defibrillator: a marker sweeps back and forth, and she taps in the green. */
function Defib({ hour, onDone }: { hour: number; onDone: (hit: boolean) => void }) {
  const marker = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const [result, setResult] = useState<boolean | null>(null);
  const zone = defibZone(hour);
  const zoneStart = 0.62;

  useEffect(() => {
    if (result !== null) return;
    const start = performance.now();
    let frame = 0;
    const speed = 1100 - Math.min(hour, 11) * 40;
    const tick = (now: number) => {
      const t = ((now - start) / speed) % 2;
      position.current = t < 1 ? t : 2 - t;
      if (marker.current) marker.current.style.left = `${position.current * 100}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hour, result]);

  const shock = useCallback(() => {
    if (result !== null) return;
    setResult(position.current >= zoneStart && position.current <= zoneStart + zone);
  }, [result, zone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); shock(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shock]);

  return (
    <section className="ns-panel ns-code">
      <h2>⚡ V-fib!</h2>
      <p>Shock when the marker is in the green. Hit it and you keep your coffee.</p>
      <div className="ns-defib" aria-hidden>
        <div className="ns-defib-zone" style={{ left: `${zoneStart * 100}%`, width: `${zone * 100}%` }} />
        <div className="ns-defib-marker" ref={marker} />
      </div>
      {result === null
        ? <button type="button" className="btn btn-primary ns-shock" onClick={shock}>Shock!</button>
        : (
          <>
            <p className="ns-result">{result ? '💓 Sinus rhythm. Nice timing.' : '📉 Missed the window.'}</p>
            <button type="button" className="btn btn-primary" autoFocus onClick={() => onDone(result)}>Continue</button>
          </>
        )}
    </section>
  );
}

function QuestionRoom({ run, pool, seed, onAnswer, onConsult, onOpinion }: {
  run: Run;
  pool: GameQuestion[];
  seed: number;
  onAnswer: (answer: number[], seconds: number) => void;
  onConsult: () => void;
  onOpinion: () => void;
}) {
  const question = questionOf(pool, run)!;
  const [answer, setAnswer] = useState<number[]>([]);
  const [startedAt] = useState(() => Date.now());
  const [quickLeft, setQuickLeft] = useState(QUICK_SECONDS);
  const multi = question.correct.length > 1;

  useEffect(() => {
    const tick = setInterval(() => setQuickLeft(Math.max(0, QUICK_SECONDS - (Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(tick);
  }, [startedAt]);

  const submit = () => {
    if (answer.length) onAnswer(answer, (Date.now() - startedAt) / 1000);
    setAnswer([]);
  };

  const title = run.room === 'boss' ? `🧑‍⚕️ The Attending’s rounds · ${5 - run.boss.left + 1} of 5`
    : run.room === 'lightning' ? `🚨 Code Blue · ${3 - run.lightning.left + 1} of 3`
      : `${DOORS[run.room as keyof typeof DOORS].icon} ${DOORS[run.room as keyof typeof DOORS].name}`;
  return (
    <section className="ns-panel">
      <div className="ns-room-head">
        <span className="ns-room-title">{title}</span>
        {quickLeft > 0 && <span className="ns-quick" title="Answer before this runs out for a bonus">⚡ {Math.ceil(quickLeft)}s bonus</span>}
      </div>
      {run.message === SECOND_OPINION && <p className="ns-second">{SECOND_OPINION}</p>}
      <MathText className="sd-stem">{question.stem}</MathText>
      <Choices key={`${question.id}:${run.hidden.join()}`} question={question} seed={seed} answer={answer} hidden={run.hidden} onChange={setAnswer} />
      <div className="sd-actions ns-actions">
        <button type="button" className="btn btn-primary" disabled={!answer.length} onClick={submit}>{multi ? 'Answer' : 'Lock it in'}</button>
        <button type="button" className="hb-small-btn" disabled={run.consults <= 0 || run.hidden.length > 0} onClick={onConsult} title="Take away some wrong choices">📟 Consult ({run.consults})</button>
        <button type="button" className="hb-small-btn" disabled={run.opinions <= 0 || run.opinionArmed || multi} onClick={onOpinion} title="If you’re wrong, get another try">{run.opinionArmed ? '🧑‍⚕️ Second opinion ready' : `🧑‍⚕️ Second opinion (${run.opinions})`}</button>
      </div>
    </section>
  );
}

export default function NightShiftPage() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'error' | 'empty'>('loading');
  const [pool, setPool] = useState<GameQuestion[]>([]);
  const [bossSystem, setBossSystem] = useState<PanceSystem | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [seed, setSeed] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [ending, setEnding] = useState<{ isBest: boolean; rank: string; eaten: number } | null>(null);
  const [fire, setFire] = useState(0);
  const ended = useRef(false);

  const begin = useCallback((questions: GameQuestion[], boss: PanceSystem | null) => {
    const next = Math.floor(Math.random() * 2 ** 31);
    ended.current = false;
    setSeed(next);
    setEnding(null);
    setRun(startRun(questions, next, boss));
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      params.set('today', localToday());
      const res = await fetch(`/api/study/games?${params}`, { cache: 'no-store' });
      if (cancelled) return;
      if (res.status === 401) { setStatus('signed-out'); return; }
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.success) { setStatus('error'); return; }
      if (!body.questions.length) { setStatus('empty'); return; }
      setPool(body.questions);
      setBossSystem(body.bossSystem);
      setStatus('ready');
      begin(body.questions, body.bossSystem);
    })().catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [begin]);

  // A shift over: note it once, for the rank and any pancakes planned for it.
  useEffect(() => {
    if (run?.phase !== 'over' || ended.current) return;
    ended.current = true;
    if (run.won) setFire((n) => n + 1);
    send({ action: 'run-end', score: run.score, hours: Math.min(run.hour, 12), survived: run.won })
      .then((body) => setEnding({ isBest: body.isBest, rank: body.rank, eaten: body.eaten }))
      .catch(() => setSaveFailed(true));
  }, [run]);

  if (status === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to play">This game uses your own questions.</SignInPrompt></div>;
  if (status === 'loading') return <div className="sd"><p className="hb-hint">Loading…</p></div>;
  if (status === 'error') return <div className="sd"><div className="hb-banner is-error"><span>Couldn’t load your questions.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div></div>;
  if (status === 'empty' || !run) {
    return (
      <div className="sd sd-narrow">
        <section className="sd-card sd-done">
          <h2>No questions match that</h2>
          <p className="hb-hint">Try something wider, or add a test.</p>
          <Link className="btn btn-secondary" href="/study/games">Back to Games</Link>
        </section>
      </div>
    );
  }

  const change = (work: (next: Run) => void) => {
    const next = clone(run);
    work(next);
    setRun(next);
    window.scrollTo({ top: 0 });
  };
  const onAnswer = (answer: number[], seconds: number) => change((next) => {
    const record = answerQuestion(next, pool, answer, seconds);
    // Anki cards aren't test questions, so there's nothing to save them against.
    if (record && questionOf(pool, next)?.testId) send({ action: 'answer', ...record }).catch(() => setSaveFailed(true));
  });

  const question = questionOf(pool, run);
  const bossName = BLUEPRINT.find((b) => b.system === run.boss.system)?.label;
  return (
    <div className="sd sd-narrow ns">
      <Confetti fire={fire} />
      <div className="ns-stage">
        <header className="ns-top">
          <h1>🌙 The Night Shift</h1>
          <Link className="ns-leave" href="/study/games">Clock out</Link>
        </header>
        <Status run={run} />
        {saveFailed && <p className="sd-warning" role="alert">⚠️ An answer didn’t save, so it may not reach your miss bank.</p>}
        {run.message && run.message !== SECOND_OPINION && run.phase !== 'rest' && <p className="ns-note">{run.message}</p>}

        {run.phase === 'doors' && (
          <section className="ns-doors-wrap">
            <p className="ns-quip">{pickQuip(QUIPS.doors, run.rng)}</p>
            <div className="ns-doors">
              {run.doors.map((kind, i) => (
                <button key={`${kind}${i}`} type="button" className={`ns-door is-${kind}`} onClick={() => change((next) => enterDoor(next, pool, i))}>
                  <span className="ns-door-icon" aria-hidden>{DOORS[kind].icon}</span>
                  <strong>{DOORS[kind].name}</strong>
                  <small>{DOORS[kind].note}</small>
                  {DOORS[kind].points > 0 && <span className="ns-door-points">{DOORS[kind].points} pts</span>}
                </button>
              ))}
            </div>
            <p className="ns-items">📟 {run.consults} Consult · 🧑‍⚕️ {run.opinions} Second opinion · ☕ up to {MAX_COFFEE}</p>
          </section>
        )}

        {run.phase === 'question' && question && (
          <QuestionRoom key={`${question.id}:${run.right + run.wrong}`} run={run} pool={pool} seed={seed} onAnswer={onAnswer}
            onConsult={() => change((next) => spendConsult(next, pool))} onOpinion={() => change((next) => spendOpinion(next))} />
        )}

        {run.phase === 'feedback' && question && run.last && (
          <section className="ns-panel">
            <p className={`ns-verdict ${run.last.right ? 'is-right' : 'is-wrong'}`}>
              {run.last.right ? `+${run.last.points.toLocaleString()}` : 'Not quite.'} <span>{pickQuip(run.last.right ? QUIPS.right : QUIPS.wrong, run.rng)}</span>
            </p>
            <MathText className="sd-stem">{question.stem}</MathText>
            <Choices key={question.id} question={question} seed={seed} answer={run.last.answer} reveal />
            <Explanation question={question} answer={run.last.answer} />
            <button type="button" className="btn btn-primary sd-self-start" autoFocus onClick={() => change((next) => proceed(next, pool))}>Keep going</button>
          </section>
        )}

        {run.phase === 'rest' && (
          <section className="ns-panel ns-center">
            <span className="ns-big-icon" aria-hidden>{run.room ? DOORS[run.room as keyof typeof DOORS]?.icon : ''}</span>
            <p>{run.message}</p>
            <button type="button" className="btn btn-primary" autoFocus onClick={() => change((next) => proceed(next, pool))}>Back to the floor</button>
          </section>
        )}

        {run.phase === 'code-intro' && (
          <section className="ns-panel ns-center ns-code">
            <h2>🚨 Code Blue!</h2>
            <p>That one went badly. Get 2 of the next 3 right and you keep your coffee.</p>
            <button type="button" className="btn btn-primary" autoFocus onClick={() => change((next) => proceed(next, pool))}>Run the code</button>
          </section>
        )}

        {run.phase === 'defib' && <Defib key={run.hour} hour={run.hour} onDone={(hit) => change((next) => defibResult(next, pool, hit))} />}

        {run.phase === 'boss-intro' && (
          <section className="ns-panel ns-center ns-boss">
            <span className="ns-big-icon" aria-hidden>🧑‍⚕️</span>
            <h2>6 am. The Attending wants to round.</h2>
            <p>“{bossName ? `I hear ${bossName.toLowerCase()} isn’t your strong suit.` : 'Let’s see what you actually know.'} Five questions. Get three.”</p>
            <p className="ns-items">Beat rounds for +1,000. Lose and it costs you a coffee.</p>
            <button type="button" className="btn btn-primary" autoFocus onClick={() => change((next) => proceed(next, pool))}>Start rounds</button>
          </section>
        )}

        {run.phase === 'over' && (
          <section className="ns-panel ns-over">
            <span className="ns-big-icon" aria-hidden>{run.won ? (run.bossBeaten ? '🌅' : '🌄') : '😴'}</span>
            <h2>{run.won ? (run.bossBeaten ? 'You survived the night, and impressed the Attending.' : 'You made it to morning. The Attending has notes.') : `Out of coffee at ${clockFor(Math.min(run.hour, 12))}.`}</h2>
            <p className="ns-final">{run.score.toLocaleString()}</p>
            {ending?.isBest && <p className="ns-note">🏆 Your best shift yet.</p>}
            <dl className="sd-stats">
              {ending && <div><dt>Rank</dt><dd>{ending.rank}</dd></div>}
              <div><dt>Right</dt><dd>{run.right} of {run.right + run.wrong}</dd></div>
              <div><dt>Best streak</dt><dd>{run.bestStreak}</dd></div>
            </dl>
            {ending && ending.eaten > 0 && <p className="ns-note">🥞 That ate a pancake off your plate.</p>}
            {run.missed.length > 0 && (
              <details className="ns-recap">
                <summary>Look back at the {run.missed.length} you missed. They’re in your miss bank.</summary>
                {run.missed.flatMap((id) => pool.filter((q) => q.id === id)).map((q) => (
                  <div key={q.id} className="ns-recap-item">
                    <MathText className="sd-stem">{q.stem}</MathText>
                    <p className="ns-recap-answer">✓ <InlineMath>{q.correct.map((i) => q.choices[i]).join(', ')}</InlineMath></p>
                    {q.explanation && <MathText>{q.explanation}</MathText>}
                  </div>
                ))}
              </details>
            )}
            <div className="sd-actions">
              <button type="button" className="btn btn-primary" onClick={() => begin(pool, bossSystem)}>Another shift</button>
              <Link className="btn btn-secondary" href="/study">Back to PA Today</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
