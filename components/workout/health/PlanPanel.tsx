'use client';

import './health.css';
import { useMemo, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import WeightPlanCard from '@/components/workout/WeightPlanCard';
import { useSitePopup } from '@/components/SitePopup';
import { ACTIVITY_LEVELS, calculateMifflinStJeor, type ActivityLevel, type CalculatorDefaults } from '@/lib/workout/calculators';
import { describeActivity, measuredActivity } from '@/lib/workout/coach';
import { addDays, planProgress, projectDaily, type WeighIn, type WeightPlan } from '@/lib/workout/weight-plan';
import type { HealthDay } from '@/lib/workout/health';

type Calorie = NonNullable<CalculatorDefaults['calorie']>;

export const GOAL_OPTIONS = [
  { value: -2, label: 'Lose 2 lb a week' },
  { value: -1.5, label: 'Lose 1.5 lb a week' },
  { value: -1, label: 'Lose 1 lb a week' },
  { value: -0.5, label: 'Lose ½ lb a week' },
  { value: 0, label: 'Maintain' },
  { value: 0.5, label: 'Gain ½ lb a week' },
  { value: 1, label: 'Gain 1 lb a week' },
];
const WEEK_OPTIONS = [4, 6, 8, 10, 12, 16, 20, 24, 30, 36, 52];

type Props = {
  calorie: Calorie;
  /** Save calculator/plan settings (merged into what's saved). */
  onSave: (patch: Omit<Partial<Calorie>, 'plan'> & { plan?: WeightPlan | null }) => Promise<void>;
  days: Record<string, HealthDay>;
  weighIns: WeighIn[];
  onLog: (weight: number) => Promise<void>;
  today: string;
};

const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

/** The form for starting or changing a plan, with a live preview of what it means. */
function PlanForm({ calorie, latestWeight, measured, plan, today, onSubmit, submitLabel }: {
  calorie: Calorie;
  latestWeight: number | null;
  measured: ReturnType<typeof measuredActivity> | null;
  plan?: WeightPlan;
  today: string;
  onSubmit: (plan: WeightPlan, restart: boolean) => void;
  submitLabel: string;
}) {
  const [goal, setGoal] = useState<number>(plan?.goalRate ?? (calorie.goalRate || -1));
  const [weeks, setWeeks] = useState<number>(plan?.weeks ?? calorie.timelineWeeks ?? 12);
  const [start, setStart] = useState<string>(plan?.startDate ?? today);
  const [weight, setWeight] = useState<string>(String(plan?.startWeightLbs ?? latestWeight ?? calorie.weightLbs ?? ''));
  const [level, setLevel] = useState<ActivityLevel>(plan?.activityLevel ?? measured?.level?.value ?? calorie.activityLevel ?? 'moderate');
  const [height, setHeight] = useState<string>(String(plan?.heightInches ?? calorie.heightInches ?? ''));
  const [age, setAge] = useState<string>(String(plan?.age ?? calorie.age ?? ''));
  const [sex, setSex] = useState<'male' | 'female'>(plan?.sex ?? calorie.sex ?? 'male');
  const [restart, setRestart] = useState(false);

  const w = parseFloat(weight);
  const h = parseFloat(height);
  const a = parseFloat(age);
  const ready = w > 50 && h > 36 && a > 10;
  const preview = useMemo(() => {
    if (!ready) return null;
    const profile = { sex, age: a, heightInches: h, activityLevel: level };
    const maintenance = Math.round(calculateMifflinStJeor({ ...profile, weightLbs: w }).maintenanceCalories);
    const target = Math.round(maintenance + goal * 500);
    const end = projectDaily(profile, w, target, weeks * 7)[weeks * 7];
    return { maintenance, target, end: Math.round(end * 10) / 10 };
  }, [ready, sex, a, h, level, w, goal, weeks]);
  const missing = !ready ? 'Add your weight, height and age to see the plan.' : '';

  return (
    <div className="pp-form">
      <div className="workout-grid-2">
        <label className="pp-field">
          <span>Goal</span>
          <select className="workout-input" value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            {GOAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="pp-field">
          <span>For</span>
          <select className="workout-input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[...new Set([...WEEK_OPTIONS, weeks])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n} weeks</option>)}
          </select>
        </label>
        <label className="pp-field">
          <span>Starting weight (lb)</span>
          <input className="workout-input" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          {latestWeight !== null && !plan && <small>Latest weigh-in</small>}
        </label>
        <label className="pp-field">
          <span>Start date</span>
          <input className="workout-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      <label className="pp-field">
        <span>Activity level</span>
        <select className="workout-input" value={level} onChange={(e) => setLevel(e.target.value as ActivityLevel)}>
          {ACTIVITY_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}{measured?.level?.value === l.value ? ' — measured' : ''}</option>)}
        </select>
        {measured?.level && <small>Apple Health: {describeActivity(measured)} → {measured.level.label}.</small>}
      </label>
      <details className="hc-more">
        <summary>Your details</summary>
        <div className="workout-grid-3" style={{ marginTop: '0.5rem' }}>
          <label className="pp-field"><span>Height (in)</span><input className="workout-input" type="number" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          <label className="pp-field"><span>Age</span><input className="workout-input" type="number" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></label>
          <label className="pp-field"><span>Sex</span>
            <select className="workout-input" value={sex} onChange={(e) => setSex(e.target.value as 'male' | 'female')}><option value="male">Male</option><option value="female">Female</option></select>
          </label>
        </div>
      </details>
      {plan && (
        <label className="workout-switch-row">
          <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />
          <span>Restart from today at {latestWeight ?? plan.startWeightLbs} lb (otherwise the plan keeps its start date and weight)</span>
        </label>
      )}
      {preview ? (
        <div className="pp-preview">
          <div><span>Maintenance</span><strong>{preview.maintenance.toLocaleString()}</strong><small>kcal a day</small></div>
          <div><span>Eat</span><strong>{preview.target.toLocaleString()}</strong><small>kcal a day</small></div>
          <div><span>By {fmtDate(addDays(start, weeks * 7)).replace(/, \d{4}$/, '')}</span><strong>{preview.end} lb</strong><small>{preview.end - w > 0 ? '+' : ''}{(preview.end - w).toFixed(1)} lb</small></div>
        </div>
      ) : <p className="workout-hint">{missing}</p>}
      <button
        type="button"
        className="workout-button is-primary is-block"
        disabled={!preview}
        onClick={() => preview && onSubmit({
          startDate: restart ? today : start,
          startWeightLbs: restart && latestWeight ? latestWeight : w,
          targetCalories: preview.target,
          goalRate: goal,
          weeks,
          sex,
          age: a,
          heightInches: h,
          activityLevel: level,
          createdAt: plan && !restart ? plan.createdAt : new Date().toISOString(),
        }, restart)}
      >
        {submitLabel}
      </button>
    </div>
  );
}

