'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Tracker from './Tracker';

export default function ActiveWorkoutPage() {
  const searchParams = useSearchParams();
  const gymId = searchParams.get('gym');
  const typeId = searchParams.get('type');
  const liftCountParam = parseInt(searchParams.get('lifts') || '5');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workoutPlan, setWorkoutPlan] = useState<any>(null);
  const [historicStats, setHistoricStats] = useState<{prevWeight: number, prevReps: number, prevSets: number, est1RM: number} | null>(null);
  const [allLifts, setAllLifts] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [pastHistory, setPastHistory] = useState<any[]>([]);
  const [resumingState, setResumingState] = useState<any>(null);

  useEffect(() => {
    async function init() {
      const isResuming = searchParams.get('resume') === 'true';
      let saved = null;
      if (isResuming) {
         try {
            const stored = localStorage.getItem('pendingWorkout');
            if (stored) saved = JSON.parse(stored);
         } catch(e) {}
      }

      if (!isResuming && (!gymId || !typeId)) {
        setError('Missing gym or workout type.');
        setLoading(false);
        return;
      }

      try {
        const [gymRes, typesRes, authRes, histRes] = await Promise.all([
           fetch('/api/workout/gyms').then(r => r.json()),
           fetch('/api/workout/types').then(r => r.json()),
           fetch('/api/workout/auth').then(r => r.json()),
           fetch('/api/workout/history').then(r => r.json())
        ]);
        
        if (authRes.authenticated) setUser(authRes.user);
        if (histRes.success) setPastHistory(histRes.history || []);

        const gym = gymRes.gyms?.find((g: any) => g.id === gymId);
        const type = typesRes.types?.find((t: any) => t.id === typeId);

        if (!isResuming && (!gym || !type)) {
           setError('Gym or Workout Type not found. Go back and check configuration.');
           return;
        }

        const availableLifts: any[] = [];
        const sourceGyms = isResuming ? gymRes.gyms || [] : [gym];
        sourceGyms.forEach((g: any) => {
            if (!g) return;
            g.stations?.forEach((station: any) => {
                if (station.lifts) {
                   station.lifts.forEach((lift: any) => {
                      availableLifts.push({ ...lift, station, gymName: g.name });
                   });
                }
            });
        });

        // For demo/empty states:
        if (availableLifts.length === 0) {
             // Mock some default lifts if none exist so we can demonstrate
             const mockStation = { type: 'plates', baseWeight: 45, plateSets: [45, 45, 25, 10, 5, 2.5] };
             availableLifts.push(
               { id: '1', name: 'Barbell Bench Press', primaryMuscle: 'Chest', station: mockStation },
               { id: '2', name: 'Barbell Squat', primaryMuscle: 'Quads', station: mockStation },
               { id: '3', name: 'Deadlift', primaryMuscle: 'Hamstrings', station: mockStation }
             );
        }

        const plan: any[] = [];

        if (!isResuming) {
           const targetMuscles: string[] = type.muscles || [];
           
           // Phase 1: Pick one lift per target muscle
           targetMuscles.forEach((muscle: string) => {
              const matches = availableLifts.filter(l => l.primaryMuscle === muscle || l.secondaryMuscle === muscle);
              if (matches.length > 0) {
                 const selected = matches[Math.floor(Math.random() * matches.length)];
                 if (!plan.find(p => p.id === selected.id)) {
                     plan.push({ ...selected, uniquePlanId: Math.random() });
                 }
              }
           });

           // Phase 2: Fill up to the user's requested lift count
           const muscleFilteredPool = targetMuscles.length > 0
             ? availableLifts.filter(l => targetMuscles.includes(l.primaryMuscle) || targetMuscles.includes(l.secondaryMuscle))
             : availableLifts;

           let tries = 0;
           while (plan.length < liftCountParam && muscleFilteredPool.length > plan.length && tries < 30) {
              const selected = muscleFilteredPool[Math.floor(Math.random() * muscleFilteredPool.length)];
              if (!plan.find(p => p.id === selected.id)) {
                     plan.push({ ...selected, uniquePlanId: Math.random() });
              }
              tries++;
           }
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
              liftElapsedSecsMap: saved.liftElapsedSecsMap,
              setElapsedSecsMap: saved.setElapsedSecsMap,
              intensitySlider: saved.intensitySlider
           });
        } else {
           setWorkoutPlan({
               id: Math.random().toString(36).substring(2, 10),
               name: `${type.name} @ ${gym.name}`,
               type: type,
               gymName: gym.name,
               lifts: plan
           });
        }
      } catch (err) {
        setError('Error generating workout algorithms.');
      } finally {
        setLoading(false);
      }
    }
    
    init();
  }, [gymId, typeId, liftCountParam]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }} className="animate-fade-in">⚙️ Calibrating optimal workout parameters...</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: '#ff6b6b' }} className="animate-fade-in">{error}</div>;
  if (!workoutPlan || workoutPlan.lifts.length === 0) return <div style={{ padding: '2rem', textAlign: 'center' }}>No valid exercises found in this gym for this workout. Please add equipment and lifts first.</div>;

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '2rem' }}>
       <Tracker 
         plan={workoutPlan} 
         allLifts={allLifts} 
         user={user} 
         pastHistory={pastHistory} 
         resumeState={resumingState}
       />
    </div>
  );
}
