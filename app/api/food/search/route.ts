import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { usageStats } from '@/lib/food/log';
import { dateParam } from '@/lib/food/resolve';
import { searchFoods } from '@/lib/food/sources';
import { loadFoodData } from '@/lib/food/store';
import { forViewer } from '@/lib/food/foods';

// Food search across every source for the signed-in account: ?q=…&more=1&date=YYYY-MM-DD.
// Foods this account logs often rank first.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) throw new ApiError(400, 'Type at least two letters.');
    if (q.length > 100) throw new ApiError(400, 'That search is too long.');
    const data = await loadFoodData(userId);
    const result = await searchFoods({
      userId,
      query: q,
      more: url.searchParams.get('more') === '1',
      usage: usageStats(data),
      today: dateParam(url.searchParams.get('date')),
    });
    return NextResponse.json({
      success: true,
      results: result.results.map((h) => ({ food: forViewer(h.food), source: h.source })),
      notices: result.notices,
      searched: result.searched,
      canSearchMore: result.canSearchMore,
    }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Food search failed');
  }
}
