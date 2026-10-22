'use client';

import { useState, useEffect } from 'react';
import { DEMO_GYMS, DEMO_HISTORY, DEMO_TYPES, DEMO_USER, DEMO_USER_ID } from '@/lib/workout/demo-data';
import { detectStalledLifts, formatRelativeDay, muscleSetCounts, startOfCurrentWeek, trainingStreak, workoutVolume } from '@/lib/workout/session-insights';
import { flushChangeQueue, flushWorkoutQueue, getQueuedChanges, getQueuedWorkouts } from '@/lib/workout/offline-queue';

// Interfaces for user representation
interface UserData {
  id: string;
  username: string;
  birthdate?: string;
  height?: string;
  gender?: string;
  weight?: number;
  intensityFactor?: number;
  weeklySetTarget?: number;
}

import { calculateExperienceScore, computeMuscleFatigue, type ExperienceResult } from '@/lib/workout/analytics';
import ExperienceLevels from '@/components/workout/ExperienceLevels';
import { newRecordId } from '@/lib/workout/stations';
import { getIntensityLabel } from '@/lib/workout/intensity';
import IntensitySlider from '@/components/workout/IntensitySlider';
import BodyweightCard from '@/components/workout/BodyweightCard';
import GoalsCard from '@/components/workout/GoalsCard';
import DeloadSuggestion from '@/components/workout/DeloadSuggestion';
import { clearWorkoutCache, fetchWorkoutJson } from '@/lib/workout/offline-cache';
import { suggestDeload } from '@/lib/workout/deload';
import { recoveryDeloadReason } from '@/lib/workout/health-coach';
import type { PublicHealth } from '@/lib/workout/health';
import CoachHomeCard from '@/components/workout/CoachHomeCard';
import { nextProgramDay, programDeloadDue, type Program } from '@/lib/workout/programs';
import { exerciseLibrary } from '@/lib/workout/exercises';
import { readPref, readTodayIntensity, savePref, saveTodayIntensity } from '@/lib/workout/device-prefs';
import HealthHomeCard from '@/components/workout/health/HealthHomeCard';
import type { Goal } from '@/lib/workout/goals';
import { useSitePopup } from '@/components/SitePopup';

/** "Not today" on a deload suggestion hides it for this long. */
const DELOAD_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/** The last gym / workout type / lift count you started with, so the form opens on them. */
const LAST_START_KEY = 'workout:lastStart';
type LastStart = { gym?: string; type?: string; lifts?: string };

function readLastStart(): LastStart {
  try { return JSON.parse(localStorage.getItem(LAST_START_KEY) || '{}') || {}; } catch { return {}; }
}
function rememberStart(start: LastStart) {
  try { localStorage.setItem(LAST_START_KEY, JSON.stringify(start)); } catch { /* just not remembered */ }
}

// A paused workout stays resumable for this long after its last update.
const PENDING_WORKOUT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readPendingWorkout(ownerId: string) {
  try {
    const stored = localStorage.getItem('pendingWorkout');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (Date.now() - (parsed.timestamp || 0) >= PENDING_WORKOUT_MAX_AGE_MS) {
      localStorage.removeItem('pendingWorkout');
      return null;
    }
    return (parsed.ownerId || DEMO_USER_ID) === ownerId ? parsed : null;
  } catch {
    localStorage.removeItem('pendingWorkout');
    return null;
  }
}


