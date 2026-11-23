'use client';

import { useEffect, useRef, useState } from 'react';
import { judge, makeDrillProblem, makeProblem, nextLevel, SPRINT_SECONDS, type DrillTarget, type MathProblem } from '@/lib/workout/rest-math';
import {
  drillTargets,
  emptyMathStats,
  normalizeMathStats,
  recordSprintStats,
  type MathAnswerRecord,
  type MathStats,
} from '@/lib/workout/rest-math-stats';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import { formatSeconds, readJsonPref, saveJsonPref, setInProgress, type ActivityProps } from './shared';
import { MathStatsPanel } from './MathStatsPanel';

export { MathStatsPanel };

// A 60-second sprint of mental arithmetic, all on this device. On-screen keys,
// so the phone keyboard never covers the page. The clock only runs while it's
// on screen: when the rest ends it stops, and the sprint waits for next time.

type Sprint = {
  phase: 'idle' | 'running' | 'over';
  /** A sprint climbs the levels; a drill serves your weak spots and doesn't count toward your best. */
  mode: 'sprint' | 'drill';
  targets: DrillTarget[];
  /** Seconds left. */
  left: number;
  level: number;
  streak: number;
  score: number;
  misses: number;
  problem: MathProblem;
  problemMs: number;
  answers: MathAnswerRecord[];
  typed: string;
  /** The last answer, for a moment: right, or wrong with what it should have been. */
  flash: { right: boolean; answer: number } | null;
  newBest: boolean;
};

const BEST_PREF = 'workout:restMathBest';
const STATS_PREF = 'workout:restMathStats';
const fresh = (level = 1, mode: Sprint['mode'] = 'sprint', targets: DrillTarget[] = []): Sprint => ({
  phase: 'idle',
  mode,
  targets,
  left: SPRINT_SECONDS,
  level,
  streak: 0,
  score: 0,
  misses: 0,
  problem: mode === 'drill' ? makeDrillProblem(targets) : makeProblem(level),
  problemMs: 0,
  answers: [],
  typed: '',
  flash: null,
  newBest: false,
});

// Kept here between rests (the panel unmounts this while you lift).
let kept: Sprint | null = null;
const readBest = () => Math.max(0, Number(readPref(BEST_PREF)) || 0);

function readLocalStats(): MathStats {
  const raw = readJsonPref<unknown>(STATS_PREF);
  if (raw !== null) return normalizeMathStats(raw);
  const legacyBest = readBest();
  const empty = emptyMathStats();
  return legacyBest > 0 ? { ...empty, best: legacyBest } : empty;
}

