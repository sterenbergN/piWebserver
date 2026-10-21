import { NextResponse } from 'next/server';
import { publicHealth } from '@/lib/workout/health';
import { createImportKey, deleteUserHealth, refreshUserWorkoutHealth, updateUserHealth } from '@/lib/workout/health-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

// Your Apple Health data and its sync key (the phone sends data to ./import).

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    // Workouts saved since the last upload get matched now.
    const health = await refreshUserWorkoutHealth(userId);
    return NextResponse.json({ success: true, health: publicHealth(health) });
  } catch (error) {
    return handleApiError(error, 'Load health data failed');
  }
}

/** { action: 'createKey' } → a new key, shown once; { action: 'revokeKey' } stops syncing. */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { action } = await readJsonObject(request);
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
    throw new ApiError(400, 'Unknown action');
  } catch (error) {
    return handleApiError(error, 'Health key change failed');
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
