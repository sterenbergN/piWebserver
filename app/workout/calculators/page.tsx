'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import PageHeader from '@/components/workout/PageHeader';
import '@/components/workout/weight-plan.css';
import { useSitePopup } from '@/components/SitePopup';
import type { WeightPlan } from '@/lib/workout/weight-plan';
import type { HealthDay } from '@/lib/workout/health';
import { describeActivity, measuredActivity } from '@/lib/workout/coach';
import {
  ACTIVITY_LEVELS,
  calculateMifflinStJeor,
  calculateBmi,
  estimateBodyFatCovertBailey,
  estimateBodyFatNavy,
  projectWeightTrend,
  type CalculatorDefaults,
} from '@/lib/workout/calculators';

type TabKey = 'calorie' | 'bodyFat';

const GOAL_OPTIONS = [
  { value: -2, label: 'Lose 2.0 lb/week' },
  { value: -1.5, label: 'Lose 1.5 lb/week' },
  { value: -1, label: 'Lose 1.0 lb/week' },
  { value: -0.5, label: 'Lose 0.5 lb/week' },
  { value: 0, label: 'Maintain weight' },
  { value: 0.5, label: 'Gain 0.5 lb/week' },
  { value: 1, label: 'Gain 1.0 lb/week' },
  { value: 1.5, label: 'Gain 1.5 lb/week' },
  { value: 2, label: 'Gain 2.0 lb/week' },
];

const EMPTY_DEFAULTS: Required<CalculatorDefaults> = {
  calorie: {
    heightInches: '',
    weightLbs: '',
    sex: 'male',
    age: '',
    activityLevel: 'moderate',
    goalRate: 0,
    timelineWeeks: 12,
    startDate: '',
  },
  bodyFat: {
    heightInches: '',
    weightLbs: '',
    sex: 'male',
    age: '',
    neckInches: '',
    waistInches: '',
    hipInches: '',
    forearmInches: '',
    wristInches: '',
    thighInches: '',
    calfInches: '',
  },
};

