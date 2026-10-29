'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/workout/PageHeader';
import ReadinessCard from '@/components/workout/health/ReadinessCard';
import HealthSetupSheet from '@/components/workout/health/HealthSetupSheet';
import CoachCard from '@/components/workout/health/CoachCard';
import PlanPanel from '@/components/workout/health/PlanPanel';
import type { CalculatorDefaults } from '@/lib/workout/calculators';
import type { WeightPlan } from '@/lib/workout/weight-plan';
import { fullCoach, profileFromUser } from '@/lib/workout/coach';
import { HeartRateChart, RefLegend, SleepBars, StepsBars, TrendLine, alignNote, setMarks } from '@/components/workout/health/HealthCharts';
import { fetchWorkoutJson } from '@/lib/workout/offline-cache';
import { readPref, readTodayIntensity, savePref, saveTodayIntensity } from '@/lib/workout/device-prefs';
import { dailyBurn, daysSince, fullWearDays, formatMinutes, healthSeries, lastKeys, localKey, rangeStats, readiness, shiftKey, timeAgo, typicalSleepTimes, type RangeStats } from '@/lib/workout/health-insights';
import { describeSync, type HealthDay, type MatchCheck, type PublicHealth } from '@/lib/workout/health';
import { flushWorkoutQueue, getQueuedWorkouts } from '@/lib/workout/offline-queue';
import '../analytics/analytics.css';
import '@/components/workout/health/health.css';

type Range = '14d' | '30d' | '90d' | '1y';
type Tab = 'today' | 'plan' | 'trends';
const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'plan', label: 'Plan' },
  { key: 'trends', label: 'Trends' },
];
type Calorie = NonNullable<CalculatorDefaults['calorie']>;
const RANGES: { key: Range; label: string; days: number }[] = [
  { key: '14d', label: '2 weeks', days: 14 },
  { key: '30d', label: 'Month', days: 30 },
  { key: '90d', label: '3 months', days: 91 },
  { key: '1y', label: 'Year', days: 364 },
];

type Workout = { id: string; timestamp: string; name?: string; type?: { name?: string }; durationSecs?: number; logs?: Record<string, any[]>; liftMeta?: Record<string, { name?: string }> };

const fmtSteps = (n: number) => n.toLocaleString();

/** A headline number with how it moved against the range before. */
function Tile({ icon, label, value, unit, delta, sub }: { icon: string; label: string; value: string; unit?: string; delta?: { text: string; tone: 'good' | 'warn' | 'neutral' } | null; sub?: string }) {
  return (
    <div className="an-tile hc-tile">
      <span className="an-tile-label"><span aria-hidden className="hc-tile-icon">{icon}</span>{label}</span>
      <strong className="an-tile-value">{value}{unit && value !== '—' && <span className="hc-unit">{unit}</span>}</strong>
      {delta ? <span className={`hc-delta is-${delta.tone}`}>{delta.text}</span> : sub ? <span className="an-tile-sub">{sub}</span> : <span className="an-tile-sub">&nbsp;</span>}
    </div>
  );
}

/** Change between two averages, as text and whether that's good news. */
function deltaOf(now: number | null, before: number | null, { unit, higherIsBetter, format = (n: number) => String(Math.round(n)) }: { unit: string; higherIsBetter: boolean | null; format?: (n: number) => string }) {
  if (now === null || before === null) return null;
  const diff = now - before;
  if (Math.abs(diff) < 0.5) return { text: 'same as before', tone: 'neutral' as const };
  const good = higherIsBetter === null ? null : (diff > 0) === higherIsBetter;
  return { text: `${diff > 0 ? '▲ +' : '▼ −'}${format(Math.abs(diff))}${unit} vs before`, tone: good === null ? 'neutral' as const : good ? 'good' as const : 'warn' as const };
}

/**
 * Apple Health, synced by an iOS Shortcut: today's readiness, sleep, steps,
 * resting heart rate and HRV, weight and body fat, and heart rate through
 * each logged workout. All optional — the setup sheet explains the sync.
 */
