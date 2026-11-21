'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ComponentType } from 'react';
import { ACTIVITIES, readChoice, readOpen, saveChoice, saveOpen, useInProgress, type Activity, type ActivityProps, type Choice } from './shared';
import './rest.css';

// "During rest": something small to do between sets — a Skills question, a
// chess puzzle or a minute of mental math. A light extra under the rest timer:
// it folds away and never takes focus. When the rest is up it steps aside for
// "Rested — go!"; a half-done activity waits (it keeps its place, as the
// activities hold their state outside the panel) for the next rest.

const loading = () => <p className="rest-note">Loading…</p>;
// Each activity is its own chunk, fetched the first time it's picked.
const VIEWS: Record<Activity, ComponentType<ActivityProps>> = {
  skills: dynamic(() => import('./SkillsQuestion'), { ssr: false, loading }),
  chess: dynamic(() => import('./ChessPuzzle'), { ssr: false, loading }),
  math: dynamic(() => import('./QuickMath'), { ssr: false, loading }),
};

/** Less rest left than this: don't start anything new. */
const MIN_SECONDS = 30;

export default function RestPanel({ done, elapsed, target }: { done: boolean; elapsed: number; target: number }) {
  // Read after mounting: the server can't see this device's choice.
  const [choice, setChoice] = useState<Choice | null>(null);
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setChoice(readChoice());
    setOpen(readOpen());
    setReady(true);
  }, []);

  // A new set restarts the rest clock: the only time `elapsed` goes down.
  const [lastElapsed, setLastElapsed] = useState(elapsed);
  /** "Finish it" was tapped after the rest ran out. */
  const [finishing, setFinishing] = useState(false);
  /** The activity has been on screen this rest (so it isn't swapped for "just breathe" midway). */
  const [shown, setShown] = useState(false);
  if (elapsed !== lastElapsed) {
    setLastElapsed(elapsed);
    if (elapsed < lastElapsed) { setFinishing(false); setShown(false); }
  }

  const activity = choice && choice !== 'off' ? choice : null;
  const inProgress = useInProgress(activity);
  const secondsLeft = target - elapsed;
  const paused = done && !finishing;
  const tooShort = !inProgress && !shown && !done && secondsLeft < MIN_SECONDS;
  const showing = ready && !!activity && open && !paused && !tooShort;
  if (showing && !shown) setShown(true);
  if (!ready) return null;

  const pick = (next: Choice) => {
    setChoice(next);
    saveChoice(next);
    setShown(false);
    if (next !== 'off') { setOpen(true); saveOpen(true); }
  };
  const toggle = () => { setOpen(!open); saveOpen(!open); };

  if (choice === 'off') {
    return (
      <div className="rest-off">
        <button type="button" className="rest-link" onClick={() => setChoice(null)}>Something to do while you rest?</button>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="rest-panel">
        <p className="rest-ask">Something to do while you rest?</p>
        <div className="rest-choices">
          {ACTIVITIES.map((a) => (
            <button key={a.id} type="button" className="rest-choice" onClick={() => pick(a.id)}>
              <span aria-hidden>{a.icon}</span> {a.label}
            </button>
          ))}
          <button type="button" className="rest-choice is-off" onClick={() => pick('off')}>Off</button>
        </div>
      </div>
    );
  }

  const View = VIEWS[activity];
  const current = ACTIVITIES.find((a) => a.id === activity)!;

  return (
    <div className={`rest-panel${open ? '' : ' is-closed'}`}>
      <div className="rest-head">
        <button type="button" className="rest-fold" aria-expanded={open} onClick={toggle}>
          <span className="rest-fold-mark" aria-hidden>{open ? '▾' : '▸'}</span>
          <span aria-hidden>{current.icon}</span> {current.label}
        </button>
        {open && (
          <span className="rest-switch" role="group" aria-label="Pick another">
            {ACTIVITIES.filter((a) => a.id !== activity).map((a) => (
              <button key={a.id} type="button" aria-label={a.label} title={a.label} onClick={() => pick(a.id)}>{a.icon}</button>
            ))}
            <button type="button" className="is-off" aria-label="Turn rest activities off" onClick={() => pick('off')}>Off</button>
          </span>
        )}
      </div>
      {open && paused && inProgress && (
        <p className="rest-note">
          Saved for your next rest.{' '}
          <button type="button" className="rest-link" onClick={() => setFinishing(true)}>Finish it now</button>
        </p>
      )}
      {open && tooShort && <p className="rest-note">Not long enough, just breathe.</p>}
      {showing && <View canStartNew={!done && secondsLeft >= MIN_SECONDS} onSwitch={pick} />}
    </div>
  );
}