export default function QuickMath({ canStartNew, onResult }: ActivityProps) {
  const [sprint, setSprint] = useState<Sprint>(() => kept ?? fresh());
  const [stats, setStats] = useState<MathStats>(emptyMathStats);
  const [signedIn, setSignedIn] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const sprintRef = useRef(sprint);
  const statsRef = useRef(stats);
  const signedInRef = useRef(signedIn);
  const onResultRef = useRef(onResult);
  const savedOverRef = useRef(sprint.phase === 'over');

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    sprintRef.current = sprint;
    kept = sprint;
    setInProgress('math', sprint.phase === 'running');
  }, [sprint]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    signedInRef.current = signedIn;
  }, [signedIn]);

  useEffect(() => {
    let active = true;
    // This device's stats first (read after mount: the server can't see them, and reading them in
    // the first render made its HTML differ from the browser's), then the account's if signed in.
    const local = readLocalStats();
    setStats(local);
    statsRef.current = local;
    void (async () => {
      try {
        const res = await fetch('/api/workout/math', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!active || !res.ok || !body.success) return;
        const isSignedIn = Boolean(body.signedIn);
        setSignedIn(isSignedIn);
        signedInRef.current = isSignedIn;
        if (isSignedIn) {
          const remote = normalizeMathStats(body.stats);
          setStats(remote);
          statsRef.current = remote;
        }
      } catch { /* offline, stay on local stats */ }
    })();
    return () => { active = false; };
  }, []);

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
        const problemMs = s.problemMs + step * 1000;
        if (left > 0) return { ...s, left, problemMs };
        return { ...s, left: 0, problemMs, phase: 'over', newBest: s.mode === 'sprint' && s.score > statsRef.current.best, flash: null };
      });
    }, 200);
    return () => clearInterval(handle);
  }, [running]);

  useEffect(() => {
    if (sprint.phase === 'running') {
      savedOverRef.current = false;
      return;
    }
    if (sprint.phase !== 'over' || savedOverRef.current) return;
    savedOverRef.current = true;

    const input = { score: sprint.score, answers: sprint.answers, mode: sprint.mode };
    const nextLocal = recordSprintStats(readLocalStats(), input);
    saveJsonPref(STATS_PREF, nextLocal);
    savePref(BEST_PREF, String(nextLocal.best));

    const nextDisplay = signedInRef.current ? recordSprintStats(statsRef.current, input) : nextLocal;
    setStats(nextDisplay);
    statsRef.current = nextDisplay;
    onResultRef.current?.();

    if (!signedInRef.current) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/workout/math', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => ({}));
        if (active && res.ok && body.success && body.stats) {
          const serverStats = normalizeMathStats(body.stats);
          setStats(serverStats);
          statsRef.current = serverStats;
          onResultRef.current?.();
        }
      } catch { /* keep local/optimistic stats */ }
    })();
    return () => { active = false; };
  }, [sprint.phase, sprint.score, sprint.answers]);

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
      if (key === 'skip') return answered(s, false, '');
      const typed = (s.typed + key).replace(/^0+(?=\d)/, '').slice(0, 6);
      const verdict = judge(typed, s.problem.answer);
      return verdict === 'more' ? { ...s, typed } : answered(s, verdict === 'right', typed);
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

  const targets = drillTargets(stats);
  const start = (mode: Sprint['mode'] = sprintRef.current.mode) => {
    savedOverRef.current = false;
    const next = mode === 'drill' ? fresh(1, 'drill', drillTargets(statsRef.current)) : fresh(Math.max(1, (sprintRef.current.mode === 'drill' ? 2 : sprintRef.current.level) - 1));
    setSprint({ ...next, phase: 'running' });
  };
  const drillButton = (
    <button
      type="button"
      className="rest-btn"
      disabled={!targets.length}
      title={targets.length ? 'A minute of the facts and kinds of problem you find hardest' : 'Play a few sprints first, so it knows what to drill'}
      onClick={() => start('drill')}
    >
      🎯 Drill weak spots
    </button>
  );

  if (sprint.phase === 'idle') {
    return (
      <div className="rest-math">
        <p className="rest-note">
          A minute of mental math. How many can you get?
          {stats.best > 0 && <> Your best: <strong>{stats.best}</strong>.</>}
        </p>
        <div className="rest-actions">
          {canStartNew
            ? <><button type="button" className="rest-btn is-primary" onClick={() => start('sprint')}>Start the 60 seconds</button>{drillButton}</>
            : <p className="rest-note">Not long enough for a sprint, just breathe.</p>}
          <button
            type="button"
            className="rest-link rest-math-stats-toggle"
            aria-expanded={showStats}
            onClick={() => setShowStats((v) => !v)}
          >
            {showStats ? 'Hide stats' : 'Stats'}
          </button>
        </div>
        {showStats && <MathStatsPanel stats={stats} />}
      </div>
    );
  }

  if (sprint.phase === 'over') {
    const sprintAvgSec = sprint.answers.length > 0
      ? (sprint.answers.reduce((sum, a) => sum + Math.min(30_000, Math.max(100, a.ms)), 0) / sprint.answers.length / 1000).toFixed(1)
      : null;

    return (
      <div className="rest-math">
        <p className="rest-result">
          <strong>{sprint.mode === 'drill' ? 'Drill done!' : 'Time!'}</strong> {sprint.score} right{sprint.misses ? `, ${sprint.misses} missed` : ''}.{' '}
          {sprint.mode === 'drill' ? 'Practice only: it doesn’t count toward your best.' : sprint.newBest ? 'A new best 🎉' : `Best: ${stats.best}.`}
          {sprintAvgSec && <span className="rest-muted"> · Avg {sprintAvgSec}s/problem</span>}
        </p>
        <div className="rest-actions">
          {canStartNew && <button type="button" className="rest-btn" onClick={() => start(sprint.mode)}>{sprint.mode === 'drill' ? 'Drill again' : 'Go again'}</button>}
          {canStartNew && sprint.mode === 'sprint' && drillButton}
          {canStartNew && sprint.mode === 'drill' && <button type="button" className="rest-btn" onClick={() => start('sprint')}>Start a sprint</button>}
          <button
            type="button"
            className="rest-link rest-math-stats-toggle"
            aria-expanded={showStats}
            onClick={() => setShowStats((v) => !v)}
          >
            {showStats ? 'Hide stats' : 'Stats'}
          </button>
        </div>
        {showStats && <MathStatsPanel stats={stats} />}
      </div>
    );
  }

  return (
    <div className="rest-math">
      <div className="rest-math-top">
        <span className={sprint.left < 10 ? 'is-low' : undefined}>⏱ {formatSeconds(Math.ceil(sprint.left))}</span>
        <span>{sprint.score} right</span>
        <span>{sprint.mode === 'drill' ? '🎯 Drill' : `Level ${sprint.level}`}</span>
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

function answered(s: Sprint, right: boolean, typed: string): Sprint {
  const drill = s.mode === 'drill';
  const { level, streak } = drill ? { level: s.level, streak: 0 } : nextLevel(s.level, s.streak, right);
  const record: MathAnswerRecord = {
    op: s.problem.op,
    right,
    ms: Math.max(100, Math.round(s.problemMs)),
    // Drill problems aren't from a level, so they stay out of the by-level numbers.
    ...(drill ? {} : { level: s.level }),
    ...(s.problem.facts ? { facts: s.problem.facts } : {}),
    text: s.problem.text,
    answer: s.problem.answer,
    ...(right ? {} : { typed }),
  };
  return {
    ...s,
    level,
    streak,
    typed: '',
    problemMs: 0,
    answers: [...s.answers, record],
    score: s.score + (right ? 1 : 0),
    misses: s.misses + (right ? 0 : 1),
    problem: drill ? makeDrillProblem(s.targets) : makeProblem(level),
    flash: { right, answer: s.problem.answer },
  };
}
