'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { bestE1RMByExercise, bestE1RMByLift, detectStalledLifts, warmupSets } from '@/lib/workout/session-insights';
import { calculatePlates, getPossibleWeights, stepWeight } from '@/lib/workout/equipment';
import { exerciseKey, exerciseKeyFromName, exerciseName, lastSessionForLift } from '@/lib/workout/exercises';
import { formatProjection, goalLabel, goalProgress, goalsFor, setMeetsGoal, type Goal } from '@/lib/workout/goals';
import { isLoadStation, type Gym } from '@/lib/workout/types';
import { DEMO_USER_ID } from '@/lib/workout/demo-data';
import { enqueueWorkout, isRetryableSaveFailure } from '@/lib/workout/offline-queue';
import { takeQueuedLifts } from '@/lib/workout/station-link';
import { vibrate } from '@/lib/workout/device-prefs';
import { buildSavePayload, estimateCalories, getBaselineReps, newPlanId, uidOf, workoutTotals, type LoggedSet, type WarmupSet } from '@/lib/workout/tracker-utils';
import { useSitePopup } from '@/components/SitePopup';
import LiftHistorySheet from '@/components/workout/LiftHistorySheet';
import SetEditSheet from '@/components/workout/SetEditSheet';
import ActiveLiftEditor from '@/components/workout/ActiveLiftEditor';
import { useCompactLayout, useRestTimer, useSuggestions, useWakeLock, useWorkoutClock } from './tracker/hooks';
import { useSharedSession, type ProgressUpdate } from './tracker/useSharedSession';
import TopBar from './tracker/TopBar';
import LiftCard from './tracker/LiftCard';
import SetLogger from './tracker/SetLogger';
import FinishScreen from './tracker/FinishScreen';
import { SupersetSheet, SwapLiftSheet, WorkoutListSheet, WorkoutMenu } from './tracker/Sheets';

type PR = { name: string; e1rm: number; previous: number; weight: number; reps: number };
type Toast = { text: string; tone: 'quiet' | 'win'; undo?: () => void };

type TrackerProps = {
  plan: any;
  allLifts: any[];
  user: any;
  pastHistory: any[];
  goals?: Goal[];
  resumeState?: any;
  sharedSessionId?: string | null;
  /** The page is running on cached data (no connection). */
  offline?: boolean;
};

/**
 * The workout in progress. Owns the workout state (plan, logged sets, what's
 * dialed in for the next set) and the actions on it; the screens live in
 * ./tracker and the self-contained behaviours (clock, rest timer, engine
 * suggestions, partner mode) in ./tracker hooks.
 */
