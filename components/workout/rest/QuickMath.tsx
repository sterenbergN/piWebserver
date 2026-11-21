'use client';

import { useEffect, useRef, useState } from 'react';
import { judge, makeProblem, nextLevel, SPRINT_SECONDS, type MathProblem } from '@/lib/workout/rest-math';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import { formatSeconds, setInProgress, type ActivityProps } from './shared';

// A 60-second sprint of mental arithmetic, all on this device. On-screen keys,
// so the phone keyboard never covers the page. The clock only runs while it's
// on screen: when the rest ends it stops, and the sprint waits for next time.

type Sprint = {
  phase: 'idle' | 'running' | 'over';
  /** Seconds left. */
  left: number;
  level: number;
  streak: number;
  score: number;
  misses: number;
  problem: MathProblem;
  typed: string;
  /** The last answer, for a moment: right, or wrong with what it should have been. */
  flash: { right: boolean; answer: number } | null;
  newBest: boolean;
};

const BEST_PREF = 'workout:restMathBest';
const fresh = (level = 1): Sprint => ({
  phase: 'idle', left: SPRINT_SECONDS, level, streak: 0, score: 0, misses: 0, problem: makeProblem(level), typed: '', flash: null, newBest: false,
});

// Kept here between rests (the panel unmounts this while you lift).
let kept: Sprint | null = null;
const readBest = () => Math.max(0, Number(readPref(BEST_PREF)) || 0);

export default function QuickMath({ canStartNew }: ActivityProps) {
  const [sprint, setSprint] = useState<Sprint>(() => kept ?? fresh());
  const [best, setBest] = useState(readBest);
  const sprintRef = useRef(sprint);
  useEffect(() => {
    sprintRef.current = sprint;
    kept = sprint;
    setInProgress('math', sprint.phase === 'running');
  }, [sprint]);

  // The clock, from real time (a slow tick or a backgrounded tab doesn't stretch it).
  const running = sprint.phase === 'running';
  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    const handle = setInterval(() => {
      const now = Date.now();
      const step = (now - last) / 1000;
      last = now;
      setSprint((s) => {
        if (s.phase !== 'running') return s;
        const left = Math.max(0, s.left - step);
        if (left > 0) return { ...s, left };
        return { ...s, left: 0, phase: 'over', newBest: s.score > readBest(), flash: null };
      });
    }, 200);
    return () => clearInterval(handle);
  }, [running]);

  useEffect(() => {
    if (sprint.phase !== 'over' || !sprint.newBest) return;
    savePref(BEST_PREF, String(sprint.score));
    setBest(sprint.score);
  }, [sprint.phase, sprint.newBest, sprint.score]);

  // The right/wrong mark fades after a moment.
  useEffect(() => {
    if (!sprint.flash) return;
    const handle = setTimeout(() => setSprint((s) => ({ ...s, flash: null })), 700);
    return () => clearTimeout(handle);
  }, [sprint.flash]);

  const press = (key: string) => {
    setSprint((s) => {
      if (s.phase !== 'running') return s;
      if (key === 'back') return { ...s, typed: s.typed.slice(0, -1) };
      if (key === 'skip') return answered(s, false);
      const typed = (s.typed + key).replace(/^0+(?=\d)/, '').slice(0, 6);
      const verdict = judge(typed, s.problem.answer);
      return verdict === 'more' ? { ...s, typed } : answered(s, verdict === 'right');
    });
  };

  // A keyboard works too, on a computer (never while typing in a box).
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running]);

  const start = () => setSprint({ ...fresh(Math.max(1, sprintRef.current.level - 1)), phase: 'running' });

  if (sprint.phase === 'idle') {
    return (
      <div className="rest-math">
        <p className="rest-note">A minute of mental math. How many can you get?{best > 0 && <> Your best: <strong>{best}</strong>.</>}</p>
        {canStartNew
          ? <button type="button" className="rest-btn is-primary" onClick={start}>Start the 60 seconds</button>
          : <p className="rest-note">Not long enough for a sprint, just breathe.</p>}
      </div>
    );
  }

  if (sprint.phase === 'over') {
    return (
      <div className="rest-math">
        <p className="rest-result">
          <strong>Time!</strong> {sprint.score} right{sprint.misses ? `, ${sprint.misses} missed` : ''}.{' '}
          {sprint.newBest ? 'A new best 🎉' : `Best: ${best}.`}
        </p>
        {canStartNew && <button type="button" className="rest-btn" onClick={start}>Go again</button>}
      </div>
    );
  }

  return (
    <div className="rest-math">
      <div className="rest-math-top">
        <span className={sprint.left < 10 ? 'is-low' : undefined}>⏱ {formatSeconds(Math.ceil(sprint.left))}</span>
        <span>{sprint.score} right</span>
        <span>Level {sprint.level}</span>
      </div>
      <div className={`rest-math-problem${sprint.flash ? (sprint.flash.right ? ' is-right' : ' is-wrong') : ''}`} aria-live="polite">
        <span>{sprint.problem.text} =</span>
        <output className="rest-math-typed">{sprint.typed || ' '}</output>
        {sprint.flash && <span className="rest-math-flash">{sprint.flash.right ? '✓' : `✗ ${sprint.flash.answer}`}</span>}
      </div>
      <div className="rest-keypad" role="group" aria-label="Number keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" aria-label="Delete" onClick={() => press('back')}>⌫</button>
        <button type="button" onClick={() => press('0')}>0</button>
        <button type="button" className="is-skip" onClick={() => press('skip')}>Skip</button>
      </div>
    </div>
  );
}

function answered(s: Sprint, right: boolean): Sprint {
  const { level, streak } = nextLevel(s.level, s.streak, right);
  return {
    ...s, level, streak, typed: '',
    score: s.score + (right ? 1 : 0),
    misses: s.misses + (right ? 0 : 1),
    problem: makeProblem(level),
    flash: { right, answer: s.problem.answer },
  };
}
