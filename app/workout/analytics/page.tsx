'use client';

import { useEffect, useMemo, useState } from 'react';
import './analytics.css';
import { calculateExperienceScore } from '@/lib/workout/analytics';
import { buildAnalyticsData } from '@/lib/workout/analytics-data';
import { normalizeLiftKey } from '@/lib/workout/calibration-utils';
import { exerciseName, exerciseKeyFromName } from '@/lib/workout/exercises';
import { reviewProgress } from '@/lib/workout/progression';
import { detectStalledLifts } from '@/lib/workout/session-insights';
import { fetchWorkoutJson } from '@/lib/workout/offline-cache';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import type { Goal } from '@/lib/workout/goals';
import {
  buildInsights, exerciseStats, muscleBalance, muscleSetsPerWeek, periodSummary, PERIODS, recentPRs,
  type Period, type ScaleFor, type Workout,
} from '@/lib/workout/insights';
import { useSitePopup } from '@/components/SitePopup';
import { DEMO_GYMS, DEMO_HISTORY, DEMO_USER } from '@/lib/workout/demo-data';
import SummaryTab from './SummaryTab';
import LiftsTab from './LiftsTab';
import MusclesTab from './MusclesTab';
import HistoryTab from './HistoryTab';
import HowItWorksSheet from './HowItWorksSheet';

type Tab = 'summary' | 'lifts' | 'muscles' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'lifts', label: 'Lifts' },
  { key: 'muscles', label: 'Muscles' },
  { key: 'history', label: 'History' },
];

/**
 * Workout analytics: how training is going over a chosen period (vs the one
 * before), each exercise's strength trend and records, sets per muscle and
 * balance, and the full history. All numbers come from lib/workout/insights.ts.
 */
