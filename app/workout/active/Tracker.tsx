'use client';

import { useState, useEffect, useCallback } from 'react';
import { calcEpley, calcAverage1RM } from '@/lib/workout/analytics';

// Plate Math Algorithm
function calculatePlates(targetWeight: number, baseWeight: number, availablePlatePairs: number[]) {
    let remaining = (targetWeight - baseWeight) / 2;
    if (remaining <= 0) return [];
    let sortedPlates = [...availablePlatePairs].sort((a,b) => b-a);
    let usedPlates: number[] = [];
    for (let i = 0; i < sortedPlates.length; i++) {
        if (remaining >= sortedPlates[i]) {
            usedPlates.push(sortedPlates[i]);
            remaining -= sortedPlates[i];
        }
    }
    return usedPlates;
}

// Generate the array of strictly possible weights based on station parameters
function getPossibleWeights(station: any): number[] {
    if (!station) return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]; 
    if (station.type === 'stack' || station.type === 'cable') {
       let possible: number[] = [];
       const inc = station.increment || 10;
       for (let w = station.minWeight || 10; w <= (station.maxWeight || 300); w += inc) {
           possible.push(w);
           if (station.additionalWeight) possible.push(w + station.additionalWeight);
       }
       return Array.from(new Set(possible)).sort((a,b) => a-b);
    }
    if (station.type === 'dumbbells') return [...(station.dumbbellPairs || [5,10,15,20,25])].sort((a,b)=>a-b);
    if (station.type === 'plates') {
       if (!station.plateSets || station.plateSets.length === 0) return [station.baseWeight || 45];
       const halfWeights = new Set([0]);
       for (const p of station.plateSets) {
            const currentPossible = Array.from(halfWeights);
            for (const w of currentPossible) {
                 halfWeights.add(w + p);
            }
       }
       return Array.from(halfWeights).map(hw => (station.baseWeight || 45) + (hw * 2)).sort((a,b) => a-b);
    }
    if (station.type === 'bodyweight') {
       if (!station.bodyWeightAdditions || station.bodyWeightAdditions.length === 0) return [0]; 
       const additions = station.bodyWeightAdditions.sort((a:number,b:number)=>a-b);
       return [0, ...additions];
    }
    return [0, 5, 10, 15];
}

// Intensity label helper
function getIntensityLabel(value: number): { label: string; emoji: string; color: string } {
    if (value <= 0.6) return { label: 'Recovery', emoji: '🧘', color: '#63b3ed' };
    if (value <= 0.8) return { label: 'Light', emoji: '🌿', color: '#68d391' };
    if (value <= 1.1) return { label: 'Standard', emoji: '⚖️', color: '#48bb78' };
    if (value <= 1.3) return { label: 'Push', emoji: '💪', color: '#ed8936' };
    return { label: 'Max Push', emoji: '🔥', color: '#fc8181' };
}

// Performance score color
function getScoreColor(score: number): string {
    if (score > 1.05) return '#48bb78'; // green — too easy / strong
    if (score >= 0.95) return '#ecc94b'; // yellow — appropriate
    return '#fc8181'; // red — struggled
}

