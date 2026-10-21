import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, caloriesToReach, daysBetween, normalizePlan, paceLbsPerWeek, planProgress, projectDaily, type WeightPlan } from './weight-plan';
import { projectWeightTrend } from './calculators';

const profile = { sex: 'male' as const, age: 30, heightInches: 70, activityLevel: 'moderate' as const };
const plan: WeightPlan = { ...profile, startDate: '2026-10-01', startWeightLbs: 200, targetCalories: 2300, goalRate: -1, weeks: 12 };

test('dates count whole days across months', () => {
  assert.equal(daysBetween('2026-10-01', '2026-11-01'), 31);
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
});

test('the daily projection lands close to the weekly calculator projection', () => {
  const daily = projectDaily(profile, 200, 2300, 84);
  const weekly = projectWeightTrend({ ...profile, startingWeightLbs: 200, targetCalories: 2300, weeks: 12 });
  assert.ok(Math.abs(daily[84] - weekly[11].weightLbs) < 0.3);
  assert.ok(daily[84] < 200);
});

test('solved calories reach the requested weight', () => {
  const kcal = caloriesToReach(profile, 195, 188, 42);
  assert.ok(Math.abs(projectDaily(profile, 195, kcal, 42)[42] - 188) < 0.1);
});

test('pace is the trend of the weigh-ins, per week', () => {
  assert.equal(paceLbsPerWeek([{ day: 0, weight: 200 }, { day: 7, weight: 199 }, { day: 14, weight: 198 }]), -1);
  assert.equal(paceLbsPerWeek([{ day: 0, weight: 200 }, { day: 2, weight: 199 }]), null);
});

test('progress compares the latest average with the plan and re-projects from it', () => {
  const p0 = planProgress(plan, [], '2026-10-15');
  // Losing faster than planned: 4 lb down by day 14, plan says about 2.
  const entries = [0, 3, 7, 10, 14].map((d) => ({ date: addDays('2026-10-01', d), weight: 200 - d * 0.3 }));
  const p = planProgress(plan, [{ date: '2026-09-20', weight: 203 }, ...entries], '2026-10-15');
  assert.equal(p0.status, 'no-data');
  assert.equal(p.weighIns.length, 5); // the September weigh-in only warms up the average
  assert.equal(p.current?.day, 14);
  // The trend through the weigh-ins, not a lagging average (which would read about 198.8).
  assert.equal(p.current?.weight, 195.8);
  assert.equal(p.status, 'ahead');
  assert.ok(p.aheadBy! > 0);
  assert.equal(p.reprojection[0].day, 14);
  assert.equal(p.reprojection[0].weight, p.current!.weight);
  assert.equal(p.reprojection[p.reprojection.length - 1].day, 84);
  assert.ok(p.projectedEnd! < p.plannedEnd); // ahead now, so ahead at the end on the same calories
  assert.ok(p.neededCalories! > plan.targetCalories); // could eat a bit more and still finish on plan
  assert.equal(p.pace, -2.1);
});

test('behind and not started', () => {
  const entries = [{ date: '2026-10-01', weight: 200 }, { date: '2026-10-29', weight: 201 }];
  assert.equal(planProgress(plan, entries, '2026-10-29').status, 'behind');
  assert.equal(planProgress({ ...plan, startDate: '2026-11-01' }, entries, '2026-10-29').status, 'not-started');
});

test('saved plans are validated', () => {
  assert.deepEqual(normalizePlan({ ...plan, extra: 1 }), { ...plan, createdAt: undefined });
  assert.equal(normalizePlan({ ...plan, startDate: 'soon' }), undefined);
  assert.equal(normalizePlan({ ...plan, targetCalories: 50 }), undefined);
  assert.equal(normalizePlan(null), undefined);
});
