import { NextResponse } from 'next/server';
import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { dateRange, dayTotals } from '@/lib/food/log';
import { round } from '@/lib/food/nutrients';
import { dateParam } from '@/lib/food/resolve';
import { loadFoodContext, loadFoodData, maintenanceInsight, targetsFor } from '@/lib/food/store';

// The week (or ?days=14/28) ending ?end=YYYY-MM-DD: each day's totals against
// its target, averages over the days something was logged, and the
// maintenance estimate from logs and weigh-ins.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const url = new URL(request.url);
    const end = dateParam(url.searchParams.get('end'));
    const span = [7, 14, 28].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 7;
    const [data, ctx] = await Promise.all([loadFoodData(userId), loadFoodContext(userId, end)]);
    const days = dateRange(end, span).map((date) => {
      const entries = data.days[date] ?? [];
      const t = targetsFor(data, ctx, date);
      return { date, totals: dayTotals(entries), logged: entries.length > 0, target: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat } };
    });
    const logged = days.filter((d) => d.logged);
    const avg = (pick: (d: (typeof days)[number]) => number) => (logged.length ? round(logged.reduce((s, d) => s + pick(d), 0) / logged.length, 0) : 0);
    return NextResponse.json({
      success: true,
      end,
      days,
      averages: {
        loggedDays: logged.length,
        kcal: avg((d) => d.totals.kcal),
        protein: avg((d) => d.totals.protein),
        carbs: avg((d) => d.totals.carbs),
        fat: avg((d) => d.totals.fat),
        targetKcal: avg((d) => d.target.kcal),
        targetProtein: avg((d) => d.target.protein),
      },
      insight: maintenanceInsight(data, ctx, end),
    }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load food week failed');
  }
}