export default function Tracker({ plan, allLifts, user, pastHistory, resumeState }: any) {
   const [localPlan, setLocalPlan] = useState<any>(resumeState?.plan || plan);
   const [activeLiftIndex, setActiveLiftIndex] = useState(resumeState?.activeLiftIndex || 0);
   const [workoutStartTime] = useState(resumeState?.startTime || Date.now());
   const [elapsedSecs, setElapsedSecs] = useState<number>(resumeState?.elapsedSecs || 0);
   const [liftElapsedSecsMap, setLiftElapsedSecsMap] = useState<Record<number, number>>(resumeState?.liftElapsedSecsMap || {});
   const [setElapsedSecsMap, setSetElapsedSecsMap] = useState<Record<number, number>>(resumeState?.setElapsedSecsMap || {});
   
   const [logs, setLogs] = useState<Record<string, any[]>>(resumeState?.logs || {});

   const [currentWeight, setCurrentWeight] = useState<number>(0);
   const [currentReps, setCurrentReps] = useState<number>(10);
   const [historicStats, setHistoricStats] = useState<{prevWeight: number, prevReps: number, prevSets: number, est1RM: number} | null>(null);
   const [suggestedWeight, setSuggestedWeight] = useState<number>(0);
   const [suggestedReps, setSuggestedReps] = useState<number>(10);
   const [suggestedSets, setSuggestedSets] = useState<number>(localPlan.type?.sets || 4);
   const [suggestionReason, setSuggestionReason] = useState<string>('');

   // New: scoring breakdown and intensity slider
   const [scoringBreakdown, setScoringBreakdown] = useState<any>(null);
   const [performanceMetrics, setPerformanceMetrics] = useState<any>(null);
   const [candidatesEvaluated, setCandidatesEvaluated] = useState<number>(0);
   const [intensitySlider, setIntensitySlider] = useState<number>(resumeState?.intensitySlider ?? user?.intensityFactor ?? 1.0);
   const [showBreakdown, setShowBreakdown] = useState(false);
   const [isCompactHeader, setIsCompactHeader] = useState(false);
   const [showHeaderDetails, setShowHeaderDetails] = useState(true);

   const [showList, setShowList] = useState(false);
   const [showChange, setShowChange] = useState(false);
   const [workoutFinished, setWorkoutFinished] = useState(false);

   useEffect(() => {
     let previousTick = Date.now();
     const timer = setInterval(() => {
        if (!workoutFinished) {
            const now = Date.now();
            const delta = Math.floor((now - previousTick) / 1000);
            if (delta > 0) {
               previousTick = now;
               setElapsedSecs((e: number) => e + delta);
               setLiftElapsedSecsMap((m: Record<number, number>) => ({...m, [activeLiftIndex]: (m[activeLiftIndex] || 0) + delta }));
               setSetElapsedSecsMap((m: Record<number, number>) => ({...m, [activeLiftIndex]: (m[activeLiftIndex] || 0) + delta }));
            }
        }
     }, 1000);
     return () => clearInterval(timer);
   }, [workoutFinished, activeLiftIndex]);

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

   const activeLift = localPlan.lifts[activeLiftIndex];

   // Lift switch no longer resets timers since they map by activeLiftIndex
   // Timer retains state in Map
   

   // Fetch progression suggestions
   const fetchProgression = useCallback((liftOverride?: any, intensityOverride?: number) => {
      const lift = liftOverride || activeLift;
      if (!lift) return;

      const historicSets: any[] = [];
      pastHistory?.forEach((workout: any) => {
          if (workout.logs && workout.logs[lift.id]) {
              historicSets.push(...workout.logs[lift.id]);
          }
      });
      historicSets.sort((a: any, b: any) => a.timestamp - b.timestamp);

      const effectiveIntensity = intensityOverride ?? intensitySlider;

      if (historicSets.length >= 1) {
          const lastSetTimestamp = historicSets[historicSets.length - 1].timestamp;
          const sessionSets = historicSets.filter((s: any) => Math.abs(s.timestamp - lastSetTimestamp) < 14400000);
          
          fetch('/api/workout/progression', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
                 liftId: lift.id,
                 station: lift.station,
                 logs: sessionSets,
                 planType: localPlan.type,
                 intensity: effectiveIntensity
             })
          }).then(r => r.json()).then(res => {
             if (res.success && res.plan) {
                 setCurrentWeight(res.plan.suggestedWeight);
                 setCurrentReps(res.plan.suggestedReps);
                 setSuggestedWeight(res.plan.suggestedWeight);
                 setSuggestedReps(res.plan.suggestedReps);
                 setSuggestedSets(res.plan.suggestedSets);
                 setSuggestionReason(res.plan.reasoning || '');
                 setScoringBreakdown(res.plan.scoringBreakdown || null);
                 setPerformanceMetrics(res.plan.performanceMetrics || null);
                 setCandidatesEvaluated(res.plan.candidatesEvaluated || 0);
             }
          });

          const lastSet = historicSets[historicSets.length - 1];
          const last1RM = calcAverage1RM(lastSet.weight, lastSet.reps);
          setHistoricStats({ 
             prevWeight: lastSet.weight, 
             prevReps: lastSet.reps, 
             prevSets: sessionSets.length,
             est1RM: Math.round(last1RM) 
          });
      } else {
          let base = 0;
          if (lift.station?.type === 'plates') base = lift.station.baseWeight || 45;
          else if (lift.station?.type === 'stack' || lift.station?.type === 'cable') base = lift.station.minWeight || 10;
          else if (lift.station?.type === 'dumbbells') base = Math.min(...(lift.station.dumbbellPairs||[5]));
          
          const fallbackReps = localPlan.type.sets ? Math.floor((localPlan.type.minReps + localPlan.type.maxReps) / 2) : 10;
          setCurrentWeight(base);
          setCurrentReps(fallbackReps);
          setSuggestedWeight(base);
          setSuggestedReps(fallbackReps);
          setSuggestedSets(localPlan.type.sets || 4);
          setSuggestionReason('Initial baseline weights.');
          setScoringBreakdown(null);
          setPerformanceMetrics(null);
          setCandidatesEvaluated(0);
          setHistoricStats(null);
      }
   }, [activeLift, pastHistory, localPlan.type, intensitySlider]);

   // Initial fetch on lift change
   useEffect(() => {
       fetchProgression();
   }, [activeLiftIndex, localPlan.lifts, pastHistory, user]);

   if (!activeLift && !workoutFinished) return <div>Invalid Workout State</div>;

   const activeLogs = logs[activeLift?.uniquePlanId] || [];
   const isDeviated = currentWeight !== suggestedWeight || currentReps !== suggestedReps;

   const handleCompleteSet = () => {
      const newLog = { weight: currentWeight, reps: currentReps, completed: true, timestamp: Date.now() };
      const updatedLogs = { ...logs, [activeLift.uniquePlanId]: [...activeLogs, newLog] };
      setLogs(updatedLogs);
      setSetElapsedSecsMap((m: Record<number, number>) => ({...m, [activeLiftIndex]: 0}));
   };

   // Persistence Logic
   useEffect(() => {
     if (!workoutFinished && localPlan) {
        localStorage.setItem('pendingWorkout', JSON.stringify({
           plan: localPlan,
           activeLiftIndex,
           logs,
           startTime: workoutStartTime,
           elapsedSecs,
           liftElapsedSecsMap,
           setElapsedSecsMap,
           intensitySlider,
           timestamp: Date.now()
        }));
     }
   }, [logs, activeLiftIndex, localPlan, workoutStartTime, workoutFinished, elapsedSecs, liftElapsedSecsMap, setElapsedSecsMap, intensitySlider]);

   const deleteSet = (index: number) => {
      const updated = [...activeLogs];
      updated.splice(index, 1);
      setLogs({ ...logs, [activeLift.uniquePlanId]: updated });
   };

   const adjustWeight = (direction: 1 | -1) => {
       const station = activeLift.station;
       if (!station) { setCurrentWeight(Math.max(0, currentWeight + (5*direction))); return; }
       
       const possible = getPossibleWeights(station);
       if (station.type === 'bodyweight') {
           if (direction === 1) setCurrentWeight(possible[Math.min(possible.length-1, possible.indexOf(currentWeight)+1)] || 0);
           else setCurrentWeight(possible[Math.max(0, possible.indexOf(currentWeight)-1)] || 0);
           return;
       }
       const idx = possible.indexOf(currentWeight);
       if (idx === -1) {
          const nearest = possible.reduce((prev, curr) => Math.abs(curr - currentWeight) < Math.abs(prev - currentWeight) ? curr : prev);
          setCurrentWeight(nearest);
       } else {
          if (direction === 1 && idx < possible.length - 1) setCurrentWeight(possible[idx + 1]);
          if (direction === -1 && idx > 0) setCurrentWeight(possible[idx - 1]);
       }
   };

   const swapLift = (newLift: any) => {
       const newPlanLifts = [...localPlan.lifts];
       newPlanLifts[activeLiftIndex] = { ...newLift, uniquePlanId: Math.random() };
       setLocalPlan({ ...localPlan, lifts: newPlanLifts });
       setShowChange(false);
   };

   // Swap logic: match current gym, match any muscle in the workout type
   const targetMuscles = localPlan.type?.muscles || [activeLift?.primaryMuscle];
   const currentGym = localPlan.gymName || localPlan.name?.split(' @ ')[1];

   const alternatives = allLifts?.filter((l: any) => {
       if (l.id === activeLift?.id) return false;
       if (currentGym && l.gymName !== currentGym) return false;
       return targetMuscles.includes(l.primaryMuscle) || targetMuscles.includes(l.secondaryMuscle);
   }) || [];

   let totalVol = 0; let totalSets = 0;
   Object.values(logs).forEach((sets: any) => sets.forEach((s: any) => { totalVol += (s.weight * s.reps); totalSets++; }));
   const MET = 4.0; 
   const weightKg = user?.weight ? user.weight * 0.453592 : 75; 
   const hours = elapsedSecs / 3600;
   const calories = Math.round(MET * weightKg * hours);

   const handleSaveWorkout = async () => {
      // Map logs to exact Lift IDs instead of random Plan IDs so history works across workouts
      const exportLogs: Record<string, any[]>  = {};
      Object.keys(logs).forEach(uid => {
         const lift = localPlan.lifts.find((l: any) => l.uniquePlanId.toString() === uid.toString());
         if (lift) exportLogs[lift.id] = logs[uid];
      });

      await fetch('/api/workout/history', { 
         method: 'POST', 
         body: JSON.stringify({
             planId: localPlan.id, name: localPlan.name, type: localPlan.type,
             duration: `${Math.floor(elapsedSecs/60)}:${(elapsedSecs%60).toString().padStart(2,'0')}`,
             timestamp: new Date().toISOString(), logs: exportLogs, calories, volume: totalVol,
             isDemo: !user
         }) 
      });
      localStorage.removeItem('pendingWorkout');
      window.location.href = '/workout';
   };

   let canDisplayPlates = false;
   let requiredPlates: number[] = [];
   if (activeLift?.station?.type === 'plates' && activeLift?.station?.plateSets) {
       canDisplayPlates = true;
       requiredPlates = calculatePlates(currentWeight, activeLift.station.baseWeight || 45, activeLift.station.plateSets);
   }

   // Intensity slider handler — re-fetches progression with new intensity
   const handleIntensityChange = (newIntensity: number) => {
       setIntensitySlider(newIntensity);
       fetchProgression(undefined, newIntensity);
   };

   const intensityInfo = getIntensityLabel(intensitySlider);
   const showExpandedHeaderDetails = !isCompactHeader || showHeaderDetails;

   if (workoutFinished) {
      return (
         <div className="workout-tile animate-fade-in" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <h1 style={{ fontSize: '3rem', margin: '0 0 1rem 0' }}>🏆</h1>
            <h2 style={{ margin: '0 0 0.5rem 0' }}>Workout Complete</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>{localPlan.name}</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', textAlign: 'left' }}>
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

            <button className="workout-btn-primary" style={{ padding: '1.25rem', fontSize: '1.2rem' }} onClick={handleSaveWorkout}>Save & Exit</button>
         </div>
      );
   }

   return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '90vh' }}>
         <div className={`workout-tile tracker-topbar${isCompactHeader ? ' tracker-topbar-compact' : ''}`} style={{ padding: '1rem', marginBottom: '0.5rem', borderRadius: '0 0 16px 16px', borderTop: 'none', position: 'sticky', top: 0, zIndex: 10 }}>
            <div className="workout-flex-between tracker-topbar-row">
               <div>
                 <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.25rem 0' }}>{localPlan.name}</h2>
                 <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>Time: {Math.floor(elapsedSecs / 60).toString().padStart(2, '0')}:{(elapsedSecs % 60).toString().padStart(2, '0')}</p>
               </div>
               <button className="btn btn-secondary tracker-topbar-action" style={{ padding: '0.5rem 1rem' }} onClick={() => setShowList(true)}>List</button>
            </div>
         </div>

         <div style={{ flex: 1, padding: '1rem' }}>
            <div className={`tracker-summary-card${isCompactHeader ? ' compact' : ''}`} style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <p style={{ color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontSize: isCompactHeader ? '0.72rem' : '0.8rem', letterSpacing: isCompactHeader ? '1px' : '2px', margin: '0 0 0.35rem 0' }}>
                   {activeLift.station?.name || 'Equipment'} • Lift {activeLiftIndex + 1}/{localPlan.lifts.length}
                </p>
                <h1 style={{ fontSize: isCompactHeader ? '1.55rem' : '2rem', margin: '0 0 0.5rem 0', lineHeight: 1.1 }}>{activeLift.name}</h1>
                <div style={{ display: showExpandedHeaderDetails ? 'flex' : 'none', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                    <button style={{ background: 'none', border: '1px solid var(--surface-border)', color: 'var(--muted)', padding: '0.2rem 1rem', borderRadius: '20px', fontSize: '0.8rem' }} onClick={() => setShowChange(true)}>Change Lift 🔄</button>
                </div>

                {/* System Target Tile */}
                <div style={{ marginTop: '0.75rem', padding: '0.6rem 1rem', background: 'rgba(var(--accent-rgb), 0.08)', border: '1px solid rgba(var(--accent-rgb), 0.3)', borderRadius: '10px', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px' }}>System Target</span>
                    <div style={{ fontWeight: 700, color: 'var(--foreground)', fontSize: '1rem', margin: '0.15rem 0' }}>
                        {suggestedWeight} lbs × {suggestedReps} reps × {suggestedSets} sets
                    </div>
                    {suggestionReason && <div style={{ color: 'var(--accent)', fontSize: '0.75rem', marginTop: '0.2rem' }}>💡 {suggestionReason}</div>}
                    
                    {/* Manual Override Badge */}
                    {isDeviated && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center', marginTop: '0.3rem' }}>
                           <span style={{ background: '#ed8936', color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manual Override</span>
                           <button onClick={() => { setCurrentWeight(suggestedWeight); setCurrentReps(suggestedReps); }} style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '0.1rem 0.5rem', borderRadius: '12px', fontSize: '0.7rem', cursor: 'pointer' }}>
                               ↩ Reset
                           </button>
                        </div>
                    )}

                    {isCompactHeader && (
                        <button
                          onClick={() => setShowHeaderDetails((value) => !value)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.78rem', cursor: 'pointer', marginTop: '0.35rem', textDecoration: 'underline' }}
                        >
                          {showHeaderDetails ? 'Hide Details ▲' : 'Details ▼'}
                        </button>
                    )}

                    {/* Collapsible Scoring Breakdown */}
                    {showExpandedHeaderDetails && scoringBreakdown && (
                        <button 
                          onClick={() => setShowBreakdown(!showBreakdown)} 
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '0.7rem', cursor: 'pointer', marginTop: '0.3rem', textDecoration: 'underline' }}
                        >
                          {showBreakdown ? 'Hide Details ▴' : 'Show Scoring Details ▾'}
                        </button>
                    )}

                    {showExpandedHeaderDetails && showBreakdown && scoringBreakdown && (
                        <div className="animate-fade-in" style={{ marginTop: '0.5rem', padding: '0.6rem', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', textAlign: 'left', fontSize: '0.75rem' }}>
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 1rem' }}>
                              <div>
                                 <span style={{ color: 'var(--muted)' }}>Overload:</span>{' '}
                                 <strong style={{ color: scoringBreakdown.overloadRatio >= 1 ? '#48bb78' : '#fc8181' }}>
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
                </div>

                {/* Intensity Slider */}
                <div style={{ display: showExpandedHeaderDetails ? 'block' : 'none', marginTop: '0.75rem', padding: '0.6rem 1rem', background: 'rgba(0,0,0,0.1)', borderRadius: '10px' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Workout Intensity</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: intensityInfo.color }}>
                         {intensityInfo.emoji} {intensityInfo.label} ({intensitySlider.toFixed(2)})
                      </span>
                   </div>
                   <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={intensitySlider}
                      onChange={(e) => handleIntensityChange(parseFloat(e.target.value))}
                      style={{
                         width: '100%',
                         height: '6px',
                         WebkitAppearance: 'none',
                         appearance: 'none' as any,
                         borderRadius: '3px',
                         outline: 'none',
                         cursor: 'pointer',
                         background: `linear-gradient(to right, #63b3ed 0%, #48bb78 40%, #ed8936 70%, #fc8181 100%)`,
                      }}
                   />
                   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                      <span>🧘 Recovery</span>
                      <span>⚖️ Standard</span>
                      <span>🔥 Push</span>
                   </div>
                </div>

                {showExpandedHeaderDetails && historicStats && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
                       <span style={{opacity: 0.7}}>Prev:</span> <strong style={{color:'var(--foreground)'}}>{historicStats.prevWeight} lbs × {historicStats.prevReps} ({historicStats.prevSets} sets)</strong> &nbsp;•&nbsp; 
                       <span style={{opacity: 0.7}}>1RM Est:</span> <strong style={{color:'var(--foreground)'}}>{historicStats.est1RM} lbs</strong>
                    </div>
                )}
                
                <div style={{ display: showExpandedHeaderDetails ? 'flex' : 'none', gap: '1rem', fontSize: '0.75rem', color: 'var(--muted)', justifyContent: 'center', marginTop: '1rem', background: 'rgba(0,0,0,0.1)', padding: '0.5rem', borderRadius: '8px', flexWrap: 'wrap' }}>
                    <span>Workout: {Math.floor(elapsedSecs / 60)}:{String(elapsedSecs % 60).padStart(2,'0')}</span>
                    <span>Lift: {Math.floor((liftElapsedSecsMap[activeLiftIndex] || 0) / 60)}:{String((liftElapsedSecsMap[activeLiftIndex] || 0) % 60).padStart(2,'0')}</span>
                    <span>Set: {Math.floor((setElapsedSecsMap[activeLiftIndex] || 0) / 60)}:{String((setElapsedSecsMap[activeLiftIndex] || 0) % 60).padStart(2,'0')}</span>
                </div>
            </div>

            <div className="workout-tile" style={{ background: 'rgba(0,0,0,0.1)' }}>
                {activeLogs.length > 0 ? (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                      {activeLogs.map((log: any, i: number) => (
                         <div key={i} className="workout-flex-between animate-fade-in" style={{ padding: '0.75rem', background: 'var(--surface-glass)', borderRadius: '8px' }}>
                            <strong style={{ color: 'var(--accent)' }}>Set {i+1}</strong>
                            <span>{log.weight} lbs × {log.reps}</span>
                            <button onClick={() => deleteSet(i)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '0 0.5rem' }}>✕</button>
                         </div>
                      ))}
                   </div>
                ) : <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>No sets logged yet.</p>}

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                       <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', textAlign: 'center', marginBottom: '0.25rem' }}>Weight (lbs)</label>
                       <div style={{ display: 'flex' }}>
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderRight: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '8px 0 0 8px' }} onClick={() => adjustWeight(-1)}>-</button>
                          <input className="hide-spinners" type="number" style={{ flex: 1, minWidth: '60px', textAlign: 'center', border: 'none', background: 'var(--input-bg)', color: 'var(--foreground)' }} value={currentWeight} onChange={e => setCurrentWeight(parseFloat(e.target.value) || 0)} readOnly />
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderLeft: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '0 8px 8px 0' }} onClick={() => adjustWeight(1)}>+</button>
                       </div>
                    </div>
                    <div style={{ flex: 1 }}>
                       <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', textAlign: 'center', marginBottom: '0.25rem' }}>Reps</label>
                       <div style={{ display: 'flex' }}>
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderRight: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '8px 0 0 8px' }} onClick={() => setCurrentReps(Math.max(1, currentReps - 1))}>-</button>
                          <input className="hide-spinners" type="number" style={{ flex: 1, minWidth: '60px', textAlign: 'center', border: 'none', background: 'var(--input-bg)', color: 'var(--foreground)' }} value={currentReps} onChange={e => setCurrentReps(parseFloat(e.target.value) || 0)} />
                          <button style={{ width: '36px', padding: '0.5rem', border: 'none', borderLeft: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', borderRadius: '0 8px 8px 0' }} onClick={() => setCurrentReps(currentReps + 1)}>+</button>
                       </div>
                    </div>
                </div>
                <button className="workout-btn-primary" onClick={handleCompleteSet} style={{ marginTop: '1.5rem', boxShadow: 'none' }}>Complete Set ✓</button>
            </div>

            {canDisplayPlates && requiredPlates.length > 0 && (
                <div className="animate-fade-in" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                   <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Plate Math Config</p>
                   {/* Vertical stacking to avoid rotation overlap */}
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                      <div style={{ width: '60px', height: '10px', background: 'var(--surface-border)', borderRadius: '4px', marginBottom: '8px' }}></div>
                      <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {requiredPlates.map((p, idx) => (
                           <div key={idx} style={{ 
                              width: (p >= 45 ? 60 : p >= 25 ? 45 : 30) + 'px', 
                              height: '14px', 
                              background: 'var(--accent)', 
                              borderRadius: '4px', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              color: 'var(--background)', 
                              fontSize: '0.65rem', 
                              fontWeight: 'bold',
                              border: '1px solid rgba(0,0,0,0.1)'
                           }}>
                              {p}
                           </div>
                        ))}
                      </div>
                   </div>
                </div>
            )}
         </div>

         <div style={{ display: 'flex', gap: '0.5rem', padding: '1rem', background: 'var(--surface-glass)', borderTop: '1px solid var(--surface-border)' }}>
             {activeLiftIndex > 0 && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '1rem', borderRadius: '12px' }} onClick={() => setActiveLiftIndex((prev: number) => prev - 1)}>Prev</button>
             )}
             {activeLiftIndex < localPlan.lifts.length - 1 ? (
                <button className="workout-btn-primary" style={{ flex: 1, margin: 0, padding: '1rem' }} onClick={() => setActiveLiftIndex((prev: number) => prev + 1)}>Next Lift →</button>
             ) : <button className="workout-btn-primary" style={{ flex: 1, margin: 0, padding: '1rem', background: '#48bb78', boxShadow: '0 4px 15px rgba(72,187,120,0.3)' }} onClick={() => setWorkoutFinished(true)}>Finish 🏆</button>}
         </div>

         {showList && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--background)', zIndex: 100, padding: '1.5rem', overflowY: 'auto' }} className="animate-fade-in">
               <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ margin: 0 }}>Workout Itinerary</h2>
                  <button style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.5rem' }} onClick={() => setShowList(false)}>✕</button>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {localPlan.lifts.map((l: any, i: number) => {
                     const isDone = logs[l.uniquePlanId] && logs[l.uniquePlanId].length >= localPlan.type.sets;
                     return (
                        <button key={i} className="btn btn-secondary" style={{ padding: '1rem', textAlign: 'left', border: i === activeLiftIndex ? '1px solid var(--accent)' : '1px solid var(--surface-border)', background: isDone ? 'rgba(72,187,120,0.1)' : 'var(--input-bg)' }} onClick={() => { setActiveLiftIndex(i); setShowList(false); }}>
                           <strong>{i + 1}. {l.name}</strong>
                           <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>{l.station?.name} • {logs[l.uniquePlanId]?.length || 0}/{localPlan.type.sets} Sets</p>
                        </button>
                     )
                  })}
               </div>
            </div>
         )}

         {showChange && (
             <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--background)', zIndex: 100, padding: '1.5rem', overflowY: 'auto' }} className="animate-fade-in">
               <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ margin: 0 }}>Swap Exercise</h2>
                  <button style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.5rem' }} onClick={() => setShowChange(false)}>✕</button>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {alternatives.map((l: any, i: number) => (
                      <button key={i} className="workout-flex-between" style={{ color: 'var(--foreground)', padding: '0.85rem 1rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }} onClick={() => swapLift(l)}>
                         <div>
                            <strong style={{ fontSize: '1rem' }}>{l.name}</strong>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
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
      </div>
   );
}
