'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { bestE1RMByLift, detectStalledLifts, findPreviousSameType, restTargetSeconds, warmupSets, workoutVolume } from '@/lib/workout/session-insights';
import { calculatePlates, getPossibleWeights, snapToPossibleWeight, stepWeight } from '@/lib/workout/equipment';
import InlineGymEditor from './InlineGymEditor';
import { useSitePopup } from '@/components/SitePopup';
import IntensitySlider from '@/components/workout/IntensitySlider';
import LiftHistorySheet from '@/components/workout/LiftHistorySheet';
import PlateDiagram from '@/components/workout/PlateDiagram';
import { DEMO_USER_ID } from '@/lib/workout/demo-data';
import { enqueueWorkout, isRetryableSaveFailure } from '@/lib/workout/offline-queue';
import { takeQueuedLifts } from '@/lib/workout/station-link';

// Performance score color
function getScoreColor(score: number): string {
    if (score > 1.05) return 'var(--success)'; // green — too easy / strong
    if (score >= 0.95) return '#ecc94b'; // yellow — appropriate
    return 'var(--danger)'; // red — struggled
}

function formatClock(totalSecs: number) {
    return `${Math.floor(totalSecs / 60)}:${String(totalSecs % 60).padStart(2, '0')}`;
}

function newPlanId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

const uidOf = (lift: any) => String(lift?.uniquePlanId ?? '');

type HistoricStats = { prevWeight: number; prevReps: number; prevSets: number; est1RM: number };

type Suggestion = {
    liftId: string;
    intensity: number;
    weight: number;
    reps: number;
    sets: number;
    reason: string;
    breakdown: any;
    metrics: any;
    candidates: number;
    calibration: any;
    historicStats: HistoricStats | null;
};

/** Most recent previous workout containing this lift, preferring non-deload sessions
 *  so a light deload week doesn't become the baseline for progression. */
function findLastSessionForLift(pastHistory: any[] | undefined, lift: any) {
    const withLift = (pastHistory || [])
        .filter((workout: any) => Array.isArray(workout?.logs?.[lift.id]) && workout.logs[lift.id].length > 0)
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return withLift.find((workout: any) => !workout.isDeload) || withLift[0] || null;
}

function getBaselineReps(type: any) {
    const min = Number(type?.minReps);
    const max = Number(type?.maxReps);
    return Number.isFinite(min) && Number.isFinite(max) && max >= min ? Math.floor((min + max) / 2) : 10;
}

