import test from 'node:test';
import { strict as assert } from 'node:assert';
import { FoodInputError } from './foods';
import {
  applyLogAction, cleanSettings, dateRange, dayTotals, DEFAULT_SETTINGS, emptyFoodData, frequentFoods, isDateKey, mealForTime, mealTotals,
  normalizeFoodData, recentFoods, shiftDate, snapshotFor, usageStats, type LogAction, type ResolvedItem,
} from './log';
import { estimateMaintenance, slopePerDay } from './maintenance';
import { exerciseKcalFor, resolveTargets } from './targets';
import type { Food, FoodUserData } from './types';

let n = 0;
const newId = () => `e${++n}`;
const now = new Date(Date.UTC(2026, 10, 20, 12));
const apply = (data: FoodUserData, action: LogAction) => applyLogAction(data, action, now, newId);

const oats: Food = {
  id: 'usda:1', source: 'usda', sourceId: '1', name: 'Oats',
  servings: [
    { id: 'p0', label: '1 cup (80 g)', grams: 80, nutrients: { kcal: 300, protein: 10, carbs: 54, fat: 5, fiber: 8 } },
    { id: '100g', label: '100 g', grams: 100, nutrients: { kcal: 375, protein: 12.5, carbs: 67.5, fat: 6.3, fiber: 10 } },
  ],
};
const item = (food: Food, servingIndex = 0, amount = 1): ResolvedItem => ({ foodId: food.id, servingId: food.servings[servingIndex].id, amount, snapshot: snapshotFor(food, food.servings[servingIndex]) });

test('date keys and meal by time of day', () => {
  assert.ok(isDateKey('2026-11-20'));
  assert.ok(!isDateKey('2026-02-30'));
  assert.ok(!isDateKey('20261120'));
  assert.ok(!isDateKey(null));
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(dateRange('2026-11-20', 3), ['2026-11-18', '2026-11-19', '2026-11-20']);
  assert.equal(mealForTime(new Date(2026, 0, 1, 7, 30)), 'breakfast');
  assert.equal(mealForTime(new Date(2026, 0, 1, 12)), 'lunch');
  assert.equal(mealForTime(new Date(2026, 0, 1, 16)), 'snack');
  assert.equal(mealForTime(new Date(2026, 0, 1, 19)), 'dinner');
  assert.equal(mealForTime(new Date(2026, 0, 1, 23)), 'snack');
});

test('add, total, edit, move and remove entries', () => {
  const data = emptyFoodData();
  const [entry] = apply(data, { type: 'add', date: '2026-11-20', meal: 'breakfast', items: [item(oats, 0, 1.5)] });
  assert.equal(entry.snapshot.name, 'Oats');
  assert.deepEqual(dayTotals(data.days['2026-11-20']), { kcal: 450, protein: 15, carbs: 81, fat: 7.5, fiber: 12 });
  apply(data, { type: 'edit', date: '2026-11-20', id: entry.id, amount: 2, meal: 'snack' });
  assert.equal(data.days['2026-11-20'][0].amount, 2);
  assert.equal(mealTotals(data.days['2026-11-20']).snack.kcal, 600);
  apply(data, { type: 'edit', date: '2026-11-20', id: entry.id, serving: { servingId: '100g', snapshot: snapshotFor(oats, oats.servings[1]) }, amount: 0.5 });
  assert.equal(dayTotals(data.days['2026-11-20']).kcal, 188);
  apply(data, { type: 'edit', date: '2026-11-20', id: entry.id, moveTo: '2026-11-19' });
  assert.equal(data.days['2026-11-20'], undefined);
  assert.equal(data.days['2026-11-19'].length, 1);
  apply(data, { type: 'remove', date: '2026-11-19', ids: [entry.id] });
  assert.deepEqual(data.days, {});
  assert.throws(() => apply(data, { type: 'edit', date: '2026-11-19', id: 'gone', amount: 1 }), FoodInputError);
  assert.throws(() => apply(data, { type: 'add', date: '2026-11-20', meal: 'brunch' as never, items: [item(oats)] }), FoodInputError);
  assert.throws(() => apply(data, { type: 'add', date: 'yesterday', meal: 'lunch', items: [item(oats)] }), FoodInputError);
  assert.throws(() => apply(data, { type: 'add', date: '2026-11-20', meal: 'lunch', items: [item(oats, 0, 0)] }), FoodInputError);
  assert.throws(() => apply(data, { type: 'add', date: '2026-11-20', meal: 'lunch', items: [item(oats, 0, 10000)] }), FoodInputError);
});

