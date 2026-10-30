'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { playBeep, readPref, savePref, unlockAudio, vibrate } from '@/lib/workout/device-prefs';

/**
 * A countdown keeps the time it goes off rather than counting ticks, so it
 * stays right when the phone sleeps or the tab is in the background (like
 * the workout rest timer). Kept on this device so a reload doesn't lose it.
 */
export type RunningTimer = {
  id: string;
  label: string;
  recipeSlug: string;
  totalSec: number;
  /** When it goes off (ms since epoch) while running; null while paused or done. */
  endsAt: number | null;
  /** Seconds left while paused. */
  remainingSec: number;
  done: boolean;
  /** Went off and nobody has acknowledged it yet. */
  ringing?: boolean;
};

const TIMERS_PREF = 'recipes:timers';
/** Coming back to a timer that went off longer ago than this doesn't beep late. */
const LATE_ALARM_MS = 2 * 60 * 1000;
/** A timer repeats its alarm until it's acknowledged, but not forever. */
const RING_EVERY_MS = 4000;
const RING_FOR_MS = 60 * 1000;

export const secondsLeft = (t: RunningTimer, now: number) =>
  t.endsAt !== null ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : t.remainingSec;

export const isRunning = (t: RunningTimer | undefined) => Boolean(t && t.endsAt !== null && !t.done);

function readSavedTimers(): Record<string, RunningTimer> {
  try {
    const saved = JSON.parse(readPref(TIMERS_PREF) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    // A reload is an acknowledgement: whatever was ringing has been seen, or is long past.
    return Object.fromEntries(Object.entries(saved as Record<string, RunningTimer>).map(([id, t]) => [id, { ...t, ringing: false }]));
  } catch {
    return {};
  }
}

export type RecipeTimers = ReturnType<typeof useRecipeTimers>;

export function useRecipeTimers() {
  const [timers, setTimers] = useState<Record<string, RunningTimer>>({});
  const [now, setNow] = useState(() => Date.now());
  const timersRef = useRef(timers);
  const audioRef = useRef<AudioContext | null>(null);

  const ringOnce = useCallback(() => {
    vibrate([300, 150, 300, 150, 300]);
    playBeep(audioRef.current, 3);
  }, []);

  useEffect(() => {
    setTimers(readSavedTimers());
  }, []);

  // Redrawn while any run, and each one alarms at the moment it's due (not on
  // the next tick). A timer that went off while the phone slept is shown as
  // done without a late beep.
  useEffect(() => {
    timersRef.current = timers;
    savePref(TIMERS_PREF, JSON.stringify(timers));
    const running = Object.values(timers).filter(isRunning);
    if (!running.length) return;
    const finish = (id: string) => {
      const t = timersRef.current[id];
      if (!t || t.done || t.endsAt === null) return;
      const onTime = Date.now() - t.endsAt < LATE_ALARM_MS;
      if (onTime) ringOnce();
      setTimers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], endsAt: null, remainingSec: 0, done: true, ringing: onTime } } : prev));
    };
    const alarms = running.map((t) => window.setTimeout(() => finish(t.id), Math.max(0, t.endsAt! - Date.now())));
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    setNow(Date.now());
    return () => {
      alarms.forEach((handle) => window.clearTimeout(handle));
      window.clearInterval(tick);
    };
  }, [timers, ringOnce]);

  // Keep ringing until acknowledged (or a minute has gone by).
  const anyRinging = Object.values(timers).some((t) => t.ringing);
  useEffect(() => {
    if (!anyRinging) return;
    const repeat = window.setInterval(ringOnce, RING_EVERY_MS);
    const stop = window.setTimeout(() => {
      setTimers((prev) => Object.fromEntries(Object.entries(prev).map(([id, t]) => [id, { ...t, ringing: false }])));
    }, RING_FOR_MS);
    return () => {
      window.clearInterval(repeat);
      window.clearTimeout(stop);
    };
  }, [anyRinging, ringOnce]);

  // Every tap re-unlocks audio, which iPhones suspend when the screen locks or
  // another app plays sound — otherwise the alarm is silently dropped.
  const hasTimers = Object.keys(timers).length > 0;
  useEffect(() => {
    if (!hasTimers) return;
    const unlock = () => {
      audioRef.current = unlockAudio(audioRef.current);
    };
    document.addEventListener('pointerdown', unlock, true);
    return () => document.removeEventListener('pointerdown', unlock, true);
  }, [hasTimers]);

  /** Start, pause, resume, or restart (once done). */
  const toggle = useCallback((id: string, label: string, seconds: number, recipeSlug: string) => {
    audioRef.current = unlockAudio(audioRef.current); // a tap, so the alarm may play later
    const at = Date.now();
    setTimers((prev) => {
      const cur = prev[id];
      let next: RunningTimer;
      if (!cur || cur.done) {
        next = { id, label, recipeSlug, totalSec: seconds, endsAt: at + seconds * 1000, remainingSec: seconds, done: false };
      } else if (cur.endsAt !== null) {
        next = { ...cur, endsAt: null, remainingSec: secondsLeft(cur, at) };
      } else {
        next = { ...cur, endsAt: at + cur.remainingSec * 1000 };
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setTimers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { timers, now, hasTimers, toggle, dismiss };
}
