'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Tracker from './Tracker';
import { AddExerciseForGym } from '@/components/workout/AddExerciseFlow';

/** Rep/set scheme when a "build as I go" workout has no workout type. */
const FREESTYLE_TYPE = { name: 'Freestyle', muscles: [] as string[], intensity: 75, minReps: 8, maxReps: 12, sets: 3 };
import { buildLiftPlan } from '@/lib/workout/plan';
import { DEMO_GYMS, DEMO_HISTORY, DEMO_TYPES, DEMO_USER_ID } from '@/lib/workout/demo-data';

function newPlanId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function ActiveWorkoutPage() {
  const searchParams = useSearchParams();
  const gymId = searchParams.get('gym');
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
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workoutPlan, setWorkoutPlan] = useState<any>(null);
  const [allLifts, setAllLifts] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [pastHistory, setPastHistory] = useState<any[]>([]);
  const [resumingState, setResumingState] = useState<any>(null);

  useEffect(() => {
    async function init() {
      const isResuming = searchParams.get('resume') === 'true';
      let saved: any = null;
      if (isResuming) {
         try {
            const stored = localStorage.getItem('pendingWorkout');
            if (stored) saved = JSON.parse(stored);
         } catch(e) {}
      }

      if (!isResuming && !sharedSessionId && (!gymId || (!typeId && !isFreestyle))) {
        setError('Missing gym or workout type.');
        setLoading(false);
        return;
      }

      try {
        const [gymRes, typesRes, authRes, histRes] = isDemoMode
          ? [
              { gyms: DEMO_GYMS },
              { types: DEMO_TYPES },
              { authenticated: false, user: null },
              { success: true, history: DEMO_HISTORY },
            ]
          : await Promise.all([
              fetch('/api/workout/gyms').then(r => r.json()),
              fetch('/api/workout/types?scope=mine').then(r => r.json()),
              fetch('/api/workout/auth').then(r => r.json()),
              fetch('/api/workout/history').then(r => r.json())
            ]);
        
        if (authRes.authenticated) setUser(authRes.user);
        if (histRes.success) setPastHistory(histRes.history || []);
        const activeOwnerId = authRes.authenticated && authRes.user?.id ? authRes.user.id : DEMO_USER_ID;

        if (isResuming && saved) {
          const savedOwnerId = saved.ownerId || DEMO_USER_ID;
          if (savedOwnerId !== activeOwnerId) {
            saved = null;
          }
        }
        if (isResuming && !saved) {
          setError('No resumable workout found for this user.');
          return;
        }

        const isSharedJoin = !!sharedSessionId && sharedMode === 'join';
        const gym = gymRes.gyms?.find((g: any) => g.id === gymId);
        const type = typesRes.types?.find((t: any) => t.id === typeId) || (isFreestyle ? FREESTYLE_TYPE : undefined);

        if (!isResuming && !sharedSessionId && (!gym || !type)) {
           setError('Gym or Workout Type not found. Go back and check configuration.');
           return;
        }

        const availableLifts: any[] = [];
        const sourceGyms = isResuming || isSharedJoin ? gymRes.gyms || [] : [gym];
        sourceGyms.forEach((g: any) => {
            if (!g) return;
            g.stations?.forEach((station: any) => {
                if (station.lifts) {
                   station.lifts.forEach((lift: any) => {
                      availableLifts.push({ ...lift, station, gymName: g.name, gymId: g.id });
                   });
                }
            });
        });

        // Sample lifts only for demo mode — never inject fake lifts into a real gym.
        if (availableLifts.length === 0 && isDemoMode) {
             // Mock some default lifts if none exist so we can demonstrate
             const mockStation = { type: 'plates', baseWeight: 45, plateSets: [45, 45, 25, 10, 5, 2.5] };
             availableLifts.push(
               { id: '1', name: 'Barbell Bench Press', primaryMuscle: 'Chest', station: mockStation },
               { id: '2', name: 'Barbell Squat', primaryMuscle: 'Quads', station: mockStation },
               { id: '3', name: 'Deadlift', primaryMuscle: 'Hamstrings', station: mockStation }
             );
        }

        const plan: any[] = [];

        if (!isResuming && !isSharedJoin && !isFreestyle) {
           plan.push(...buildLiftPlan(availableLifts, type.muscles || [], liftCountParam, histRes.history || [], type.fixedLifts || []).map((lift) => ({ ...lift, uniquePlanId: newPlanId() })));
        }

        // Maintain full reference list for Tracker Swap Lift UI
        setAllLifts(availableLifts);

        if (saved) {
           setWorkoutPlan(saved.plan);
            setResumingState({
               activeLiftIndex: saved.activeLiftIndex,
               logs: saved.logs,
               startTime: saved.startTime,
               elapsedSecs: saved.elapsedSecs,
               drafts: saved.drafts,
               liftElapsedSecsMap: saved.liftElapsedSecsMap,
               lastSetAt: saved.lastSetAt,
               sessionPRs: saved.sessionPRs,
               currentRir: saved.currentRir,
               intensitySlider: saved.intensitySlider,
               sharedSessionId: saved.sharedSessionId,
               sharedCode: saved.sharedCode,
            });
        } else if (isSharedJoin) {
           const sessionRes = await fetch(`/api/workout/session?id=${encodeURIComponent(sharedSessionId)}`);
           const sessionData = await sessionRes.json();
           if (!sessionData.success || !sessionData.session?.planTemplate?.lifts) {
             setError(sessionData.message || 'Unable to load shared workout session.');
             return;
           }
           const template = sessionData.session.planTemplate;
           const templateLifts = (template.lifts || []).map((lift: any) => {
             const fromGym = availableLifts.find((entry) => entry.id === lift.id);
             if (fromGym) return { ...fromGym, uniquePlanId: newPlanId() };
             return {
               ...lift,
               station: lift.station || null,
               gymName: template.gymName || 'Shared Session',
               gymId: template.gymId || '',
               uniquePlanId: newPlanId(),
             };
           });
           const fallbackType = template.type || {
             name: 'Shared Workout',
             sets: 4,
             minReps: 8,
             maxReps: 12,
             intensity: 75,
           };
           setWorkoutPlan({
             id: `shared-${newPlanId()}`,
             name: `${template.name || 'Shared Workout'} (Joined)`,
             type: fallbackType,
             gymName: template.gymName || 'Shared Session',
             gymId: template.gymId || '',
             lifts: templateLifts,
             sharedSessionId,
           });
        } else {
           setWorkoutPlan({
               id: newPlanId(),
               name: `${isDeload ? 'Deload: ' : ''}${type.name} @ ${gym.name}`,
               freestyle: isFreestyle || undefined,
               isDeload,
               type: type,
               gymName: gym.name,
               gymId: gym.id,
               lifts: plan,
               sharedSessionId: sharedSessionId || undefined,
           });
        }
      } catch (err) {
        setError('Error generating workout algorithms.');
      } finally {
        setLoading(false);
      }
    }
    
    init();
  }, [gymId, typeId, liftCountParam, sharedMode, sharedSessionId, isDeload, isFreestyle]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }} className="animate-fade-in">⚙️ Calibrating optimal workout parameters...</div>;
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
         resumeState={resumingState || (intensityParam ? { intensitySlider: parseFloat(intensityParam) } : undefined)}
         sharedSessionId={sharedSessionId || workoutPlan?.sharedSessionId}
       />
    </div>
  );
}