test('quick add, restore after delete, copy a meal', () => {
  const data = emptyFoodData();
  const [q] = apply(data, { type: 'quick', date: '2026-11-19', meal: 'lunch', nutrients: { kcal: 650, protein: 30 } });
  assert.equal(q.foodId, 'quick');
  assert.equal(q.snapshot.name, 'Quick add');
  assert.throws(() => apply(data, { type: 'quick', date: '2026-11-19', meal: 'lunch', nutrients: { kcal: 0 } }), FoodInputError);
  apply(data, { type: 'add', date: '2026-11-19', meal: 'lunch', items: [item(oats)] });
  const removed = data.days['2026-11-19'].slice();
  apply(data, { type: 'remove', date: '2026-11-19', ids: removed.map((e) => e.id) });
  apply(data, { type: 'restore', date: '2026-11-19', entries: removed });
  assert.equal(data.days['2026-11-19'].length, 2);
  const copied = apply(data, { type: 'copy-meal', fromDate: '2026-11-19', fromMeal: 'lunch', date: '2026-11-20', meal: 'dinner' });
  assert.equal(copied.length, 2);
  assert.ok(copied.every((e) => e.meal === 'dinner' && !removed.some((r) => r.id === e.id)));
  assert.equal(dayTotals(data.days['2026-11-20']).kcal, 950);
  assert.throws(() => apply(data, { type: 'copy-meal', fromDate: '2026-11-19', fromMeal: 'breakfast', date: '2026-11-20', meal: 'dinner' }), FoodInputError);
});

test('saved meals: save from a day, save items, rename, replace by name, remove', () => {
  const data = emptyFoodData();
  apply(data, { type: 'add', date: '2026-11-20', meal: 'breakfast', items: [item(oats), item(oats, 1, 0.5)] });
  apply(data, { type: 'save-meal-from', name: 'Usual breakfast', date: '2026-11-20', meal: 'breakfast' });
  assert.equal(data.meals.length, 1);
  assert.equal(data.meals[0].items.length, 2);
  apply(data, { type: 'save-meal', name: 'usual BREAKFAST', items: [item(oats)] });
  assert.equal(data.meals.length, 1);
  assert.equal(data.meals[0].items.length, 1);
  apply(data, { type: 'rename-meal', id: data.meals[0].id, name: 'Oats' });
  assert.equal(data.meals[0].name, 'Oats');
  assert.throws(() => apply(data, { type: 'save-meal', name: '', items: [item(oats)] }), FoodInputError);
  assert.throws(() => apply(data, { type: 'save-meal-from', name: 'Empty', date: '2026-11-20', meal: 'dinner' }), FoodInputError);
  apply(data, { type: 'remove-meal', id: data.meals[0].id });
  assert.equal(data.meals.length, 0);
});

test('normalizeFoodData drops junk and keeps good entries', () => {
  const data = emptyFoodData();
  apply(data, { type: 'add', date: '2026-11-20', meal: 'breakfast', items: [item(oats)] });
  const raw = JSON.parse(JSON.stringify(data));
  raw.days['2026-11-20'].push({ id: 'x', meal: 'breakfast', snapshot: { name: 'No kcal', nutrients: {} }, amount: 1 });
  raw.days['not-a-date'] = [data.days['2026-11-20'][0]];
  raw.meals = [{ id: 'm', name: 'Empty', items: [] }];
  raw.settings = { kcalTarget: 99999, addExercise: 'yes', proteinPerLb: 1 };
  const clean = normalizeFoodData(raw);
  assert.deepEqual(Object.keys(clean.days), ['2026-11-20']);
  assert.equal(clean.days['2026-11-20'].length, 1);
  assert.equal(clean.meals.length, 0);
  assert.deepEqual(clean.settings, { ...DEFAULT_SETTINGS, proteinPerLb: 1 });
  assert.deepEqual(normalizeFoodData(null), emptyFoodData());
});

test('cleanSettings sets, clears and range-checks targets', () => {
  const s = cleanSettings({ kcalTarget: '2100', proteinTarget: 160, planTarget: 'needed', addExercise: true });
  assert.equal(s.kcalTarget, 2100);
  assert.equal(s.proteinTarget, 160);
  assert.equal(s.planTarget, 'needed');
  assert.equal(s.addExercise, true);
  const cleared = cleanSettings({ kcalTarget: '' }, s);
  assert.equal(cleared.kcalTarget, undefined);
  assert.equal(cleared.proteinTarget, 160);
  assert.equal(cleanSettings({ kcalTarget: 100 }).kcalTarget, undefined);
  assert.equal(cleanSettings({ proteinPerLb: 5 }).proteinPerLb, 0.8);
});

