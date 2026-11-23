import test from 'node:test';
import { strict as assert } from 'node:assert';
import { emptyFoodData, intakeByDay } from '../lib/food/log';
import type { LogEntry } from '../lib/food/types';
import { intakeOn, type HealthDay } from '../lib/workout/health';

const entry = (kcal: number, protein: number, amount = 1): LogEntry => ({
  id: `e${kcal}${amount}`,
  meal: 'lunch',
  foodId: 'f',
  servingId: 's',
  amount,
  at: '2026-11-20T12:00:00.000Z',
  snapshot: { name: 'Food', source: 'custom', servingLabel: '1 serving', nutrients: { kcal, protein, carbs: 0, fat: 0 } },
});

test('intakeByDay adds up each logged day and skips empty ones', () => {
  const data = emptyFoodData();
  data.days['2026-11-20'] = [entry(500, 30), entry(250, 10, 2)];
  data.days['2026-11-21'] = [];
  assert.deepEqual(intakeByDay(data), { '2026-11-20': { kcal: 1000, protein: 50 } });
});

test('a day’s intake comes from the Food log, then an older typed-in number', () => {
  const days: Record<string, HealthDay> = { '2026-11-20': { intakeKcal: 1800, proteinG: 120 }, '2026-11-19': { intakeKcal: 2100 } };
  const food = { '2026-11-20': { kcal: 2250, protein: 160 } };
  assert.deepEqual(intakeOn('2026-11-20', food, days), { kcal: 2250, protein: 160, fromFood: true });
  assert.deepEqual(intakeOn('2026-11-19', food, days), { kcal: 2100, protein: null, fromFood: false });
  assert.deepEqual(intakeOn('2026-11-18', undefined, days), { kcal: null, protein: null, fromFood: false });
});