export default function Tracker({ plan, allLifts, user, pastHistory, resumeState, sharedSessionId: sharedSessionIdProp }: any) {
   const { confirm, popup } = useSitePopup();
   const [localPlan, setLocalPlan] = useState<any>(resumeState?.plan || plan);

   // Lifts picked on a station page (QR sticker) join the workout in progress.
   useEffect(() => {
     const queued = takeQueuedLifts();
     if (queued.length === 0) return;
     setLocalPlan((prev: any) => prev ? {
       ...prev,
       lifts: [...prev.lifts, ...queued.map((q) => ({ ...q.lift, station: q.station, gymId: q.gymId, gymName: q.gymName, uniquePlanId: newPlanId() }))],
     } : prev);
   }, []);
   const [activeLiftIndex, setActiveLiftIndex] = useState<number>(resumeState?.activeLiftIndex || 0);
   const [workoutStartTime] = useState(resumeState?.startTime || Date.now());
   const [elapsedSecs, setElapsedSecs] = useState<number>(resumeState?.elapsedSecs || 0);
   // Per-lift timers are keyed by the lift's plan id (not its index) so they
   // stay attached to the right lift when lifts are removed or reordered.
   const [liftElapsedSecsMap, setLiftElapsedSecsMap] = useState<Record<string, number>>(resumeState?.liftElapsedSecsMap || {});

   const [logs, setLogs] = useState<Record<string, any[]>>(resumeState?.logs || {});
   // Manual weight/rep overrides per lift, so bouncing between superset
   // partners doesn't reset what the user dialed in.
   const [drafts, setDrafts] = useState<Record<string, { weight: number; reps: number }>>(resumeState?.drafts || {});
   const [currentRir, setCurrentRir] = useState<number | null>(resumeState?.currentRir ?? null);

   // Engine suggestions for every lift in the plan, keyed by plan id.
   const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
   const suggestionsRef = useRef(suggestions);
   suggestionsRef.current = suggestions;
   const hasLoadedSuggestions = useRef(false);

   const [intensitySlider, setIntensitySlider] = useState<number>(resumeState?.intensitySlider ?? user?.intensityFactor ?? 1.0);
   const intensityRef = useRef(intensitySlider);
   intensityRef.current = intensitySlider;
   const [showBreakdown, setShowBreakdown] = useState(false);
   const [isCompactHeader, setIsCompactHeader] = useState(false);
   const [showHeaderDetails, setShowHeaderDetails] = useState(true);

   const [showList, setShowList] = useState(false);
   const [showAddLift, setShowAddLift] = useState(false);
   const [showChange, setShowChange] = useState(false);
   const [showSuperset, setShowSuperset] = useState(false);
   const [showLiftHistory, setShowLiftHistory] = useState(false);
   const [showMenu, setShowMenu] = useState(false);
   const [workoutFinished, setWorkoutFinished] = useState(false);
   const [saving, setSaving] = useState(false);
   const [saveError, setSaveError] = useState('');
   // Rest timer: counts from the last completed set (any lift, so supersets work).
   const [lastSetAt, setLastSetAt] = useState<number | null>(resumeState?.lastSetAt ?? null);
   const restNotifiedFor = useRef<number | null>(null);
   // Personal records hit this session, keyed by lift id.
   const [sessionPRs, setSessionPRs] = useState<Record<string, { name: string; e1rm: number; previous: number; weight: number; reps: number }>>(resumeState?.sessionPRs || {});
   const [prToast, setPrToast] = useState<string | null>(null);
   const [templateState, setTemplateState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
   const bestBeforeSession = useMemo(() => bestE1RMByLift(pastHistory), [pastHistory]);
   const stalledLiftIds = useMemo(() => new Set(detectStalledLifts(pastHistory).map((lift) => lift.liftId)), [pastHistory]);
  const [sharedSessionId, setSharedSessionId] = useState<string | null>(sharedSessionIdProp || resumeState?.sharedSessionId || null);
  const [sharedCode, setSharedCode] = useState<string | null>(resumeState?.sharedCode || null);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState('');
  const [peerProgress, setPeerProgress] = useState<any>(null);

   // Guard against an out-of-range index (e.g. a resumed plan that lost lifts).
   const safeLiftIndex = Math.min(Math.max(0, activeLiftIndex), Math.max(0, localPlan.lifts.length - 1));
   const activeLift = localPlan.lifts[safeLiftIndex];
   const activeUid = uidOf(activeLift);
   const defaultSetCount = Number(localPlan.type?.sets) > 0 ? Number(localPlan.type.sets) : 5;

   useEffect(() => {
     if (activeLiftIndex !== safeLiftIndex) setActiveLiftIndex(safeLiftIndex);
   }, [activeLiftIndex, safeLiftIndex]);

   useEffect(() => {
     if (workoutFinished || !activeUid) return;
     let previousTick = Date.now();
     const timer = setInterval(() => {
        const now = Date.now();
        const delta = Math.floor((now - previousTick) / 1000);
        if (delta > 0) {
           previousTick += delta * 1000;
           setElapsedSecs((e: number) => e + delta);
           setLiftElapsedSecsMap((m) => ({ ...m, [activeUid]: (m[activeUid] || 0) + delta }));
        }
     }, 1000);
     return () => clearInterval(timer);
   }, [workoutFinished, activeUid]);

   useEffect(() => {
      const mediaQuery = window.matchMedia('(max-width: 430px)');
      const syncHeaderMode = (matches: boolean) => {
         setIsCompactHeader(matches);
         setShowHeaderDetails(!matches);
      };

      syncHeaderMode(mediaQuery.matches);
      const listener = (event: MediaQueryListEvent) => syncHeaderMode(event.matches);
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
   }, []);

  useEffect(() => {
    if (sharedSessionIdProp) setSharedSessionId(sharedSessionIdProp);
  }, [sharedSessionIdProp]);

   const getLiftLogs = useCallback((lift: any, logsSource = logs) => {
      if (!lift) return [];
      return logsSource[uidOf(lift)] || [];
   }, [logs]);

   /** Sets planned for a lift: the engine's suggestion, else the workout type's default. */
   const getTargetSets = useCallback((lift: any) => {
      if (!lift) return defaultSetCount;
      return suggestions[uidOf(lift)]?.sets || defaultSetCount;
   }, [suggestions, defaultSetCount]);

   const getRemainingSets = useCallback((lift: any, logsSource = logs) => {
      if (!lift) return 0;
      return Math.max(0, getTargetSets(lift) - getLiftLogs(lift, logsSource).length);
   }, [getLiftLogs, getTargetSets, logs]);

   const getSupersetPartner = useCallback((lift: any, planSource = localPlan) => {
      if (!lift?.supersetId) return null;
      return planSource.lifts.find((entry: any) => uidOf(entry) !== uidOf(lift) && entry.supersetId === lift.supersetId) || null;
   }, [localPlan]);

   const findNextUnfinishedLiftIndex = useCallback((startIndex: number, logsSource = logs, planSource = localPlan) => {
      for (let offset = 1; offset <= planSource.lifts.length; offset++) {
         const idx = (startIndex + offset) % planSource.lifts.length;
         if (getRemainingSets(planSource.lifts[idx], logsSource) > 0) return idx;
      }
      return null;
   }, [getRemainingSets, localPlan, logs]);

   // ─── Progression suggestions ────────────────────────────────────────────────

   const requestSuggestion = useCallback(async (lift: any, intensity: number): Promise<Suggestion> => {
      const lastWorkout = findLastSessionForLift(pastHistory, lift);
      const sessionSets: any[] = lastWorkout ? lastWorkout.logs[lift.id] : [];
      const possibleWeights = getPossibleWeights(lift.station);
      const baseline: Suggestion = {
         liftId: lift.id,
         intensity,
         weight: possibleWeights[0] ?? 0,
         reps: getBaselineReps(localPlan.type),
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
               liftName: lift.name,
               gymId: localPlan.gymId,
               station: lift.station,
               logs: sessionSets,
               plannedSets: lastWorkout?.liftMeta?.[lift.id]?.plannedSets,
               planType: localPlan.type,
               intensity,
               progressionProfile: lift.progressionProfile || 'standard',
               deload: localPlan.isDeload === true,
            }),
         });
         data = await response.json();
      } catch {
         data = null;
      }

      const calibration = data?.calibration || null;
      if (sessionSets.length === 0) {
         return { ...baseline, calibration };
      }

      // Stats from the previous session's top set.
      const topSet = sessionSets.reduce((best: any, set: any) =>
         !best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps) ? set : best, null);
      const historicStats: HistoricStats = {
         prevWeight: topSet.weight,
         prevReps: topSet.reps,
         prevSets: sessionSets.length,
         est1RM: Math.round(calcAverage1RM(topSet.weight, topSet.reps)),
      };

      if (!data?.success || !data.plan) {
         // Offline / server error: repeat last session rather than resetting to baseline.
         return {
            ...baseline,
            weight: snapToPossibleWeight(topSet.weight, possibleWeights),
            reps: topSet.reps,
            sets: sessionSets.length,
            reason: 'Could not reach the progression engine — repeating last session.',
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
   }, [pastHistory, localPlan.gymId, localPlan.type, localPlan.isDeload, defaultSetCount]);

   // Fetch suggestions for every lift in the plan (so set targets in the list are
   // accurate), re-fetching when intensity changes. Results are stored per lift,
   // so a slow response can never overwrite a different lift's numbers.
   useEffect(() => {
      const delay = hasLoadedSuggestions.current ? 350 : 0; // debounce slider drags
      const handle = setTimeout(() => {
         hasLoadedSuggestions.current = true;
         localPlan.lifts.forEach((lift: any) => {
            const uid = uidOf(lift);
            const existing = suggestionsRef.current[uid];
            if (existing && existing.intensity === intensitySlider && existing.liftId === lift.id) return;
            requestSuggestion(lift, intensitySlider).then((suggestion) => {
               // Drop responses for an intensity the user has since moved away from.
               if (suggestion.intensity !== intensityRef.current) return;
               setSuggestions((prev) => ({ ...prev, [uid]: suggestion }));
            });
         });
      }, delay);
      return () => clearTimeout(handle);
   }, [localPlan.lifts, intensitySlider, requestSuggestion]);

   useEffect(() => {
      setCurrentRir(null);
   }, [activeUid]);

   const activeSuggestion: Suggestion | undefined = suggestions[activeUid];
   const activePossibleWeights = useMemo(() => getPossibleWeights(activeLift?.station), [activeLift?.station]);
   const suggestedWeight = activeSuggestion?.weight ?? activePossibleWeights[0] ?? 0;
   const suggestedReps = activeSuggestion?.reps ?? getBaselineReps(localPlan.type);
   const suggestedSets = getTargetSets(activeLift);
   const suggestionReason = activeSuggestion?.reason || '';
   const scoringBreakdown = activeSuggestion?.breakdown || null;
   const performanceMetrics = activeSuggestion?.metrics || null;
   const candidatesEvaluated = activeSuggestion?.candidates || 0;
   const calibrationInfo = activeSuggestion?.calibration || null;
   const historicStats = activeSuggestion?.historicStats || null;
   const suggestionLoading = !activeSuggestion;

   const activeDraft = drafts[activeUid];
   const currentWeight = activeDraft?.weight ?? suggestedWeight;
   const currentReps = activeDraft?.reps ?? suggestedReps;

   const setCurrentWeight = (weight: number) =>
      setDrafts((prev) => ({ ...prev, [activeUid]: { weight, reps: prev[activeUid]?.reps ?? suggestedReps } }));
   const setCurrentReps = (reps: number) =>
      setDrafts((prev) => ({ ...prev, [activeUid]: { weight: prev[activeUid]?.weight ?? suggestedWeight, reps } }));
   const resetToSuggestion = () =>
      setDrafts((prev) => {
         const next = { ...prev };
         delete next[activeUid];
         return next;
      });

   const activeLogs = logs[activeUid] || [];
   const isDeviated = !!activeDraft && (currentWeight !== suggestedWeight || currentReps !== suggestedReps);
   const activePartner = getSupersetPartner(activeLift);
   const activePartnerIndex = activePartner
      ? localPlan.lifts.findIndex((lift: any) => uidOf(lift) === uidOf(activePartner))
      : -1;
   const activeRemainingSets = getRemainingSets(activeLift);
   const activePartnerRemainingSets = getRemainingSets(activePartner);
   const eligibleSupersetLifts = localPlan.lifts.filter((lift: any) =>
      uidOf(lift) !== activeUid &&
      !lift.supersetId &&
      getRemainingSets(lift) > 0
   );

  const buildProgressPayload = useCallback((statusOverride?: 'active' | 'paused' | 'finished' | 'deleted') => {
    const totalCompletedSets = Object.values(logs).reduce((sum: number, sets: any) => sum + (sets?.length || 0), 0);
    const totalSets = (localPlan?.lifts || []).reduce((sum: number, lift: any) => sum + getTargetSets(lift), 0);
    return {
      activeLiftIndex: safeLiftIndex,
      currentLiftName: activeLift?.name || '',
      completedSets: totalCompletedSets,
      totalSets,
      status: statusOverride || (workoutFinished ? 'finished' : 'active'),
      currentWeight,
      currentReps,
      lastSet: lastSetAt
        ? (() => {
            const all = Object.values(logs).flat() as any[];
            const last = all.reduce((latest, set) => (!latest || set.timestamp > latest.timestamp ? set : latest), null);
            return last ? { weight: last.weight, reps: last.reps, at: last.timestamp } : null;
          })()
        : null,
    };
  }, [activeLift?.name, safeLiftIndex, localPlan?.lifts, logs, getTargetSets, workoutFinished, currentWeight, currentReps, lastSetAt]);

  const pushSharedProgress = useCallback(async (statusOverride?: 'active' | 'paused' | 'finished' | 'deleted') => {
    if (!sharedSessionId) return;
    try {
      await fetch('/api/workout/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sharedSessionId,
          progress: buildProgressPayload(statusOverride),
        }),
      });
    } catch {
      // silent shared sync failure
    }
  }, [buildProgressPayload, sharedSessionId]);

  const refreshSharedPeer = useCallback(async () => {
    if (!sharedSessionId) return;
    try {
      const response = await fetch(`/api/workout/session?id=${encodeURIComponent(sharedSessionId)}`);
      const data = await response.json();
      if (!data.success) return;
      setPeerProgress(data.peer?.progress || null);
      if (data.session?.code) setSharedCode(data.session.code);
    } catch {
      // silent shared poll failure
    }
  }, [sharedSessionId]);

  const handleEnableSharedMode = async () => {
    if (!user?.id) {
      setSharedError('Shared mode requires login.');
      return;
    }
    if (sharedSessionId) {
      setSharedError('');
      return;
    }

    setSharedLoading(true);
    setSharedError('');
    try {
      const response = await fetch('/api/workout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          planTemplate: {
            name: localPlan.name,
            type: localPlan.type,
            gymId: localPlan.gymId,
            gymName: localPlan.gymName,
            lifts: localPlan.lifts.map((lift: any) => ({
              id: lift.id,
              name: lift.name,
              primaryMuscle: lift.primaryMuscle,
              secondaryMuscle: lift.secondaryMuscle,
              progressionProfile: lift.progressionProfile,
              station: lift.station,
            })),
          },
          progress: buildProgressPayload('active'),
        }),
      });
      const data = await response.json();
      if (!data.success || !data.sessionId) {
        setSharedError(data.message || 'Unable to enable shared mode.');
        return;
      }
      setSharedSessionId(data.sessionId);
      setSharedCode(data.code || null);
    } catch {
      setSharedError('Network error enabling shared mode.');
    } finally {
      setSharedLoading(false);
    }
  };

  const handleCompleteSet = () => {
    if (currentRir === null || !activeLift) return;

    const newLog = {
      weight: currentWeight,
      reps: currentReps,
      plannedWeight: suggestedWeight,
      plannedReps: suggestedReps,
      rir: currentRir,
      completed: true,
      timestamp: Date.now(),
    };

    const updatedLogs = { ...logs, [activeUid]: [...activeLogs, newLog] };
    setLogs(updatedLogs);
    setCurrentRir(null);
    setLastSetAt(newLog.timestamp);

    // Personal record: beat the best estimated 1RM from history (and this session).
    const e1rm = calcAverage1RM(currentWeight, currentReps);
    const previousBest = Math.max(bestBeforeSession[activeLift.id] || 0, sessionPRs[activeLift.id]?.e1rm || 0);
    if (previousBest > 0 && e1rm > previousBest + 0.5) {
      const baseline = sessionPRs[activeLift.id]?.previous ?? bestBeforeSession[activeLift.id];
      setSessionPRs((prev) => ({ ...prev, [activeLift.id]: { name: activeLift.name, e1rm, previous: baseline, weight: currentWeight, reps: currentReps } }));
      setPrToast(`New PR on ${activeLift.name}: ${currentWeight} × ${currentReps} (est. 1RM ${Math.round(e1rm)} lbs, +${Math.round(e1rm - previousBest)})`);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([80, 60, 80, 60, 160]);
    }

    const partner = getSupersetPartner(activeLift);
    if (!partner) return;

    const currentRemaining = getRemainingSets(activeLift, updatedLogs);
    const partnerRemaining = getRemainingSets(partner, updatedLogs);
    const partnerIndex = localPlan.lifts.findIndex((lift: any) => uidOf(lift) === uidOf(partner));

    if (partnerRemaining > 0 && partnerIndex >= 0) {
      setActiveLiftIndex(partnerIndex);
      return;
    }

    if (currentRemaining > 0) {
      return;
    }

    const nextUnfinished = findNextUnfinishedLiftIndex(safeLiftIndex, updatedLogs);
    if (nextUnfinished !== null) {
      setActiveLiftIndex(nextUnfinished);
    }
  };

   // Persistence Logic
   useEffect(() => {
     if (workoutFinished || !localPlan) return;
     try {
        localStorage.setItem('pendingWorkout', JSON.stringify({
           plan: localPlan,
           ownerId: user?.id || DEMO_USER_ID,
           sharedSessionId,
           sharedCode,
           activeLiftIndex: safeLiftIndex,
           logs,
           drafts,
           startTime: workoutStartTime,
           elapsedSecs,
           liftElapsedSecsMap,
           currentRir,
           intensitySlider,
           lastSetAt,
           sessionPRs,
           timestamp: Date.now()
        }));
     } catch {
        // Storage full or unavailable — the workout continues, it just can't be resumed.
     }
   }, [logs, drafts, safeLiftIndex, localPlan, workoutStartTime, workoutFinished, elapsedSecs, liftElapsedSecsMap, currentRir, intensitySlider, sharedSessionId, sharedCode, user?.id, lastSetAt, sessionPRs]);

   // Keep the phone screen on during the workout (where supported).
   useEffect(() => {
      if (workoutFinished || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
      let lock: { release: () => Promise<void> } | null = null;
      let cancelled = false;
      const acquire = async () => {
         try {
            const sentinel = await (navigator as any).wakeLock.request('screen');
            if (cancelled) sentinel.release();
            else lock = sentinel;
         } catch {
            // Denied (e.g. battery saver) — the workout still works.
         }
      };
      const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
      acquire();
      document.addEventListener('visibilitychange', onVisible);
      return () => {
         cancelled = true;
         document.removeEventListener('visibilitychange', onVisible);
         lock?.release().catch(() => {});
      };
   }, [workoutFinished]);

   useEffect(() => {
      if (!prToast) return;
      const handle = setTimeout(() => setPrToast(null), 5000);
      return () => clearTimeout(handle);
   }, [prToast]);

   useEffect(() => {
      // Sync on real progress; weight/rep tweaks are debounced so +/- taps
      // don't send a request each.
      if (!sharedSessionId) return;
      const handle = setTimeout(() => pushSharedProgress('active'), 800);
      return () => clearTimeout(handle);
   }, [safeLiftIndex, logs, currentWeight, currentReps, sharedSessionId]);

   useEffect(() => {
      if (!sharedSessionId) return;
      refreshSharedPeer();
      const poller = setInterval(refreshSharedPeer, 3000);
      return () => clearInterval(poller);
   }, [refreshSharedPeer, sharedSessionId]);

   const deleteSet = (index: number) => {
      const updated = [...activeLogs];
      updated.splice(index, 1);
      setLogs({ ...logs, [activeUid]: updated });
   };

   const adjustWeight = (direction: 1 | -1) => {
      setCurrentWeight(stepWeight(currentWeight, direction, activePossibleWeights));
   };

   const swapLift = (newLift: any) => {
        const newEntry = { ...newLift, uniquePlanId: newPlanId(), supersetId: null as string | null };
        const newPlanLifts = [...localPlan.lifts];
        if (activeLogs.length > 0) {
           // Sets were already logged for this lift — keep it and add the new one
           // after it, instead of silently discarding the logged sets.
           newPlanLifts.splice(safeLiftIndex + 1, 0, newEntry);
           setActiveLiftIndex(safeLiftIndex + 1);
        } else {
           newEntry.supersetId = activeLift?.supersetId || null;
           newPlanLifts[safeLiftIndex] = newEntry;
        }
        setLocalPlan({ ...localPlan, lifts: newPlanLifts });
        setShowChange(false);
    };

   const removeLiftAt = async (index: number) => {
      if (localPlan.lifts.length <= 1) return;
      const lift = localPlan.lifts[index];
      const uid = uidOf(lift);
      const loggedCount = logs[uid]?.length || 0;
      if (loggedCount > 0) {
         const ok = await confirm({
            title: 'Remove Lift',
            message: `Remove ${lift.name}? Its ${loggedCount} logged set${loggedCount === 1 ? '' : 's'} will be discarded.`,
            confirmLabel: 'Remove',
            danger: true,
         });
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

   const handlePairSuperset = (partnerLift: any) => {
      const supersetId = `ss-${Math.random().toString(36).substring(2, 10)}`;
      setLocalPlan({
         ...localPlan,
         lifts: localPlan.lifts.map((lift: any) =>
            uidOf(lift) === activeUid || uidOf(lift) === uidOf(partnerLift)
               ? { ...lift, supersetId }
               : lift
         ),
      });
      setShowSuperset(false);
   };

   const handleUnpairSuperset = () => {
      if (!activeLift?.supersetId) return;
      if (activeRemainingSets === 0 && activePartnerRemainingSets === 0) return;
      setLocalPlan({
         ...localPlan,
         lifts: localPlan.lifts.map((lift: any) =>
            lift.supersetId === activeLift.supersetId
               ? { ...lift, supersetId: null }
               : lift
         ),
      });
      setShowSuperset(false);
   };

   // Swap logic: match current gym, match any muscle in the workout type
   const targetMuscles: string[] = localPlan.type?.muscles?.length ? localPlan.type.muscles : [activeLift?.primaryMuscle];
   const currentGym = localPlan.gymName || localPlan.name?.split(' @ ')[1];
   const liftIdsInPlan = new Set(localPlan.lifts.map((lift: any) => lift.id));

   const alternatives = allLifts?.filter((l: any) => {
       if (liftIdsInPlan.has(l.id)) return false;
       if (currentGym && l.gymName && l.gymName !== currentGym) return false;
       return targetMuscles.includes(l.primaryMuscle) || targetMuscles.includes(l.secondaryMuscle);
   }) || [];

   let totalVol = 0; let totalSets = 0;
   Object.values(logs).forEach((sets: any) => sets.forEach((s: any) => { totalVol += (s.weight * s.reps); totalSets++; }));
   const MET = 4.0;
   const weightKg = user?.weight ? user.weight * 0.453592 : 75;
   const hours = elapsedSecs / 3600;
   const calories = Math.round(MET * weightKg * hours);

   const handleSaveWorkout = async () => {
      if (saving) return;
      setSaving(true);
      setSaveError('');

      // Map logs to exact Lift IDs instead of random Plan IDs so history works across workouts
      const exportLogs: Record<string, any[]> = {};
      const liftMeta: Record<string, any> = {};
      localPlan.lifts.forEach((lift: any) => {
         const liftLogs = logs[uidOf(lift)] || [];
         if (liftLogs.length === 0) return;
         // The same lift can appear twice (e.g. re-added); merge rather than overwrite.
         exportLogs[lift.id] = [...(exportLogs[lift.id] || []), ...liftLogs];
         liftMeta[lift.id] = {
           name: lift.name,
           stationType: lift.station?.type,
           stationId: lift.station?.id,
           primaryMuscle: lift.primaryMuscle,
           secondaryMuscle: lift.secondaryMuscle,
           supersetId: lift.supersetId || null,
           plannedSets: (liftMeta[lift.id]?.plannedSets || 0) + getTargetSets(lift),
         };
      });

      if (Object.keys(exportLogs).length === 0) {
         setSaveError('No sets were logged, so there is nothing to save.');
         setSaving(false);
         return;
      }

      const payload = {
         clientId: localPlan.id, // lets the server ignore a duplicate save
         planId: localPlan.id, name: localPlan.name, type: localPlan.type,
         duration: formatClock(elapsedSecs),
         durationSecs: elapsedSecs,
         timestamp: new Date().toISOString(), logs: exportLogs, calories, volume: totalVol,
         gymId: localPlan.gymId, gymName: localPlan.gymName, liftMeta,
         isDeload: localPlan.isDeload === true,
         intensitySlider,
         isDemo: !user,
      };

      let status: number | null = null;
      let message = '';
      try {
         const response = await fetch('/api/workout/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
         });
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

      await pushSharedProgress('finished');
      localStorage.removeItem('pendingWorkout');
      window.location.href = '/workout';
   };

   // Save this session's lifts (in order) as a pinned-lift template.
   const handleSaveAsTemplate = async () => {
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

   const handlePauseWorkout = async () => {
      await pushSharedProgress('paused');
      window.location.href = '/workout';
   };

   const handleDeleteWorkout = async () => {
      const ok = await confirm({ title: 'Delete Workout', message: 'Delete this workout? Logged sets will not be saved.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      await pushSharedProgress('deleted');
      localStorage.removeItem('pendingWorkout');
      window.location.href = '/workout';
   };

   const restTarget = restTargetSeconds(suggestedReps);
   const restElapsed = lastSetAt ? Math.max(0, Math.floor((Date.now() - lastSetAt) / 1000)) : 0;
   const showRestTimer = !!lastSetAt && totalSets > 0 && restElapsed < 15 * 60;
   const restDone = restElapsed >= restTarget;
   useEffect(() => {
      // Buzz once when the rest target is reached.
      if (!showRestTimer || !restDone || restNotifiedFor.current === lastSetAt) return;
      restNotifiedFor.current = lastSetAt;
      if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
   }, [showRestTimer, restDone, lastSetAt]);

   // Finish-screen comparison with the last workout of the same type.
   const previousSameType = findPreviousSameType(pastHistory, localPlan.type);
   const previousVolume = previousSameType ? (previousSameType.volume ?? workoutVolume(previousSameType.logs)) : 0;
   const prList = Object.values(sessionPRs);

   const warmups = activeLogs.length === 0 && activeLift?.station?.type !== 'bodyweight' && !suggestionLoading
      ? warmupSets(suggestedWeight, activePossibleWeights)
      : [];

   const canDisplayPlates = activeLift?.station?.type === 'plates' && Array.isArray(activeLift?.station?.plateSets);
   const requiredPlates = canDisplayPlates
      ? calculatePlates(currentWeight, activeLift.station.baseWeight ?? 45, activeLift.station.plateSets)
      : [];

   const handleIntensityChange = (newIntensity: number) => {
       setIntensitySlider(newIntensity);
   };

   const showExpandedHeaderDetails = !isCompactHeader || showHeaderDetails;
   const isUsingBaseline = suggestionReason.toLowerCase().includes('baseline');

   if (!activeLift) {
      return <div style={{ padding: '2rem', textAlign: 'center' }}>This workout has no lifts left.</div>;
   }

   if (workoutFinished) {
      return (
         <div className="workout-tile animate-fade-in" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <h1 style={{ fontSize: '3rem', margin: '0 0 1rem 0' }}>🏆</h1>
            <h2 style={{ margin: '0 0 0.5rem 0' }}>Workout Complete</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>{localPlan.name}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem', marginBottom: '2rem', textAlign: 'left' }}>
               <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Time</label>
                  <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{Math.floor(elapsedSecs/60)}m {(elapsedSecs%60)}s</div>
               </div>
               <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Volume Load</label>
                  <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{totalVol.toLocaleString()} lbs</div>
               </div>
               <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Est. Calories</label>
                  <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{calories} kcal</div>
               </div>
               <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Total Sets</label>
                  <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{totalSets}</div>
               </div>
            </div>

            {previousVolume > 0 && (
               <p style={{ margin: '-1rem 0 1.25rem', fontSize: '0.85rem' }}>
                  Volume vs last {localPlan.type?.name || 'session'}:{' '}
                  <strong style={{ color: totalVol >= previousVolume ? 'var(--success)' : 'var(--warning)' }}>
                     {totalVol >= previousVolume ? '+' : ''}{Math.round(((totalVol - previousVolume) / previousVolume) * 100)}%
                  </strong>
               </p>
            )}

            {prList.length > 0 && (
               <div style={{ textAlign: 'left', marginBottom: '1.25rem', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid rgba(var(--success-rgb), 0.4)', background: 'rgba(var(--success-rgb), 0.08)' }}>
                  <strong style={{ display: 'block', marginBottom: '0.35rem' }}>🏆 {prList.length} personal record{prList.length === 1 ? '' : 's'}</strong>
                  {prList.map((pr) => (
                     <div key={pr.name} className="workout-flex-between" style={{ fontSize: '0.85rem', padding: '0.15rem 0' }}>
                        <span>{pr.name} — {pr.weight} × {pr.reps}</span>
                        <span style={{ color: 'var(--success)' }}>+{Math.round(pr.e1rm - pr.previous)} lbs e1RM</span>
                     </div>
                  ))}
               </div>
            )}

            <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
               {localPlan.lifts.filter((lift: any) => (logs[uidOf(lift)] || []).length > 0).map((lift: any) => {
                  const sets = logs[uidOf(lift)];
                  const top = sets.reduce((best: any, set: any) => (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps) ? set : best), null);
                  return (
                     <div key={uidOf(lift)} className="workout-list-row" style={{ marginBottom: '0.35rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{lift.name}</span>
                        <span className="workout-hint">{sets.length} set{sets.length === 1 ? '' : 's'} · best {top.weight} × {top.reps}</span>
                     </div>
                  );
               })}
            </div>

            {saveError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0 0 1rem' }}>{saveError}</p>}
            <button className="workout-btn-primary" style={{ padding: '1.25rem', fontSize: '1.2rem', opacity: saving ? 0.6 : 1 }} onClick={handleSaveWorkout} disabled={saving}>{saving ? 'Saving…' : 'Save & Exit'}</button>
            {user && (
              <button className="btn btn-secondary" style={{ width: '100%', marginTop: '0.75rem', borderRadius: '12px' }} onClick={handleSaveAsTemplate} disabled={templateState === 'saving' || templateState === 'saved'}>
                {templateState === 'saved' ? '📌 Saved as template' : templateState === 'saving' ? 'Saving template…' : templateState === 'error' ? 'Retry saving as template' : '📌 Save lifts as template'}
              </button>
            )}
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: '0.75rem', borderRadius: '12px' }} onClick={() => { setWorkoutFinished(false); setSaveError(''); }} disabled={saving}>Back to Workout</button>
         </div>
      );
   }

   return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
         <div className={`workout-tile tracker-topbar${isCompactHeader ? ' tracker-topbar-compact' : ''}`} style={{ padding: isCompactHeader ? '0.65rem 0.75rem' : '1rem', marginBottom: isCompactHeader ? '0.35rem' : '0.5rem', borderRadius: '0 0 16px 16px', borderTop: 'none', position: 'sticky', top: 0, zIndex: 10 }}>
            {sharedSessionId && peerProgress && (
              <div className="animate-fade-in" style={{ marginBottom: '0.55rem', padding: '0.45rem 0.55rem', borderRadius: '10px', background: 'rgba(var(--accent-rgb), 0.1)', border: '1px solid rgba(var(--accent-rgb), 0.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: 'var(--muted)', minWidth: 0 }}>
                    Partner: <strong style={{ color: 'var(--foreground)' }}>{peerProgress.currentLiftName || 'Starting...'}</strong>
                    {peerProgress.currentWeight !== undefined && peerProgress.status === 'active' ? ` · up next ${peerProgress.currentWeight}×${peerProgress.currentReps}` : ''}
                    {peerProgress.status && peerProgress.status !== 'active' ? ` · ${peerProgress.status}` : ''}
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    {peerProgress.completedSets || 0}/{peerProgress.totalSets || 0}
                  </span>
                </div>
                {peerProgress.lastSet && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>
                    Last set {peerProgress.lastSet.weight}×{peerProgress.lastSet.reps} · {Math.max(0, Math.round((Date.now() - peerProgress.lastSet.at) / 60000))}m ago
                  </div>
                )}
                <div style={{ height: '6px', borderRadius: '4px', background: 'var(--surface-border)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${peerProgress.totalSets > 0 ? Math.min(100, Math.round(((peerProgress.completedSets || 0) / peerProgress.totalSets) * 100)) : 0}%`,
                      height: '100%',
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              </div>
            )}
            <div className="workout-flex-between tracker-topbar-row">
               <div>
                 <h2 style={{ fontSize: isCompactHeader ? '1.02rem' : '1.2rem', margin: '0 0 0.2rem 0' }}>{localPlan.name}</h2>
                 <p style={{ margin: 0, fontSize: isCompactHeader ? '0.75rem' : '0.85rem', color: 'var(--muted)' }}>Time: {Math.floor(elapsedSecs / 60).toString().padStart(2, '0')}:{(elapsedSecs % 60).toString().padStart(2, '0')}</p>
               </div>
               <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="btn btn-secondary tracker-topbar-action" style={{ padding: isCompactHeader ? '0.35rem 0.7rem' : '0.5rem 1rem' }} onClick={() => setShowList(true)}>List</button>
                  <button className="btn btn-secondary tracker-topbar-action" style={{ padding: isCompactHeader ? '0.35rem 0.7rem' : '0.5rem 1rem' }} onClick={() => setShowMenu(true)}>Menu</button>
               </div>
            </div>
         </div>

         <div style={{ flex: 1, padding: isCompactHeader ? '0.65rem' : '1rem', paddingBottom: isCompactHeader ? '1.25rem' : '2rem', overflowY: 'auto' }}>
            <div className={`tracker-summary-card${isCompactHeader ? ' compact' : ''}`} style={{ textAlign: 'center', marginBottom: isCompactHeader ? '0.6rem' : '1rem' }}>
                <p style={{ color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontSize: isCompactHeader ? '0.72rem' : '0.8rem', letterSpacing: isCompactHeader ? '1px' : '2px', margin: '0 0 0.35rem 0' }}>
                   {activeLift.station?.name || 'Equipment'} • Lift {safeLiftIndex + 1}/{localPlan.lifts.length}
                </p>
                <h1 style={{ fontSize: isCompactHeader ? '1.38rem' : '2rem', margin: '0 0 0.35rem 0', lineHeight: 1.1 }}>{activeLift.name}</h1>
                {stalledLiftIds.has(activeLift.id) && !localPlan.isDeload && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: '0 0 0.4rem' }}>
                    ⚠️ Plateau: no new best in 3 sessions. Consider fewer reps at a heavier weight, or{' '}
                    <button className="workout-text-btn" style={{ fontSize: '0.75rem', textDecoration: 'underline' }} onClick={() => setShowChange(true)}>swap to a variation</button>.
                  </p>
                )}
                {activeLift.notes && (
                  <p className="workout-hint" style={{ margin: '-0.15rem 0 0.4rem' }}>📝 {activeLift.notes}</p>
                )}
                <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'center', alignItems: 'center' }}>
                    <button style={{ background: 'none', border: '1px solid var(--surface-border)', color: 'var(--muted)', padding: isCompactHeader ? '0.16rem 0.7rem' : '0.2rem 1rem', borderRadius: '20px', fontSize: isCompactHeader ? '0.74rem' : '0.8rem' }} onClick={() => setShowChange(true)}>Change Lift 🔄</button>
                    <button style={{ background: 'none', border: '1px solid var(--surface-border)', color: 'var(--muted)', padding: isCompactHeader ? '0.16rem 0.7rem' : '0.2rem 1rem', borderRadius: '20px', fontSize: isCompactHeader ? '0.74rem' : '0.8rem' }} onClick={() => setShowLiftHistory(true)}>History 📈</button>
                    <button style={{ background: 'none', border: '1px solid var(--surface-border)', color: activeLift?.supersetId ? 'var(--accent)' : 'var(--muted)', padding: isCompactHeader ? '0.16rem 0.7rem' : '0.2rem 1rem', borderRadius: '20px', fontSize: isCompactHeader ? '0.74rem' : '0.8rem' }} onClick={() => setShowSuperset(true)}>
                      {activeLift?.supersetId ? 'Superset SS' : 'Superset'}
                    </button>
                </div>

                {activePartner && activePartnerRemainingSets > 0 && (
                    <div style={{ marginTop: '0.55rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', border: '1px solid rgba(var(--accent-rgb), 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ minWidth: 0, textAlign: 'left' }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px' }}>Superset Partner</div>
                          <div style={{ fontWeight: 700, fontSize: isCompactHeader ? '0.82rem' : '0.92rem' }}>{activePartner.name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                            {getLiftLogs(activePartner).length}/{getTargetSets(activePartner)} sets logged
                            {activeRemainingSets > 0 && activePartnerRemainingSets > 0 ? ' • Up next after this set' : ''}
                          </div>
                        </div>
                        <button className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem', borderRadius: '999px', flexShrink: 0 }} onClick={() => activePartnerIndex >= 0 && setActiveLiftIndex(activePartnerIndex)}>
                          Switch
                        </button>
                    </div>
                )}

                {/* System Target Tile */}
                <div style={{ marginTop: isCompactHeader ? '0.5rem' : '0.75rem', padding: isCompactHeader ? '0.45rem 0.65rem' : '0.6rem 1rem', background: 'rgba(var(--accent-rgb), 0.08)', border: '1px solid rgba(var(--accent-rgb), 0.3)', borderRadius: '10px', fontSize: isCompactHeader ? '0.8rem' : '0.85rem' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px' }}>System Target</span>
                    <div style={{ fontWeight: 700, color: 'var(--foreground)', fontSize: isCompactHeader ? '0.92rem' : '1rem', margin: isCompactHeader ? '0.1rem 0' : '0.15rem 0' }}>
                        {suggestionLoading ? 'Calculating…' : `${suggestedWeight} lbs × ${suggestedReps} reps × ${suggestedSets} sets`}
                    </div>
                    {isCompactHeader && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', marginTop: '0.3rem' }}>
                          <button
                            onClick={() => setShowHeaderDetails((value) => !value)}
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem', borderRadius: '999px' }}
                          >
                            <span style={{ marginRight: '0.35rem' }}>{showHeaderDetails ? 'Hide Details' : 'Details'}</span>
                            <span style={{ display: 'inline-block', transform: showHeaderDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>▾</span>
                          </button>
                          {!showHeaderDetails && (
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.62rem', color: 'var(--muted)' }}>
                              {calibrationInfo && calibrationInfo.status === 'calibrating' && (
                                <span title="Calibration in progress">🧪 Calibrating</span>
                              )}
                              {calibrationInfo && calibrationInfo.status === 'calibrated' && (
                                <span title="Calibration applied">✅ Calibrated</span>
                              )}
                              {calibrationInfo && calibrationInfo.status === 'none' && (activeLift.station?.type === 'stack' || activeLift.station?.type === 'cable') && (
                                <span title="Needs calibration">⚠️ Calibration</span>
                              )}
                              {scoringBreakdown && (
                                <span title="Scoring details available">📊 Scoring</span>
                              )}
                              {historicStats && (
                                <span title="History available">🕒 History</span>
                              )}
                              {isUsingBaseline && (
                                <span title="Using baseline weights">🧱 Baseline</span>
                              )}
                            </div>
                          )}
                        </div>
                    )}
                </div>

                {/* Intensity Slider */}
                {showExpandedHeaderDetails && (
                  <div style={{ marginTop: '0.45rem', textAlign: 'left' }}>
                    {isCompactHeader && (
                      <div style={{ marginBottom: '0.35rem', padding: '0.35rem 0.45rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', fontSize: '0.66rem', color: 'var(--muted)', lineHeight: 1.25 }}>
                        {calibrationInfo && calibrationInfo.status === 'calibrating' && <div>🧪 Calibrating: using another gym as temporary reference.</div>}
                        {calibrationInfo && calibrationInfo.status === 'calibrated' && <div>✅ Calibrated: this gym has a saved scale factor.</div>}
                        {calibrationInfo && calibrationInfo.status === 'none' && (activeLift.station?.type === 'stack' || activeLift.station?.type === 'cable') && <div>⚠️ Calibration: this lift needs a first calibration here.</div>}
                        {scoringBreakdown && <div>📊 Scoring: shows overload/e1RM decision metrics.</div>}
                        {historicStats && <div>🕒 History: previous session stats for this lift.</div>}
                        {isUsingBaseline && <div>🧱 Baseline: using starter weights until enough lift history is built.</div>}
                      </div>
                    )}
                    {suggestionReason && (
                      <div style={{ color: 'var(--accent)', fontSize: '0.74rem', marginBottom: '0.25rem' }}>💡 {suggestionReason}</div>
                    )}
                    {isDeviated && (
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ background: 'var(--warning)', color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manual Override</span>
                        <button onClick={resetToSuggestion} style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '0.1rem 0.5rem', borderRadius: '12px', fontSize: '0.7rem', cursor: 'pointer' }}>
                          Reset
                        </button>
                      </div>
                    )}
                    {calibrationInfo && calibrationInfo.status === 'calibrating' && (
                      <div className="animate-fade-in" style={{ marginTop: '0.2rem', padding: '0.45rem 0.55rem', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', fontSize: '0.73rem', color: 'var(--muted)' }}>
                        <strong style={{ color: 'var(--accent)' }}>Calibrating</strong> - last time you did this at <strong>{calibrationInfo.referenceGymName || 'another gym'}</strong>{' '}
                        you used <strong>{calibrationInfo.referenceWeight} lbs × {calibrationInfo.referenceReps}</strong>. We'll auto-calibrate after this session.
                      </div>
                    )}
                    {calibrationInfo && calibrationInfo.status === 'calibrated' && (
                      <div className="animate-fade-in" style={{ marginTop: '0.2rem', padding: '0.45rem 0.55rem', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', fontSize: '0.73rem', color: 'var(--muted)' }}>
                        <strong style={{ color: 'var(--accent)' }}>Calibration</strong> - scale factor <strong>{calibrationInfo.scaleFactor?.toFixed(2)}</strong> applied for this station.
                        {typeof calibrationInfo.confidence === 'number' && (
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
                            {Math.round(calibrationInfo.confidence * 100)}% confidence
                          </span>
                        )}
                      </div>
                    )}
                    {calibrationInfo && calibrationInfo.status === 'none' && (activeLift.station?.type === 'stack' || activeLift.station?.type === 'cable') && (
                      <div className="animate-fade-in" style={{ marginTop: '0.2rem', padding: '0.45rem 0.55rem', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', fontSize: '0.73rem', color: 'var(--muted)' }}>
                        <strong style={{ color: 'var(--accent)' }}>Calibration Needed</strong> - no prior scale for this lift in <strong>{localPlan.gymName || 'this gym'}</strong> yet.
                      </div>
                    )}

                    {/* Collapsible Scoring Breakdown */}
                    {scoringBreakdown && (
                      <button 
                        onClick={() => setShowBreakdown(!showBreakdown)} 
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '0.7rem', cursor: 'pointer', marginTop: '0.3rem', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                      >
                        <span>{showBreakdown ? 'Hide Scoring Details' : 'Show Scoring Details'}</span>
                        <span style={{ display: 'inline-block', transform: showBreakdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>▾</span>
                      </button>
                    )}

                    {showBreakdown && scoringBreakdown && (
                      <div className="animate-fade-in" style={{ marginTop: '0.4rem', padding: '0.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', textAlign: 'left', fontSize: '0.73rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.3rem 1rem' }}>
                          <div>
                            <span style={{ color: 'var(--muted)' }}>Overload:</span>{' '}
                            <strong style={{ color: scoringBreakdown.overloadRatio >= 1 ? 'var(--success)' : 'var(--danger)' }}>
                              {((scoringBreakdown.overloadRatio - 1) * 100).toFixed(1)}%
                            </strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--muted)' }}>e1RM:</span>{' '}
                            <strong>{Math.round(scoringBreakdown.e1RM)} lbs</strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--muted)' }}>Load:</span>{' '}
                            <strong>{Math.round(scoringBreakdown.totalLoad).toLocaleString()}</strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--muted)' }}>Candidates:</span>{' '}
                            <strong>{candidatesEvaluated}</strong>
                          </div>
                        </div>
                        {performanceMetrics && (
                          <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ color: 'var(--muted)' }}>Performance:</span>
                            <span style={{ 
                              color: getScoreColor(performanceMetrics.performanceScore),
                              fontWeight: 700 
                            }}>
                              {performanceMetrics.performanceScore.toFixed(2)}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                              {performanceMetrics.performanceScore > 1.05 ? '(Too Easy)' : 
                               performanceMetrics.performanceScore < 0.95 ? '(Too Hard)' : '(Appropriate)'}
                            </span>
                          </div>
                        )}
                        {scoringBreakdown.performanceAdjustment && (
                          <div style={{ marginTop: '0.3rem', color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.7rem' }}>
                            {scoringBreakdown.performanceAdjustment}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ marginTop: '0.55rem', padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.1)', borderRadius: '10px' }}>
                      <IntensitySlider value={intensitySlider} onChange={handleIntensityChange} />
                    </div>
                  </div>
                )}

                {showExpandedHeaderDetails && historicStats && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
                       <span style={{opacity: 0.7}}>Prev:</span> <strong style={{color:'var(--foreground)'}}>{historicStats.prevWeight} lbs × {historicStats.prevReps} ({historicStats.prevSets} sets)</strong> &nbsp;•&nbsp; 
                       <span style={{opacity: 0.7}}>1RM Est:</span> <strong style={{color:'var(--foreground)'}}>{historicStats.est1RM} lbs</strong>
                    </div>
                )}
                
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: 'var(--muted)', justifyContent: 'center', marginTop: isCompactHeader ? '0.4rem' : '0.6rem' }}>
                    <span>Workout {formatClock(elapsedSecs)}</span>
                    <span>This lift {formatClock(liftElapsedSecsMap[activeUid] || 0)}</span>
                </div>
                {showRestTimer && (
                  <div className={`tracker-rest${restDone ? ' done' : ''}`} role="timer" aria-live="polite">
                    <div className="workout-flex-between" style={{ fontSize: '0.8rem' }}>
                      <span>{restDone ? 'Rested — ready for the next set' : 'Resting'}</span>
                      <strong>{formatClock(restElapsed)} / {formatClock(restTarget)}</strong>
                    </div>
                    <div className="tracker-rest-bar"><div style={{ width: `${Math.min(100, (restElapsed / restTarget) * 100)}%` }} /></div>
                  </div>
                )}
            </div>

            <div className="workout-tile" style={{ background: 'rgba(0,0,0,0.1)', padding: isCompactHeader ? '0.65rem' : undefined }}>
                {activeLogs.length > 0 ? (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: isCompactHeader ? '0.6rem' : '0.75rem' }}>
                      {activeLogs.map((log: any, i: number) => (
                         <div key={i} className="workout-flex-between animate-fade-in" style={{ padding: isCompactHeader ? '0.42rem 0.5rem' : '0.6rem', background: 'var(--surface-glass)', borderRadius: '8px' }}>
                             <strong style={{ color: 'var(--accent)' }}>Set {i+1}</strong>
                             <span>{log.weight} lbs × {log.reps}{typeof log.rir === 'number' ? ` • RIR ${log.rir >= 5 ? '5+' : log.rir}` : ''}</span>
                             <button onClick={() => deleteSet(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0 0.5rem' }}>✕</button>
                          </div>
                      ))}
                   </div>
                ) : (
                  <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                    <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>No sets logged yet.</p>
                    {warmups.length > 0 && (
                      <p className="workout-hint" style={{ margin: '0.35rem 0 0' }}>
                        Warm-up: {warmups.map((w) => `${w.weight}×${w.reps}`).join(' · ')}
                      </p>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                       <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', textAlign: 'center', marginBottom: '0.25rem' }}>Weight (lbs)</label>
                       <div style={{ display: 'flex' }}>
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderRight: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '8px 0 0 8px' }} onClick={() => adjustWeight(-1)}>-</button>
                          <input className="hide-spinners" type="number" style={{ flex: 1, minWidth: '60px', textAlign: 'center', border: 'none', background: 'var(--input-bg)', color: 'var(--foreground)' }} value={currentWeight} readOnly aria-label="Weight in pounds" />
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderLeft: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '0 8px 8px 0' }} onClick={() => adjustWeight(1)}>+</button>
                       </div>
                    </div>
                    <div style={{ flex: 1 }}>
                       <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', textAlign: 'center', marginBottom: '0.25rem' }}>Reps</label>
                       <div style={{ display: 'flex' }}>
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderRight: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '8px 0 0 8px' }} onClick={() => setCurrentReps(Math.max(0, currentReps - 1))}>-</button>
                          <input className="hide-spinners" type="number" style={{ flex: 1, minWidth: '60px', textAlign: 'center', border: 'none', background: 'var(--input-bg)', color: 'var(--foreground)' }} inputMode="numeric" value={currentReps} onChange={e => setCurrentReps(Math.max(0, Math.round(Number(e.target.value)) || 0))} aria-label="Reps" />
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderLeft: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '0 8px 8px 0' }} onClick={() => setCurrentReps(currentReps + 1)}>+</button>
                       </div>
                    </div>
                </div>
                <div style={{ marginTop: '0.65rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', textAlign: 'center', marginBottom: '0.1rem' }}>Reps In Reserve</label>
                    <p className="workout-hint" style={{ textAlign: 'center', margin: '0 0 0.35rem' }}>How many more reps could you have done? 0 = failure</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '0.35rem' }}>
                      {[0, 1, 2, 3, 4, 5].map((rir) => {
                        const isSelected = currentRir === rir;
                        return (
                          <button
                            key={rir}
                            onClick={() => setCurrentRir(rir)}
                            style={{
                              border: isSelected ? '1px solid var(--accent)' : '1px solid var(--surface-border)',
                              background: isSelected ? 'rgba(var(--accent-rgb), 0.18)' : 'var(--input-bg)',
                              color: isSelected ? 'var(--foreground)' : 'var(--muted)',
                              borderRadius: '10px',
                              padding: '0.55rem 0.2rem',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {rir === 5 ? '5+' : rir}
                          </button>
                        );
                      })}
                    </div>
                </div>
                <button className="workout-btn-primary" onClick={handleCompleteSet} disabled={currentRir === null} style={{ marginTop: isCompactHeader ? '1rem' : '1.5rem', boxShadow: 'none', opacity: currentRir === null ? 0.55 : 1 }}>Complete Set ✓</button>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                    {safeLiftIndex > 0 && (
                      <button className="btn btn-secondary" style={{ flex: 1, padding: isCompactHeader ? '0.7rem' : '0.9rem', borderRadius: '12px' }} onClick={() => setActiveLiftIndex(safeLiftIndex - 1)}>Prev</button>
                    )}
                    {safeLiftIndex < localPlan.lifts.length - 1 ? (
                      <button className="btn btn-secondary" style={{ flex: 1, padding: isCompactHeader ? '0.7rem' : '0.9rem', borderRadius: '12px' }} onClick={() => setActiveLiftIndex(safeLiftIndex + 1)}>Next Lift →</button>
                    ) : <button className="workout-btn-primary" style={{ flex: 1, margin: 0, padding: isCompactHeader ? '0.7rem' : '0.9rem', background: 'var(--success)', boxShadow: '0 4px 15px rgba(var(--success-rgb), 0.3)' }} onClick={() => setWorkoutFinished(true)}>Finish 🏆</button>}
                </div>
            </div>

            {canDisplayPlates && requiredPlates === null && (
                <p className="animate-fade-in" style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--warning)' }}>
                   {currentWeight} lbs can&apos;t be loaded exactly with this station&apos;s plates.
                </p>
            )}
            {canDisplayPlates && requiredPlates && requiredPlates.length > 0 && (
                <PlateDiagram plates={requiredPlates} barWeight={activeLift.station.baseWeight ?? 45} totalWeight={currentWeight} />
            )}
         </div>

         {showMenu && (
            <div className="workout-overlay animate-fade-in" style={{ zIndex: 120 }}>
               <div className="workout-overlay-header">
                  <h2>Workout Menu</h2>
                  <button className="workout-close-btn" aria-label="Close" onClick={() => setShowMenu(false)}>✕</button>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <button className="btn btn-secondary" style={{ textAlign: 'left', padding: '0.9rem 1rem' }} onClick={handlePauseWorkout}>Pause Workout</button>
                  <button className="btn btn-secondary" style={{ textAlign: 'left', padding: '0.9rem 1rem' }} onClick={() => { setWorkoutFinished(true); setShowMenu(false); }}>Finish Workout</button>
                  <button className="btn btn-secondary" style={{ textAlign: 'left', padding: '0.9rem 1rem', color: 'var(--danger)', borderColor: 'rgba(var(--danger-rgb), 0.35)' }} onClick={handleDeleteWorkout}>Delete Workout</button>
                  <button className="btn btn-secondary" style={{ textAlign: 'left', padding: '0.9rem 1rem' }} disabled={sharedLoading} onClick={handleEnableSharedMode}>
                    {sharedLoading ? 'Creating Invite...' : sharedSessionId ? 'Shared Mode Enabled' : 'Invite To Shared Session'}
                  </button>
                  {sharedCode && (
                    <div className="workout-tile" style={{ marginBottom: 0 }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Share this code</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.2rem', color: 'var(--accent)' }}>{sharedCode}</div>
                    </div>
                  )}
                  {sharedError && <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{sharedError}</p>}
               </div>
            </div>
         )}

         {showList && (
            <div className="workout-overlay animate-fade-in">
               <div className="workout-overlay-header">
                  <h2>Workout Itinerary</h2>
                  <button className="workout-close-btn" aria-label="Close" onClick={() => { setShowList(false); setShowAddLift(false); }}>✕</button>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                   {localPlan.lifts.map((l: any, i: number) => {
                      const isDone = getRemainingSets(l) === 0;
                      const partner = getSupersetPartner(l);
                      const liftSuggestedSets = getTargetSets(l);
                      return (
                         // T2: min-width: 0 on row prevents horizontal overflow
                         <div key={uidOf(l)} style={{ display: 'flex', gap: '0.5rem', minWidth: 0 }}>
                            <button className="btn btn-secondary" style={{ flex: 1, minWidth: 0, padding: '0.85rem 1rem', textAlign: 'left', border: i === safeLiftIndex ? '1px solid var(--accent)' : '1px solid var(--surface-border)', background: isDone ? 'rgba(var(--success-rgb), 0.1)' : 'var(--input-bg)' }} onClick={() => { setActiveLiftIndex(i); setShowList(false); setShowAddLift(false); }}>
                               {/* Wrap text instead of truncating */}
                               <strong style={{ display: 'flex', wordWrap: 'break-word', whiteSpace: 'normal', lineHeight: '1.3' }}>
                                 <span style={{ minWidth: '1.5rem', flexShrink: 0 }}>{i + 1}.</span>
                                 <span>{l.name} {partner && <span style={{ marginLeft: '0.35rem', fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.05rem 0.35rem', borderRadius: '10px' }}>SS</span>}</span>
                               </strong>
                               <p style={{ margin: '0.35rem 0 0 1.5rem', fontSize: '0.8rem', color: 'var(--muted)', wordWrap: 'break-word', whiteSpace: 'normal', lineHeight: '1.3' }}>
                                 {/* T3: show per-lift engine-suggested set target */}
                                 {l.station?.name} • {logs[uidOf(l)]?.length || 0}/{liftSuggestedSets} sets
                                 {partner ? ` • SS: ${partner.name}` : ''}
                               </p>
                            </button>
                            {/* T2: fixed-width delete button so it never gets clipped */}
                            <button className="btn btn-secondary" aria-label={`Remove ${l.name}`} disabled={localPlan.lifts.length <= 1} style={{ flexShrink: 0, width: '3rem', padding: 0, color: 'var(--danger)', border: '1px solid rgba(var(--danger-rgb), 0.3)', background: 'rgba(var(--danger-rgb), 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: localPlan.lifts.length <= 1 ? 0.4 : 1 }} onClick={() => removeLiftAt(i)}>✕</button>
                         </div>
                      )
                   })}
               </div>
               {/* T1: Add Lift button at bottom of list */}
               {!showAddLift ? (
                  <button
                    className="btn btn-secondary"
                    style={{ width: '100%', padding: '0.85rem', borderRadius: '12px', border: '1px dashed var(--accent)', color: 'var(--accent)', marginBottom: '1rem' }}
                    onClick={() => setShowAddLift(true)}
                  >
                    Manage Equipment & Lifts
                  </button>
               ) : (
                  <div className="animate-fade-in" style={{ marginBottom: '1rem', border: '1px solid var(--accent)', borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(var(--accent-rgb),0.08)', borderBottom: '1px solid var(--accent)' }}>
                      <strong style={{ fontSize: '0.9rem' }}>Manage Equipment</strong>
                      <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }} onClick={() => setShowAddLift(false)}>✕</button>
                    </div>
                    <div style={{ padding: '1rem' }}>
                      <InlineGymEditor
                        gymId={localPlan.gymId}
                        onGymUpdated={(updatedGym) => {
                          const changedUids: string[] = [];
                          const updatedLifts = localPlan.lifts.map((lift: any) => {
                            const updatedStation = updatedGym.stations.find((s: any) => s.id === lift.station?.id);
                            if (updatedStation) {
                              changedUids.push(uidOf(lift));
                              return { ...lift, station: updatedStation };
                            }
                            return lift;
                          });
                          // Equipment changed → the weight ladder may differ, so re-suggest.
                          setSuggestions((prev) => {
                            const next = { ...prev };
                            changedUids.forEach((uid) => delete next[uid]);
                            return next;
                          });
                          setLocalPlan({ ...localPlan, lifts: updatedLifts });
                        }}
                        onClose={() => setShowAddLift(false)}
                        onAddLiftToWorkout={(lift, station) => {
                          const newLiftEntry = { ...lift, station, gymId: localPlan.gymId, gymName: localPlan.gymName, uniquePlanId: newPlanId() };
                          setLocalPlan((prev: any) => ({ ...prev, lifts: [...prev.lifts, newLiftEntry] }));
                          setShowAddLift(false);
                        }}
                      />
                    </div>
                  </div>
               )}
            </div>
         )}

         {showChange && (
             // T5: use overscroll-behavior: contain so inner scroll doesn't fight the page
             <div className="workout-overlay animate-fade-in">
               <div className="workout-overlay-header">
                  <h2>Swap Exercise</h2>
                  <button className="workout-close-btn" aria-label="Close" onClick={() => setShowChange(false)}>✕</button>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingBottom: '2rem' }}>
                  {alternatives.length === 0 && (
                     <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No other lifts at this gym match this workout&apos;s muscle groups.</p>
                  )}
                  {alternatives.map((l: any) => (
                      <button key={`${l.gymId || ''}-${l.id}`} className="workout-flex-between" style={{ color: 'var(--foreground)', padding: '0.85rem 1rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }} onClick={() => swapLift(l)}>
                         <div style={{ minWidth: 0, flex: 1 }}>
                            <strong style={{ fontSize: '1rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</strong>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                               {l.station?.name}
                            </p>
                            <p style={{ margin: '0.15rem 0 0', fontSize: '0.7rem', color: 'var(--accent)' }}>
                               {l.primaryMuscle} {l.secondaryMuscle ? `• ${l.secondaryMuscle}` : ''}
                            </p>
                         </div>
                         <span style={{ color: 'var(--foreground)', fontSize: '0.85rem', paddingLeft: '1rem', flexShrink: 0 }}>Swap 🔄</span>
                      </button>
                  ))}
               </div>
            </div>
          )}

         {showSuperset && (
             <div className="workout-overlay animate-fade-in">
               <div className="workout-overlay-header">
                  <h2>Manage Superset</h2>
                  <button className="workout-close-btn" aria-label="Close" onClick={() => setShowSuperset(false)}>✕</button>
               </div>

               <div className="workout-tile" style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.35rem' }}>Current Lift</div>
                  <strong style={{ fontSize: '1rem' }}>{activeLift.name}</strong>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>{getLiftLogs(activeLift).length}/{getTargetSets(activeLift)} sets logged</p>
               </div>

               {activePartner ? (
                 <div className="workout-tile">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.35rem' }}>Paired With</div>
                        <strong style={{ fontSize: '1rem' }}>{activePartner.name}</strong>
                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>{getLiftLogs(activePartner).length}/{getTargetSets(activePartner)} sets logged</p>
                      </div>
                      <button className="btn btn-secondary" style={{ color: 'var(--danger)', borderColor: 'rgba(var(--danger-rgb), 0.35)', opacity: activeRemainingSets === 0 && activePartnerRemainingSets === 0 ? 0.5 : 1 }} onClick={handleUnpairSuperset} disabled={activeRemainingSets === 0 && activePartnerRemainingSets === 0}>
                        Remove Pair
                      </button>
                    </div>
                    <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>This superset alternates between the two lifts after every completed set until one side finishes.</p>
                 </div>
               ) : (
                 <div>
                   <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 0.75rem 0' }}>Choose one remaining lift to pair with the current lift. The system will never auto-create supersets.</p>
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                     {eligibleSupersetLifts.map((lift: any) => (
                       <button key={uidOf(lift)} className="workout-flex-between" style={{ color: 'var(--foreground)', padding: '0.85rem 1rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }} onClick={() => handlePairSuperset(lift)}>
                          <div>
                             <strong style={{ fontSize: '1rem' }}>{lift.name}</strong>
                             <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                                {lift.station?.name} • {getLiftLogs(lift).length}/{getTargetSets(lift)} sets logged
                             </p>
                          </div>
                          <span style={{ color: 'var(--foreground)', fontSize: '0.8rem', paddingLeft: '1rem', flexShrink: 0 }}>Pair SS</span>
                       </button>
                     ))}
                     {eligibleSupersetLifts.length === 0 && (
                       <div className="workout-tile" style={{ marginBottom: 0 }}>
                         <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>No eligible lifts are available. Only unfinished, unpaired lifts can be added to a superset.</p>
                       </div>
                     )}
                   </div>
                 </div>
               )}
            </div>
         )}
         {showLiftHistory && (
            <LiftHistorySheet liftId={activeLift.id} liftName={activeLift.name} history={pastHistory || []} onClose={() => setShowLiftHistory(false)} />
         )}
         {prToast && (
            <div className="tracker-toast animate-fade-in" role="status" onClick={() => setPrToast(null)}>🏆 {prToast}</div>
         )}
         {popup}
      </div>
   );
}