/**
 * The weight and calorie plan in one place: the plan's progress (planned
 * line, weigh-ins, re-projection), your calories from every source that's
 * available — weigh-ins, Apple Health, the formula — and the activity level
 * your data shows. Without a plan, a short form starts one.
 */
export default function PlanPanel({ calorie, onSave, days, weighIns, onLog, today }: Props) {
  const { confirm, popup } = useSitePopup();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const plan = calorie.plan;
  const latestWeight = weighIns.length ? weighIns[weighIns.length - 1].weight : null;
  const profile = useMemo(() => {
    const age = num(plan?.age ?? calorie.age);
    const heightInches = num(plan?.heightInches ?? calorie.heightInches);
    const weightLbs = latestWeight ?? num(calorie.weightLbs);
    return age && heightInches && weightLbs ? { sex: (plan?.sex ?? calorie.sex ?? 'male') as 'male' | 'female', age, heightInches, weightLbs } : null;
  }, [plan, calorie, latestWeight]);
  const measured = useMemo(() => (profile ? measuredActivity(days, profile) : null), [days, profile]);
  const progress = useMemo(() => (plan ? planProgress(plan, weighIns, today) : null), [plan, weighIns, today]);

  const chosenLevel = plan?.activityLevel ?? calorie.activityLevel ?? 'moderate';
  const formula = profile ? Math.round(calculateMifflinStJeor({ ...profile, activityLevel: chosenLevel }).maintenanceCalories / 10) * 10 : null;
  const estimates = [
    progress?.realMaintenance ? { key: 'weighins', label: 'From your weigh-ins', kcal: progress.realMaintenance.kcal, note: `trend since ${fmtDate(plan!.startDate).replace(/, \d{4}$/, '')}, if you ate the plan's calories` } : null,
    measured?.maintenance && measured.basis === 'calories' ? { key: 'health', label: 'From Apple Health', kcal: measured.maintenance, note: `resting + active, last ${measured.days} days` } : null,
    formula ? { key: 'formula', label: 'From the formula', kcal: formula, note: `your size and ${ACTIVITY_LEVELS.find((l) => l.value === chosenLevel)?.label} activity` } : null,
  ].filter((e): e is { key: string; label: string; kcal: number; note: string } => !!e);
  const best = estimates[0];

  const save = async (patch: Parameters<Props['onSave']>[0]) => {
    setSaving(true);
    try { await onSave(patch); } finally { setSaving(false); }
  };
  const submit = async (next: WeightPlan) => {
    await save({ plan: next, goalRate: next.goalRate, timelineWeeks: next.weeks, activityLevel: next.activityLevel, startDate: next.startDate, weightLbs: next.startWeightLbs, heightInches: next.heightInches, age: next.age, sex: next.sex });
    setEditing(false);
  };
  const endPlan = async () => {
    if (!(await confirm({ title: 'End plan', message: 'End this plan? Your weigh-ins are kept.', confirmLabel: 'End plan', danger: true }))) return;
    await save({ plan: null });
  };
  const useMeasured = async () => {
    if (!measured?.level) return;
    if (plan) setEditing(true);
    else await save({ activityLevel: measured.level.value });
  };

  return (
    <div className="an-stack">
      {plan ? (
        <WeightPlanCard plan={plan} entries={weighIns} today={today} onLog={onLog} onEdit={() => setEditing(true)} onEnd={endPlan} />
      ) : (
        <section className="workout-tile an-card">
          <h2>Start a plan</h2>
          <p className="workout-hint" style={{ margin: '-0.25rem 0 0.75rem' }}>
            Pick a goal and how long; your weight{measured?.level ? ' and activity level come' : ' comes'} from your data. Then every weigh-in is tracked against the plan.
          </p>
          <PlanForm calorie={calorie} latestWeight={latestWeight} measured={measured} today={today} onSubmit={submit} submitLabel={saving ? 'Saving…' : 'Start plan'} />
        </section>
      )}

      <section className="workout-tile an-card">
        <div className="an-card-head"><h2>Your calories</h2>{plan && <span className="workout-hint">Plan: {plan.targetCalories.toLocaleString()} kcal a day</span>}</div>
        {estimates.length === 0 ? (
          <p className="workout-hint" style={{ margin: 0 }}>Add your height, age and weight (start a plan above, or in the calorie calculator) to see your maintenance calories.</p>
        ) : (
          <div className="pp-estimates">
            {estimates.map((e) => (
              <div key={e.key} className={e === best ? 'is-best' : ''}>
                <span>{e.label}{e === best && estimates.length > 1 ? ' · best guess' : ''}</span>
                <strong>{e.kcal.toLocaleString()} <small>kcal to maintain</small></strong>
                <small>{e.note}</small>
              </div>
            ))}
          </div>
        )}
        {best && plan && Math.abs(best.kcal - (formula ?? best.kcal)) >= 100 && best.key !== 'formula' && (
          <p className="workout-hint" style={{ margin: '0.6rem 0 0' }}>
            Your real maintenance differs from the formula by about {Math.abs(best.kcal - formula!).toLocaleString()} kcal, so the plan&apos;s {plan.targetCalories.toLocaleString()} kcal is really a
            {' '}{best.kcal - plan.targetCalories >= 0 ? `${(best.kcal - plan.targetCalories).toLocaleString()} kcal deficit` : `${(plan.targetCalories - best.kcal).toLocaleString()} kcal surplus`} — about {(Math.abs(best.kcal - plan.targetCalories) * 7 / 3500).toFixed(1)} lb a week.
          </p>
        )}
      </section>

      <section className="workout-tile an-card">
        <h2>Activity level</h2>
        {measured?.level ? (<>
          <p className="pp-activity">
            <strong>{measured.level.label}</strong>
            <span className="hc-coach-badge">measured</span>
          </p>
          <p className="workout-hint" style={{ margin: '0.25rem 0 0' }}>Apple Health: {describeActivity(measured)}.</p>
          {measured.level.value !== chosenLevel ? (
            <div className="calc-watch" style={{ margin: '0.6rem 0 0' }}>
              <span>Your {plan ? 'plan' : 'calculator'} uses <strong>{ACTIVITY_LEVELS.find((l) => l.value === chosenLevel)?.label}</strong>.</span>
              <button type="button" className="workout-button is-small" disabled={saving} onClick={useMeasured}>{plan ? 'Update plan' : `Use ${measured.level.label}`}</button>
            </div>
          ) : <p className="workout-hint" style={{ margin: '0.4rem 0 0' }}>✓ Matches what your {plan ? 'plan' : 'calculator'} uses.</p>}
        </>) : (
          <p className="workout-hint" style={{ margin: 0 }}>
            Your activity level is worked out from a week of calories burned (resting + active) or steps from Apple Health.
            {measured ? ` ${measured.days} of 7 days so far.` : ''} Until then the plan uses {ACTIVITY_LEVELS.find((l) => l.value === chosenLevel)?.label}.
          </p>
        )}
      </section>

      <p className="workout-hint" style={{ textAlign: 'center', margin: 0 }}>
        Trying out numbers? The <a href="/workout/calculators" className="workout-text-btn" style={{ textDecoration: 'underline' }}>calorie calculator</a> works without changing your plan.
      </p>

      {editing && plan && (
        <Sheet title="Change plan" subtitle={`Started ${fmtDate(plan.startDate)}`} onClose={() => setEditing(false)}>
          <PlanForm calorie={calorie} latestWeight={latestWeight} measured={measured} plan={{ ...plan, activityLevel: measured?.level && measured.level.value !== plan.activityLevel ? measured.level.value : plan.activityLevel }} today={today} onSubmit={submit} submitLabel={saving ? 'Saving…' : 'Save plan'} />
        </Sheet>
      )}
      {popup}
    </div>
  );
}