export default function Tracker({ plan, allLifts, user, pastHistory, goals = [], resumeState, sharedSessionId: sharedSessionIdProp, offline = false }: TrackerProps) {
  const { confirm, popup } = useSitePopup();
  const compact = useCompactLayout();

  // ─── Workout state ──────────────────────────────────────────────────────────
  const [localPlan, setLocalPlan] = useState<any>(resumeState?.plan || plan);
  const [activeLiftIndex, setActiveLiftIndex] = useState<number>(resumeState?.activeLiftIndex || 0);
  const [workoutStartTime] = useState(resumeState?.startTime || Date.now());
  const [logs, setLogs] = useState<Record<string, LoggedSet[]>>(resumeState?.logs || {});
  const [warmupsDone, setWarmupsDone] = useState<Record<string, WarmupSet[]>>(resumeState?.warmupsDone || {});
  // Manual weight/rep overrides per lift, so bouncing between superset
  // partners doesn't reset what the user dialed in.
  const [drafts, setDrafts] = useState<Record<string, { weight: number; reps: number }>>(resumeState?.drafts || {});
  const [intensity, setIntensity] = useState<number>(resumeState?.intensitySlider ?? user?.intensityFactor ?? 1.0);
  const [lastSetAt, setLastSetAt] = useState<number | null>(resumeState?.lastSetAt ?? null);
  const [sessionPRs, setSessionPRs] = useState<Record<string, PR>>(resumeState?.sessionPRs || {});
  const [goalsHit, setGoalsHit] = useState<string[]>(resumeState?.goalsHit || []);
  const [finished, setFinished] = useState(false);

  // ─── UI state ───────────────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<null | 'list' | 'add' | 'menu' | 'swap' | 'superset' | 'history'>(null);
  const [editTarget, setEditTarget] = useState<'lift' | 'station' | null>(null);
  const [editingSetIndex, setEditingSetIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [templateState, setTemplateState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Lifts picked on a station page (QR sticker) join the workout in progress.
  useEffect(() => {
    const queued = takeQueuedLifts();
    if (queued.length === 0) return;
    setLocalPlan((prev: any) => ({
      ...prev,
      lifts: [...prev.lifts, ...queued.map((q) => ({ ...q.lift, station: q.station, gymId: q.gymId, gymName: q.gymName, uniquePlanId: newPlanId() }))],
    }));
    setActiveLiftIndex(localPlan.lifts.length);
  }, []);

  // Guard against an out-of-range index (e.g. a resumed plan that lost lifts).
  const safeLiftIndex = Math.min(Math.max(0, activeLiftIndex), Math.max(0, localPlan.lifts.length - 1));
  useEffect(() => { if (activeLiftIndex !== safeLiftIndex) setActiveLiftIndex(safeLiftIndex); }, [activeLiftIndex, safeLiftIndex]);
  const activeLift = localPlan.lifts[safeLiftIndex];
  const activeUid = uidOf(activeLift);
  useEffect(() => { setEditingSetIndex(null); }, [activeUid]);

  const defaultSetCount = Number(localPlan.type?.sets) > 0 ? Number(localPlan.type.sets) : 5;
  const { elapsedSecs, liftElapsedSecsMap } = useWorkoutClock(activeUid, !finished, resumeState);
  useWakeLock(!finished);
  const { suggestions, invalidate } = useSuggestions(localPlan, pastHistory, intensity, defaultSetCount);

  // ─── Derived values ─────────────────────────────────────────────────────────
  const getLogs = useCallback((lift: any, source = logs) => (lift ? source[uidOf(lift)] || [] : []), [logs]);
  /** Sets planned for a lift: the engine's suggestion, else the workout type's default. */
  const getTargetSets = useCallback((lift: any) => (lift ? suggestions[uidOf(lift)]?.sets || defaultSetCount : defaultSetCount), [suggestions, defaultSetCount]);
  const getRemainingSets = useCallback((lift: any, source = logs) => (lift ? Math.max(0, getTargetSets(lift) - getLogs(lift, source).length) : 0), [getLogs, getTargetSets, logs]);
  const getSupersetPartner = useCallback((lift: any) => (lift?.supersetId
    ? localPlan.lifts.find((entry: any) => uidOf(entry) !== uidOf(lift) && entry.supersetId === lift.supersetId) || null
    : null), [localPlan]);
  const findNextUnfinished = useCallback((start: number, source = logs) => {
    for (let offset = 1; offset <= localPlan.lifts.length; offset++) {
      const idx = (start + offset) % localPlan.lifts.length;
      if (getRemainingSets(localPlan.lifts[idx], source) > 0) return idx;
    }
    return null;
  }, [getRemainingSets, localPlan, logs]);

  const suggestion = suggestions[activeUid];
  const possibleWeights = useMemo(() => getPossibleWeights(activeLift?.station), [activeLift?.station]);
  const suggestedWeight = suggestion?.weight ?? possibleWeights[0] ?? 0;
  const suggestedReps = suggestion?.reps ?? getBaselineReps(localPlan.type);
  const draft = drafts[activeUid];
  const currentWeight = draft?.weight ?? suggestedWeight;
  const currentReps = draft?.reps ?? suggestedReps;
  const activeLogs = getLogs(activeLift);
  const partner = getSupersetPartner(activeLift);
  const activeRemaining = getRemainingSets(activeLift);
  const partnerRemaining = getRemainingSets(partner);
  const liftDone = activeLogs.length > 0 && activeRemaining === 0 && !(partner && partnerRemaining > 0);
  const nextLiftIndex = liftDone ? findNextUnfinished(safeLiftIndex) : null;
  const { volume: totalVolume, sets: totalSets } = workoutTotals(logs);
  const rest = useRestTimer(lastSetAt, suggestedReps, totalSets > 0 && !finished);

  // PRs follow the exercise across gyms, except on stacks/cables whose numbers differ per machine.
  const bestByLift = useMemo(() => bestE1RMByLift(pastHistory), [pastHistory]);
  const bestByExercise = useMemo(() => bestE1RMByExercise(pastHistory), [pastHistory]);
  const bestBefore = (lift: any) => (isLoadStation(lift?.station?.type) ? bestByLift[lift.id] : bestByExercise[exerciseKey(lift)]) || 0;
  const stalledExercises = useMemo(() => new Set(detectStalledLifts(pastHistory).map((lift) => exerciseKeyFromName(lift.name))), [pastHistory]);
  const lastSession = useMemo(() => (activeLift?.id ? lastSessionForLift(pastHistory, activeLift) : null), [pastHistory, activeLift]);
  const activeGoal = activeLift ? goalsFor(goals, exerciseName(activeLift)).find((g) => !goalsHit.includes(goalLabel(g))) : undefined;
  const activeGoalProgress = useMemo(() => (activeGoal ? goalProgress(activeGoal, pastHistory) : null), [activeGoal, pastHistory]);

  const warmups = activeLogs.length === 0 && activeLift?.station?.type !== 'bodyweight' && suggestion
    ? warmupSets(suggestedWeight, possibleWeights)
    : [];

  // ─── Persistence (resume after closing the page) ────────────────────────────
  const shared = useSharedSession({
    userId: user?.id,
    initialSessionId: sharedSessionIdProp || resumeState?.sharedSessionId || null,
    initialCode: resumeState?.sharedCode || null,
    planTemplate: () => ({
      name: localPlan.name,
      type: localPlan.type,
      gymId: localPlan.gymId,
      gymName: localPlan.gymName,
      lifts: localPlan.lifts.map((lift: any) => ({ id: lift.id, name: lift.name, exercise: lift.exercise, primaryMuscle: lift.primaryMuscle, secondaryMuscle: lift.secondaryMuscle, progressionProfile: lift.progressionProfile, station: lift.station })),
    }),
    onPeerSet: (peer) => {
      const set = peer.progress.lastSet;
      if (set) setToast({ tone: 'quiet', text: `👥 ${peer.username} finished ${set.liftName ? `${set.liftName} ` : 'a set '}${set.weight}×${set.reps} — your turn` });
    },
  });

  useEffect(() => {
    if (finished) return;
    try {
      localStorage.setItem('pendingWorkout', JSON.stringify({
        plan: localPlan,
        ownerId: user?.id || DEMO_USER_ID,
        sharedSessionId: shared.sessionId,
        sharedCode: shared.code,
        activeLiftIndex: safeLiftIndex,
        logs,
        warmupsDone,
        drafts,
        startTime: workoutStartTime,
        elapsedSecs,
        liftElapsedSecsMap,
        intensitySlider: intensity,
        lastSetAt,
        sessionPRs,
        goalsHit,
        timestamp: Date.now(),
      }));
    } catch {
      // Storage full or unavailable — the workout continues, it just can't be resumed.
    }
  }, [logs, warmupsDone, drafts, safeLiftIndex, localPlan, workoutStartTime, finished, elapsedSecs, liftElapsedSecsMap, intensity, shared.sessionId, shared.code, user?.id, lastSetAt, sessionPRs, goalsHit]);

  // ─── Partner mode sync ──────────────────────────────────────────────────────
  const progressUpdate = (status?: ProgressUpdate['status']): ProgressUpdate => {
    const all = Object.entries(logs).flatMap(([uid, sets]) => sets.map((set) => ({ ...set, uid })));
    const last = all.reduce<(LoggedSet & { uid: string }) | null>((latest, set) => (!latest || (set.timestamp || 0) > (latest.timestamp || 0) ? set : latest), null);
    const lastLift = last ? localPlan.lifts.find((lift: any) => uidOf(lift) === last.uid) : null;
    return {
      activeLiftIndex: safeLiftIndex,
      currentLiftName: activeLift?.name || '',
      completedSets: totalSets,
      totalSets: localPlan.lifts.reduce((sum: number, lift: any) => sum + getTargetSets(lift), 0),
      status: status || (finished ? 'finished' : 'active'),
      currentWeight,
      currentReps,
      lastSet: last ? { weight: last.weight, reps: last.reps, at: last.timestamp || Date.now(), liftName: lastLift?.name } : null,
      restingSince: lastSetAt,
    };
  };
  useEffect(() => {
    // Sync on real progress; weight/rep tweaks are debounced so +/- taps don't send a request each.
    if (!shared.sessionId) return;
    const handle = setTimeout(() => shared.push(progressUpdate()), 700);
    return () => clearTimeout(handle);
  }, [safeLiftIndex, logs, currentWeight, currentReps, shared.sessionId]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(handle);
  }, [toast]);

  // ─── Actions ────────────────────────────────────────────────────────────────
  const setCurrentWeight = (weight: number) => setDrafts((prev) => ({ ...prev, [activeUid]: { weight, reps: prev[activeUid]?.reps ?? suggestedReps } }));
  const setCurrentReps = (reps: number) => setDrafts((prev) => ({ ...prev, [activeUid]: { weight: prev[activeUid]?.weight ?? suggestedWeight, reps } }));
  const resetToSuggestion = () => setDrafts((prev) => {
    const next = { ...prev };
    delete next[activeUid];
    return next;
  });

  /** Log a set at the current weight × reps. One tap: the effort button is the log button. */
  const logSet = (rir: number) => {
    if (!activeLift) return;
    const newLog: LoggedSet = { weight: currentWeight, reps: currentReps, plannedWeight: suggestedWeight, plannedReps: suggestedReps, rir, completed: true, timestamp: Date.now() };
    const before = { logs, lastSetAt, sessionPRs, goalsHit, index: safeLiftIndex };
    const undo = () => {
      setLogs(before.logs);
      setLastSetAt(before.lastSetAt);
      setSessionPRs(before.sessionPRs);
      setGoalsHit(before.goalsHit);
      setActiveLiftIndex(before.index);
      setToast(null);
    };

    const updatedLogs = { ...logs, [activeUid]: [...activeLogs, newLog] };
    setLogs(updatedLogs);
    setLastSetAt(newLog.timestamp!);
    rest.unlock();
    vibrate(30);

    // Goal reached, personal record, or just "logged".
    const reachedGoal = activeGoal && setMeetsGoal(newLog, activeGoal) ? goalLabel(activeGoal) : null;
    const e1rm = calcAverage1RM(currentWeight, currentReps);
    const previousBest = Math.max(bestBefore(activeLift), sessionPRs[activeLift.id]?.e1rm || 0);
    const isPR = previousBest > 0 && e1rm > previousBest + 0.5;
    if (isPR) {
      const baseline = sessionPRs[activeLift.id]?.previous ?? bestBefore(activeLift);
      setSessionPRs((prev) => ({ ...prev, [activeLift.id]: { name: activeLift.name, e1rm, previous: baseline, weight: currentWeight, reps: currentReps } }));
    }
    if (reachedGoal) setGoalsHit((prev) => [...prev, reachedGoal]);
    if (reachedGoal || isPR) vibrate([80, 60, 80, 60, 160]);
    setToast(reachedGoal
      ? { tone: 'win', undo, text: `🎯 Goal reached: ${reachedGoal}!` }
      : isPR
        ? { tone: 'win', undo, text: `🏆 New PR on ${activeLift.name}: ${currentWeight} × ${currentReps} (est. 1RM ${Math.round(e1rm)} lbs, +${Math.round(e1rm - previousBest)})` }
        : { tone: 'quiet', undo, text: `Set ${activeLogs.length + 1} logged: ${currentWeight} × ${currentReps}` });

    // Supersets alternate after every set until one side is done.
    if (!partner) return;
    const partnerIndex = localPlan.lifts.findIndex((lift: any) => uidOf(lift) === uidOf(partner));
    if (getRemainingSets(partner, updatedLogs) > 0 && partnerIndex >= 0) return setActiveLiftIndex(partnerIndex);
    if (getRemainingSets(activeLift, updatedLogs) > 0) return;
    const next = findNextUnfinished(safeLiftIndex, updatedLogs);
    if (next !== null) setActiveLiftIndex(next);
  };

  const toggleWarmup = (set: WarmupSet) => setWarmupsDone((prev) => {
    const list = prev[activeUid] || [];
    const has = list.some((w) => w.weight === set.weight && w.reps === set.reps);
    return { ...prev, [activeUid]: has ? list.filter((w) => !(w.weight === set.weight && w.reps === set.reps)) : [...list, set] };
  });

  const updateSet = (index: number, set: LoggedSet) => {
    setLogs((prev) => ({ ...prev, [activeUid]: (prev[activeUid] || []).map((s, i) => (i === index ? set : s)) }));
    setEditingSetIndex(null);
  };
  const deleteSet = (index: number) => {
    setLogs((prev) => ({ ...prev, [activeUid]: (prev[activeUid] || []).filter((_, i) => i !== index) }));
    setEditingSetIndex(null);
  };

  /**
   * Equipment or lift details were edited (here or in the equipment panel):
   * refresh every planned lift on a changed station, keeping its plan state.
   */
  const applyGymUpdate = (updatedGym: Gym) => {
    const stationIds = new Set(updatedGym.stations.map((s) => s.id));
    invalidate(localPlan.lifts.filter((lift: any) => stationIds.has(lift.station?.id)).map(uidOf));
    setLocalPlan((prev: any) => ({
      ...prev,
      lifts: prev.lifts.map((lift: any) => {
        const station = updatedGym.stations.find((s) => s.id === lift.station?.id);
        if (!station) return lift;
        const saved = station.lifts.find((l) => l.id === lift.id);
        return { ...lift, ...(saved || {}), station, uniquePlanId: lift.uniquePlanId, supersetId: lift.supersetId };
      }),
    }));
  };

  const addLifts = (entries: { lift: any; station: any }[]) => {
    const added = entries.map(({ lift, station }) => ({ ...lift, station, gymId: localPlan.gymId, gymName: localPlan.gymName, uniquePlanId: newPlanId() }));
    setLocalPlan((prev: any) => ({ ...prev, lifts: [...prev.lifts, ...added] }));
    setActiveLiftIndex(localPlan.lifts.length);
    setSheet(null);
  };

  const swapLift = (newLift: any) => {
    const entry = { ...newLift, uniquePlanId: newPlanId(), supersetId: null as string | null };
    const lifts = [...localPlan.lifts];
    if (activeLogs.length > 0) {
      // Sets were already logged for this lift — keep it and add the new one after it.
      lifts.splice(safeLiftIndex + 1, 0, entry);
      setActiveLiftIndex(safeLiftIndex + 1);
    } else {
      entry.supersetId = activeLift?.supersetId || null;
      lifts[safeLiftIndex] = entry;
    }
    setLocalPlan({ ...localPlan, lifts });
    setSheet(null);
  };

  const removeLiftAt = async (index: number) => {
    if (localPlan.lifts.length <= 1) return;
    const lift = localPlan.lifts[index];
    const uid = uidOf(lift);
    const loggedCount = logs[uid]?.length || 0;
    if (loggedCount > 0) {
      const ok = await confirm({ title: 'Remove lift', message: `Remove ${lift.name}? Its ${loggedCount} logged set${loggedCount === 1 ? '' : 's'} will be discarded.`, confirmLabel: 'Remove', danger: true });
      if (!ok) return;
    }
    const remaining = localPlan.lifts
      .filter((_: any, i: number) => i !== index)
      // A superset needs both halves; unpair the partner of a removed lift.
      .map((entry: any) => (lift.supersetId && entry.supersetId === lift.supersetId ? { ...entry, supersetId: null } : entry));
    setLocalPlan({ ...localPlan, lifts: remaining });
    setLogs((prev) => {
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    // Keep pointing at the same lift when an earlier one is removed.
    setActiveLiftIndex((prev) => (index < prev ? prev - 1 : Math.min(prev, remaining.length - 1)));
  };

  const pairSuperset = (other: any) => {
    const supersetId = `ss-${Math.random().toString(36).slice(2, 10)}`;
    setLocalPlan({ ...localPlan, lifts: localPlan.lifts.map((lift: any) => (uidOf(lift) === activeUid || uidOf(lift) === uidOf(other) ? { ...lift, supersetId } : lift)) });
    setSheet(null);
  };
  const unpairSuperset = () => {
    if (!activeLift?.supersetId) return;
    setLocalPlan({ ...localPlan, lifts: localPlan.lifts.map((lift: any) => (lift.supersetId === activeLift.supersetId ? { ...lift, supersetId: null } : lift)) });
    setSheet(null);
  };

  const calories = estimateCalories(elapsedSecs, user?.weight);

  const [notes, setNotes] = useState('');
  const saveWorkout = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    const payload = { ...buildSavePayload({ plan: localPlan, logs, warmups: warmupsDone, targetSets: getTargetSets, elapsedSecs, intensity, bodyweightLbs: user?.weight, isDemo: !user }), notes: notes.trim() || undefined };
    if (Object.keys(payload.logs).length === 0) {
      setSaveError('No sets were logged, so there is nothing to save.');
      setSaving(false);
      return;
    }

    let status: number | null = null;
    let message = '';
    try {
      const response = await fetch('/api/workout/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      status = response.status;
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) message = data.message || `Save failed (${response.status}).`;
    } catch {
      message = 'Network error';
    }

    if (message) {
      if (user?.id && isRetryableSaveFailure(status)) {
        // Can't reach the server right now: keep the workout in the offline
        // queue and let the home page sync it later.
        enqueueWorkout(user.id, payload, message);
        localStorage.removeItem('pendingWorkout');
        window.location.href = '/workout?queued=1';
        return;
      }
      setSaveError(`${message} Your workout is still stored on this device — try again.`);
      setSaving(false);
      return;
    }

    // Mark goals reached today (best effort — the goal also shows as reached from history).
    if (user) {
      await Promise.all(goals.filter((g) => goalsHit.includes(goalLabel(g)) && !g.achievedAt).map((g) =>
        fetch('/api/workout/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...g, achievedAt: new Date().toISOString() }) }).catch(() => {})));
    }
    await shared.push(progressUpdate('finished'));
    localStorage.removeItem('pendingWorkout');
    window.location.href = '/workout';
  };

  // Save this session's lifts (in order) as a pinned-lift template.
  const saveAsTemplate = async () => {
    if (!user || templateState === 'saving' || templateState === 'saved') return;
    setTemplateState('saving');
    const type = localPlan.type || {};
    const loggedLifts = localPlan.lifts.filter((lift: any) => (logs[uidOf(lift)] || []).length > 0);
    const fixedLifts = Array.from(new Map(loggedLifts.map((lift: any) => [lift.id, { liftId: lift.id, name: lift.name }])).values());
    const muscles = Array.from(new Set(loggedLifts.map((lift: any) => lift.primaryMuscle).filter(Boolean)));
    try {
      const response = await fetch('/api/workout/types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${type.name || 'Workout'} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`,
          muscles: type.muscles?.length ? type.muscles : muscles,
          intensity: type.intensity, sets: type.sets, minReps: type.minReps, maxReps: type.maxReps,
          fixedLifts,
        }),
      });
      const data = await response.json().catch(() => ({}));
      setTemplateState(response.ok && data.success ? 'saved' : 'error');
    } catch {
      setTemplateState('error');
    }
  };

  const pauseWorkout = async () => {
    await shared.push(progressUpdate('paused'));
    window.location.href = '/workout';
  };

  const deleteWorkout = async () => {
    const ok = await confirm({ title: 'Delete workout', message: 'Delete this workout? Logged sets will not be saved.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await shared.push(progressUpdate('deleted'));
    localStorage.removeItem('pendingWorkout');
    window.location.href = '/workout';
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (!activeLift) return <div style={{ padding: '2rem', textAlign: 'center' }}>This workout has no lifts left.</div>;

  if (finished) {
    return (
      <FinishScreen
        plan={localPlan}
        logs={logs}
        pastHistory={pastHistory}
        elapsedSecs={elapsedSecs}
        calories={calories}
        prs={sessionPRs}
        goalsHit={goalsHit}
        canSaveTemplate={!!user}
        templateState={templateState}
        onSaveTemplate={saveAsTemplate}
        saving={saving}
        saveError={saveError}
        onSave={saveWorkout}
        notes={notes}
        onNotesChange={setNotes}
        onBack={() => { setFinished(false); setSaveError(''); }}
        getLinkPayload={user ? () => buildSavePayload({ plan: localPlan, logs, warmups: warmupsDone, targetSets: getTargetSets, elapsedSecs, intensity, bodyweightLbs: user?.weight, isDemo: false }) : undefined}
      />
    );
  }

  const calibration = suggestion?.calibration;
  const calibrationNote = !calibration ? ''
    : calibration.status === 'calibrating' ? `🧪 Calibrating: last time at ${calibration.referenceGymName || 'another gym'} you did ${calibration.referenceWeight} lbs × ${calibration.referenceReps}. This gym is calibrated after today.`
    : calibration.status === 'calibrated' ? `✅ Calibrated for this gym (×${calibration.scaleFactor?.toFixed(2)}${typeof calibration.confidence === 'number' ? `, ${Math.round(calibration.confidence * 100)}% confident` : ''}).`
    : calibration.status === 'none' && isLoadStation(activeLift.station?.type) ? `⚠️ No calibration for this machine at ${localPlan.gymName || 'this gym'} yet — today's sets will set it.`
    : '';

  const lastTime = lastSession ? {
    sets: lastSession.sets as LoggedSet[],
    date: lastSession.workout.timestamp ? new Date(lastSession.workout.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : undefined,
    where: lastSession.sameLift ? undefined : lastSession.workout.gymId === localPlan.gymId ? 'other equipment' : lastSession.workout.gymName || 'another gym',
  } : null;

  const plates = activeLift.station?.type === 'plates' && Array.isArray(activeLift.station?.plateSets)
    ? { bar: activeLift.station.baseWeight ?? 45, plates: calculatePlates(currentWeight, activeLift.station.baseWeight ?? 45, activeLift.station.plateSets) }
    : null;

  // Swap candidates: this gym's lifts for the workout's muscles.
  const targetMuscles: string[] = localPlan.type?.muscles?.length ? localPlan.type.muscles : [activeLift.primaryMuscle];
  const liftIdsInPlan = new Set(localPlan.lifts.map((lift: any) => lift.id));
  const alternatives = (allLifts || []).filter((l: any) =>
    !liftIdsInPlan.has(l.id)
    && (!localPlan.gymName || !l.gymName || l.gymName === localPlan.gymName)
    && (targetMuscles.includes(l.primaryMuscle) || targetMuscles.includes(l.secondaryMuscle)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <TopBar
        name={localPlan.name}
        elapsedSecs={elapsedSecs}
        compact={compact}
        peer={shared.peer}
        live={shared.live}
        onList={() => setSheet('list')}
        onAdd={() => setSheet('add')}
        onMenu={() => setSheet('menu')}
      />
      {offline && <p className="workout-offline-note">📡 Offline — using saved data. Sets are kept on this phone and saved when you&apos;re back online.</p>}

      <div style={{ flex: 1, padding: compact ? '0.65rem' : '1rem', paddingBottom: compact ? '1.25rem' : '2rem' }}>
        <LiftCard
          lift={activeLift}
          index={safeLiftIndex}
          count={localPlan.lifts.length}
          compact={compact}
          canEdit={!!user && !!activeLift.station?.id}
          onEdit={setEditTarget}
          plateau={stalledExercises.has(exerciseKey(activeLift)) && !localPlan.isDeload}
          onSwap={() => setSheet('swap')}
          onHistory={() => setSheet('history')}
          onSuperset={() => setSheet('superset')}
          partner={partner && partnerRemaining > 0 ? {
            name: partner.name,
            logged: getLogs(partner).length,
            target: getTargetSets(partner),
            upNext: activeRemaining > 0,
            onSwitch: () => setActiveLiftIndex(localPlan.lifts.findIndex((lift: any) => uidOf(lift) === uidOf(partner))),
          } : null}
          target={{ loading: !suggestion, weight: suggestedWeight, reps: suggestedReps, sets: getTargetSets(activeLift) }}
          deviated={!!draft && (currentWeight !== suggestedWeight || currentReps !== suggestedReps)}
          onReset={resetToSuggestion}
          suggestion={suggestion}
          calibrationNote={calibrationNote}
          liftSecs={liftElapsedSecsMap[activeUid] || 0}
          workoutSecs={elapsedSecs}
          intensity={intensity}
          onIntensity={setIntensity}
          rest={rest}
          extra={activeGoal && activeGoalProgress && (
            <p className="workout-hint" style={{ margin: '-0.1rem 0 0.45rem' }}>
              🎯 Goal {activeGoal.targetWeight}×{activeGoal.targetReps} · {Math.round(activeGoalProgress.fraction * 100)}% · {formatProjection(activeGoalProgress)}
            </p>
          )}
        />

        <SetLogger
          compact={compact}
          sets={activeLogs}
          onEditSet={setEditingSetIndex}
          warmups={warmups}
          warmupsDone={warmupsDone[activeUid] || []}
          onToggleWarmup={toggleWarmup}
          lastTime={lastTime}
          liftDone={liftDone}
          nextLiftName={nextLiftIndex !== null ? localPlan.lifts[nextLiftIndex].name : null}
          onNextUnfinished={() => nextLiftIndex !== null && setActiveLiftIndex(nextLiftIndex)}
          onFinish={() => setFinished(true)}
          weight={currentWeight}
          reps={currentReps}
          onWeight={setCurrentWeight}
          onReps={setCurrentReps}
          onStepWeight={(direction) => setCurrentWeight(stepWeight(currentWeight, direction, possibleWeights))}
          onLog={logSet}
          canPrev={safeLiftIndex > 0}
          onPrev={() => setActiveLiftIndex(safeLiftIndex - 1)}
          hasNext={safeLiftIndex < localPlan.lifts.length - 1}
          onNext={() => setActiveLiftIndex(safeLiftIndex + 1)}
          plates={plates}
        />
      </div>

      {sheet === 'menu' && (
        <WorkoutMenu
          onClose={() => setSheet(null)}
          onPause={pauseWorkout}
          onFinish={() => { setFinished(true); setSheet(null); }}
          onDelete={deleteWorkout}
          partner={{
            active: !!shared.sessionId,
            code: shared.code,
            inviteLink: shared.inviteLink,
            loading: shared.loading,
            error: shared.error,
            onStart: () => shared.start(progressUpdate('active')),
            onLeave: () => shared.leave(progressUpdate()),
          }}
        />
      )}
      {(sheet === 'list' || sheet === 'add') && (
        <WorkoutListSheet
          plan={localPlan}
          activeIndex={safeLiftIndex}
          logs={logs}
          targetSets={getTargetSets}
          partnerOf={getSupersetPartner}
          startAdding={sheet === 'add'}
          onSelect={(index) => { setActiveLiftIndex(index); setSheet(null); }}
          onRemove={removeLiftAt}
          onAdd={addLifts}
          onGymUpdated={applyGymUpdate}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'swap' && <SwapLiftSheet alternatives={alternatives} onSwap={swapLift} onClose={() => setSheet(null)} />}
      {sheet === 'superset' && (
        <SupersetSheet
          lift={activeLift}
          partner={partner}
          logged={(lift) => getLogs(lift).length}
          targetSets={getTargetSets}
          eligible={localPlan.lifts.filter((lift: any) => uidOf(lift) !== activeUid && !lift.supersetId && getRemainingSets(lift) > 0)}
          canUnpair={!(activeRemaining === 0 && partnerRemaining === 0)}
          onPair={pairSuperset}
          onUnpair={unpairSuperset}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'history' && (
        <LiftHistorySheet liftId={activeLift.id} liftName={exerciseName(activeLift)} history={pastHistory || []} onClose={() => setSheet(null)} />
      )}
      {editingSetIndex !== null && activeLogs[editingSetIndex] && (
        <SetEditSheet
          key={editingSetIndex}
          set={activeLogs[editingSetIndex]}
          setNumber={editingSetIndex + 1}
          liftName={activeLift.name}
          possibleWeights={possibleWeights}
          onSave={(set) => updateSet(editingSetIndex, set as LoggedSet)}
          onDelete={() => deleteSet(editingSetIndex)}
          onClose={() => setEditingSetIndex(null)}
        />
      )}
      {editTarget && activeLift.station?.id && (
        <ActiveLiftEditor mode={editTarget} stationId={activeLift.station.id} liftId={activeLift.id} onSaved={applyGymUpdate} onClose={() => setEditTarget(null)} />
      )}
      {toast && (
        <div className={`tracker-toast animate-fade-in${toast.tone === 'quiet' ? ' is-quiet' : ''}`} role="status">
          <span style={{ flex: 1, minWidth: 0 }} onClick={() => setToast(null)}>{toast.text}</span>
          {toast.undo && <button type="button" className="tracker-toast-action" onClick={toast.undo}>Undo</button>}
        </div>
      )}
      {popup}
    </div>
  );
}