export default function WorkoutDashboard() {
  const { confirm, popup } = useSitePopup();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // Dashboard Aggregates
  const [rankSymbol, setRankSymbol] = useState('⚪');
  const [rankName, setRankName] = useState('Beginner');
  const [rankScore, setRankScore] = useState(0);
  const [rankBreakdown, setRankBreakdown] = useState<ExperienceResult['breakdown'] | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [liftLookup, setLiftLookup] = useState<Record<string, { primaryMuscle?: string; secondaryMuscle?: string }>>({});
  const [syncMessage, setSyncMessage] = useState('');

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  // Analytics Expansion
  const [expandAnalytics, setExpandAnalytics] = useState(false);

  // Start Lift Expansion State
  const [showStartMenu, setShowStartMenu] = useState(false);
  const [availableGyms, setAvailableGyms] = useState<any[]>([]);
  const [availableTypes, setAvailableTypes] = useState<any[]>([]);
  const [selectedGym, setSelectedGym] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [liftCount, setLiftCount] = useState('5');
  // "➕ New gym…" in the gym picker: name it here, optionally copy another gym's equipment.
  const [newGymName, setNewGymName] = useState('');
  const [newGymCopyFrom, setNewGymCopyFrom] = useState('');
  const [startingFreestyle, setStartingFreestyle] = useState(false);
  const [startError, setStartError] = useState('');
  const [isDeload, setIsDeload] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [offline, setOffline] = useState(false);
  // Signed in as the site admin (not a workout user): show the link to manage workout accounts.
  const [isSiteAdmin, setIsSiteAdmin] = useState(false);
  useEffect(() => {
    fetch('/api/auth').then((r) => r.json()).then((d) => setIsSiteAdmin(d.isAdmin === true)).catch(() => {});
  }, []);
  // A lower intensity picked for today only (from the readiness card).
  const [todayIntensity, setTodayIntensity] = useState<number | null>(null);
  useEffect(() => { setTodayIntensity(readTodayIntensity()); }, []);
  const chooseTodayIntensity = (value: number | null) => { saveTodayIntensity(value); setTodayIntensity(value); };
  const startIntensity = todayIntensity ?? user?.intensityFactor ?? 1.0;
  // Synced Apple Health days (from the health card), for a recovery-based deload reason.
  const [homeHealth, setHomeHealth] = useState<PublicHealth | null>(null);
  const healthDays = homeHealth?.days || null;
  const [deloadSnoozedUntil, setDeloadSnoozedUntil] = useState(0);
  const [showJoinShared, setShowJoinShared] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  // Profile Menu State
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editWeight, setEditWeight] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editGender, setEditGender] = useState('unspecified');
  const [editIntensityFactor, setEditIntensityFactor] = useState(1.0);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Pending workout resume state
  const [pendingWorkout, setPendingWorkout] = useState<{plan?: any, logs?: any, timestamp?: number, startTime?: number, activeLiftIndex?: number, ownerId?: string} | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('showLogin') === '1') setShowLogin(true);
    // Partner invite link: /workout?join=ABC opens the join box with the code filled in.
    const join = (params.get('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (join) {
      setJoinCode(join);
      setShowStartMenu(true);
      setShowJoinShared(true);
    }
    setDeloadSnoozedUntil(Number(readPref('workout:deloadSnoozedUntil')) || 0);
  }, []);

  useEffect(() => {
    const enterDemoMode = () => {
      setIsDemo(true);
      setUser({ ...DEMO_USER, height: String(DEMO_USER.height) });
      setAvailableGyms(DEMO_GYMS);
      setAvailableTypes(DEMO_TYPES);
      setPendingWorkout(readPendingWorkout(DEMO_USER.id));
      setHistory(DEMO_HISTORY);
    };

    async function load() {
      try {
        // Offline-first: every read falls back to the copy saved on this phone.
        const auth = await fetchWorkoutJson('/api/workout/auth');
        const data = auth.data;
        if (auth.offline) setOffline(true);
        if (!data?.authenticated || !data.user) {
          enterDemoMode();
          return;
        }

        setUser(data.user);
        setIsDemo(false);
        setPendingWorkout(readPendingWorkout(data.user.id));

        // Populate profile editor fields
        setEditWeight(data.user.weight?.toString() || '');
        setEditHeight(data.user.height?.toString() || '');
        setEditGender(data.user.gender || 'unspecified');
        setEditIntensityFactor(data.user.intensityFactor ?? 1.0);

        const results = await Promise.all([
          fetchWorkoutJson('/api/workout/gyms'),
          fetchWorkoutJson('/api/workout/types?scope=mine'),
          fetchWorkoutJson('/api/workout/history'),
          fetchWorkoutJson('/api/workout/programs'),
          fetchWorkoutJson('/api/workout/goals'),
        ]);
        if (results.some((r) => r.offline)) setOffline(true);
        const [gymsRes, typesRes, historyRes, programsRes, goalsRes] = results.map((r) => r.data);
        if (programsRes?.success) setPrograms(programsRes.programs || []);
        if (goalsRes?.success) setGoals(goalsRes.goals || []);

        const userGyms: any[] = gymsRes?.success ? gymsRes.gyms : [];
        setAvailableGyms(userGyms);
        if (typesRes?.success) setAvailableTypes(typesRes.types || []);
        const userTypes: any[] = typesRes?.success ? typesRes.types || [] : [];
        const last = readLastStart();
        if (last.gym && userGyms.some((g) => g.id === last.gym)) setSelectedGym(last.gym);
        else if (userGyms.length === 1) setSelectedGym(userGyms[0].id);
        if (last.type && userTypes.some((t) => t.id === last.type)) setSelectedType(last.type);
        else if (userTypes.length === 1) setSelectedType(userTypes[0].id);
        if (last.lifts) setLiftCount(last.lifts);

        if (historyRes?.success) {
          const history: any[] = historyRes.history || [];
          setHistory(history);

          const allLifts: any[] = [];
          userGyms.forEach((g: any) => g.stations?.forEach((s: any) => {
            if (s.lifts) allLifts.push(...s.lifts);
          }));
          setLiftLookup(Object.fromEntries(allLifts.map((lift) => [lift.id, lift])));

          if (data.user.weight) {
            const exp = calculateExperienceScore(data.user, history, allLifts);
            setRankSymbol(exp.symbol);
            setRankName(exp.level);
            setRankScore(exp.score);
            setRankBreakdown(exp.breakdown);
          }
        }
      } catch {
        enterDemoMode();
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Upload workouts that were saved offline, now and whenever we reconnect.
  const syncQueuedWorkouts = async (ownerId: string) => {
    // Edits and deletes made offline in History go up too.
    if (getQueuedChanges(ownerId).length > 0) await flushChangeQueue(ownerId);
    if (getQueuedWorkouts(ownerId).length === 0) {
      setQueuedCount(0);
      return;
    }
    const result = await flushWorkoutQueue(ownerId);
    setQueuedCount(result.remaining);
    if (result.synced > 0) {
      setSyncMessage(`Synced ${result.synced} offline workout${result.synced === 1 ? '' : 's'}.`);
      const historyRes = await fetch('/api/workout/history').then((r) => r.json()).catch(() => null);
      if (historyRes?.success) setHistory(historyRes.history || []);
    }
  };

  useEffect(() => {
    if (!user || isDemo) return;
    syncQueuedWorkouts(user.id);
    const onOnline = () => syncQueuedWorkouts(user.id);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.id, isDemo]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/workout/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      
      if (data.success) {
        window.location.reload(); // Reloads to hydrate authenticated state proper
      } else {
        setLoginError(data.message || 'Login failed');
      }
    } catch {
      setLoginError('Network Error');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/workout/auth', { method: 'DELETE' });
    clearWorkoutCache();
    window.location.reload();
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setProfileSaving(true);
    setProfileError('');
    try {
      const res = await fetch('/api/workout/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: parseFloat(editWeight) || 0,
          height: editHeight === '' ? '' : parseFloat(editHeight) || 0,
          gender: editGender,
          intensityFactor: editIntensityFactor
        })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        setEditIntensityFactor(data.user.intensityFactor ?? 1.0);
        setShowProfileEditor(false);
        setShowProfileMenu(false);
      } else {
        setProfileError(data.message || 'Could not save profile.');
      }
    } catch {
      setProfileError('Network error — profile not saved.');
    }
    setProfileSaving(false);
  };

  const handleJoinSharedWorkout = async () => {
    const normalized = joinCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      setJoinError('Enter a valid 3-letter code.');
      return;
    }
    if (isDemo) {
      setJoinError('Shared mode requires login.');
      return;
    }

    setJoinLoading(true);
    setJoinError('');
    try {
      const response = await fetch('/api/workout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: normalized }),
      });
      const data = await response.json();
      if (!data.success || !data.sessionId) {
        setJoinError(data.message || 'Unable to join shared workout.');
        return;
      }
      window.location.href = `/workout/active?sharedSessionId=${encodeURIComponent(data.sessionId)}&sharedMode=join`;
    } catch {
      setJoinError('Network error while joining shared workout.');
    } finally {
      setJoinLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '4rem' }}>Loading Workout Dashboard...</div>;
  }

  if (showLogin) {
    return (
      <div className="workout-tile animate-fade-in" style={{ marginTop: '20vh' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Login to Workout</h2>
        <form onSubmit={handleLogin}>
          <label htmlFor="workout-login-username" className="sr-only">Username</label>
          <input 
            id="workout-login-username"
            name="username"
            type="text" 
            autoComplete="username"
            className="workout-input" 
            placeholder="Username" 
            value={loginUsername} 
            onChange={e => setLoginUsername(e.target.value)} 
          />
          <label htmlFor="workout-login-password" className="sr-only">Password</label>
          <input 
            id="workout-login-password"
            name="password"
            type="password" 
            autoComplete="current-password"
            className="workout-input" 
            placeholder="Password" 
            value={loginPassword} 
            onChange={e => setLoginPassword(e.target.value)} 
          />
          {loginError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>{loginError}</p>}
          <button type="submit" className="workout-btn-primary">Enter</button>
        </form>
        <button 
          className="btn btn-secondary" 
          style={{ width: '100%', marginTop: '1rem', borderRadius: '12px' }}
          onClick={() => setShowLogin(false)}
        >
          Back to Demo
        </button>
      </div>
    );
  }

  // Formatting date for header
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const streak = trainingStreak(history);
  const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
  const levelIndex = Math.min(LEVELS.length - 1, Math.floor(Math.max(0, rankScore) / 2));
  const levelProgress = levelIndex >= LEVELS.length - 1
    ? { percent: 100, next: null as string | null, remaining: 0 }
    : { percent: Math.round(((rankScore - levelIndex * 2) / 2) * 100), next: LEVELS[levelIndex + 1], remaining: (levelIndex + 1) * 2 - rankScore };
  // Weekly working sets per muscle vs. the user's goal. Muscles trained in the
  // last four weeks are listed even at zero so gaps are visible.
  const weeklySetTarget = user?.weeklySetTarget ?? 10;
  const weekSets = muscleSetCounts(history, liftLookup, startOfCurrentWeek());
  const recentMuscles = Object.keys(muscleSetCounts(history, liftLookup, new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)));
  const volumeRows = Array.from(new Set([...recentMuscles, ...Object.keys(weekSets)]))
    .map((muscle) => ({ muscle, sets: weekSets[muscle] || 0 }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
  const updateWeeklyTarget = async (next: number) => {
    const target = Math.min(30, Math.max(2, next));
    setUser((prev) => (prev ? { ...prev, weeklySetTarget: target } : prev));
    if (isDemo) return;
    await fetch('/api/workout/auth', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeklySetTarget: target }),
    }).catch(() => {});
  };

  const stalledLifts = detectStalledLifts(history).slice(0, 4);

  const recentWorkouts = [...history]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 3);
  // Workouts already finished today (oldest first): acknowledged above the start button, which still starts another.
  const doneToday = history
    .filter((w) => new Date(w.timestamp).toDateString() === now.toDateString())
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const trainedToday = doneToday.length > 0 && !pendingWorkout;
  const canRepeat = (workout: any) => availableGyms.some((g) => g.id === workout.gymId) && Object.keys(workout.logs || {}).length > 0;
  /** Start the same lifts, in the same order, as a past workout. */
  const repeatWorkout = (workout: any) => {
    const params = new URLSearchParams({
      gym: workout.gymId,
      repeat: workout.id,
      intensity: String(isDeload ? 0.5 : startIntensity),
      isDemo: String(isDemo),
    });
    if (isDeload) params.set('deload', '1');
    if (availableTypes.some((t) => t.id === workout.type?.id)) params.set('type', workout.type.id);
    window.location.href = `/workout/active?${params.toString()}`;
  };

  /** Next day of a program, at its usual gym (else the gym you used last). */
  const startProgram = (program: Program) => {
    const gym = program.gymId && availableGyms.some((g) => g.id === program.gymId) ? program.gymId : selectedGym && selectedGym !== '__new__' ? selectedGym : '';
    if (!gym) {
      setShowStartMenu(true);
      setStartError(`Pick a gym first, then start ${program.name} again.`);
      return;
    }
    const params = new URLSearchParams({ program: program.id, gym, intensity: String(isDeload ? 0.5 : startIntensity) });
    if (isDeload) params.set('deload', '1');
    window.location.href = `/workout/active?${params.toString()}`;
  };

  // Deload: only ever suggested, with reasons; the user picks it for a workout or snoozes it.
  const allLifts = availableGyms.flatMap((g: any) => (g.stations || []).flatMap((s: any) => s.lifts || []));
  const trainingDeload = isDemo || Date.now() < deloadSnoozedUntil ? null
    : suggestDeload(history, allLifts, { programDue: programs.some((p) => programDeloadDue(p, history)) });
  // A week of raised resting heart rate / lowered HRV is a reason too.
  const recoveryReason = isDemo || Date.now() < deloadSnoozedUntil || !healthDays ? null : recoveryDeloadReason(healthDays);
  const deloadSuggestion = trainingDeload || recoveryReason
    ? { reasons: [...(trainingDeload?.reasons || []), ...(recoveryReason ? [recoveryReason] : [])] }
    : null;
  const snoozeDeload = () => {
    const until = Date.now() + DELOAD_SNOOZE_MS;
    setDeloadSnoozedUntil(until);
    savePref('workout:deloadSnoozedUntil', String(until));
    setIsDeload(false);
  };
  const exercises = exerciseLibrary(availableGyms);
  const saveGoal = async (goal: Partial<Goal>) => {
    const res = await fetch('/api/workout/goals', { method: goal.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goal) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not save the goal.');
    setGoals((prev) => (goal.id ? prev.map((g) => (g.id === data.goal.id ? data.goal : g)) : [...prev, data.goal]));
  };
  const deleteGoal = async (goal: Goal) => {
    await fetch(`/api/workout/goals?id=${encodeURIComponent(goal.id)}`, { method: 'DELETE' });
    setGoals((prev) => prev.filter((g) => g.id !== goal.id));
  };
  // One-tap starts: your latest workout of each kind (type + gym), newest first.
  const quickStarts = [...history]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .filter(canRepeat)
    .filter((w, i, all) => all.findIndex((o) => (o.type?.name || o.name) === (w.type?.name || w.name) && o.gymId === w.gymId) === i)
    .slice(0, 3);

  return (
    <div className="animate-fade-in">
      {isDemo && <div className="demo-banner">SAMPLE MODE - PROGRESS WILL NOT BE SAVED</div>}
      {offline && !isDemo && <p className="workout-offline-note" style={{ margin: '0 0 1rem' }}>📡 Offline — showing data saved on this phone. You can still start and log a workout.</p>}

      <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0, lineHeight: 1.2 }}>Hi, {user?.username}</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>{dateStr} &bull; {timeStr}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-secondary" style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => {
            if (isDemo) setShowLogin(true);
            else { setShowProfileMenu(!showProfileMenu); setShowProfileEditor(false); }
          }}>
            👤
          </button>
          
          {showProfileMenu && !isDemo && (
             <div className="animate-fade-in" style={{ 
                position: 'absolute', top: '50px', right: 0, 
                background: 'var(--background)', 
                border: '1px solid var(--surface-border)', 
                borderRadius: showProfileEditor ? '12px 12px 0 0' : '12px', 
                padding: '0.5rem', width: '220px', zIndex: 50, 
                display: 'flex', flexDirection: 'column', gap: '0.5rem', 
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)' 
             }}>
                <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left', background: 'var(--background)', border: 'none', padding: '0.5rem' }} onClick={() => setShowProfileEditor(!showProfileEditor)}>✏️ Edit Profile</button>
                <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left', background: 'var(--background)', border: 'none', padding: '0.5rem', color: 'var(--danger)' }} onClick={handleLogout}>🚪 Logout</button>
             </div>
          )}

          {showProfileMenu && showProfileEditor && !isDemo && (
             <div className="animate-fade-in" style={{ 
                position: 'absolute', top: '138px', right: 0, 
                background: 'var(--background)', 
                border: '1px solid var(--surface-border)', 
                borderTop: 'none', borderRadius: '0 0 12px 12px', 
                padding: '0.75rem', width: '220px', zIndex: 50, 
                boxShadow: '0 8px 20px rgba(0,0,0,0.4)' 
             }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Weight (lbs)</label>
                <input className="workout-input" type="number" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', color: 'var(--foreground)' }} value={editWeight} onChange={e => setEditWeight(e.target.value)} />

                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Height (inches)</label>
                <input className="workout-input" type="number" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', color: 'var(--foreground)' }} value={editHeight} onChange={e => setEditHeight(e.target.value)} />

                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Gender</label>
                <select className="workout-input" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', color: 'var(--foreground)' }} value={editGender} onChange={e => setEditGender(e.target.value)}>
                   <option value="unspecified">Unspecified</option>
                   <option value="male">Male</option>
                   <option value="female">Female</option>
                </select>

                <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--input-bg)', border: '1px solid var(--surface-border)', borderRadius: '10px' }}>
                   <IntensitySlider title="Default Intensity" value={editIntensityFactor} onChange={setEditIntensityFactor} />
                </div>

                <button className="workout-btn-primary" style={{ padding: '0.75rem', fontSize: '0.9rem', marginTop: '0.5rem', borderRadius: '8px' }} onClick={handleSaveProfile} disabled={profileSaving}>
                   {profileSaving ? 'Saving...' : 'Save Profile Changes'}
                </button>
                {profileError && <p className="workout-error">{profileError}</p>}
             </div>
          )}
        </div>
      </div>

      {!isDemo && user && (
        <HealthHomeCard defaultIntensity={user.intensityFactor ?? 1.0} todayIntensity={todayIntensity} onUseIntensity={chooseTodayIntensity} onLoaded={setHomeHealth} />
      )}
      {!isDemo && user && <CoachHomeCard history={history} health={homeHealth} user={user} />}

      <div className="workout-tile" style={{ cursor: 'pointer', transition: 'all 0.3s ease', marginTop: '1rem' }} onClick={() => setExpandAnalytics(!expandAnalytics)}>
        <div className="workout-flex-between">
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Experience Profile</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
             <span className="experience-badge" title={`Experience score ${rankScore.toFixed(2)}`}>{rankSymbol} {rankName}</span>
             <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{expandAnalytics ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Progress toward the next experience level (levels every 2 points) */}
        <div style={{ marginTop: '0.75rem', height: '4px', background: 'var(--surface-border)', borderRadius: '2px', overflow: 'hidden' }}>
           <div style={{ width: `${levelProgress.percent}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        {levelProgress.next && (
          <p className="workout-hint" style={{ margin: '0.35rem 0 0' }}>Score {rankScore.toFixed(1)} · {levelProgress.remaining.toFixed(1)} to {levelProgress.next}</p>
        )}
        {!expandAnalytics && <p className="workout-hint" style={{ margin: '0.35rem 0 0' }}>Tap to see what each level means for your training</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', marginTop: '1rem' }}>
          {[
            { value: streak.workoutsThisWeek, label: 'This week' },
            { value: streak.weekStreak, label: 'Week streak' },
            { value: streak.daysSinceLast === null ? '—' : streak.daysSinceLast === 0 ? 'Today' : `${streak.daysSinceLast}d`, label: 'Since last' },
          ].map((stat) => (
            <div key={stat.label} style={{ background: 'var(--background)', padding: '0.85rem 0.5rem', borderRadius: '12px', textAlign: 'center' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0 0 0.2rem 0', color: 'var(--foreground)' }}>{stat.value}</p>
              <p style={{ color: 'var(--muted)', fontSize: '0.68rem', margin: 0, textTransform: 'uppercase' }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {expandAnalytics && (
           <div className="animate-fade-in" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--surface-border)' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Recent Performance Breakdown</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                 <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Est. Strength Rank</label>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{rankName}</div>
                 </div>
                 <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Default Intensity</label>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: getIntensityLabel(user?.intensityFactor || 1.0).color }}>
                      {getIntensityLabel(user?.intensityFactor || 1.0).emoji} {getIntensityLabel(user?.intensityFactor || 1.0).label}
                    </div>
                 </div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <ExperienceLevels current={rankName as ExperienceResult['level']} score={rankScore} breakdown={rankBreakdown} />
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', marginTop: '1rem', fontSize: '0.8rem', borderRadius: '8px' }}
                onClick={(e) => { e.stopPropagation(); window.location.href = '/workout/analytics'; }}
              >
                View Deep Dive Charts ↗
              </button>
           </div>
        )}
      </div>

      {(queuedCount > 0 || syncMessage) && (
        <div className="workout-tile animate-fade-in" style={{ borderLeft: `3px solid ${queuedCount > 0 ? 'var(--warning)' : 'var(--success)'}`, padding: '0.9rem 1rem' }}>
          {queuedCount > 0 ? (
            <div className="workout-flex-between" style={{ gap: '0.75rem' }}>
              <span style={{ fontSize: '0.9rem' }}>📶 {queuedCount} workout{queuedCount === 1 ? '' : 's'} saved offline — waiting to sync.</span>
              <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', flexShrink: 0 }} onClick={() => user && syncQueuedWorkouts(user.id)}>Retry</button>
            </div>
          ) : (
            <span style={{ fontSize: '0.9rem' }}>✅ {syncMessage}</span>
          )}
        </div>
      )}

      {pendingWorkout && (() => {
          const age = Date.now() - (pendingWorkout.timestamp || 0);
          const minsAgo = Math.round(age / 60000);
          const workoutName = pendingWorkout.plan?.name || 'Workout';
          const totalSets = pendingWorkout.logs ? Object.values(pendingWorkout.logs).reduce((sum: number, sets: any) => sum + (sets?.length || 0), 0) : 0;
          return (
             <div className="workout-tile animate-fade-in" style={{ 
                borderLeft: '3px solid var(--accent-light)',
                borderRadius: 0,
                background: 'rgba(var(--accent-rgb), 0.08)',
                marginBottom: '0.5rem'
             }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                   <span style={{ fontSize: '1.5rem' }}>⚡</span>
                   <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>Workout In Progress</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                         {workoutName} • {minsAgo}m ago • {totalSets} sets logged
                      </div>
                   </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                   <button 
                     className="workout-btn-primary" 
                     style={{ flex: 2, margin: 0, padding: '0.85rem' }}
                     onClick={() => window.location.href = '/workout/active?resume=true'}
                   >
                     Resume
                   </button>
                   <button 
                     className="btn btn-secondary" 
                     style={{ flex: 1, padding: '0.85rem', borderRadius: '12px', color: 'var(--danger)', borderColor: 'rgba(var(--danger-rgb), 0.3)' }}
                     onClick={async () => {
                       const ok = await confirm({ title: 'Discard workout', message: `Discard this workout? Its ${totalSets} logged set${totalSets === 1 ? '' : 's'} will be lost.`, confirmLabel: 'Discard', danger: true });
                       if (!ok) return;
                       localStorage.removeItem('pendingWorkout');
                       setPendingWorkout(null);
                     }}
                   >
                     Discard
                   </button>
                </div>
             </div>
          );
      })()}

      {!showStartMenu ? (
        <>
          {(deloadSuggestion || isDeload) && (
            <DeloadSuggestion suggestion={deloadSuggestion || { reasons: [] }} chosen={isDeload} onChoose={setIsDeload} onDismiss={snoozeDeload} />
          )}
          {trainedToday && (
            <div className="workout-tile workout-done-today animate-fade-in">
              <span className="workout-done-today-icon" aria-hidden>✓</span>
              <div>
                <strong>{doneToday.length === 1 ? 'You trained today' : `${doneToday.length} workouts today`}</strong>
                {doneToday.map((w) => {
                  const sets = Object.values(w.logs || {}).reduce((sum: number, list: any) => sum + (list?.length || 0), 0);
                  const volume = Math.round(w.volume ?? workoutVolume(w.logs));
                  const length = w.durationSecs ? `${Math.round(w.durationSecs / 60)} min` : w.duration;
                  return (
                    <span key={w.id} className="workout-hint">
                      {w.isDeload ? '🧘 ' : ''}{w.type?.name || w.name || 'Workout'} at {new Date(w.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {length ? ` · ${length}` : ''} · {sets} sets{volume ? ` · ${volume.toLocaleString()} lb` : ''}
                    </span>
                  );
                })}
                <span className="workout-hint">Recovery is where the gains happen — but another session is fine if you planned one.</span>
              </div>
            </div>
          )}
          <button className="workout-btn-primary" style={{ padding: trainedToday ? '0.95rem' : '1.25rem', fontSize: trainedToday ? '1.05rem' : '1.25rem', marginTop: '0.5rem' }} onClick={() => setShowStartMenu(true)}>
            {trainedToday ? 'Start another workout' : 'Start a workout ⚡'}
          </button>
          {programs.length > 0 && !isDemo && (
            <div className="workout-quick-starts">
              <span className="workout-hint">Your programs:</span>
              {programs.map((program) => {
                const next = nextProgramDay(program, history);
                const day = program.days[next];
                const dayName = day?.name || availableTypes.find((t) => t.id === day?.typeId)?.name || 'Next day';
                const gym = availableGyms.find((g) => g.id === program.gymId);
                return (
                  <button key={program.id} type="button" className="workout-quick-start workout-program-start" onClick={() => startProgram(program)}>
                    <strong>▶ {program.name}: {dayName}</strong>
                    <span>Day {next + 1} of {program.days.length}{gym ? ` · ${gym.emoji ? `${gym.emoji} ` : ''}${gym.name}` : ''}{programDeloadDue(program, history) ? ' · deload week' : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
          {quickStarts.length > 0 && (
            <div className="workout-quick-starts">
              <span className="workout-hint">Or repeat:</span>
              {quickStarts.map((w) => {
                const gym = availableGyms.find((g) => g.id === w.gymId);
                const lifts = Object.keys(w.logs || {}).length;
                return (
                  <button key={w.id} type="button" className="workout-quick-start" onClick={() => repeatWorkout(w)}>
                    <strong>↻ {w.type?.name || w.name}</strong>
                    <span>{gym?.emoji ? `${gym.emoji} ` : ''}{gym?.name || w.gymName} · {lifts} lift{lifts === 1 ? '' : 's'} · {formatRelativeDay(w.timestamp)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="workout-tile animate-fade-in" style={{ borderColor: 'var(--accent)', background: 'rgba(var(--accent-rgb), 0.05)' }}>
          <div className="workout-flex-between">
            <h3 style={{ margin: '0 0 1rem 0' }}>Configure Workout</h3>
             <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 0.5rem' }} onClick={() => setShowStartMenu(false)}>✕</button>
          </div>
          
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Select Gym</label>
          <select className="workout-input" value={selectedGym} onChange={e => setSelectedGym(e.target.value)}>
            <option value="">-- Choose Gym --</option>
            {availableGyms.map(g => <option key={g.id} value={g.id}>{g.emoji ? g.emoji + ' ' : ''}{g.name}</option>)}
            {!isDemo && <option value="__new__">➕ New gym…</option>}
          </select>
          {selectedGym === '__new__' && (
            <div className="animate-fade-in" style={{ marginBottom: '0.75rem' }}>
              <input className="workout-input" placeholder="Gym name" value={newGymName} onChange={e => setNewGymName(e.target.value)} />
              <select className="workout-input" value={newGymCopyFrom} onChange={e => setNewGymCopyFrom(e.target.value)}>
                <option value="">Start empty — add equipment as I go</option>
                {availableGyms.map(g => <option key={g.id} value={g.id}>Copy equipment from {g.name} (fix weights later)</option>)}
              </select>
            </div>
          )}

          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Select Workout Type</label>
          <select className="workout-input" value={selectedType} onChange={e => setSelectedType(e.target.value)}>
             <option value="">-- Choose Type --{selectedGym ? ' (optional for Build as I go)' : ''}</option>
             {availableTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.intensity}%)</option>)}
          </select>

          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Number of Lifts</label>
          <select className="workout-input" value={liftCount} onChange={e => setLiftCount(e.target.value)}>
            {[3, 4, 5, 6, 7, 8].map(n => <option key={n} value={String(n)}>{n} lifts</option>)}
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--surface-border)', borderRadius: '10px', cursor: 'pointer', background: isDeload ? 'rgba(99, 179, 237, 0.1)' : 'transparent' }}>
            <input type="checkbox" checked={isDeload} onChange={e => setIsDeload(e.target.checked)} style={{ marginTop: '0.15rem' }} />
            <div>
              <div style={{ fontWeight: 600, color: isDeload ? 'var(--info)' : 'var(--foreground)' }}>Deload Workout</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Automatically reduces weight targets and sets to prioritize recovery.</div>
            </div>
          </label>
          {deloadSuggestion && !isDeload && (
            <p style={{ fontSize: '0.8rem', color: 'var(--info, #63b3ed)', margin: '-0.5rem 0 1rem' }}>
              Deload suggested: {deloadSuggestion.reasons.join(' ')}
            </p>
          )}

          <button 
             className="workout-btn-primary" 
             disabled={!selectedGym || selectedGym === '__new__' || !selectedType}
             style={{ opacity: (!selectedGym || selectedGym === '__new__' || !selectedType) ? 0.5 : 1 }}
             onClick={() => {
               const params = new URLSearchParams({
                 gym: selectedGym,
                 type: selectedType,
                 lifts: liftCount,
                 intensity: String(isDeload ? 0.5 : startIntensity),
                 isDemo: String(isDemo),
               });
               if (isDeload) params.set('deload', '1');
               rememberStart({ gym: selectedGym, type: selectedType, lifts: liftCount });
               window.location.href = `/workout/active?${params.toString()}`;
             }}
          >
            Build & Start
          </button>

          {!isDemo && (
            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '0.6rem', padding: '0.85rem', borderRadius: '12px' }}
              disabled={startingFreestyle || !selectedGym || (selectedGym === '__new__' && !newGymName.trim())}
              onClick={async () => {
                setStartingFreestyle(true);
                try {
                  let gymId = selectedGym;
                  if (gymId === '__new__') {
                    const source = availableGyms.find(g => g.id === newGymCopyFrom);
                    const stations = (source?.stations || []).map((st: any) => ({
                      ...st, id: newRecordId(), lifts: (st.lifts || []).map((l: any) => ({ ...l, id: newRecordId() })),
                    }));
                    const res = await fetch('/api/workout/gyms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newGymName.trim(), emoji: '🏋️', stations }) });
                    const d = await res.json();
                    if (!d.success) throw new Error(d.message || 'Could not create the gym');
                    gymId = d.gym.id;
                  }
                  rememberStart({ gym: gymId, type: selectedType, lifts: liftCount });
                  const params = new URLSearchParams({ gym: gymId, freestyle: '1', intensity: String(startIntensity) });
                  if (selectedType) params.set('type', selectedType);
                  window.location.href = `/workout/active?${params.toString()}`;
                } catch (err) {
                  setStartError(err instanceof Error ? err.message : 'Could not start');
                  setStartingFreestyle(false);
                }
              }}
            >
              🚶 Build as I go — pick machines while I walk around
            </button>
          )}
          {startError && <p className="workout-error" style={{ marginTop: '0.5rem' }}>{startError}</p>}

          <div style={{ marginTop: '0.85rem', borderTop: '1px solid var(--surface-border)', paddingTop: '0.85rem' }}>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', borderRadius: '10px' }}
              onClick={() => {
                setShowJoinShared((prev) => !prev);
                setJoinError('');
              }}
            >
              {showJoinShared ? 'Hide Shared Join' : 'Join Shared Workout'}
            </button>
            {showJoinShared && (
              <div className="animate-fade-in" style={{ marginTop: '0.65rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Enter 3-letter code</label>
                <input
                  className="workout-input"
                  value={joinCode}
                  maxLength={3}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
                  placeholder="KLF"
                />
                {joinError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', margin: '0.4rem 0 0' }}>{joinError}</p>}
                <button
                  className="workout-btn-primary"
                  style={{ marginTop: '0.6rem' }}
                  disabled={joinLoading}
                  onClick={handleJoinSharedWorkout}
                >
                  {joinLoading ? 'Joining...' : 'Join Session'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="workout-link-grid" aria-label="More workout pages">
        {[
          { href: '/workout/config', icon: '🏋️', label: 'Gyms & lifts' },
          { href: isDemo ? '/workout/calculators?isDemo=1' : '/workout/calculators', icon: '🧮', label: 'Calculators' },
          { href: '/workout/report', icon: '🗓️', label: 'Weekly report' },
          { href: '/workout/analytics', icon: '📈', label: 'Analytics' },
          ...(isDemo ? [] : [{ href: '/workout/health', icon: '❤️', label: 'Health' }]),
        ].map((link) => (
          <a key={link.href} className="workout-action-tile" href={link.href}>
            <span aria-hidden>{link.icon}</span><span>{link.label}</span>
          </a>
        ))}
      </nav>
      {isSiteAdmin && (
        <a href="/workout/users" className="workout-text-btn" style={{ display: 'block', textAlign: 'center', margin: '0.6rem 0 0' }}>
          👥 Manage workout users (admin)
        </a>
      )}

      {volumeRows.length > 0 && (
        <div className="workout-tile" style={{ marginTop: '1rem' }}>
          <div className="workout-flex-between" style={{ marginBottom: '0.75rem', gap: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Sets This Week</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span className="workout-hint">Goal</span>
              <button className="btn btn-secondary" style={{ padding: '0.1rem 0.55rem' }} aria-label="Lower weekly set goal" onClick={() => updateWeeklyTarget(weeklySetTarget - 2)}>−</button>
              <strong style={{ minWidth: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>{weeklySetTarget}</strong>
              <button className="btn btn-secondary" style={{ padding: '0.1rem 0.55rem' }} aria-label="Raise weekly set goal" onClick={() => updateWeeklyTarget(weeklySetTarget + 2)}>+</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {volumeRows.map(({ muscle, sets }) => {
              const done = sets >= weeklySetTarget;
              return (
                <div key={muscle} style={{ display: 'grid', gridTemplateColumns: '5.5rem minmax(0, 1fr) 3.2rem', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <span>{muscle}</span>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-border)', overflow: 'hidden' }} role="meter" aria-valuemin={0} aria-valuemax={weeklySetTarget} aria-valuenow={sets} aria-label={`${muscle} sets this week`}>
                    <div style={{ width: `${Math.min(100, (sets / weeklySetTarget) * 100)}%`, height: '100%', borderRadius: 4, background: done ? 'var(--success)' : 'var(--accent)' }} />
                  </div>
                  <span style={{ textAlign: 'right', color: done ? 'var(--success)' : 'var(--muted)' }}>{Number.isInteger(sets) ? sets : sets.toFixed(1)}/{weeklySetTarget}{done ? ' ✓' : ''}</span>
                </div>
              );
            })}
          </div>
          <p className="workout-hint" style={{ margin: '0.6rem 0 0' }}>Secondary muscles count as half a set. Resets Monday.</p>
        </div>
      )}

      {!isDemo && (
        <BodyweightCard onWeightChange={(weight) => { setUser((prev) => (prev ? { ...prev, weight } : prev)); setEditWeight(String(weight)); }} />
      )}

      {!isDemo && (
        <GoalsCard goals={goals} history={history} exercises={exercises} onSave={saveGoal} onDelete={deleteGoal} />
      )}

      {stalledLifts.length > 0 && (
        <div className="workout-tile" style={{ marginTop: '1rem', borderLeft: '3px solid var(--warning)' }}>
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>Plateaus</h3>
          <p className="workout-hint" style={{ margin: '0 0 0.6rem' }}>
            No new best in the last 3 sessions. Try a lighter week (Deload), a different rep range, or swap to a variation.
          </p>
          {stalledLifts.map((lift) => (
            <div key={lift.liftId} className="workout-list-row" style={{ marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{lift.name}</span>
              <span className="workout-hint">best e1RM {lift.bestE1RM} lbs · {lift.sessions} sessions</span>
            </div>
          ))}
        </div>
      )}

      {recentWorkouts.length > 0 && (
        <div className="workout-tile" style={{ marginTop: '1rem' }}>
          <div className="workout-flex-between" style={{ marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Recent Workouts</h3>
            <a href="/workout/analytics" className="workout-text-btn">All history →</a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {recentWorkouts.map((workout) => {
              const setCount = Object.values(workout.logs || {}).reduce((sum: number, sets: any) => sum + (sets?.length || 0), 0);
              const volume = workout.volume ?? workoutVolume(workout.logs);
              return (
                <div key={workout.id} className="workout-list-row" style={{ padding: '0.65rem 0.75rem' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {workout.isDeload ? '🧘 ' : ''}{workout.type?.name || workout.name}
                    </div>
                    <div className="workout-hint">
                      {formatRelativeDay(workout.timestamp)} · {setCount} sets · {Math.round(volume).toLocaleString()} lbs{workout.duration ? ` · ${workout.duration}` : ''}
                    </div>
                  </div>
                  {canRepeat(workout) && (
                    <button className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem', borderRadius: '999px', flexShrink: 0 }} onClick={() => repeatWorkout(workout)}>
                      Repeat
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {isDemo && (
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button onClick={() => setShowLogin(true)} style={{ background: 'none', border: 'none', color: 'var(--accent-light)', textDecoration: 'underline', cursor: 'pointer' }}>
            Login to personal account
          </button>
        </div>
      )}
      {popup}
    </div>
  );
}