export default function HealthPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [health, setHealth] = useState<PublicHealth | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [queued, setQueued] = useState(0);
  const [weights, setWeights] = useState<{ date: string; weight: number }[]>([]);
  const [range, setRange] = useState<Range>('30d');
  const [setupOpen, setSetupOpen] = useState(false);
  const [openWorkout, setOpenWorkout] = useState<string | null>(null);
  const [todayIntensity, setTodayIntensity] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  // The calorie calculator's saved settings, which hold the weight plan.
  const [calorie, setCalorie] = useState<Calorie | null>(null);

  useEffect(() => {
    const saved = readPref('workout:healthRange');
    if (RANGES.some((r) => r.key === saved)) setRange(saved as Range);
    setTodayIntensity(readTodayIntensity());
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup') === '1') setSetupOpen(true);
    const wanted = params.get('tab') || readPref('workout:healthTab');
    if (TABS.some((t) => t.key === wanted)) setTab(wanted as Tab);
  }, []);

  const loadHealth = useCallback(async () => {
    const res = await fetchWorkoutJson('/api/workout/health');
    if (res.data?.success) setHealth(res.data.health);
    return res;
  }, []);

  useEffect(() => {
    (async () => {
      const auth = await fetchWorkoutJson('/api/workout/auth');
      if (!auth.data?.authenticated) { setLoading(false); return; }
      setSignedIn(true);
      setUser(auth.data.user);
      // A workout saved with no signal waits on this phone; send it first so it can be matched.
      if (getQueuedWorkouts(auth.data.user.id).length) await flushWorkoutQueue(auth.data.user.id).catch(() => null);
      setQueued(getQueuedWorkouts(auth.data.user.id).length);
      const [h, hist, bw, calc] = await Promise.all([loadHealth(), fetchWorkoutJson('/api/workout/history'), fetchWorkoutJson('/api/workout/bodyweight'), fetchWorkoutJson('/api/workout/calculator-settings')]);
      setCalorie(calc.data?.calculatorDefaults?.calorie || {});
      setOffline([h, hist, bw].some((r) => r.offline));
      setHistory(hist.data?.history || []);
      setWeights(bw.data?.entries || []);
      setLoading(false);
    })();
  }, [loadHealth]);

  const chooseRange = (next: Range) => { setRange(next); savePref('workout:healthRange', next); };
  const chooseTab = (next: Tab) => { setTab(next); savePref('workout:healthTab', next); window.scrollTo({ top: 0 }); };
  /** Save plan/calculator settings; an ended plan is sent as null so it's removed, not kept. */
  const savePlan = async (patch: Omit<Partial<Calorie>, 'plan'> & { plan?: WeightPlan | null }) => {
    const res = await fetch('/api/workout/calculator-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calculatorDefaults: { calorie: patch } }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) setCalorie(data.calculatorDefaults.calorie);
  };
  const logWeight = async (weight: number) => {
    const res = await fetch('/api/workout/bodyweight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight, date: localKey(new Date()) }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) setWeights(data.entries);
  };
  const useIntensity = (value: number | null) => { saveTodayIntensity(value); setTodayIntensity(value); };

  // Typed-in bodyweight entries count as weight readings too.
  const days = useMemo(() => {
    const merged: Record<string, HealthDay> = { ...(health?.days || {}) };
    for (const entry of weights) merged[entry.date] = { ...merged[entry.date], weight: entry.weight };
    return merged;
  }, [health, weights]);

  const today = localKey(new Date());
  const yesterday = shiftKey(today, 1);
  const burnYesterday = useMemo(() => (fullWearDays(days).has(yesterday) ? dailyBurn(days[yesterday])! : null), [days, yesterday]);
  const spec = RANGES.find((r) => r.key === range)!;
  const keys = useMemo(() => lastKeys(today, spec.days), [today, spec.days]);
  const view = useMemo(() => {
    const stats = rangeStats(days, keys);
    const before: RangeStats = rangeStats(days, lastKeys(shiftKey(today, spec.days), spec.days));
    const series = healthSeries(days, today, spec.days, range === '1y');
    const typical = typicalSleepTimes(days, keys);
    return { stats, before, series, typical };
  }, [days, keys, today, spec.days, range]);
  const ready = useMemo(() => readiness(days, today, user?.intensityFactor ?? 1), [days, today, user?.intensityFactor]);
  const coach = useMemo(() => fullCoach({ history, health: health ? { ...health, days } : null, profile: profileFromUser(user) }).insights.filter((i) => i.usesHealth), [history, days, health, user]);

  const matched = useMemo(() => history
    .filter((w) => health?.workouts?.[w.id])
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 12), [history, health]);

  if (loading) return <div className="an-loading">Loading health data…</div>;

  if (!signedIn) {
    return (
      <div className="animate-fade-in an-page">
        <PageHeader title="Health" />
        <div className="workout-tile an-empty">
          <strong>Log in to connect Apple Health</strong>
          <p className="workout-hint">Sleep, steps, heart rate and your scale, next to your training.</p>
          <a className="workout-button is-primary" href="/workout">Go to log in</a>
        </div>
      </div>
    );
  }

  const h = health!;
  const hasData = Object.keys(h?.days || {}).length > 0 || weights.length > 0;
  const stale = daysSince(h?.lastSync?.at);
  const status = !h?.connected && !h?.lastSync ? 'Not connected'
    : h?.lastSync ? `Synced ${timeAgo(h.lastSync.at)}${!h.connected ? ' · syncing stopped' : ''}` : 'Waiting for the first sync';
  const { stats, before, series, typical } = view;
  const has = (key: 'steps' | 'sleepHours' | 'restingHr' | 'hrv' | 'weight' | 'bodyFat' | 'burnKcal') => series.some((p) => typeof p[key] === 'number');

  return (
    <div className="animate-fade-in an-page hc-page">
      <PageHeader
        title="Health & plan"
        subtitle={<span className={`hc-status${stale !== null && stale >= 2 ? ' is-stale' : h?.lastSync ? ' is-ok' : ''}`}><span className="hc-dot" aria-hidden /> {status}{stale !== null && stale >= 2 ? ' — check your automation' : ''}</span>}
        actions={<button type="button" className="workout-button is-small" onClick={() => setSetupOpen(true)}>{h?.connected ? '⚙︎ Sync' : 'Connect'}</button>}
      />
      {offline && <p className="workout-offline-note" style={{ margin: '0 0 0.75rem' }}>📡 Offline — showing data saved on this phone.</p>}
      {h?.lastSync && (h.lastSync.unreadableDates || h.lastSync.mismatched?.length || h.lastSync.ignored?.length) ? (
        <p className="hc-warn" style={{ marginBottom: '0.9rem' }}>
          ⚠︎ The last sync had problems. {describeSync(h.lastSync)}{' '}
          <button type="button" className="workout-text-btn" style={{ textDecoration: 'underline' }} onClick={() => setSetupOpen(true)}>Fix the shortcut</button>
        </p>
      ) : null}

      <nav className="an-tabs hc-tabs" aria-label="Health sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => chooseTab(t.key)}>{t.label}</button>
        ))}
      </nav>

      {tab === 'today' && (!hasData ? (
        <section className="workout-tile hc-hero">
          <span className="hc-hero-icon" aria-hidden>❤️</span>
          <h2>Bring in Apple Health</h2>
          <p>Optional extras next to your training — nothing else needs them.</p>
          <ul>
            <li><strong>Readiness</strong> each morning from sleep, resting heart rate and HRV</li>
            <li><strong>Heart rate and calories</strong> for each workout, from your Watch</li>
            <li><strong>Weight and body fat</strong> straight from your Renpho scale</li>
            <li><strong>Sleep and steps</strong> trends</li>
          </ul>
          <button type="button" className="workout-button is-primary is-block" onClick={() => setSetupOpen(true)}>Set up the sync (about 10 minutes)</button>
        </section>
      ) : (<div className="an-stack">
        {ready ? (
          <ReadinessCard readiness={ready} todayIntensity={todayIntensity} onUseIntensity={useIntensity} />
        ) : (
          <section className="workout-tile an-card hc-note">
            <strong>Readiness needs about a week of data</strong>
            <p className="workout-hint">It compares last night&apos;s sleep, resting heart rate and HRV with your usual, so it starts once there&apos;s a baseline.</p>
          </section>
        )}

        <section className="an-tiles hc-tiles" aria-label="At a glance">
          <Tile icon="🌙" label="Last night" value={days[today]?.sleep ? formatMinutes(days[today].sleep!.asleepMin) : '—'} sub="asleep" />
          <Tile icon="👣" label="Steps yesterday" value={days[yesterday]?.steps !== undefined ? fmtSteps(days[yesterday].steps!) : '—'} />
          <Tile icon="🔥" label="Burned yesterday" value={burnYesterday !== null ? burnYesterday.toLocaleString() : '—'} unit="kcal"
            sub={burnYesterday !== null ? 'resting + active' : days[yesterday]?.activeKcal ? 'Watch off part of the day' : undefined} />
          <Tile icon="⚖" label="Weight" value={weights.length ? String(weights[weights.length - 1].weight) : '—'} unit="lb" sub={weights.length ? 'latest weigh-in' : undefined} />
        </section>

        <CoachCard
          insights={coach}
          building={Object.keys(h?.days || {}).length < 21}
          more={<a href="/workout/analytics?tab=coach" className="workout-text-btn" style={{ display: 'block', marginTop: '0.6rem' }}>Training advice (effort, load, rest…) in Analytics › Coach</a>}
        />
      </div>))}

      {tab === 'plan' && (
        calorie ? (
          <PlanPanel calorie={calorie} onSave={savePlan} days={days} weighIns={weights} onLog={logWeight} today={today} />
        ) : <p className="workout-hint">Loading your plan…</p>
      )}

      {tab === 'trends' && (!hasData ? (
        <section className="workout-tile an-empty">
          <strong>No health data yet</strong>
          <p className="workout-hint">Connect Apple Health to see sleep, steps, calories, heart and body trends.</p>
          <button type="button" className="workout-button is-primary" onClick={() => setSetupOpen(true)}>Connect</button>
        </section>
      ) : (<div className="an-stack">
        <div className="an-periods" role="radiogroup" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.key} type="button" role="radio" aria-checked={range === r.key} onClick={() => chooseRange(r.key)}>{r.label}</button>
          ))}
        </div>

        <section className="an-tiles hc-tiles is-six" aria-label={`Averages over ${spec.label.toLowerCase()}`}>
          <Tile icon="🌙" label="Sleep" value={stats.sleepMin !== null ? formatMinutes(stats.sleepMin) : '—'}
            delta={deltaOf(stats.sleepMin, before.sleepMin, { unit: '', higherIsBetter: true, format: (n) => formatMinutes(n) })} sub="a night" />
          <Tile icon="👣" label="Steps" value={stats.steps !== null ? fmtSteps(stats.steps) : '—'}
            delta={deltaOf(stats.steps, before.steps, { unit: '', higherIsBetter: true, format: fmtSteps })} sub="a day" />
          <Tile icon="♥" label="Resting HR" value={stats.restingHr !== null ? String(stats.restingHr) : '—'} unit="bpm"
            delta={deltaOf(stats.restingHr, before.restingHr, { unit: ' bpm', higherIsBetter: false })} />
          <Tile icon="〰" label="HRV" value={stats.hrv !== null ? String(stats.hrv) : '—'} unit="ms"
            delta={deltaOf(stats.hrv, before.hrv, { unit: ' ms', higherIsBetter: true })} />
          <Tile icon="⚖" label="Weight" value={stats.weight ? String(stats.weight.latest) : '—'} unit="lb"
            delta={stats.weight?.change != null ? { text: `${stats.weight.change > 0 ? '+' : stats.weight.change < 0 ? '−' : ''}${Math.abs(stats.weight.change)} lb this ${spec.key === '1y' ? 'year' : 'range'}`, tone: 'neutral' } : null} sub="latest" />
          <Tile icon="◔" label="Body fat" value={stats.bodyFat ? String(stats.bodyFat.latest) : '—'} unit="%"
            delta={stats.bodyFat?.change != null ? { text: `${stats.bodyFat.change > 0 ? '+' : stats.bodyFat.change < 0 ? '−' : ''}${Math.abs(stats.bodyFat.change)} pts this ${spec.key === '1y' ? 'year' : 'range'}`, tone: 'neutral' } : null} sub="latest" />
        </section>

        <section className="workout-tile an-card">
          <div className="an-card-head">
            <h2>Sleep</h2>
            {typical && <span className="workout-hint">Usually {typical.bedtime} → {typical.wake}</span>}
          </div>
          {has('sleepHours') ? <SleepBars data={series} usualHours={stats.sleepMin !== null ? stats.sleepMin / 60 : null} /> : <Empty what="sleep" add="Sleep Analysis" />}
          {has('sleepHours') && stats.sleepMin !== null && <RefLegend>Your average, {formatMinutes(stats.sleepMin)} a night</RefLegend>}
          {has('sleepHours') && <p className="workout-hint an-chart-note">Time asleep{range === '1y' ? ', averaged per week' : ' each night'}. Tap a bar for deep, core and REM.</p>}
        </section>

        <section className="workout-tile an-card">
          <div className="an-card-head"><h2>Steps</h2>{stats.steps !== null && <span className="workout-hint">{stats.stepDays} days</span>}</div>
          {has('steps') ? <StepsBars data={series} average={stats.steps} /> : <Empty what="steps" add="Steps (grouped by day)" />}
          {has('steps') && stats.steps !== null && <RefLegend>Average, {fmtSteps(stats.steps)} a day</RefLegend>}
        </section>

        <section className="workout-tile an-card">
          <div className="an-card-head"><h2>Calories burned</h2>{stats.burnKcal !== null && <span className="workout-hint">avg {stats.burnKcal.toLocaleString()} a day</span>}</div>
          {has('burnKcal') ? <TrendLine data={series} dataKey="burnKcal" unit="kcal" /> : <Empty what="daily calories" add="Active Energy and Resting Energy (grouped by day)" />}
          <p className="workout-hint an-chart-note">Resting plus active calories each day, from Apple Health. Days the Watch was off for part of the day (resting calories well under your usual) are left out, today included until it&apos;s over. This is what your activity level in the plan is measured from.</p>
        </section>

        <section className="workout-tile an-card">
          <h2>Heart</h2>
          <h3 className="hc-sub">Resting heart rate</h3>
          {has('restingHr') ? <TrendLine data={series} dataKey="restingHr" unit="bpm" /> : <Empty what="resting heart rate" add="Resting Heart Rate" />}
          <h3 className="hc-sub">Heart rate variability</h3>
          {has('hrv') ? <TrendLine data={series} dataKey="hrv" unit="ms" /> : <Empty what="HRV" add="Heart Rate Variability" />}
          <p className="workout-hint an-chart-note">Lower resting heart rate and higher HRV than usual generally mean you&apos;re well recovered.</p>
        </section>

        <section className="workout-tile an-card">
          <div className="an-card-head"><h2>Body</h2><button type="button" className="workout-text-btn" onClick={() => chooseTab('plan')}>Weight plan ›</button></div>
          <h3 className="hc-sub">Weight</h3>
          {has('weight') ? <TrendLine data={series} dataKey="weight" unit="lb" digits={1} /> : <Empty what="weight" add="Weight" />}
          <h3 className="hc-sub">Body fat</h3>
          {has('bodyFat') ? <TrendLine data={series} dataKey="bodyFat" unit="%" digits={1} /> : <Empty what="body fat" add="Body Fat Percentage" />}
          <p className="workout-hint an-chart-note">Scale body fat jumps around day to day; the trend over weeks is what matters.</p>
        </section>

        <section className="workout-tile an-card">
          <div className="an-card-head"><h2>Workouts</h2><span className="workout-hint">From your Watch</span></div>
          {queued > 0 && (
            <p className="hc-warn">{queued === 1 ? 'A workout saved on this phone hasn’t' : `${queued} workouts saved on this phone haven’t`} reached the site yet (no signal when it was saved), so it can’t get heart rate. It’ll go up next time there’s a connection.</p>
          )}
          {(h.waiting || []).map((c) => {
            const w = history.find((x) => x.id === c.id);
            return w ? <WaitingWorkout key={c.id} workout={w} check={c} /> : null;
          })}
          {matched.length === 0 ? (
            <p className="workout-hint" style={{ margin: 0 }}>
              Heart rate and calories show up here for workouts in the last two weeks once the shortcut sends <em>Heart Rate</em> and <em>Active Energy</em>.
            </p>
          ) : (
            <div className="workout-stack">
              {matched.map((w) => {
                const wh = h.workouts[w.id];
                const open = openWorkout === w.id;
                return (
                  <div key={w.id} className={`an-workout${open ? ' is-open' : ''}`}>
                    <button type="button" className="an-workout-head" aria-expanded={open} onClick={() => setOpenWorkout(open ? null : w.id)}>
                      <span className="workout-card-text">
                        <span className="workout-card-title">{w.type?.name || w.name || 'Workout'}</span>
                        <span className="workout-card-meta">
                          {new Date(w.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          {wh.avgHr !== undefined && ` · ♥ ${wh.avgHr} avg · ${wh.maxHr} max`}
                          {wh.kcal !== undefined && ` · ${wh.kcal} kcal`}
                        </span>
                      </span>
                      <span className={`workout-chevron${open ? ' is-open' : ''}`} aria-hidden>›</span>
                    </button>
                    {open && (
                      <div className="an-workout-body animate-fade-in">
                        {wh.trace && wh.trace.length > 1 ? (
                          <HeartRateChart trace={wh.trace} sets={setMarks(w, wh.start, wh.setOffsetSec)} avg={wh.avgHr} />
                        ) : <p className="workout-hint">No heart rate readings during this one — only calories.</p>}
                        <p className="workout-hint" style={{ margin: '0.4rem 0 0' }}>
                          {Math.round((Date.parse(wh.end) - Date.parse(wh.start)) / 60_000)} min{wh.watch ? ' (Watch session)' : ''} · dashed lines are your logged sets
                        </p>
                        {wh.setOffsetSec ? <p className="workout-hint" style={{ margin: '0.25rem 0 0' }}>{alignNote(wh.setOffsetSec)}</p> : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="workout-hint hc-privacy">🔒 Health data is private to your account. It&apos;s never in shared workouts, links or partner mode.</p>
      </div>))}

      {setupOpen && h && <HealthSetupSheet health={h} onChanged={loadHealth} onClose={() => setSetupOpen(false)} />}
    </div>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** A recent workout with no heart rate or calories yet, and why. */
function WaitingWorkout({ workout, check }: { workout: Workout; check: MatchCheck }) {
  let why: string;
  if (!check.from || !check.to) {
    why = 'It has no timer or set times, so there’s no way to tell when it happened.';
  } else if (!check.newestHeartRate && !check.newestEnergy) {
    why = 'No heart rate or energy readings have reached the site. Check that the shortcut sends Heart Rate and Active Energy.';
  } else if (check.newestHeartRate && check.newestHeartRate < check.to && (!check.newestEnergy || check.newestEnergy < check.to)) {
    why = `The site’s newest heart rate is from ${clock(check.newestHeartRate)}, before this workout ended. It should arrive with the next sync after your Watch has passed it to your phone.`;
  } else {
    why = `The site has readings up to ${clock(check.newestHeartRate || check.newestEnergy!)}, but only ${check.heartRate} heart rate and ${check.energy} energy reading${check.energy === 1 ? '' : 's'} between ${clock(check.from)} and ${clock(check.to)}. The shortcut is probably skipping that time: check that its Heart Rate and Active Energy steps use “Start Date is after Since”.`;
  }
  return (
    <div className="hc-waiting">
      <strong>{workout.type?.name || workout.name || 'Workout'} · waiting for heart rate</strong>
      <span className="workout-hint">{why}</span>
    </div>
  );
}

function Empty({ what, add }: { what: string; add: string }) {
  return <p className="workout-hint hc-empty">No {what} in this range. Add <strong>{add}</strong> to your shortcut to see it here.</p>;
}
