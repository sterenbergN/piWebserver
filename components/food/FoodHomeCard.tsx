'use client';

import './food.css';
import { useEffect, useState } from 'react';
import { fmt, localDateKey } from '@/lib/food/client';
import type { Targets } from '@/lib/food/targets';
import type { Nutrients } from '@/lib/food/types';
import { fetchWorkoutJson } from '@/lib/workout/offline-cache';

/** "Today: 1,450 / 2,100 kcal · 120 g protein" on the Train page, linking to the Food page. */
export default function FoodHomeCard() {
  const [day, setDay] = useState<{ totals: Nutrients; targets: Targets; entries: number } | null>(null);

  useEffect(() => {
    fetchWorkoutJson(`/api/food/day?brief=1&date=${localDateKey()}`).then((res) => {
      if (res.data?.success) setDay(res.data);
    });
  }, []);

  if (!day) return null;
  const { totals, targets } = day;
  const share = targets.kcal > 0 ? Math.min(100, (totals.kcal / targets.kcal) * 100) : 0;
  return (
    <a className="food-home" href="/workout/food">
      <span aria-hidden style={{ fontSize: '1.4rem' }}>🍽️</span>
      <span className="food-home-body">
        <strong>Today: {fmt(totals.kcal)} / {fmt(targets.kcal)} kcal · {Math.round(totals.protein)} g protein</strong>
        <small>{day.entries ? `${fmt(Math.max(targets.kcal - totals.kcal, 0))} kcal and ${Math.max(Math.round(targets.protein - totals.protein), 0)} g protein to go` : 'Nothing logged yet today'}</small>
        <span className="food-bar" aria-hidden><span style={{ width: `${share}%` }} /></span>
      </span>
      <span className="food-home-go">{day.entries ? 'Food ›' : 'Log ›'}</span>
    </a>
  );
}