export default function AnalyticsPage() {
  const { confirm, popup } = useSitePopup();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [lifts, setLifts] = useState<any[]>([]);
  const [gymNames, setGymNames] = useState<Map<string, string>>(new Map());
  const [calibrations, setCalibrations] = useState<any[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tab, setTab] = useState<Tab>('summary');
  const [period, setPeriod] = useState<Period>('12w');
  const [openLift, setOpenLift] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);

  // Remember the chosen tab and period on this device; ?tab= deep-links.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantedTab = params.get('tab') || readPref('workout:analyticsTab');
    if (TABS.some((t) => t.key === wantedTab)) setTab(wantedTab as Tab);
    const savedPeriod = readPref('workout:analyticsPeriod');
    if (PERIODS.some((p) => p.key === savedPeriod)) setPeriod(savedPeriod as Period);
  }, []);
  const chooseTab = (next: Tab) => { setTab(next); savePref('workout:analyticsTab', next); window.scrollTo({ top: 0 }); };
  const choosePeriod = (next: Period) => { setPeriod(next); savePref('workout:analyticsPeriod', next); };

  useEffect(() => {
    (async () => {
      const [auth, hist, gyms, calib, goalsRes] = await Promise.all([
        fetchWorkoutJson('/api/workout/auth'),
        fetchWorkoutJson('/api/workout/history'),
        fetchWorkoutJson('/api/workout/gyms'),
        fetchWorkoutJson('/api/workout/calibration'),
        fetchWorkoutJson('/api/workout/goals'),
      ]);
      if ([auth, hist, gyms].some((r) => r.offline)) setOffline(true);
      const gymList: any[] = auth.data?.authenticated ? gyms.data?.gyms || [] : DEMO_GYMS;
      const liftList = gymList.flatMap((g) => (g.stations || []).flatMap((s: any) => (s.lifts || []).map((l: any) => ({ ...l, stationType: s.type }))));
      setLifts(liftList);
      setGymNames(new Map(gymList.map((g) => [g.id, g.name])));
      if (auth.data?.authenticated) {
        setUser(auth.data.user);
        setHistory(hist.data?.history || []);
        setCalibrations(calib.data?.calibrations || []);
        setGoals(goalsRes.data?.goals || []);
      } else {
        setIsDemo(true);
        setUser(DEMO_USER);
        setHistory(DEMO_HISTORY as unknown as Workout[]);
      }
      setLoading(false);
    })();
  }, []);

  // Machines at different gyms read differently; calibration puts them on one scale.
  const scaleFor: ScaleFor = useMemo(() => {
    const map = new Map(calibrations.map((c) => [`${c.gymId}|${c.liftKey}`, c.scaleFactor || 1]));
    const stationType = new Map(lifts.map((l) => [l.id, l.stationType]));
    return (workout, liftId) => {
      const meta = workout.liftMeta?.[liftId];
      const type = meta?.stationType || stationType.get(liftId);
      if (!workout.gymId || (type !== 'stack' && type !== 'cable')) return 1;
      return map.get(`${workout.gymId}|${normalizeLiftKey(exerciseName(meta) || '')}`) || 1;
    };
  }, [calibrations, lifts]);

  const liftLookup = useMemo(() => Object.fromEntries(lifts.map((l) => [l.id, l])), [lifts]);
  const periodLabel = PERIODS.find((p) => p.key === period)!.label;
  const data = useMemo(() => {
    const summary = periodSummary(history, period);
    const stats = exerciseStats(history, period, { scaleFor, lifts: liftLookup });
    const muscles = muscleSetsPerWeek(history, period, { lifts: liftLookup });
    const balance = muscleBalance(muscles);
    const stalled = detectStalledLifts(history as any);
    const last = history.length ? Math.max(...history.map((w) => new Date(w.timestamp).getTime())) : null;
    const insights = buildInsights({
      summary, stats, muscles, balance, stalled,
      weeklySetGoal: user?.weeklySetTarget ?? 10,
      daysSinceLast: last === null ? null : Math.floor((Date.now() - last) / 86_400_000),
      periodLabel,
    });
    return { summary, stats, muscles, balance, insights, prs: recentPRs(stats, period, history) };
  }, [history, period, scaleFor, liftLookup, user?.weeklySetTarget, periodLabel]);

  // Engine view (fatigue, recovery, "vs plan" per lift) from the shared analytics builder.
  const engine = useMemo(() => buildAnalyticsData(history as any, lifts, calibrations), [history, lifts, calibrations]);
  const reviewFor = (name: string) => {
    const entry = engine.overloadTracking.find((o) => exerciseKeyFromName(o.name) === exerciseKeyFromName(name));
    return entry ? reviewProgress(entry.sessions, { intensity: user?.intensityFactor ?? 1, typeIntensity: entry.typeIntensity, profile: entry.profile }) : undefined;
  };
  const experience = useMemo(() => calculateExperienceScore(user || { weight: 150 }, history, lifts), [user, history, lifts]);

  const deleteWorkout = async (id: string) => {
    const ok = await confirm({ title: 'Delete workout', message: 'Permanently delete this workout from your history?', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await fetch(`/api/workout/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if ((await res.json().catch(() => ({}))).success) setHistory((prev) => prev.filter((w) => w.id !== id));
  };

  if (loading) return <div className="an-loading">Crunching numbers…</div>;

  return (
    <div className="animate-fade-in an-page">
      <header className="an-header">
        <a href="/workout" className="workout-text-btn">← Workout</a>
        <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
          <h1>Analytics</h1>
          <button type="button" className="workout-button is-small" onClick={() => setShowHow(true)}>ⓘ How it works</button>
        </div>
        {isDemo && <p className="workout-hint" style={{ margin: 0 }}>Sample data — log in to see your own.</p>}
        {offline && <p className="workout-offline-note" style={{ margin: 0 }}>📡 Offline — showing data saved on this phone.</p>}
      </header>

      <div className="an-sticky">
        <nav className="an-tabs" aria-label="Analytics sections">
          {TABS.map((t) => (
            <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => chooseTab(t.key)}>{t.label}</button>
          ))}
        </nav>
        {tab !== 'history' && (
          <div className="an-periods" role="radiogroup" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" role="radio" aria-checked={period === p.key} onClick={() => choosePeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        )}
      </div>

      {history.length === 0 ? (
        <div className="workout-tile an-empty">
          <strong>No workouts yet</strong>
          <p className="workout-hint">Log a workout and your trends, records and muscle balance show up here.</p>
          <a className="workout-button is-primary" href="/workout">Start a workout</a>
        </div>
      ) : (<>
        {tab === 'summary' && (
          <SummaryTab
            history={history}
            period={period}
            periodLabel={periodLabel}
            summary={data.summary}
            insights={data.insights}
            prs={data.prs}
            goals={goals}
            onOpenLift={(key) => { setOpenLift(key); chooseTab('lifts'); }}
          />
        )}
        {tab === 'lifts' && (
          <LiftsTab
            stats={data.stats}
            periodLabel={periodLabel}
            goals={goals}
            history={history}
            bodyweight={user?.weight}
            openKey={openLift}
            onOpen={setOpenLift}
            reviewFor={reviewFor}
          />
        )}
        {tab === 'muscles' && (
          <MusclesTab
            muscles={data.muscles}
            balance={data.balance}
            weeklySetGoal={user?.weeklySetTarget ?? 10}
            periodLabel={periodLabel}
            fatigue={engine.fatigue}
            recovery={engine.recovery}
          />
        )}
        {tab === 'history' && (
          <HistoryTab history={history} lifts={liftLookup} gymNames={gymNames} canDelete={!isDemo} onDelete={deleteWorkout} />
        )}
      </>)}

      {showHow && (
        <HowItWorksSheet
          user={user}
          isDemo={isDemo}
          experience={experience}
          calibrations={calibrations}
          gymNames={gymNames}
          onClose={() => setShowHow(false)}
          onIntensitySaved={(intensityFactor) => setUser((prev: any) => ({ ...prev, intensityFactor }))}
        />
      )}
      {popup}
    </div>
  );
}
