import { NextResponse } from 'next/server';
import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { dayTotals, frequentFoods, mealTotals, recentFoods, shiftDate } from '@/lib/food/log';
import { dateParam } from '@/lib/food/resolve';
import { loadFoodContext, loadFoodData, targetsFor } from '@/lib/food/store';
import { MEALS } from '@/lib/food/types';

// Everything the Food page shows for one day (?date=YYYY-MM-DD): entries,
// totals and targets, plus recent and frequent foods, saved meals, and which
// of the day before's meals can be copied. ?brief=1 is just totals and targets,
// for the card on the Train page.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const url = new URL(request.url);
    const date = dateParam(url.searchParams.get('date'));
    const [data, ctx] = await Promise.all([loadFoodData(userId), loadFoodContext(userId, date)]);
    const entries = data.days[date] ?? [];
    const totals = dayTotals(entries);
    const targets = targetsFor(data, ctx, date);
    if (url.searchParams.get('brief') === '1') {
      return NextResponse.json({ success: true, date, totals, targets, entries: entries.length }, { headers: PRIVATE });
    }
    const previous = shiftDate(date, -1);
    return NextResponse.json({
      success: true,
      date,
      entries,
      totals,
      meals: mealTotals(entries),
      targets,
      exerciseKcal: ctx.exercise[date] ?? null,
      plan: ctx.plan,
      latestWeight: ctx.latestWeight,
      settings: data.settings,
      recent: recentFoods(data, 30),
      frequent: frequentFoods(data, date),
      savedMeals: data.meals,
      previous: { date: previous, meals: MEALS.filter((m) => (data.days[previous] ?? []).some((e) => e.meal === m)) },
    }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load food day failed');
  }
}
