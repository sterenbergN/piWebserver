'use client';

import { useState, useEffect } from 'react';
import { 
   LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
   BarChart, Bar
} from 'recharts';
import { calcAverage1RM, calcEpley, calcBrzycki, calcLombardi, calcWilks, calcBoerLBM, calcRelativeStrength, calculateExperienceScore } from '@/lib/workout/analytics';

// Intensity label helper
function getIntensityLabel(value: number): { label: string; emoji: string; color: string } {
    if (value <= 0.6) return { label: 'Recovery', emoji: '🧘', color: '#63b3ed' };
    if (value <= 0.8) return { label: 'Light', emoji: '🌿', color: '#68d391' };
    if (value <= 1.1) return { label: 'Standard', emoji: '⚖️', color: '#48bb78' };
    if (value <= 1.3) return { label: 'Push', emoji: '💪', color: '#ed8936' };
    return { label: 'Max Push', emoji: '🔥', color: '#fc8181' };
}

export default function AnalyticsPage() {
   const [history, setHistory] = useState<any[]>([]);
   const [user, setUser] = useState<any>(null);
   const [loading, setLoading] = useState(true);
   const [isDemo, setIsDemo] = useState(false);

   const [oneRMs, setOneRMs] = useState<any[]>([]);
   const [volumeTimeline, setVolumeTimeline] = useState<any[]>([]);
   const [volumeType, setVolumeType] = useState<any[]>([]);
   const [calorieTimeline, setCalorieTimeline] = useState<any[]>([]);
   const [overloadTracking, setOverloadTracking] = useState<any[]>([]);

   // Modals / Expanded states
   const [expand1RM, setExpand1RM] = useState(false);
   const [expandVolume, setExpandVolume] = useState(false);
   const [expandCalories, setExpandCalories] = useState(false);
   const [chartMode, setChartMode] = useState<'timeline' | 'type'>('timeline');

   const [expandedInfo, setExpandedInfo] = useState<string | null>(null);
   const [auditPage, setAuditPage] = useState(0);
   const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
   const [systemPopup, setSystemPopup] = useState<{title: string, message: string, onConfirm: () => void} | null>(null);
   
   // Advanced Analytics Extensions
   const [rmsPage, setRmsPage] = useState(0);
   const [expandedRM, setExpandedRM] = useState<string | null>(null);
   const [chartSeries, setChartSeries] = useState<'volume' | 'calories' | 'intensity'>('volume');
   const [allLiftsMap, setAllLiftsMap] = useState<Map<string, string>>(new Map());
   const [experience, setExperience] = useState<any>(null);

   // Intensity Factor Slider (persisted)
   const [intensityFactor, setIntensityFactor] = useState(1.0);
   const [intensitySaving, setIntensitySaving] = useState(false);
   const [intensitySaved, setIntensitySaved] = useState(false);

   useEffect(() => {
       async function fetchData() {
           const [authRes, histRes, gymsRes] = await Promise.all([
               fetch('/api/workout/auth').then(r => r.json()),
               fetch('/api/workout/history').then(r => r.json()),
               fetch('/api/workout/gyms').then(r => r.json())
           ]);
           
           let currentUser = null;
           let histData = [];

           const rawLifts: any[] = [];
           const liftsMap = new Map<string, string>();
           if (gymsRes.success) {
               gymsRes.gyms?.forEach((g:any) => g.stations?.forEach((s:any) => s.lifts?.forEach((l:any) => {
                   liftsMap.set(l.id, l.name);
                   rawLifts.push(l);
               })));
           }
           setAllLiftsMap(liftsMap);

           if (authRes.authenticated) {
               currentUser = authRes.user;
               histData = authRes.user.id ? histRes.history || [] : [];
               setIsDemo(false);
               setIntensityFactor(authRes.user.intensityFactor ?? 1.0);
           } else {
               // Demo mode mockup data
               setIsDemo(true);
               currentUser = { weight: 175, height: '70', gender: 'male', username: 'Guest Lifter' };
               histData = [
                  { 
                     id: 'demo1',
                     timestamp: new Date(Date.now() - 86400000*3).toISOString(), 
                     type: { name: 'Upper Power' },
                     calories: 450,
                     logs: {
                        'bench_press': [{ reps: 5, weight: 185 }, { reps: 5, weight: 185 }, { reps: 4, weight: 185 }],
                        'overhead_press': [{ reps: 8, weight: 115 }, { reps: 8, weight: 115 }]
                     }
                  },
                  { 
                     id: 'demo2',
                     timestamp: new Date(Date.now() - 86400000).toISOString(), 
                     type: { name: 'Lower Power' },
                     calories: 550,
                     logs: {
                        'squat': [{ reps: 5, weight: 225 }, { reps: 5, weight: 235 }, { reps: 5, weight: 245 }],
                        'deadlift': [{ reps: 3, weight: 315 }]
                     }
                  },
               ];
           }

           setUser(currentUser);
           setHistory(histData.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));

           const exp = calculateExperienceScore(currentUser || { weight: 150 }, histData, rawLifts);
           setExperience(exp);

           const rms = new Map();
           const raw1RMDetails = new Map();
           const typeVols = new Map(); // average volume per type
           const vols: any[] = [];
           const cals: any[] = [];

           histData.forEach((workout: any) => {
               const dateStr = new Date(workout.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
               
               cals.push({ date: dateStr, calories: workout.calories || 0 });

               if (workout.type?.name !== 'Cardio') {
                   let workoutVol = 0;
                   let workoutMaxRM = 0;
                   Object.keys(workout.logs).forEach(liftId => {
                       workout.logs[liftId].forEach((set: any) => {
                           const vol = set.reps * set.weight;
                           workoutVol += vol;
                           
                           const epley = calcEpley(set.weight, set.reps);
                           const brzycki = calcBrzycki(set.weight, set.reps);
                           const lombardi = calcLombardi(set.weight, set.reps);
                           const avg = (epley + brzycki + lombardi) / 3;

                           if (avg > workoutMaxRM) workoutMaxRM = avg;

                           const currentMax = rms.get(liftId) || 0;
                           if (avg > currentMax) {
                               rms.set(liftId, avg);
                               raw1RMDetails.set(liftId, { epley, brzycki, lombardi, avg });
                           }
                       });
                   });

                   vols.push({ 
                      date: dateStr, 
                      volume: workoutVol, 
                      intensity: Math.round(workoutMaxRM),
                      type: workout.type?.name || 'Generic' 
                   });
                   
                   const tName = workout.type?.name || 'Generic';
                   if (!typeVols.has(tName)) typeVols.set(tName, { sum: 0, count: 0 });
                   const tData = typeVols.get(tName);
                   typeVols.set(tName, { sum: tData.sum + workoutVol, count: tData.count + 1 });
               }
           });

           const mappedRms = Array.from(raw1RMDetails.entries()).map(([k, v]) => ({ name: liftsMap.get(k) || k, ...v }));
           mappedRms.sort((a,b) => b.avg - a.avg);
           
           setOneRMs(mappedRms);
           setVolumeTimeline(vols);
           setCalorieTimeline(cals);

           // Map type avg
           const mappedTypes = Array.from(typeVols.entries()).map(([k, v]) => ({ name: k, avgVolume: Math.round(v.sum / v.count) }));
           setVolumeType(mappedTypes);

           // Compute per-lift overload tracking across sessions
           const liftSessions = new Map<string, {weight: number, date: string}[]>();
           histData.forEach((w: any) => {
               if (w.type?.name !== 'Cardio' && w.logs) {
                   const dateStr = new Date(w.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                   Object.keys(w.logs).forEach(liftId => {
                       const topSet = w.logs[liftId].reduce((best: any, s: any) => (s.weight > (best?.weight || 0) ? s : best), null);
                       if (topSet) {
                           if (!liftSessions.has(liftId)) liftSessions.set(liftId, []);
                           liftSessions.get(liftId)!.push({ weight: topSet.weight, date: dateStr });
                       }
                   });
               }
           });
           const olTracking: any[] = [];
           liftSessions.forEach((sessions, liftId) => {
               if (sessions.length >= 2) {
                   const prev = sessions[sessions.length - 2];
                   const curr = sessions[sessions.length - 1];
                   const jumpRatio = prev.weight > 0 ? (curr.weight - prev.weight) / prev.weight : 0;
                   olTracking.push({
                       name: liftsMap.get(liftId) || liftId,
                       prevWeight: prev.weight,
                       currWeight: curr.weight,
                       jumpRatio,
                       date: curr.date
                   });
               }
           });
           setOverloadTracking(olTracking);

           setLoading(false);
       }
       fetchData();
   }, []);

   const handleDeleteLog = (id: string) => {
      setSystemPopup({ title: 'Delete Workout', message: 'Permanently delete this workout from your history?', onConfirm: async () => {
         const res = await fetch('/api/workout/history?id=' + id, { method: 'DELETE' });
         if ((await res.json()).success) {
            setHistory(history.filter(h => h.id !== id));
         }
         setSystemPopup(null);
      }});
   }

   const handleSaveIntensity = async () => {
      setIntensitySaving(true);
      setIntensitySaved(false);
      try {
         const res = await fetch('/api/workout/auth', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intensityFactor: intensityFactor })
         });
         if (res.ok) {
            setIntensitySaved(true);
            setTimeout(() => setIntensitySaved(false), 2500);
         }
      } catch { /* silent */ }
      setIntensitySaving(false);
   };

   const handleDownloadCsv = () => {
      window.location.href = '/api/workout/export';
   };

   if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Crunching numbers...</div>;

   let sbdTotal = 0;
   const bench = oneRMs.find(r => r.name.toLowerCase().includes('bench'))?.avg || 0;
   const squat = oneRMs.find(r => r.name.toLowerCase().includes('squat'))?.avg || 0;
   const deadlift = oneRMs.find(r => r.name.toLowerCase().includes('deadlift'))?.avg || 0;
   sbdTotal = bench + squat + deadlift;

   const missingWilks = [];
   if (!bench) missingWilks.push('Bench Press');
   if (!squat) missingWilks.push('Squat');
   if (!deadlift) missingWilks.push('Deadlift');

   let wilks = 0;
   if (missingWilks.length === 0 && user?.weight) {
      wilks = Math.round(calcWilks(sbdTotal, user.weight, user.gender));
   }

   let lbm = 0;
   if (user?.weight && user?.height) lbm = Math.round(calcBoerLBM(user.weight, parseInt(user.height), user.gender));

   const intensityInfo = getIntensityLabel(intensityFactor);

   // Compute average achieved growth for factor analysis
   const avgAchievedGrowth = overloadTracking.length > 0
      ? overloadTracking.reduce((sum, o) => sum + o.jumpRatio, 0) / overloadTracking.length
      : 0;

   return (
       <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
           <div className="workout-flex-between" style={{ marginBottom: '1.5rem', padding: '0 1rem' }}>
              <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Advanced Analytics</h1>
              <button className="btn btn-secondary" onClick={() => window.location.href = '/workout'} style={{ padding: '0.4rem 0.8rem' }}>Back</button>
           </div>

           <div style={{ padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* ═══ Training Intensity Profile ═══ */}
                <div className="workout-tile" style={{ borderLeft: `3px solid ${intensityInfo.color}` }}>
                   <div className="workout-flex-between" style={{ marginBottom: '0.75rem' }}>
                      <h3 style={{ margin: 0 }}>Training Intensity Profile</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                         {intensitySaved && (
                            <span className="animate-fade-in" style={{ fontSize: '0.75rem', color: '#48bb78', fontWeight: 600 }}>
                               ✓ Saved
                            </span>
                         )}
                         <button 
                            className="workout-btn-primary" 
                            style={{ width: 'auto', margin: 0, padding: '0.4rem 1rem', fontSize: '0.8rem', opacity: intensitySaving ? 0.5 : 1 }}
                            onClick={handleSaveIntensity}
                            disabled={intensitySaving}
                         >
                            {intensitySaving ? 'Saving...' : 'Save'}
                         </button>
                      </div>
                   </div>

                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Default Workout Intensity</span>
                      <span style={{ fontSize: '1.2rem', fontWeight: 700, color: intensityInfo.color }}>
                         {intensityInfo.emoji} {intensityInfo.label} ({intensityFactor.toFixed(2)})
                      </span>
                   </div>

                   <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={intensityFactor}
                      onChange={(e) => { setIntensityFactor(parseFloat(e.target.value)); setIntensitySaved(false); }}
                      style={{
                         width: '100%',
                         height: '8px',
                         WebkitAppearance: 'none',
                         appearance: 'none' as any,
                         borderRadius: '4px',
                         outline: 'none',
                         cursor: 'pointer',
                         background: `linear-gradient(to right, #63b3ed 0%, #48bb78 40%, #ed8936 70%, #fc8181 100%)`,
                      }}
                   />
                   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                      <span>🧘 Recovery (0.5)</span>
                      <span>⚖️ Standard (1.0)</span>
                      <span>🔥 Max Push (1.5)</span>
                   </div>

                   <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.75rem 0 0 0', lineHeight: 1.5 }}>
                      This sets the <strong style={{ color: 'var(--foreground)' }}>default intensity</strong> for the progression engine. 
                      You can override it per-workout using the slider in the active tracker.
                   </p>
                </div>

                {/* ═══ Progression Engine Scoring ═══ */}
                <div className="workout-tile" style={{ position: 'relative' }}>
                   <button className="btn btn-secondary" style={{ position:'absolute', top: '10px', right: '10px', padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setExpandedInfo(expandedInfo === 'scoring' ? null : 'scoring')}>
                     {expandedInfo === 'scoring' ? 'Hide ✕' : 'How It Works ⓘ'}
                   </button>

                   <h3 style={{ margin: '0 0 0.5rem 0' }}>Progression Engine</h3>
                   <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 0.75rem 0' }}>
                      Constraint-based candidate generation + scoring system
                   </p>

                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pipeline</div>
                         <div style={{ fontSize: '0.85rem', fontWeight: 700, marginTop: '0.15rem' }}>Generate → Filter → Score</div>
                      </div>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Intensity</div>
                         <div style={{ fontSize: '1rem', fontWeight: 700, color: intensityInfo.color, marginTop: '0.15rem' }}>{intensityFactor.toFixed(2)}</div>
                      </div>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Overload Target</div>
                         <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.15rem' }}>{(5 * intensityFactor).toFixed(1)}%</div>
                      </div>
                   </div>

                   {expandedInfo === 'scoring' && (
                      <div className="animate-fade-in" style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', fontSize: '0.82rem', lineHeight: 1.7 }}>
                         <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--accent)' }}>How the Progression Engine Works</h4>
                         
                         <p style={{ margin: '0 0 0.75rem 0' }}>
                            The system does <strong>NOT</strong> use fixed rules like "add 5 lbs". Instead, it generates many possible next workouts, 
                            filters out invalid ones, and scores each candidate to find the optimal progression.
                         </p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>1. Candidate Generation</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>Weight ±2 equipment steps, Reps ±2, Sets ±1 from your last session.</p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>2. Filtering</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>Rejects candidates that use invalid weights, exceed rep/set bounds, or violate time limits.</p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>3. Scoring Formulas</h5>
                         <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', margin: '0.3rem 0 0.5rem 0' }}>
                            <div>load = Σ(weight × reps) across sets</div>
                            <div>e1RM = weight × (1 + reps/30)  <span style={{ color: 'var(--muted)' }}>// Epley</span></div>
                            <div>overloadRatio = currentLoad / lastLoad</div>
                            <div>targetOverload = 0.05 × intensity × perfScore</div>
                         </div>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>4. Performance Score</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>
                            Normalized around <strong>1.0</strong>. Factors: completion ratio (actual vs planned reps), 
                            intensity deviation (actual vs planned weight), fatigue slope (rep drop across sets), 
                            weight drops, and extra sets.
                         </p>
                         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.3rem', fontSize: '0.75rem', textAlign: 'center' }}>
                            <div style={{ background: 'rgba(72,187,120,0.15)', padding: '0.3rem', borderRadius: '4px', color: '#48bb78' }}>&gt; 1.05 = Too Easy</div>
                            <div style={{ background: 'rgba(236,201,75,0.15)', padding: '0.3rem', borderRadius: '4px', color: '#ecc94b' }}>0.95–1.05 = Right</div>
                            <div style={{ background: 'rgba(252,129,129,0.15)', padding: '0.3rem', borderRadius: '4px', color: '#fc8181' }}>&lt; 0.95 = Too Hard</div>
                         </div>

                         <h5 style={{ margin: '0.75rem 0 0.3rem 0', color: 'var(--foreground)' }}>5. Intensity Factor Effect</h5>
                         <p style={{ margin: '0' }}>
                            <strong>High (≥1.2):</strong> Favors weight increases, allows rep drops, amplifies overload target.<br/>
                            <strong>Low (≤0.8):</strong> Favors volume (reps/sets), penalizes weight jumps, conservative progression.<br/>
                            <strong>Adaptive:</strong> Effective intensity = userIntensity × clamp(perfScore, 0.9, 1.1) × historyTrend
                         </p>
                      </div>
                   )}
                </div>

                {/* ═══ Formula Breakdown Summary ═══ */}
                <div className="workout-tile">
                   <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0 }}>1RM Formula Comparison</h3>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Global Avg</div>
                   </div>
                   {(() => {
                      const eSum = (oneRMs || []).reduce((s:number, r:any) => s + (r.epley||0), 0) / (oneRMs.length || 1);
                      const bSum = (oneRMs || []).reduce((s:number, r:any) => s + (r.brzycki||0), 0) / (oneRMs.length || 1);
                      const lSum = (oneRMs || []).reduce((s:number, r:any) => s + (r.lombardi||0), 0) / (oneRMs.length || 1);
                      return (
                         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                            <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Epley</div>
                               <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Math.round(eSum)}</div>
                               <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>w×(1+r/30)</div>
                            </div>
                            <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Brzycki</div>
                               <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Math.round(bSum)}</div>
                               <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>w×36/(37-r)</div>
                            </div>
                            <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Lombardi</div>
                               <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Math.round(lSum)}</div>
                               <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>w×r^0.10</div>
                            </div>
                         </div>
                      );
                   })()}
                </div>

               {/* ═══ Ranking Tile ═══ */}
               {experience && (
               <div className="workout-tile" style={{ textAlign: 'center', background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.1) 0%, rgba(0,0,0,0.2) 100%)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem', textAlign: 'left' }}>
                     <h3 style={{ margin: 0, lineHeight: 1.2, flex: '1 1 160px' }}>Lifter Experience</h3>
                     <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem', flexShrink: 0 }} onClick={() => setExpandedInfo(expandedInfo === 'rank' ? null : 'rank')}>
                    {expandedInfo === 'rank' ? 'Hide Breakdown ✕' : 'Score Breakdown ⓘ'}
                     </button>
                  </div>

                  <div style={{ fontSize: '3rem', margin: '1rem 0' }}>{experience.symbol} {experience.level}</div>
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>Experience Score (E): <strong>{experience.score.toFixed(2)}</strong></p>

                  {expandedInfo === 'rank' && (
                     <div className="animate-fade-in" style={{ marginTop: '1rem', background: 'var(--background)', padding: '1rem', borderRadius: '8px', textAlign: 'left', fontSize: '0.85rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent)' }}>Score Computation Breakdown</h4>
                        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>E = (0.2 × Time) + (0.3 × Consistency) + (0.3 × Strength) + (0.2 × Progression)</p>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Time (T) Weight 20%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.time.toFixed(2)}</div>
                           </div>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Consistency (C) Weight 30%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.consistency.toFixed(2)}</div>
                           </div>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Strength (S) Weight 30%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.strength.toFixed(2)}</div>
                           </div>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Progression (P) Weight 20%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.progression.toFixed(2)}</div>
                           </div>
                        </div>

                        <ul style={{ margin: '1rem 0 0 1rem', padding: 0, fontSize: '0.8rem' }}>
                           <li>⚪ Beginner: &lt; 2</li>
                           <li>🟢 Novice: 2 - 4</li>
                           <li>🔵 Intermediate: 4 - 6</li>
                           <li>🟣 Advanced: 6 - 8</li>
                           <li>🟡 Elite: 8+</li>
                        </ul>
                     </div>
                  )}
               </div>
               )}

               {/* ═══ 1RM Extrapolation ═══ */}
               <div className="workout-tile" style={{ position: 'relative' }}>
                  <h3 style={{ margin: '0 0 1rem 0' }}>Top 1RM Extrapolations</h3>
                  
                  {oneRMs.length > 0 ? (
                      <div>
                         <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {oneRMs.slice(rmsPage * 5, (rmsPage + 1) * 5).map((rm, i) => (
                               <div key={i} style={{ background: 'var(--input-bg)', borderRadius: '12px', overflow: 'hidden' }}>
                                  <div 
                                    className="workout-flex-between" 
                                    style={{ padding: '0.75rem 1rem', cursor: 'pointer' }}
                                    onClick={() => setExpandedRM(expandedRM === rm.name ? null : rm.name)}
                                  >
                                     <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ width: '30px', height: '30px', background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--background)' }}>
                                           {rmsPage * 5 + i + 1}
                                        </div>
                                        <strong style={{ fontSize: '0.9rem' }}>{rm.name}</strong>
                                     </div>
                                     <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>{Math.round(rm.avg)} <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 400 }}>lbs</span></div>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '-2px' }}>Avg 1RM ▾</div>
                                     </div>
                                  </div>
                                  
                                  {expandedRM === rm.name && (
                                     <div className="animate-fade-in" style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--surface-border)', background: 'rgba(255,255,255,0.02)' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', textAlign: 'center' }}>
                                           <div><div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Epley</div><div style={{ fontWeight: 600 }}>{Math.round(rm.epley)}</div></div>
                                           <div><div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Brzycki</div><div style={{ fontWeight: 600 }}>{Math.round(rm.brzycki)}</div></div>
                                           <div><div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Lombardi</div><div style={{ fontWeight: 600 }}>{Math.round(rm.lombardi)}</div></div>
                                        </div>
                                     </div>
                                  )}
                               </div>
                            ))}
                         </div>
                         
                         {oneRMs.length > 5 && (
                            <div className="workout-flex-between" style={{ marginTop: '1rem' }}>
                               <button 
                                 className="btn btn-secondary" 
                                 disabled={rmsPage === 0}
                                 onClick={() => setRmsPage(p => p - 1)}
                                 style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', opacity: rmsPage === 0 ? 0.3 : 1 }}
                               >
                                 ← Prev
                               </button>
                               <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Page {rmsPage + 1} of {Math.ceil(oneRMs.length / 5)}</span>
                               <button 
                                 className="btn btn-secondary" 
                                 disabled={(rmsPage + 1) * 5 >= oneRMs.length}
                                 onClick={() => setRmsPage(p => p + 1)}
                                 style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', opacity: (rmsPage + 1) * 5 >= oneRMs.length ? 0.3 : 1 }}
                               >
                                 Next →
                               </button>
                            </div>
                         )}
                      </div>
                   ) : <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No lifting history available yet.</p>}

                  {/* Powerlifting Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                      <div className="workout-tile" style={{ textAlign: 'center', position: 'relative' }}>
                          <button className="btn btn-secondary" style={{ position:'absolute', top: '10px', right: '10px', padding: '0.2rem', borderRadius: '8px', fontSize: '0.7rem' }} onClick={() => setExpandedInfo(expandedInfo === 'wilks' ? null : 'wilks')}>ⓘ</button>
                          <h4 style={{ margin: '0 0 0.5rem 0' }}>Wilks Score</h4>
                          {wilks > 0 ? (
                              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{wilks}</div>
                          ) : (
                              <div style={{ fontSize: '0.75rem', color: '#ff6b6b' }}>
                                  Missing minimum requirements:<br/>
                                  {missingWilks.map(m => <span key={m}>• {m}<br/></span>)}
                                  {!user?.weight && <span>• Bodyweight Setup</span>}
                              </div>
                          )}
                          {expandedInfo === 'wilks' && (
                              <div className="animate-fade-in" style={{ marginTop: '1rem', background: 'var(--input-bg)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.75rem', textAlign: 'left' }}>
                                  Wilks measures strength relative to bodyweight across S/B/D. It utilizes a 5th order polynomial adjusted exclusively for Men/Women.
                              </div>
                          )}
                      </div>
                      
                      <div className="workout-tile" style={{ textAlign: 'center', position: 'relative' }}>
                           <button className="btn btn-secondary" style={{ position:'absolute', top: '10px', right: '10px', padding: '0.2rem', borderRadius: '8px', fontSize: '0.7rem' }} onClick={() => setExpandedInfo(expandedInfo === 'lbm' ? null : 'lbm')}>ⓘ</button>
                          <h4 style={{ margin: '0 0 0.5rem 0' }}>Lean Mass</h4>
                          {lbm > 0 ? (
                              <><div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{lbm}</div><span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>lbs</span></>
                          ) : (
                              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Requires Height and Weight configured.</p>
                          )}
                          {expandedInfo === 'lbm' && (
                              <div className="animate-fade-in" style={{ marginTop: '1rem', background: 'var(--input-bg)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.75rem', textAlign: 'left' }}>
                                  Lean Body Mass (LBM) excludes fat weight. <br/>M: (0.407 * W) + (0.267 * H) - 19.2<br/>F: (0.252 * W) + (0.473 * H) - 48.3
                              </div>
                          )}
                      </div>
                  </div>
               </div>

               {/* ═══ Performance Timeline ═══ */}
               <div className="workout-tile">
                    <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                       <h3 style={{ margin: 0 }}>Performance Over Time</h3>
                       <select 
                         className="workout-input" 
                         style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.8rem', margin: 0 }}
                         value={chartSeries}
                         onChange={e => setChartSeries(e.target.value as any)}
                       >
                          <option value="volume">Volume (lbs)</option>
                          <option value="intensity">Intensity (1RM-lbs)</option>
                          <option value="calories">Calories (kcal)</option>
                       </select>
                    </div>

                    <div style={{ width: '100%', height: expandVolume ? '300px' : '150px', transition: 'height 0.3s' }} onClick={() => setExpandVolume(!expandVolume)}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartSeries === 'volume' ? volumeTimeline : chartSeries === 'intensity' ? volumeTimeline : calorieTimeline}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} />
                            <YAxis stroke="var(--muted)" fontSize={10} />
                            <Tooltip contentStyle={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '8px' }} />
                            <Line 
                              type="monotone" 
                              dataKey={chartSeries === 'volume' ? 'volume' : chartSeries === 'intensity' ? 'intensity' : 'calories'} 
                              stroke={chartSeries === 'volume' ? 'var(--accent)' : chartSeries === 'intensity' ? '#4fd1c5' : '#ffb347'} 
                              strokeWidth={3} 
                              dot={{ r: 4, fill: chartSeries === 'volume' ? 'var(--accent)' : chartSeries === 'intensity' ? '#4fd1c5' : '#ffb347' }} 
                            />
                          </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

               {/* ═══ Progressive Overload Factor Tile ═══ */}
               <div className="workout-tile" style={{ position: 'relative' }}>
                  <button className="btn btn-secondary" style={{ position:'absolute', top: '10px', right: '10px', padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setExpandedInfo(expandedInfo === 'overload' ? null : 'overload')}>
                    {expandedInfo === 'overload' ? 'Hide ✕' : 'About ⓘ'}
                  </button>

                  <h3 style={{ margin: '0 0 1rem 0' }}>Progressive Overload Tracking</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 1rem 0' }}>
                     Intensity Factor: <strong style={{ color: intensityInfo.color }}>{intensityInfo.emoji} {intensityFactor.toFixed(2)}</strong>
                     <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>({intensityInfo.label})</span>
                  </p>

                  {expandedInfo === 'overload' && (
                     <div className="animate-fade-in" style={{ marginBottom: '1rem', background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent)' }}>How Progressive Overload Works</h4>
                        <p>Your intensity factor of <strong>{intensityFactor.toFixed(2)}</strong> controls how the progression engine selects your next workout:</p>
                        <ul style={{ margin: '0.5rem 0', paddingLeft: '1.2rem', lineHeight: 1.8 }}>
                           <li><strong>Target Overload:</strong> <code style={{ color: 'var(--accent-light)' }}>target = 0.05 × intensity × perfScore</code></li>
                           <li><strong>Allowed Jump:</strong> <code style={{ color: 'var(--accent-light)' }}>maxJump = weight × 0.15 × (0.75 + intensity)</code></li>
                           <li><strong>Scoring:</strong> Candidates closest to the target overload ratio score highest</li>
                           <li><strong>Adaptive:</strong> History trend amplifies or dampens effective intensity</li>
                        </ul>
                        <p>Jump Ratio below shows the actual % weight change achieved session-over-session. 
                        Green = met/exceeded expectations, yellow = partial progress, red = decreased.</p>
                     </div>
                  )}

                  {overloadTracking.length > 0 ? (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid var(--accent)' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Factor Analysis</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.2rem' }}>
                               <div>
                                  <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                                    {(avgAchievedGrowth * 100).toFixed(1)}%
                                  </div>
                                  <div style={{ fontSize: '0.75rem' }}>Avg Achieved Growth</div>
                               </div>
                               <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.2rem', fontWeight: 600, color: intensityInfo.color }}>
                                    {(5 * intensityFactor).toFixed(1)}%
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Target Overload</div>
                               </div>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.5rem 0 0 0', fontStyle: 'italic' }}>
                               {avgAchievedGrowth > (0.05 * intensityFactor)
                                 ? 'You are outperforming your target. Consider increasing intensity if workouts feel too easy.'
                                 : avgAchievedGrowth > 0
                                   ? 'Progression is steady but below target. This is normal — trust the process.'
                                   : 'Growth is stalling. Consider a deload cycle or reducing intensity.'}
                            </p>
                        </div>
                        {overloadTracking.map((ol, i) => {
                           const targetGrowth = 0.05 * intensityFactor;
                           const status = ol.jumpRatio >= targetGrowth ? '🟢' : ol.jumpRatio > 0 ? '🟡' : '🔴';
                           return (
                              <div key={i} style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                 <div>
                                    <strong style={{ fontSize: '0.85rem' }}>{ol.name}</strong>
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>{ol.prevWeight} → {ol.currWeight} lbs</p>
                                 </div>
                                 <div style={{ textAlign: 'right' }}>
                                    <span style={{ fontSize: '1rem' }}>{status}</span>
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>{(ol.jumpRatio * 100).toFixed(1)}%</p>
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  ) : (
                     <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Need at least 2 sessions per lift to track overload.</p>
                  )}
               </div>

               {/* ═══ Raw History Audit Log ═══ */}
               <div className="workout-tile">
                  <h3 style={{ margin: '0 0 1rem 0' }}>Raw Audit Log</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {history.slice().reverse().slice(auditPage * 5, (auditPage + 1) * 5).map((h, i) => (
                         <div key={h.id} style={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '8px' }}>
                             <div className="workout-flex-between" style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => setExpandedAudit(expandedAudit === h.id ? null : h.id)}>
                                <div>
                                   <strong style={{ fontSize: '0.9rem' }}>{h.type?.name || 'Workout'}</strong>
                                   <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>{new Date(h.timestamp).toLocaleDateString()} • {h.calories} kcal</p>
                                </div>
                                <span style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>{expandedAudit === h.id ? '▴' : '▾'}</span>
                             </div>
                             
                             {expandedAudit === h.id && (
                                <div className="animate-fade-in" style={{ padding: '0.75rem', borderTop: '1px solid var(--surface-border)', background: 'var(--input-bg)', borderRadius: '0 0 8px 8px' }}>
                                   {h.logs && Object.keys(h.logs).length > 0 ? (
                                     <>
                                       {/* Per-workout summary */}
                                       {(() => {
                                          let totalW = 0, totalR = 0, totalSets = 0, totalVol = 0;
                                          Object.values(h.logs).forEach((sets: any) => sets.forEach((s: any) => { totalW += s.weight; totalR += s.reps; totalSets++; totalVol += s.weight * s.reps; }));
                                          return (
                                             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.7rem', textAlign: 'center' }}>
                                                <div style={{ background: 'var(--background)', padding: '0.4rem', borderRadius: '6px' }}><div style={{ fontWeight: 700 }}>{totalSets > 0 ? Math.round(totalW / totalSets) : 0}</div>Avg Weight</div>
                                                <div style={{ background: 'var(--background)', padding: '0.4rem', borderRadius: '6px' }}><div style={{ fontWeight: 700 }}>{totalSets > 0 ? (totalR / totalSets).toFixed(1) : 0}</div>Avg Reps</div>
                                                <div style={{ background: 'var(--background)', padding: '0.4rem', borderRadius: '6px' }}><div style={{ fontWeight: 700 }}>{totalVol.toLocaleString()}</div>Total Vol</div>
                                             </div>
                                          );
                                       })()}
                                       {Object.keys(h.logs).map(liftId => {
                                           const sets = h.logs[liftId];
                                           const liftName = allLiftsMap.get(liftId) || liftId;
                                           const topSet = sets.reduce((best: any, s: any) => (s.weight > (best?.weight || 0) ? s : best), null);
                                           const top1RM = topSet ? Math.round(calcAverage1RM(topSet.weight, topSet.reps)) : 0;
                                           return (
                                              <div key={liftId} style={{ marginBottom: '0.75rem' }}>
                                                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>{liftName}</strong>
                                                    {top1RM > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Est. 1RM: {top1RM}</span>}
                                                 </div>
                                                 <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                                                    {sets.length} sets • {sets.reduce((sum: number, s: any) => sum + (s.weight * s.reps), 0)} lbs volume
                                                    {sets.map((s:any, idx:number) => <div key={idx} style={{ paddingLeft: '0.5rem' }}>{idx+1}. {s.weight} lbs × {s.reps}</div>)}
                                                 </div>
                                              </div>
                                           );
                                       })}
                                     </>
                                   ) : <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>No detailed set logs.</p>}
                                   
                                   <button onClick={() => handleDeleteLog(h.id)} style={{ border: 'none', background: 'none', color: '#ff6b6b', fontSize: '0.8rem', marginTop: '0.5rem' }}>✕ Delete Workout</button>
                                </div>
                             )}
                         </div>
                      ))}
                      {history.length > 5 && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={auditPage === 0} onClick={() => setAuditPage(prev => Math.max(0, prev - 1))}>Prev</button>
                              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={(auditPage + 1) * 5 >= history.length} onClick={() => setAuditPage(prev => prev + 1)}>Next</button>
                          </div>
                      )}
                      {history.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No workouts tracked yet.</p>}
                  </div>
               </div>

               {!isDemo && (
                  <div className="workout-tile" style={{ textAlign: 'center' }}>
                     <h3 style={{ margin: '0 0 0.5rem 0' }}>Export User Data</h3>
                     <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 1rem 0' }}>
                        Download a CSV with one row per logged set plus placeholder rows for workouts without set data.
                     </p>
                     <button className="workout-btn-primary" style={{ marginTop: 0 }} onClick={handleDownloadCsv}>
                        Download CSV
                     </button>
                  </div>
               )}
           </div>

           {systemPopup && (
               <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="workout-tile animate-fade-in" style={{ width: '90%', maxWidth: '400px' }}>
                      <h3 style={{ margin: '0 0 1rem 0' }}>{systemPopup.title}</h3>
                      <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>{systemPopup.message}</p>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                         <button className="workout-btn-primary" style={{ margin: 0, flex: 1, background: '#ff6b6b' }} onClick={systemPopup.onConfirm}>Confirm</button>
                         <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSystemPopup(null)}>Cancel</button>
                      </div>
                  </div>
               </div>
           )}
       </div>
   );
}