test('usage, recent and frequent foods come from the log, quick adds aside', () => {
  const data = emptyFoodData();
  const rice: Food = { ...oats, id: 'usda:2', sourceId: '2', name: 'Rice' };
  apply(data, { type: 'add', date: '2026-11-10', meal: 'lunch', items: [item(rice)] });
  apply(data, { type: 'add', date: '2026-11-18', meal: 'breakfast', items: [item(oats)] });
  apply(data, { type: 'add', date: '2026-11-19', meal: 'breakfast', items: [item(oats, 1, 0.8)] });
  apply(data, { type: 'quick', date: '2026-11-19', meal: 'snack', nutrients: { kcal: 100 } });
  assert.deepEqual(usageStats(data), { 'usda:2': { count: 1, last: '2026-11-10' }, 'usda:1': { count: 2, last: '2026-11-19' } });
  const recent = recentFoods(data);
  assert.deepEqual(recent.map((r) => r.foodId), ['usda:1', 'usda:2']);
  assert.equal(recent[0].servingId, '100g');
  assert.equal(recent[0].amount, 0.8);
  assert.deepEqual(frequentFoods(data, '2026-11-20').map((f) => f.foodId), ['usda:1']);
});

// ─── Targets ──────────────────────────────────────────────────────────────────

test('targets: own > plan (or needed) > default; protein from bodyweight; exercise optional', () => {
  const base = { ...DEFAULT_SETTINGS };
  let t = resolveTargets({ settings: base, planKcal: 2100, neededKcal: 1950, weightLbs: 200 });
  assert.equal(t.kcal, 2100);
  assert.equal(t.kcalSource, 'plan');
  assert.equal(t.protein, 160);
  assert.equal(t.proteinSource, 'bodyweight');
  assert.equal(t.fat, 70);
  assert.equal(t.carbs, Math.round((2100 - 640 - 630) / 4));
  t = resolveTargets({ settings: { ...base, planTarget: 'needed' }, planKcal: 2100, neededKcal: 1950 });
  assert.equal(t.kcal, 1950);
  assert.equal(t.kcalSource, 'needed');
  t = resolveTargets({ settings: { ...base, planTarget: 'needed' }, planKcal: 2100, neededKcal: null });
  assert.equal(t.kcalSource, 'plan');
  t = resolveTargets({ settings: { ...base, kcalTarget: 2500, proteinTarget: 180 }, planKcal: 2100, weightLbs: 200 });
  assert.equal(t.kcal, 2500);
  assert.equal(t.protein, 180);
  t = resolveTargets({ settings: base });
  assert.equal(t.kcal, 2000);
  assert.equal(t.kcalSource, 'default');
  assert.equal(t.proteinSource, 'default');
  t = resolveTargets({ settings: base, planKcal: 2000, exerciseKcal: 400 });
  assert.equal(t.kcal, 2000);
  assert.equal(t.exerciseKcal, 0);
  t = resolveTargets({ settings: { ...base, addExercise: true }, planKcal: 2000, exerciseKcal: 400 });
  assert.equal(t.kcal, 2400);
  assert.equal(t.baseKcal, 2000);
  assert.equal(t.exerciseKcal, 400);
  assert.equal(exerciseKcalFor(512.4, [300]), 512);
  assert.equal(exerciseKcalFor(undefined, [300, 150]), 450);
  assert.equal(exerciseKcalFor(0, []), null);
});

// ─── Maintenance ──────────────────────────────────────────────────────────────

test('slope of a line', () => {
  assert.equal(slopePerDay([{ day: 0, value: 200 }, { day: 10, value: 199 }]), -0.1);
  assert.equal(slopePerDay([{ day: 0, value: 200 }]), null);
  assert.equal(slopePerDay([{ day: 3, value: 200 }, { day: 3, value: 201 }]), null);
});

test('estimateMaintenance: intake minus 3,500 kcal per lb of trend, needs two weeks', () => {
  const today = '2026-11-28';
  const intake: Record<string, number> = {};
  const weighIns: { date: string; weight: number }[] = [];
  // 27 days at 2,000 kcal while losing 0.5 lb/week → maintenance 2,000 + 250 = 2,250.
  for (let i = 1; i <= 27; i++) {
    const date = shiftDate(today, -i);
    intake[date] = 2000;
    if (i % 3 === 0) weighIns.push({ date, weight: 200 - (0.5 / 7) * (27 - i) });
  }
  intake[today] = 300; // today's half-logged day is ignored
  intake[shiftDate(today, -40)] = 5000; // outside the window
  const { estimate, shortfall } = estimateMaintenance(intake, weighIns, today);
  assert.equal(shortfall, null);
  assert.equal(estimate!.kcal, 2250);
  assert.equal(estimate!.avgIntake, 2000);
  assert.equal(estimate!.weeklyChange, -0.5);
  assert.equal(estimate!.loggedDays, 27);
  assert.equal(estimate!.confidence, 'good');

  // Half-logged days (under 800) don't count.
  const sparse = { ...intake };
  for (let i = 1; i <= 15; i++) sparse[shiftDate(today, -i)] = 500;
  const short = estimateMaintenance(sparse, weighIns, today);
  assert.equal(short.estimate, null);
  assert.equal(short.shortfall!.loggedDays, 12);

  // Weigh-ins bunched into a few days aren't enough.
  const bunched = estimateMaintenance(intake, weighIns.slice(0, 3), today);
  assert.equal(bunched.estimate, null);
});
