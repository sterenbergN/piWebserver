'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { getPossibleWeights, snapToPossibleWeight } from '@/lib/workout/equipment';
import { exerciseName, lastSessionForLift } from '@/lib/workout/exercises';
import { restTargetSeconds } from '@/lib/workout/session-insights';
import { isLoadStation } from '@/lib/workout/types';
import { playBeep, readPref, savePref, unlockAudio, vibrate } from '@/lib/workout/device-prefs';
import { relatedStartingWeight } from '@/lib/workout/related-exercises';
import { getBaselineReps, topSet, uidOf, type HistoricStats, type Suggestion } from '@/lib/workout/tracker-utils';

// Self-contained pieces of the tracker's behaviour. Tracker.tsx owns the
// workout state (plan, logs, drafts) and wires these together.

/** Workout and per-lift timers, ticking while the workout is open. */
export function useWorkoutClock(activeUid: string, running: boolean, resume?: { elapsedSecs?: number; liftElapsedSecsMap?: Record<string, number> }) {
  const [elapsedSecs, setElapsedSecs] = useState<number>(resume?.elapsedSecs || 0);
  // Keyed by the lift's plan id (not its index) so timers stay with the right
  // lift when lifts are removed or reordered.
  const [liftElapsedSecsMap, setLiftElapsedSecsMap] = useState<Record<string, number>>(resume?.liftElapsedSecsMap || {});

  useEffect(() => {
    if (!running || !activeUid) return;
    let previousTick = Date.now();
    const timer = setInterval(() => {
      const delta = Math.floor((Date.now() - previousTick) / 1000);
      if (delta > 0) {
        previousTick += delta * 1000;
        setElapsedSecs((e) => e + delta);
        setLiftElapsedSecsMap((m) => ({ ...m, [activeUid]: (m[activeUid] || 0) + delta }));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [running, activeUid]);

  return { elapsedSecs, liftElapsedSecsMap };
}

/** True on phone-width screens (tighter tracker layout). */
export function useCompactLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 430px)');
    setCompact(query.matches);
    const listener = (event: MediaQueryListEvent) => setCompact(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return compact;
}

const REST_TIMES_PREF = 'workout:restTimes';

function readRestTimes(): Record<string, number> {
  try {
    const parsed = JSON.parse(readPref(REST_TIMES_PREF) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

type RestTimerOptions = {
  lastSetAt: number | null;
  /** Reps planned for the lift you're on; sets the default rest. */
  reps: number;
  enabled: boolean;
  /** The exercise you're on (exerciseKey), so a changed rest is remembered for it. */
  liftKey: string;
  /** Rest times saved to the account (user.restTimes). */
  saved?: Record<string, number>;
  /** Signed in: also save changes to the account, so other devices get them. */
  syncToServer: boolean;
};

/**
 * Rest timer from the last logged set (any lift, so supersets work). The
 * target is rep-based until you change it with ±15 — then that rest is
 * remembered for the exercise (on this device and, signed in, your account)
 * and used every time you do it. When the rest is up the phone buzzes
 * (Android) and, if sound is on, beeps.
 */
export function useRestTimer({ lastSetAt, reps, enabled, liftKey, saved, syncToServer }: RestTimerOptions) {
  // The account's times win over this device's (they may be newer, from another phone).
  const [restTimes, setRestTimes] = useState<Record<string, number>>(() => ({ ...readRestTimes(), ...(saved || {}) }));
  const [sound, setSound] = useState(() => readPref('workout:restSound') === '1');
  const audioRef = useRef<AudioContext | null>(null);
  const notifiedFor = useRef<number | null>(null);
  const soundRef = useRef(sound);
  useEffect(() => { soundRef.current = sound; }, [sound]);

  const custom = restTimes[liftKey];
  const target = custom > 0 ? custom : restTargetSeconds(reps);
  const elapsed = lastSetAt ? Math.max(0, Math.floor((Date.now() - lastSetAt) / 1000)) : 0;
  const visible = enabled && !!lastSetAt && elapsed < 15 * 60;
  const done = elapsed >= target;

  // Alert at the exact moment the rest is up (not on the next clock tick).
  // Coming back to the page long after it ended doesn't set off a late beep.
  useEffect(() => {
    if (!enabled || !lastSetAt) return;
    const due = lastSetAt + target * 1000;
    const notify = () => {
      if (notifiedFor.current === lastSetAt) return;
      notifiedFor.current = lastSetAt;
      if (Date.now() - due > 15_000) return;
      vibrate([200, 100, 200]);
      if (soundRef.current) playBeep(audioRef.current);
    };
    const wait = due - Date.now();
    if (wait <= 0) {
      notify();
      return;
    }
    notifiedFor.current = null; // e.g. +15 after it went off: alert again at the new time
    const handle = setTimeout(notify, wait);
    return () => clearTimeout(handle);
  }, [enabled, lastSetAt, target]);

  // Every tap re-unlocks audio, which iPhones suspend when the screen locks or
  // another app plays sound — otherwise the next beep is silently dropped.
  useEffect(() => {
    if (!sound || !enabled) return;
    const unlock = () => { audioRef.current = unlockAudio(audioRef.current); };
    document.addEventListener('pointerdown', unlock, true);
    return () => document.removeEventListener('pointerdown', unlock, true);
  }, [sound, enabled]);

  // Save to the account shortly after the last ±15 tap (one request, not one per tap).
  const pendingSync = useRef<Record<string, number | null>>({});
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSync = useCallback(() => {
    syncTimer.current = null;
    const changes = pendingSync.current;
    pendingSync.current = {};
    Object.entries(changes).forEach(([key, seconds]) => {
      fetch('/api/workout/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restTime: { key, seconds } }),
        keepalive: true,
      }).catch(() => { /* still remembered on this device */ });
    });
  }, []);
  useEffect(() => () => { if (syncTimer.current) { clearTimeout(syncTimer.current); flushSync(); } }, [flushSync]);

  // Read and written straight away, so quick taps each build on the last.
  const restTimesRef = useRef(restTimes);
  const remember = (change: (current: number) => number | null) => {
    if (!liftKey) return;
    const next = { ...restTimesRef.current };
    const current = next[liftKey] > 0 ? next[liftKey] : restTargetSeconds(reps);
    const seconds = change(current);
    if (seconds === null) delete next[liftKey];
    else next[liftKey] = seconds;
    restTimesRef.current = next;
    setRestTimes(next);
    savePref(REST_TIMES_PREF, JSON.stringify(next));
    if (!syncToServer) return;
    pendingSync.current[liftKey] = seconds;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(flushSync, 1200);
  };

  return {
    target,
    elapsed,
    visible,
    done,
    sound,
    /** This exercise has its own remembered rest (not the rep-based default). */
    custom: custom > 0,
    adjust: (delta: number) => remember((current) => Math.max(15, Math.min(900, current + delta))),
    resetToDefault: () => remember(() => null),
    toggleSound: () => {
      const next = !sound;
      setSound(next);
      savePref('workout:restSound', next ? '1' : '0');
      if (next) {
        audioRef.current = unlockAudio(audioRef.current);
        playBeep(audioRef.current, 1); // so you know it can be heard
      }
    },
    /** Call from a tap (e.g. logging a set) so the beep is allowed to play later. */
    unlock: () => { if (sound) audioRef.current = unlockAudio(audioRef.current); },
  };
}

type SuggestionContext = { plan: any; pastHistory: any[]; intensity: number; defaultSetCount: number };

/** Ask the progression engine what to do on one lift today. */
async function requestSuggestion(lift: any, { plan, pastHistory, intensity, defaultSetCount }: SuggestionContext): Promise<Suggestion> {
  // Last time on this lift; for plates, dumbbells and bodyweight (same numbers
  // everywhere) the same exercise at another gym works as a starting point too.
  const possibleWeights = getPossibleWeights(lift.station);
  const last = lastSessionForLift(pastHistory, lift);
  const usable = last && (last.sameLift || !isLoadStation(lift.station?.type)) ? last : null;
  const lastWorkout: any = usable?.workout || null;
  const sessionSets: any[] = usable
    ? (usable.sameLift ? usable.sets : usable.sets.map((set: any) => ({ ...set, weight: snapToPossibleWeight(set.weight, possibleWeights) })))
    : [];
  const baseline: Suggestion = {
    liftId: lift.id,
    intensity,
    weight: possibleWeights[0] ?? 0,
    reps: getBaselineReps(plan.type),
    sets: defaultSetCount,
    reason: 'Initial baseline weights.',
    breakdown: null,
    metrics: null,
    candidates: 0,
    calibration: null,
    historicStats: null,
  };

  let data: any = null;
  try {
    const response = await fetch('/api/workout/progression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        liftId: lift.id,
        liftName: exerciseName(lift),
        gymId: plan.gymId,
        station: lift.station,
        logs: sessionSets,
        plannedSets: lastWorkout?.liftMeta?.[lift.id]?.plannedSets,
        planType: plan.type,
        intensity,
        progressionProfile: lift.progressionProfile || 'standard',
        deload: plan.isDeload === true,
      }),
    });
    data = await response.json();
  } catch {
    data = null;
  }

  const calibration = data?.calibration || null;
  if (sessionSets.length === 0) {
    // Never done here: start from a related lift if there is one (bench → dumbbell bench).
    const related = plan.isDeload ? null : relatedStartingWeight(lift, pastHistory, { reps: baseline.reps, possibleWeights });
    return related
      ? { ...baseline, weight: related.weight, reason: `First time — estimated from your ${related.fromName} (est. 1RM ${related.fromE1rm}). Adjust if it feels off.`, calibration }
      : { ...baseline, calibration };
  }

  const top = topSet(sessionSets)!;
  const historicStats: HistoricStats = {
    prevWeight: top.weight,
    prevReps: top.reps,
    prevSets: sessionSets.length,
    est1RM: Math.round(calcAverage1RM(top.weight, top.reps)),
  };

  if (!data?.success || !data.plan) {
    // Offline / server error: repeat last session rather than resetting to baseline.
    return {
      ...baseline,
      weight: snapToPossibleWeight(top.weight, possibleWeights),
      reps: top.reps,
      sets: sessionSets.length,
      reason: 'Offline — repeating last session.',
      calibration,
      historicStats,
    };
  }

  return {
    liftId: lift.id,
    intensity,
    weight: data.plan.suggestedWeight,
    reps: data.plan.suggestedReps,
    sets: data.plan.suggestedSets,
    reason: data.plan.reasoning || '',
    breakdown: data.plan.scoringBreakdown || null,
    metrics: data.plan.performanceMetrics || null,
    candidates: data.plan.candidatesEvaluated || 0,
    calibration,
    historicStats,
  };
}

/**
 * Engine suggestions for every lift in the plan (so set targets in the list
 * are accurate), re-fetched when intensity changes. Results are stored per
 * planned lift, so a slow response can never overwrite another lift's numbers.
 */
export function useSuggestions(plan: any, pastHistory: any[], intensity: number, defaultSetCount: number) {
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  // Latest values for the async request callbacks (refreshed after each render).
  const suggestionsRef = useRef(suggestions);
  const intensityRef = useRef(intensity);
  const context = useRef<SuggestionContext>({ plan, pastHistory, intensity, defaultSetCount });
  useEffect(() => {
    suggestionsRef.current = suggestions;
    intensityRef.current = intensity;
    context.current = { plan, pastHistory, intensity, defaultSetCount };
  });
  const loadedOnce = useRef(false);

  useEffect(() => {
    const delay = loadedOnce.current ? 350 : 0; // debounce slider drags
    const handle = setTimeout(() => {
      loadedOnce.current = true;
      plan.lifts.forEach((lift: any) => {
        const uid = uidOf(lift);
        const existing = suggestionsRef.current[uid];
        if (existing && existing.intensity === intensity && existing.liftId === lift.id) return;
        requestSuggestion(lift, { ...context.current, intensity }).then((suggestion) => {
          // Drop responses for an intensity the user has since moved away from.
          if (suggestion.intensity !== intensityRef.current) return;
          setSuggestions((prev) => ({ ...prev, [uid]: suggestion }));
        });
      });
    }, delay);
    return () => clearTimeout(handle);
  }, [plan.lifts, intensity, plan.gymId, plan.isDeload]);

  /** Forget suggestions for these planned lifts (e.g. their equipment changed) so they're re-fetched. */
  const invalidate = useCallback((uids: string[]) => {
    setSuggestions((prev) => {
      const next = { ...prev };
      uids.forEach((uid) => delete next[uid]);
      return next;
    });
  }, []);

  return { suggestions, invalidate };
}
