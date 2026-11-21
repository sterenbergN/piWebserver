import { NextResponse } from 'next/server';
import { handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { cleanSettings } from '@/lib/food/log';
import { loadFoodData, updateFoodData } from '@/lib/food/store';

// The account's food targets. Blank targets follow the weight plan and bodyweight.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    return NextResponse.json({ success: true, settings: (await loadFoodData(userId)).settings }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load food settings failed');
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const { data } = await updateFoodData(userId, (d) => { d.settings = cleanSettings(body.settings, d.settings); });
    return NextResponse.json({ success: true, settings: data.settings }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save food settings failed');
  }
}
