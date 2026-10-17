'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Tracker from './Tracker';
import { AddExerciseForGym } from '@/components/workout/AddExerciseFlow';
import { buildLiftPlan } from '@/lib/workout/plan';
import { nextProgramDay, type Program } from '@/lib/workout/programs';
import { fetchWorkoutJson } from '@/lib/workout/offline-cache';
import { newPlanId } from '@/lib/workout/tracker-utils';
import type { Goal } from '@/lib/workout/goals';
import { planFromShare, type SharedWorkout } from '@/lib/workout/workout-share';
import { DEMO_GYMS, DEMO_HISTORY, DEMO_TYPES, DEMO_USER_ID } from '@/lib/workout/demo-data';

/** Rep/set scheme when a "build as I go" workout has no workout type. */
const FREESTYLE_TYPE = { name: 'Freestyle', muscles: [] as string[], intensity: 75, minReps: 8, maxReps: 12, sets: 3 };

export default function ActiveWorkoutPage() {
  const searchParams = useSearchParams();
  const gymParam = searchParams.get('gym');
  const typeId = searchParams.get('type');
  const sharedSessionId = searchParams.get('sharedSessionId');
  const sharedMode = searchParams.get('sharedMode');
  const isDemoMode = searchParams.get('isDemo') === 'true';
  const parsedLiftCount = parseInt(searchParams.get('lifts') || '5', 10);
  const liftCountParam = Number.isFinite(parsedLiftCount) ? Math.min(12, Math.max(1, parsedLiftCount)) : 5;
  const intensityParam = searchParams.get('intensity');
  const isDeload = searchParams.get('deload') === '1';
  // "Build as I go": start empty and add machines/lifts while walking around.
  const isFreestyle = searchParams.get('freestyle') === '1';
  // "Repeat": the same lifts, in the same order, as a past workout (history id).
  const repeatId = searchParams.get('repeat');
  // Programs: the next day of a pre-planned rotation (or a specific day).
  const programId = searchParams.get('program');
  const programDayParam = searchParams.get('day');
  // A workout someone shared by link (token): its lifts, at `gym` if given, else at their gym once.
  const sharedWorkoutToken = searchParams.get('sharedWorkout');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [workoutPlan, setWorkoutPlan] = useState<any>(null);
  const [allLifts, setAllLifts] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [pastHistory, setPastHistory] = useState<any[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [resumingState, setResumingState] = useState<any>(null);

  useEffect(() => {
    async function init() {
      const isResuming = searchParams.get('resume') === 'true';
      let saved: any = null;
      if (isResuming) {
        try {
          const stored = localStorage.getItem('pendingWorkout');
          if (stored) saved = JSON.parse(stored);
        } catch { /* nothing to resume */ }
      }

      if (!isResuming && !sharedSessionId && !programId && !sharedWorkoutToken && (!gymParam || (!typeId && !isFreestyle && !repeatId))) {
        setError('Missing gym or workout type.');
        setLoading(false);
        return;
      }

      try {
        // Offline-first: each read falls back to the last copy saved on this phone.
        const [gymRes, typesRes, authRes, histRes, goalsRes, programsRes] = isDemoMode
          ? [{ gyms: DEMO_GYMS }, { types: DEMO_TYPES }, { authenticated: false, user: null }, { success: true, history: DEMO_HISTORY }, null, null]
          : await (async () => {
              const results = await Promise.all([
                fetchWorkoutJson('/api/workout/gyms'),
                fetchWorkoutJson('/api/workout/types?scope=mine'),
                fetchWorkoutJson('/api/workout/auth'),
                fetchWorkoutJson('/api/workout/history'),
                fetchWorkoutJson('/api/workout/goals'),
                programId ? fetchWorkoutJson('/api/workout/programs') : Promise.resolve({ data: null, offline: false }),
              ]);
              if (results.some((r) => r.offline)) setOffline(true);
              return results.map((r) => r.data || {});
            })();

        if (authRes?.authenticated) setUser(authRes.user);
        if (histRes?.success) setPastHistory(histRes.history || []);
        if (goalsRes?.success) setGoals(goalsRes.goals || []);
        const activeOwnerId = authRes?.authenticated && authRes.user?.id ? authRes.user.id : DEMO_USER_ID;

        if (isResuming && saved && (saved.ownerId || DEMO_USER_ID) !== activeOwnerId) saved = null;
        if (isResuming && !saved) {
          setError('No resumable workout found for this user.');
          return;
        }

        const isSharedJoin = !!sharedSessionId && sharedMode === 'join';
        const history: any[] = histRes?.history || [];

        // A program day decides the workout type, lift count and (by default) the gym.
        const program: Program | undefined = programId ? programsRes?.programs?.find((p: Program) => p.id === programId) : undefined;
        if (programId && !program && !isResuming) {
          setError('Program not found. It may have been deleted.');
          return;
        }
        const programDay = program
          ? (programDayParam !== null && Number.isInteger(Number(programDayParam)) ? Number(programDayParam) % program.days.length : nextProgramDay(program, history))
          : undefined;
        const day = program && programDay !== undefined ? program.days[programDay] : undefined;
        const gymId = gymParam || program?.gymId || null;

        let gym = gymRes?.gyms?.find((g: any) => g.id === gymId);
        let share: SharedWorkout | null = null;
        if (sharedWorkoutToken && !isResuming) {
          const shareRes = await fetch(`/api/workout/shared-workouts?token=${encodeURIComponent(sharedWorkoutToken)}`).then((r) => r.json()).catch(() => ({}));
          if (!shareRes.success) {
            setError(shareRes.message || 'Could not open the shared workout.');
            return;
          }
          share = shareRes.share as SharedWorkout;
          // Without one of your gyms, use theirs just this once (nothing is saved to your gyms).
          if (!gym) gym = share.gym;
        }
        const repeatOf = repeatId ? history.find((w: any) => w.id === repeatId) : null;
        const type = typesRes?.types?.find((t: any) => t.id === (day?.typeId || typeId))
          || (isFreestyle ? FREESTYLE_TYPE : undefined)
          || (repeatOf ? { ...FREESTYLE_TYPE, ...(repeatOf.type || {}), name: repeatOf.type?.name || 'Repeat' } : undefined)
          || (share ? { ...FREESTYLE_TYPE, name: share.typeName || share.title } : undefined);

        if (!isResuming && !sharedSessionId && (!gym || !type)) {
          setError(program && !type ? 'This program day uses a workout type that no longer exists. Edit the program.' : 'Gym or workout type not found. Go back and check configuration.');
          return;
        }

        const availableLifts: any[] = [];
        const sourceGyms = isResuming || isSharedJoin ? gymRes?.gyms || [] : [gym];
        sourceGyms.forEach((g: any) => {
          g?.stations?.forEach((station: any) => {
            station.lifts?.forEach((lift: any) => availableLifts.push({ ...lift, station, gymName: g.name, gymId: g.id }));
          });
        });

        // Sample lifts only for demo mode — never inject fake lifts into a real gym.
        if (availableLifts.length === 0 && isDemoMode) {
          const mockStation = { type: 'plates', baseWeight: 45, plateSets: [45, 45, 25, 10, 5, 2.5] };
          availableLifts.push(
            { id: '1', name: 'Barbell Bench Press', primaryMuscle: 'Chest', station: mockStation },
            { id: '2', name: 'Barbell Squat', primaryMuscle: 'Quads', station: mockStation },
            { id: '3', name: 'Deadlift', primaryMuscle: 'Hamstrings', station: mockStation },
          );
        }

        const plan: any[] = [];
        if (!isResuming && !isSharedJoin && !isFreestyle) {
          // Repeating pins every lift of that workout (matched by id, else by name).
          const repeatLifts = repeatOf
            ? Object.keys(repeatOf.logs || {}).map((liftId) => ({ liftId, name: repeatOf.liftMeta?.[liftId]?.name || '' }))
            : null;
          const picked = share ? [] : repeatLifts
            ? buildLiftPlan(availableLifts, type.muscles || [], repeatLifts.length, history, repeatLifts)
            : buildLiftPlan(availableLifts, type.muscles || [], day?.lifts ?? liftCountParam, history, type.fixedLifts || []);
          if (share) {
            // Their lifts in their order, as they exist in this gym; targets come from your own history.
            const { entries } = planFromShare(share, gym);
            plan.push(...entries.map(({ lift, station }) => ({ ...lift, station, gymName: gym.name, gymId: gym.id, uniquePlanId: newPlanId() })));
          } else {
            plan.push(...picked.map((lift) => ({ ...lift, uniquePlanId: newPlanId() })));
          }
        }

        // Full reference list for the tracker's Swap Lift sheet.
        setAllLifts(availableLifts);

        if (saved) {
          setWorkoutPlan(saved.plan);
          setResumingState(saved);
        } else if (isSharedJoin) {
          const sessionRes = await fetch(`/api/workout/session?id=${encodeURIComponent(sharedSessionId!)}`);
          const sessionData = await sessionRes.json();
          if (!sessionData.success || !sessionData.session?.planTemplate?.lifts) {
            setError(sessionData.message || 'Unable to load shared workout session.');
            return;
          }
          const template = sessionData.session.planTemplate;
          const templateLifts = (template.lifts || []).map((lift: any) => {
            const fromGym = availableLifts.find((entry) => entry.id === lift.id);
            if (fromGym) return { ...fromGym, uniquePlanId: newPlanId() };
            return { ...lift, station: lift.station || null, gymName: template.gymName || 'Shared Session', gymId: template.gymId || '', uniquePlanId: newPlanId() };
          });
          setWorkoutPlan({
            id: `shared-${newPlanId()}`,
            name: `${template.name || 'Shared Workout'} (Joined)`,
            type: template.type || { name: 'Shared Workout', sets: 4, minReps: 8, maxReps: 12, intensity: 75 },
            gymName: template.gymName || 'Shared Session',
            gymId: template.gymId || '',
            lifts: templateLifts,
            sharedSessionId,
          });
        } else {
          const dayLabel = day ? day.name || type.name : type.name;
          setWorkoutPlan({
            id: newPlanId(),
            name: share ? `${share.ownerName}'s ${type.name} @ ${gym.name}` : `${isDeload ? 'Deload: ' : ''}${program ? `${program.name} · ${dayLabel}` : type.name} @ ${gym.name}`,
            freestyle: isFreestyle || undefined,
            isDeload,
            type,
            gymName: gym.name,
            gymId: gym.id,
            programId: program?.id,
            programDay,
            lifts: plan,
            sharedSessionId: sharedSessionId || undefined,
          });
        }
      } catch {
        setError('Could not set up the workout.');
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [gymParam, typeId, liftCountParam, sharedMode, sharedSessionId, isDeload, isFreestyle, repeatId, programId, programDayParam, sharedWorkoutToken]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }} className="animate-fade-in">⚙️ Planning your workout…</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }} className="animate-fade-in">{error}</div>;
  if (workoutPlan && workoutPlan.lifts.length === 0 && isFreestyle) {
    return (
      <div className="animate-fade-in" style={{ paddingBottom: '2rem' }}>
        <a href="/workout" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>← Workout</a>
        <h1 style={{ fontSize: '1.4rem', margin: '0.4rem 0 0.25rem' }}>Build as you go</h1>
        <p className="workout-hint" style={{ marginTop: 0 }}>
          {workoutPlan.gymName}: walk up to a machine, pick it (or set it up), choose your lifts and start. Add more any time with ＋.
        </p>
        <AddExerciseForGym
          gymId={workoutPlan.gymId}
          onAdd={(entries) => setWorkoutPlan({
            ...workoutPlan,
            lifts: entries.map(({ lift, station }) => ({ ...lift, station, gymId: workoutPlan.gymId, gymName: workoutPlan.gymName, uniquePlanId: newPlanId() })),
          })}
        />
      </div>
    );
  }

  if (!workoutPlan || workoutPlan.lifts.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>No valid exercises found in this gym for this workout. Please add equipment and lifts first.</p>
        <a className="btn btn-secondary" href="/workout/config" style={{ display: 'inline-block', marginTop: '1rem' }}>Open Configuration</a>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '2rem' }}>
      <Tracker
        plan={workoutPlan}
        allLifts={allLifts}
        user={user}
        pastHistory={pastHistory}
        goals={goals}
        offline={offline}
        resumeState={resumingState || (intensityParam ? { intensitySlider: parseFloat(intensityParam) } : undefined)}
        sharedSessionId={sharedSessionId || workoutPlan?.sharedSessionId}
      />
    </div>
  );
}
