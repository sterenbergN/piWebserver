import { NextResponse } from 'next/server';
import { logBodyweights } from '@/lib/workout/bodyweight';
import { publicHealth } from '@/lib/workout/health';
import { createImportKey, deleteUserHealth, refreshUserWorkoutHealth, updateUserHealth } from '@/lib/workout/health-store';
import { loadUserHistory } from '@/lib/workout/history';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Your Apple Health data and its sync key (the phone sends data to ./import).

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    // Workouts saved since the last upload get matched now.
    const health = await refreshUserWorkoutHealth(userId);
    return NextResponse.json({ success: true, health: publicHealth(health, await loadUserHistory(userId)) });
  } catch (error) {
    return handleApiError(error, 'Load health data failed');
  }
}

/** { action: 'createKey' } → a new key, shown once; { action: 'revokeKey' } stops syncing; { action: 'logDaily', date, weight?, calories?, protein? } saves daily manual stats. */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const { action } = body;
    if (action === 'createKey') {
      const key = await createImportKey(userId);
      return NextResponse.json({ success: true, key });
    }
    if (action === 'revokeKey') {
      await updateUserHealth(userId, (health) => {
        delete health.keyHash;
        delete health.keyHint;
        delete health.keyCreatedAt;
      });
      return NextResponse.json({ success: true });
    }
    if (action === 'logDaily') {
      const date = typeof body.date === 'string' && DATE_RE.test(body.date)
        ? body.date
        : new Date().toLocaleDateString('en-CA');
      const hasWeight = body.weight !== undefined && body.weight !== '' && body.weight !== null;
      const hasCalories = body.calories !== undefined && body.calories !== '' && body.calories !== null;
      const hasProtein = body.protein !== undefined && body.protein !== '' && body.protein !== null;
      if (!hasWeight && !hasCalories && !hasProtein) {
        throw new ApiError(400, 'Enter weight, calories, or protein to save.');
      }

      const weight = hasWeight ? Number(body.weight) : null;
      if (weight !== null && (!Number.isFinite(weight) || weight < 50 || weight > 800)) {
        throw new ApiError(400, 'Weight must be between 50 and 800 lbs');
      }
      const calories = hasCalories ? Number(body.calories) : null;
      if (calories !== null && (!Number.isFinite(calories) || calories < 0 || calories > 25000)) {
        throw new ApiError(400, 'Calories must be between 0 and 25,000 kcal');
      }
      const protein = hasProtein ? Number(body.protein) : null;
      if (protein !== null && (!Number.isFinite(protein) || protein < 0 || protein > 2000)) {
        throw new ApiError(400, 'Protein must be between 0 and 2,000 g');
      }

      const entries = weight !== null ? await logBodyweights(userId, [{ date, weight }]) : null;
      const updated = await updateUserHealth(userId, (health) => {
        const day = { ...(health.days[date] || {}) };
        if (weight !== null) day.weight = Math.round(weight * 10) / 10;
        if (calories !== null) day.intakeKcal = Math.round(calories);
        if (protein !== null) day.proteinG = Math.round(protein);
        health.days[date] = day;
        return health;
      });
      const history = await loadUserHistory(userId);
      return NextResponse.json({
        success: true,
        health: publicHealth(updated, history),
        ...(entries ? { entries } : {}),
      });
    }
    throw new ApiError(400, 'Unknown action');
  } catch (error) {
    return handleApiError(error, 'Health action failed');
  }
}

/** Forget all health data and the key. Workouts and bodyweight entries stay. */
export async function DELETE() {
  try {
    const userId = await requireWorkoutUserId();
    await deleteUserHealth(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Delete health data failed');
  }
}