function asNumber(value: number | '' | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export default function WorkoutCalculatorsPage() {
  const searchParams = useSearchParams();
  const isSampleMode = searchParams.get('isDemo') === '1';
  const [activeTab, setActiveTab] = useState<TabKey>('calorie');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [showCalorieInfo, setShowCalorieInfo] = useState(false);
  const [showBodyFatInfo, setShowBodyFatInfo] = useState(false);
  const [calorieForm, setCalorieForm] = useState(EMPTY_DEFAULTS.calorie);
  const [bodyFatForm, setBodyFatForm] = useState(EMPTY_DEFAULTS.bodyFat);
  const initializedRef = useRef(false);
  const { confirm, popup } = useSitePopup();
  // Synced Apple Health days, for the activity level your Watch actually shows.
  const [healthDays, setHealthDays] = useState<Record<string, HealthDay>>({});
  const today = new Date().toLocaleDateString('en-CA');

  useEffect(() => {
    async function loadDefaults() {
      if (isSampleMode) {
        initializedRef.current = true;
        setLoading(false);
        return;
      }
      try {
        const response = await fetch('/api/workout/calculator-settings');
        if (response.status === 401) {
          setNeedsLogin(true);
          return;
        }

        const data = await response.json();
        if (data.success && data.calculatorDefaults) {
          setCalorieForm({ ...EMPTY_DEFAULTS.calorie, ...data.calculatorDefaults.calorie });
          setBodyFatForm({ ...EMPTY_DEFAULTS.bodyFat, ...data.calculatorDefaults.bodyFat });
          initializedRef.current = true;
        }
        const health = await fetch('/api/workout/health').then((r) => r.json()).catch(() => null);
        if (health?.success) setHealthDays(health.health.days || {});
      } finally {
        setLoading(false);
      }
    }

    loadDefaults();
  }, [isSampleMode]);

  useEffect(() => {
    if (!initializedRef.current || loading || needsLogin || isSampleMode) return;

    const timeout = window.setTimeout(async () => {
      setSaving(true);
      try {
        const response = await fetch('/api/workout/calculator-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calculatorDefaults: {
              calorie: { ...calorieForm, plan: calorieForm.plan ?? null },
              bodyFat: bodyFatForm,
            },
          }),
        });
        setSaveFailed(!response.ok);
      } catch {
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [calorieForm, bodyFatForm, loading, needsLogin, isSampleMode]);

  const calorieMetrics = useMemo(() => {
    const heightInches = asNumber(calorieForm.heightInches);
    const weightLbs = asNumber(calorieForm.weightLbs);
    const age = asNumber(calorieForm.age);

    if (!heightInches || !weightLbs || !age) return null;

    const maintenance = calculateMifflinStJeor({
      sex: calorieForm.sex || 'male',
      age,
      heightInches,
      weightLbs,
      activityLevel: calorieForm.activityLevel || 'moderate',
    });
    const targetCalories = Math.round(maintenance.maintenanceCalories + ((calorieForm.goalRate || 0) * 500));
    const timelineWeeks = typeof calorieForm.timelineWeeks === 'number' ? calorieForm.timelineWeeks : 12;
    const projection = projectWeightTrend({
      sex: calorieForm.sex || 'male',
      age,
      heightInches,
      startingWeightLbs: weightLbs,
      activityLevel: calorieForm.activityLevel || 'moderate',
      targetCalories,
      weeks: timelineWeeks,
      startDate: calorieForm.startDate || undefined,
    });
    const weights = projection.map((point) => point.weightLbs);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const yPadding = Math.max(1, Number(((maxWeight - minWeight) * 0.08).toFixed(1)));

    return {
      maintenanceCalories: Math.round(maintenance.maintenanceCalories),
      bmr: Math.round(maintenance.bmr),
      targetCalories,
      projection,
      timelineWeeks,
      yMin: Number((minWeight - yPadding).toFixed(1)),
      yMax: Number((maxWeight + yPadding).toFixed(1)),
    };
  }, [calorieForm]);

  const bodyFatMetrics = useMemo(() => {
    const heightInches = asNumber(bodyFatForm.heightInches);
    const weightLbs = asNumber(bodyFatForm.weightLbs);
    const age = asNumber(bodyFatForm.age);
    const neckInches = asNumber(bodyFatForm.neckInches);
    const waistInches = asNumber(bodyFatForm.waistInches);
    const hipInches = asNumber(bodyFatForm.hipInches);
    const forearmInches = asNumber(bodyFatForm.forearmInches);
    const wristInches = asNumber(bodyFatForm.wristInches);
    const thighInches = asNumber(bodyFatForm.thighInches);
    const calfInches = asNumber(bodyFatForm.calfInches);

    let navy = null;
    if (heightInches && weightLbs && neckInches && waistInches) {
      const navyValid = bodyFatForm.sex === 'male'
        ? waistInches > neckInches
        : !!hipInches && (waistInches + hipInches > neckInches);
      if (navyValid) {
        navy = estimateBodyFatNavy({
          sex: bodyFatForm.sex || 'male',
          heightInches,
          weightLbs,
          neckInches,
          waistInches,
          hipInches: bodyFatForm.sex === 'female' ? hipInches || undefined : undefined,
        });
      }
    }

    let covertBailey: number | null = null;
    if (age && wristInches) {
      const canCalculateMale = bodyFatForm.sex === 'male' && waistInches && hipInches && forearmInches;
      const canCalculateFemale = bodyFatForm.sex === 'female' && hipInches && thighInches && calfInches;
      if (canCalculateMale || canCalculateFemale) {
        covertBailey = estimateBodyFatCovertBailey({
          sex: bodyFatForm.sex || 'male',
          age,
          waistInches: waistInches || undefined,
          hipInches: hipInches || undefined,
          forearmInches: forearmInches || undefined,
          wristInches,
          thighInches: thighInches || undefined,
          calfInches: calfInches || undefined,
        });
      }
    }

    const bmi = weightLbs && heightInches ? calculateBmi(weightLbs, heightInches) : null;
    if (!navy && !covertBailey && !bmi) return null;

    return {
      navy,
      covertBailey,
      bmi,
    };
  }, [bodyFatForm]);

  const plan = calorieForm.plan;
  const fromWatch = (() => {
    const age = asNumber(calorieForm.age);
    const heightInches = asNumber(calorieForm.heightInches);
    const weightLbs = asNumber(calorieForm.weightLbs);
    if (!age || !heightInches || !weightLbs || !Object.keys(healthDays).length) return null;
    return measuredActivity(healthDays, { sex: calorieForm.sex || 'male', age, heightInches, weightLbs });
  })();
  /** Freeze the calculator's numbers as a plan starting on the projection start date (or today). */
  const startPlan = async () => {
    if (!calorieMetrics) return;
    const weightLbs = asNumber(calorieForm.weightLbs);
    const age = asNumber(calorieForm.age);
    const heightInches = asNumber(calorieForm.heightInches);
    if (!weightLbs || !age || !heightInches) return;
    if (plan && !(await confirm({ title: 'Replace plan', message: 'Start a new plan with these numbers? The current plan is replaced; your weigh-ins are kept.', confirmLabel: 'Replace plan' }))) return;
    const next: WeightPlan = {
      startDate: calorieForm.startDate || today,
      startWeightLbs: weightLbs,
      targetCalories: calorieMetrics.targetCalories,
      goalRate: calorieForm.goalRate || 0,
      weeks: calorieMetrics.timelineWeeks,
      sex: calorieForm.sex || 'male',
      age,
      heightInches,
      activityLevel: calorieForm.activityLevel || 'moderate',
      createdAt: new Date().toISOString(),
    };
    setCalorieForm({ ...calorieForm, plan: next });
    if (isSampleMode) return;
    // Save now (not on the usual delay) and follow the plan in Health & plan.
    await fetch('/api/workout/calculator-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calculatorDefaults: { calorie: { ...calorieForm, plan: next } } }),
    }).catch(() => {});
    window.location.href = '/workout/health?tab=plan';
  };

  if (loading) {
    return <div className="workout-tile" style={{ textAlign: 'center' }}>Loading calculators...</div>;
  }

  if (needsLogin) {
    return (
      <div className="workout-tile" style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 0.75rem 0' }}>Login Required</h2>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>Calculator inputs are saved per workout user, so login is required unless you launch this page in sample mode.</p>
        <button className="workout-btn-primary" style={{ marginTop: 0 }} onClick={() => { window.location.href = '/workout?showLogin=1'; }}>
          Go to Workout Login
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Calculators"
        subtitle={isSampleMode ? 'Sample mode: inputs are local only and are not saved.' : 'Inputs are saved to your profile; results stay on this page.'}
        actions={!isSampleMode ? <span style={{ fontSize: '0.75rem', color: saving ? 'var(--accent)' : saveFailed ? 'var(--danger)' : 'var(--muted)' }}>{saving ? 'Saving…' : saveFailed ? 'Couldn’t save' : 'Saved'}</span> : undefined}
      />

      <div className="workout-tile" style={{ padding: '0.5rem', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
        <button className="btn btn-secondary" style={{ padding: '0.85rem', borderRadius: '12px', borderColor: activeTab === 'calorie' ? 'var(--accent)' : 'var(--surface-border)', color: activeTab === 'calorie' ? 'var(--accent)' : 'var(--foreground)' }} onClick={() => setActiveTab('calorie')}>
          Calories
        </button>
        <button className="btn btn-secondary" style={{ padding: '0.85rem', borderRadius: '12px', borderColor: activeTab === 'bodyFat' ? 'var(--accent)' : 'var(--surface-border)', color: activeTab === 'bodyFat' ? 'var(--accent)' : 'var(--foreground)' }} onClick={() => setActiveTab('bodyFat')}>
          Body Fat
        </button>
      </div>

      {activeTab === 'calorie' ? (
        <div>
          {plan && !isSampleMode && (
            <a className="workout-tile calc-plan-link" href="/workout/health?tab=plan">
              <span aria-hidden>📋</span>
              <span>
                <strong>Your plan is running</strong>
                <small>{plan.targetCalories.toLocaleString()} kcal a day for {plan.weeks} weeks · track it, log weigh-ins and see your real calories in Health &amp; plan.</small>
              </span>
              <span aria-hidden>›</span>
            </a>
          )}
          <p className="workout-hint" style={{ margin: '0 0 0.75rem' }}>Try out numbers here — nothing changes your plan unless you start a new one.</p>
          {(<div>
          <div className="workout-tile">
            <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Calorie Calculator</h3>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setShowCalorieInfo((v) => !v)}>
                {showCalorieInfo ? 'Hide ⓘ' : 'Formulas ⓘ'}
              </button>
            </div>
            {showCalorieInfo && (
              <div className="animate-fade-in" style={{ marginBottom: '0.75rem', background: 'var(--input-bg)', borderRadius: '10px', padding: '0.75rem', fontSize: '0.8rem', lineHeight: 1.6 }}>
                <div><strong>Mifflin-St Jeor BMR:</strong> male = (10*kg) + (6.25*cm) - (5*age) + 5, female = (10*kg) + (6.25*cm) - (5*age) - 161.</div>
                <div><strong>Maintenance:</strong> BMR multiplied by activity multiplier based on your selected lifestyle.</div>
                <div><strong>Target calories:</strong> maintenance + (goalRate * 500), where 500 kcal/day is about 1 lb/week.</div>
                <div><strong>Projection:</strong> weekly weight change = ((target - maintenance) * 7) / 3500.</div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
              <div>
                <label htmlFor="calorie-height-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Height (inches)</label>
                <input id="calorie-height-inches" className="workout-input" type="number" value={calorieForm.heightInches} onChange={(e) => setCalorieForm({ ...calorieForm, heightInches: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="calorie-weight-lbs" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Weight (lbs)</label>
                <input id="calorie-weight-lbs" className="workout-input" type="number" value={calorieForm.weightLbs} onChange={(e) => setCalorieForm({ ...calorieForm, weightLbs: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="calorie-age" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Age</label>
                <input id="calorie-age" className="workout-input" type="number" value={calorieForm.age} onChange={(e) => setCalorieForm({ ...calorieForm, age: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="calorie-sex" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Sex</label>
                <select id="calorie-sex" className="workout-input" value={calorieForm.sex} onChange={(e) => setCalorieForm({ ...calorieForm, sex: e.target.value as 'male' | 'female' })}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <label htmlFor="calorie-activity-level" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Activity Level</label>
            <select id="calorie-activity-level" className="workout-input" value={calorieForm.activityLevel} onChange={(e) => setCalorieForm({ ...calorieForm, activityLevel: e.target.value as typeof calorieForm.activityLevel })}>
              {ACTIVITY_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>{level.label}</option>
              ))}
            </select>
            <p style={{ margin: '0.35rem 0 0.75rem 0', color: 'var(--muted)', fontSize: '0.75rem' }}>
              {ACTIVITY_LEVELS.find((level) => level.value === calorieForm.activityLevel)?.description}
            </p>
            {fromWatch?.level && (
              <div className="calc-watch">
                <span>
                  ⌚ Apple Health: {describeActivity(fromWatch)}
                  {fromWatch.level.value === calorieForm.activityLevel ? <> — matches <strong>{fromWatch.level.label}</strong>.</> : <> — that&apos;s <strong>{fromWatch.level.label}</strong>.</>}
                </span>
                {fromWatch.level.value !== calorieForm.activityLevel && (
                  <button type="button" className="workout-button is-small" onClick={() => setCalorieForm({ ...calorieForm, activityLevel: fromWatch.level!.value })}>Use it</button>
                )}
              </div>
            )}

            <label htmlFor="calorie-goal" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Goal</label>
            <select id="calorie-goal" className="workout-input" value={calorieForm.goalRate} onChange={(e) => setCalorieForm({ ...calorieForm, goalRate: Number(e.target.value) })}>
              {GOAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
              <div>
                <label htmlFor="calorie-timeline-weeks" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Timeline (weeks)</label>
                <select id="calorie-timeline-weeks" className="workout-input" value={calorieForm.timelineWeeks || 12} onChange={(e) => setCalorieForm({ ...calorieForm, timelineWeeks: Number(e.target.value) })}>
                  {Array.from({ length: 22 }, (_, idx) => 8 + (idx * 2)).map((weeks) => (
                    <option key={weeks} value={weeks}>{weeks} wk</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="calorie-projection-start-date" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Projection start date</label>
                <input id="calorie-projection-start-date" className="workout-input" type="date" value={calorieForm.startDate || ''} onChange={(e) => setCalorieForm({ ...calorieForm, startDate: e.target.value })} />
              </div>
            </div>
          </div>

          {calorieMetrics ? (
            <>
              <div className="workout-tile">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', textAlign: 'center' }}>
                  <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>BMR</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{calorieMetrics.bmr}</div>
                  </div>
                  <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Maintenance</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{calorieMetrics.maintenanceCalories}</div>
                  </div>
                  <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Target</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>{calorieMetrics.targetCalories}</div>
                  </div>
                </div>
              </div>

              <div className="workout-tile">
                <h3 style={{ margin: '0 0 0.75rem 0' }}>{calorieMetrics.timelineWeeks}-Week Projection</h3>
                <div style={{ height: '220px', marginBottom: '0.75rem' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={calorieMetrics.projection}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey={calorieForm.startDate ? 'shortDate' : 'week'}
                        tick={{ fill: 'var(--muted)', fontSize: 12 }}
                        label={{ value: calorieForm.startDate ? 'Date' : 'Week', position: 'insideBottom', offset: -2, fill: 'var(--muted)', fontSize: 12 }}
                      />
                      <YAxis
                        tick={{ fill: 'var(--muted)', fontSize: 12 }}
                        width={50}
                        domain={[calorieMetrics.yMin, calorieMetrics.yMax]}
                        label={{ value: 'Weight (lbs)', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 12 }}
                      />
                      <Tooltip
                        contentStyle={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '10px', color: 'var(--foreground)' }}
                        labelFormatter={(_, payload) => payload && payload[0]?.payload ? `${payload[0].payload.dateLabel}` : ''}
                        formatter={(value) => [`${Number(value ?? 0).toFixed(1)} lbs`, 'Weight']}
                      />
                      <Line type="monotone" dataKey="weightLbs" stroke="var(--accent)" strokeWidth={3} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {(() => {
                  const points = calorieMetrics.projection;
                  const last = points[points.length - 1];
                  const totalChange = points.reduce((sum, point) => sum + point.weeklyChangeLbs, 0);
                  return last ? (
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                      Ending at <strong style={{ color: 'var(--accent)' }}>{last.weightLbs.toFixed(1)} lbs</strong>
                      {calorieForm.startDate ? ` by ${last.dateLabel}` : ` after ${points.length} weeks`}
                      {' '}({totalChange >= 0 ? '+' : ''}{totalChange.toFixed(1)} lbs).
                    </p>
                  ) : null;
                })()}
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem' }}>Week-by-week breakdown</summary>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                    <thead>
                      <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                        <th style={{ padding: '0.35rem 0.25rem', fontWeight: 500 }}>Week</th>
                        <th style={{ padding: '0.35rem 0.25rem', fontWeight: 500, textAlign: 'right' }}>Weight</th>
                        <th style={{ padding: '0.35rem 0.25rem', fontWeight: 500, textAlign: 'right' }}>Maint. kcal</th>
                        <th style={{ padding: '0.35rem 0.25rem', fontWeight: 500, textAlign: 'right' }}>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calorieMetrics.projection.map((point) => (
                        <tr key={point.week} style={{ borderTop: '1px solid var(--surface-border)' }}>
                          <td style={{ padding: '0.35rem 0.25rem' }}>{point.week}{point.shortDate ? ` · ${point.shortDate}` : ''}</td>
                          <td style={{ padding: '0.35rem 0.25rem', textAlign: 'right', fontWeight: 600 }}>{point.weightLbs.toFixed(1)}</td>
                          <td style={{ padding: '0.35rem 0.25rem', textAlign: 'right' }}>{point.maintenanceCalories}</td>
                          <td style={{ padding: '0.35rem 0.25rem', textAlign: 'right', color: 'var(--muted)' }}>{point.weeklyChangeLbs > 0 ? '+' : ''}{point.weeklyChangeLbs.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <div className="wp-start">
                  <button type="button" className={plan ? 'btn btn-secondary' : 'workout-btn-primary'} style={{ margin: 0, width: '100%', padding: '0.8rem', borderRadius: '12px' }} onClick={startPlan}>
                    {plan ? 'Replace my plan with these numbers' : 'Start a plan with these numbers'}
                  </button>
                  <p className="workout-hint">
                    Starts {calorieForm.startDate ? new Date(`${calorieForm.startDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'today'} at {calorieForm.weightLbs} lb on {calorieMetrics.targetCalories.toLocaleString()} kcal a day for {calorieMetrics.timelineWeeks} weeks.
                    Your weigh-ins (typed in, or from your scale via Apple Health) are then tracked against it.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="workout-tile">
              <p style={{ margin: 0, color: 'var(--muted)' }}>Enter height, weight, age, sex, activity level, and a weekly goal to calculate calories and build your projection timeline.</p>
            </div>
          )}
          </div>)}
        </div>
      ) : (
        <div>
          <div className="workout-tile">
            <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Body Fat Estimator</h3>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setShowBodyFatInfo((v) => !v)}>
                {showBodyFatInfo ? 'Hide ⓘ' : 'Formulas ⓘ'}
              </button>
            </div>
            {showBodyFatInfo && (
              <div className="animate-fade-in" style={{ marginBottom: '0.75rem', background: 'var(--input-bg)', borderRadius: '10px', padding: '0.75rem', fontSize: '0.8rem', lineHeight: 1.6 }}>
                <div><strong>U.S. Navy:</strong> uses log measurements of neck/waist/height (+hip for women) to estimate body fat %.</div>
                <div><strong>Covert-Bailey:</strong> anthropometric estimate using age plus circumferences, with sex-specific equations.</div>
                <div><strong>BMI:</strong> (weight in lbs / height in inches²) * 703.</div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
              <div>
                <label htmlFor="bodyfat-sex" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Sex</label>
                <select id="bodyfat-sex" className="workout-input" value={bodyFatForm.sex} onChange={(e) => setBodyFatForm({ ...bodyFatForm, sex: e.target.value as 'male' | 'female' })}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div>
                <label htmlFor="bodyfat-height-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Height (inches)</label>
                <input id="bodyfat-height-inches" className="workout-input" type="number" value={bodyFatForm.heightInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, heightInches: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="bodyfat-weight-lbs" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Weight (lbs)</label>
                <input id="bodyfat-weight-lbs" className="workout-input" type="number" value={bodyFatForm.weightLbs} onChange={(e) => setBodyFatForm({ ...bodyFatForm, weightLbs: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="bodyfat-age" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Age</label>
                <input id="bodyfat-age" className="workout-input" type="number" value={bodyFatForm.age} onChange={(e) => setBodyFatForm({ ...bodyFatForm, age: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="bodyfat-neck-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Neck (inches)</label>
                <input id="bodyfat-neck-inches" className="workout-input" type="number" value={bodyFatForm.neckInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, neckInches: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="bodyfat-waist-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Waist (inches)</label>
                <input id="bodyfat-waist-inches" className="workout-input" type="number" value={bodyFatForm.waistInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, waistInches: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              {bodyFatForm.sex === 'female' && (
                <div>
                  <label htmlFor="bodyfat-hip-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Hip (inches)</label>
                  <input id="bodyfat-hip-inches" className="workout-input" type="number" value={bodyFatForm.hipInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, hipInches: e.target.value === '' ? '' : Number(e.target.value) })} />
                </div>
              )}
              {bodyFatForm.sex === 'male' && (
                <>
                  <div>
                    <label htmlFor="bodyfat-hip-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Hip (inches)</label>
                    <input id="bodyfat-hip-inches" className="workout-input" type="number" value={bodyFatForm.hipInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, hipInches: e.target.value === '' ? '' : Number(e.target.value) })} />
                  </div>
                  <div>
                    <label htmlFor="bodyfat-forearm-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Forearm (inches)</label>
                    <input id="bodyfat-forearm-inches" className="workout-input" type="number" value={bodyFatForm.forearmInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, forearmInches: e.target.value === '' ? '' : Number(e.target.value) })} />
                  </div>
                </>
              )}
              {bodyFatForm.sex === 'female' && (
                <>
                  <div>
                    <label htmlFor="bodyfat-thigh-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Thigh (inches)</label>
                    <input id="bodyfat-thigh-inches" className="workout-input" type="number" value={bodyFatForm.thighInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, thighInches: e.target.value === '' ? '' : Number(e.target.value) })} />
                  </div>
                  <div>
                    <label htmlFor="bodyfat-calf-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Calf (inches)</label>
                    <input id="bodyfat-calf-inches" className="workout-input" type="number" value={bodyFatForm.calfInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, calfInches: e.target.value === '' ? '' : Number(e.target.value) })} />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="bodyfat-wrist-inches" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Wrist (inches)</label>
                <input id="bodyfat-wrist-inches" className="workout-input" type="number" value={bodyFatForm.wristInches} onChange={(e) => setBodyFatForm({ ...bodyFatForm, wristInches: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
            </div>
          </div>

          {bodyFatMetrics ? (
            <div className="workout-tile">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', textAlign: 'center', marginBottom: '0.5rem' }}>
                <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Navy Body Fat</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>
                    {typeof bodyFatMetrics.navy?.bodyFatPercentage === 'number' ? `${bodyFatMetrics.navy.bodyFatPercentage.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Covert-Bailey</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                    {typeof bodyFatMetrics.covertBailey === 'number' ? `${bodyFatMetrics.covertBailey.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>BMI</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{typeof bodyFatMetrics.bmi === 'number' ? bodyFatMetrics.bmi.toFixed(1) : 'N/A'}</div>
                </div>
              </div>
              {bodyFatMetrics.navy && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem', textAlign: 'center' }}>
                  <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Lean Mass (Navy)</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{bodyFatMetrics.navy.leanMassLbs.toFixed(1)} lbs</div>
                  </div>
                  <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Fat Mass (Navy)</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{bodyFatMetrics.navy.fatMassLbs.toFixed(1)} lbs</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="workout-tile">
              <p style={{ margin: 0, color: 'var(--muted)' }}>Enter body measurements to calculate U.S. Navy body fat, Covert-Bailey body fat, and BMI.</p>
            </div>
          )}
        </div>
      )}
      {popup}
    </div>
  );
}
