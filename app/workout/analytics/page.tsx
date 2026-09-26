'use client';

import { useState, useEffect } from 'react';
import { calcWilks, calcBoerLBM, calculateExperienceScore } from '@/lib/workout/analytics';
import { blendProgressRatio, computeTargetOverload, getStrengthWeight } from '@/lib/workout/progression';
import { normalizeLiftKey } from '@/lib/workout/calibration-utils';
import { buildAnalyticsData } from '@/lib/workout/analytics-data';
import { getIntensityLabel } from '@/lib/workout/intensity';
import { useSitePopup } from '@/components/SitePopup';
import { DEMO_GYMS, DEMO_HISTORY, DEMO_USER } from '@/lib/workout/demo-data';
import OverviewTab from './OverviewTab';
import StrengthTab from './StrengthTab';
import VolumeTab from './VolumeTab';
import FatigueTab from './FatigueTab';
import HistoryTab from './HistoryTab';






export default function AnalyticsPage() {
   const [history, setHistory] = useState<any[]>([]);
   const [user, setUser] = useState<any>(null);
   const [loading, setLoading] = useState(true);
   const [isDemo, setIsDemo] = useState(false);

   const [oneRMs, setOneRMs] = useState<any[]>([]);
   const [volumeTimeline, setVolumeTimeline] = useState<any[]>([]);
   const [calorieTimeline, setCalorieTimeline] = useState<any[]>([]);
   const [overloadTracking, setOverloadTracking] = useState<any[]>([]);
   const [calibrations, setCalibrations] = useState<any[]>([]);

   // Modals / Expanded states

   const { confirm, popup } = useSitePopup();
   
   // Advanced Analytics Extensions
   const [allLiftsMap, setAllLiftsMap] = useState<Map<string, string>>(new Map());
   const [liftStationTypeMap, setLiftStationTypeMap] = useState<Map<string, string>>(new Map());
   const [gymNameMap, setGymNameMap] = useState<Map<string, string>>(new Map());
   const [experience, setExperience] = useState<any>(null);

   type AnalyticsTab = 'overview' | 'strength' | 'volume' | 'fatigue' | 'history';
   const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
   const [muscleFatigue, setMuscleFatigue] = useState<any[]>([]);
   const [muscleVolumeData, setMuscleVolumeData] = useState<any[]>([]);
   const [trainingHeatmap, setTrainingHeatmap] = useState<Map<string, { setCount: number; lifts: string[] }>>(new Map());
   const [prTimeline, setPrTimeline] = useState<any[]>([]);
   const [recoveryData, setRecoveryData] = useState<any[]>([]);

   // Link Lift Modal (Phase 7)


   // Intensity Factor Slider (persisted)
   const [intensityFactor, setIntensityFactor] = useState(1.0);
   const [intensitySaving, setIntensitySaving] = useState(false);
   const [intensitySaved, setIntensitySaved] = useState(false);

   useEffect(() => {
       async function fetchData() {
            const safeJson = (url: string) => fetch(url).then(r => r.json()).catch(() => ({ success: false }));
            const [authRes, histRes, gymsRes, calibRes] = await Promise.all([
                safeJson('/api/workout/auth'),
                safeJson('/api/workout/history'),
                safeJson('/api/workout/gyms'),
                fetch('/api/workout/calibration').then(r => r.json()).catch(() => ({ success: false }))
            ]);
           
           let currentUser = null;
           let histData = [];

            const rawLifts: any[] = [];
            const liftsMap = new Map<string, string>();
            const stationTypeMap = new Map<string, string>();
            if (gymsRes.success) {
                const gymMap = new Map<string, string>();
                gymsRes.gyms?.forEach((g:any) => g.stations?.forEach((s:any) => s.lifts?.forEach((l:any) => {
                    liftsMap.set(l.id, l.name);
                    stationTypeMap.set(l.id, s.type);
                    rawLifts.push(l);
                })));
                gymsRes.gyms?.forEach((g: any) => {
                   if (g?.id) gymMap.set(g.id, g.name);
                });
                setGymNameMap(gymMap);
            }
            setAllLiftsMap(liftsMap);
            setLiftStationTypeMap(stationTypeMap);

            if (authRes.authenticated) {
                currentUser = authRes.user;
                histData = authRes.user.id ? histRes.history || [] : [];
                setIsDemo(false);
                setIntensityFactor(authRes.user.intensityFactor ?? 1.0);
                if (calibRes?.success) setCalibrations(calibRes.calibrations || []);
            } else {
               // Sample mode: same demo data as the rest of the workout pages
               setIsDemo(true);
               currentUser = DEMO_USER;
               histData = [...DEMO_HISTORY];
               DEMO_GYMS.forEach((g: any) => g.stations?.forEach((st: any) => st.lifts?.forEach((l: any) => {
                  liftsMap.set(l.id, l.name);
                  stationTypeMap.set(l.id, st.type);
                  rawLifts.push(l);
               })));
               setAllLiftsMap(liftsMap);
               setLiftStationTypeMap(stationTypeMap);
           }

           setUser(currentUser);
           setHistory(histData.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));

           const exp = calculateExperienceScore(currentUser || { weight: 150 }, histData, rawLifts);
           setExperience(exp);

            const fetchedCalibrations: any[] = authRes.authenticated && calibRes?.success ? calibRes.calibrations || [] : [];
            const liftInfos = rawLifts.map((lift: any) => ({ ...lift, stationType: stationTypeMap.get(lift.id) }));
            const data = buildAnalyticsData(histData, liftInfos, fetchedCalibrations);
            setOneRMs(data.oneRMs);
            setVolumeTimeline(data.volumeTimeline);
            setCalorieTimeline(data.calorieTimeline);
            setOverloadTracking(data.overloadTracking);
            setMuscleVolumeData(data.muscleVolume);
            setTrainingHeatmap(data.trainingDays);
            setPrTimeline(data.prTimeline);
            setRecoveryData(data.recovery);
            setMuscleFatigue(data.fatigue);

           setLoading(false);
       }
       fetchData();
   }, []);

   const handleDeleteLog = async (id: string) => {
      const ok = await confirm({ title: 'Delete Workout', message: 'Permanently delete this workout from your history?', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      const res = await fetch('/api/workout/history?id=' + encodeURIComponent(id), { method: 'DELETE' });
      if ((await res.json().catch(() => ({}))).success) {
         setHistory((prev) => prev.filter(h => h.id !== id));
      }
   };

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

   // Compare achieved progress with what the progression engine targets, using
   // the engine's own formulas so this view can't drift from its behavior.
   const strengthWeight = getStrengthWeight(intensityFactor);
   const achievedRatio = (o: any) => blendProgressRatio(o.intensityRatio, o.overloadRatio, strengthWeight);
   const targetRatioFor = (o: any) => 1 + computeTargetOverload(intensityFactor, o.performanceScore, o.historyTrend);
   const avgAchievedGrowth = overloadTracking.length > 0
      ? overloadTracking.reduce((sum, o) => sum + (achievedRatio(o) - 1), 0) / overloadTracking.length
      : 0;
   const avgTargetGrowth = overloadTracking.length > 0
      ? overloadTracking.reduce((sum, o) => sum + (targetRatioFor(o) - 1), 0) / overloadTracking.length
      : computeTargetOverload(intensityFactor, 1, 1);
   const calibrationMap = new Map<string, number>();
   calibrations.forEach((c) => {
      calibrationMap.set(`${c.gymId}|${c.liftKey}`, c.scaleFactor || 1);
   });
   const getScaleFactorForLiftDisplay = (workout: any, liftId: string) => {
      const meta = workout.liftMeta?.[liftId];
      const liftName = meta?.name || allLiftsMap.get(liftId) || liftId;
      const liftKey = normalizeLiftKey(liftName);
      const stationType = meta?.stationType || liftStationTypeMap.get(liftId);
      if (!workout.gymId || !liftKey || (stationType !== 'stack' && stationType !== 'cable')) return 1;
      return calibrationMap.get(`${workout.gymId}|${liftKey}`) || 1;
   };

   const calibrationByLift = calibrations.reduce((acc: Record<string, any[]>, entry: any) => {
      const key = entry.liftKey || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
   }, {});
   Object.keys(calibrationByLift).forEach((key) => {
      calibrationByLift[key].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
   });

   return (
       <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
           <div className="workout-flex-between" style={{ marginBottom: '1.5rem', padding: '0 1rem' }}>
              <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Advanced Analytics</h1>
              <button className="btn btn-secondary" onClick={() => window.location.href = '/workout'} style={{ padding: '0.4rem 0.8rem' }}>Back</button>
           </div>

           <div style={{ padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              <div className="workout-tile" style={{ padding: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem', position: 'sticky', top: 0, zIndex: 20, marginBottom: '0.5rem' }}>
                {(['overview', 'strength', 'volume', 'fatigue', 'history'] as const).map(tab => (
                  <button
                    key={tab}
                    className="btn btn-secondary"
                    style={{
                      flex: '1 1 auto', padding: '0.55rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem',
                      textTransform: 'capitalize', whiteSpace: 'nowrap', minWidth: '3.5rem',
                      borderColor: activeTab === tab ? 'var(--accent)' : 'var(--surface-border)',
                      color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
                      background: activeTab === tab ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
                    }}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'overview' ? '📊 Overview' :
                     tab === 'strength' ? '💪 Strength' :
                     tab === 'volume' ? '📈 Volume' :
                     tab === 'fatigue' ? '🔋 Fatigue' : '📋 History'}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && <OverviewTab experience={experience} handleSaveIntensity={handleSaveIntensity} intensityFactor={intensityFactor} intensityInfo={intensityInfo} intensitySaved={intensitySaved} intensitySaving={intensitySaving} setIntensityFactor={setIntensityFactor} setIntensitySaved={setIntensitySaved} />}

              {activeTab === 'strength' && <StrengthTab experience={experience} history={history} lbm={lbm} missingWilks={missingWilks} oneRMs={oneRMs} prTimeline={prTimeline} user={user} wilks={wilks} />}


              {activeTab === 'volume' && <VolumeTab calorieTimeline={calorieTimeline} muscleVolumeData={muscleVolumeData} trainingHeatmap={trainingHeatmap} volumeTimeline={volumeTimeline} />}

              {activeTab === 'fatigue' && <FatigueTab achievedRatio={achievedRatio} avgAchievedGrowth={avgAchievedGrowth} avgTargetGrowth={avgTargetGrowth} intensityFactor={intensityFactor} intensityInfo={intensityInfo} muscleFatigue={muscleFatigue} overloadTracking={overloadTracking} recoveryData={recoveryData} strengthWeight={strengthWeight} targetRatioFor={targetRatioFor} />}

              {activeTab === 'history' && <HistoryTab allLiftsMap={allLiftsMap} calibrationByLift={calibrationByLift} calibrations={calibrations} getScaleFactorForLiftDisplay={getScaleFactorForLiftDisplay} gymNameMap={gymNameMap} handleDeleteLog={handleDeleteLog} history={history} />}

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

           {popup}
       </div>
   );
}
