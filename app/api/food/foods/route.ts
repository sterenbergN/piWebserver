import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { generateId } from '@/lib/workout/data';
import { buildCustomFood, FoodInputError, type CustomFoodInput } from '@/lib/food/foods';
import { getFood, keepInLibrary } from '@/lib/food/sources';
import { removeCustomFood } from '@/lib/food/sources/library';
import { createLimiter } from '@/lib/security/rate-limit';

// One food by id (GET ?id=usda:171477), with every serving, from wherever it
// can be had. POST makes a food from a nutrition label ({ action: 'custom', food })
// or removes one you made ({ action: 'remove', id }).

const PRIVATE = { 'Cache-Control': 'no-store, private' };
// The library is shared, so one account can't flood it with made-up foods.
const customFoods = createLimiter({ max: 60, windowMs: 60 * 60_000 });

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id') || '';
    const { food, notice } = await getFood(id.slice(0, 100), userId);
    if (!food) throw new ApiError(404, notice || 'Couldn’t find that food.');
    return NextResponse.json({ success: true, food }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load food failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    if (body.action === 'custom') {
      if (customFoods.retryAfter(userId) > 0) throw new ApiError(429, 'That’s a lot of new foods for one hour. Try again later.');
      customFoods.hit(userId);
      let food;
      try {
        food = buildCustomFood((body.food ?? {}) as CustomFoodInput, generateId());
      } catch (error) {
        if (error instanceof FoodInputError) throw new ApiError(400, error.message);
        throw error;
      }
      await keepInLibrary(food, userId);
      return NextResponse.json({ success: true, food }, { headers: PRIVATE });
    }
    if (body.action === 'remove') {
      const ok = await removeCustomFood(String(body.id || '').slice(0, 100), userId);
      if (!ok) throw new ApiError(404, 'Only foods you made yourself can be removed.');
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }
    throw new ApiError(400, 'Unknown change.');
  } catch (error) {
    return handleApiError(error, 'Save food failed');
  }
}
