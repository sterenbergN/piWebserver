import { NextResponse } from 'next/server';
import { generateId, getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { stationKindIndex, stationMakeModelIndex } from '@/lib/workout/equipment-kinds';
import { applyWorkoutEdit, HISTORY_FILE, isCardioHistoryItem, loadUserHistory, sanitizeWorkoutPayload } from '@/lib/workout/history';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { getCalibrationStore, inferCalibrationsForWorkout, recalibrateAfterEdit, upsertCalibrationEntries } from '@/lib/workout/calibration';
import { resolveWorkoutHabitDate, syncWorkoutHabitForDate } from '@/lib/workout/habit-sync';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const userHistory = await loadUserHistory(userId);
    return NextResponse.json({ success: true, history: userHistory });
  } catch (error) {
    return handleApiError(error, 'Load workout history failed');
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readJsonObject(request);
    const userId = await getAuthenticatedWorkoutUserId();
    if (!userId) {
      // Demo users get a successful no-op so the sample flow completes.
      if (payload.isDemo) return NextResponse.json({ success: true, demo: true });
      throw new ApiError(401, 'Unauthorized');
    }

    if (isCardioHistoryItem(payload)) {
      throw new ApiError(400, 'Cardio history is no longer supported');
    }

    const workout = sanitizeWorkoutPayload(payload);
    if (Object.keys(workout.logs).length === 0) {
      throw new ApiError(400, 'Workout has no logged sets');
    }

    const { entry, previousUserHistory, duplicate } = await updateWorkoutData(
      HISTORY_FILE,
      { history: [] as any[] },
      (data) => {
        if (!Array.isArray(data.history)) data.history = [];
        const previousUserHistory = data.history.filter((h: any) => h.userId === userId);

        // Idempotency: a retried or double-submitted save must not create a duplicate.
        if (workout.clientId) {
          const existing = previousUserHistory.find((h: any) => h.clientId === workout.clientId);
          if (existing) return { entry: existing, previousUserHistory, duplicate: true };
        }

        const entry = { ...workout, id: generateId(), userId };
        data.history.push(entry);
        return { entry, previousUserHistory, duplicate: false };
      },
    );

    if (!duplicate) {
      // Calibration is best-effort; a failure here must not fail the save.
      try {
        const [store, gymData] = await Promise.all([getCalibrationStore(), getWorkoutData('gyms.json', { gyms: [] as any[] })]);
        // Same brand/model or kind of machine at the other gym is the best reference.
        const userGyms = (gymData.gyms || []).filter((g: any) => g.ownerId === userId);
        const stationKinds = stationKindIndex(userGyms);
        const stationMakeModels = stationMakeModelIndex(userGyms);
        const inferred = inferCalibrationsForWorkout(userId, entry, previousUserHistory, store, calcAverage1RM, stationKinds, stationMakeModels);
        await upsertCalibrationEntries(inferred);
      } catch (error) {
        console.error('Calibration inference failed:', error);
      }

      // Auto-tick any active workout-linked habit without creating a file if user doesn't track habits.
      try {
        const habitDate = resolveWorkoutHabitDate(payload.localDate, entry.timestamp);
        await syncWorkoutHabitForDate(userId, habitDate);
      } catch (error) {
        console.error('Workout habit auto-tick failed:', error);
      }
    }

    return NextResponse.json({ success: true, id: entry.id, duplicate });
  } catch (error) {
    return handleApiError(error, 'Save workout failed');
  }
}

/** Fix a saved workout: { logs?, timestamp?, durationSecs?, notes? }. */
export async function PATCH(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new ApiError(400, 'ID missing');
    const payload = await readJsonObject(request);

    const { before, workout, previousUserHistory } = await updateWorkoutData(HISTORY_FILE, { history: [] as any[] }, (data) => {
      const index = (data.history || []).findIndex((h: any) => h.id === id);
      if (index === -1) throw new ApiError(404, 'Not found');
      const before = data.history[index];
      if (before.userId !== userId) throw new ApiError(403, 'Forbidden');
      const edited = applyWorkoutEdit(before, payload);
      if (!edited) throw new ApiError(400, 'A workout needs at least one set — delete it instead');
      data.history[index] = edited;
      const at = new Date(edited.timestamp).getTime();
      const previousUserHistory = data.history.filter((h: any) => h.userId === userId && h.id !== id && new Date(h.timestamp).getTime() < at);
      return { before, workout: edited, previousUserHistory };
    });

    if (payload.logs !== undefined) {
      // Redo machine calibrations that came from the old numbers (best-effort).
      try {
        const [store, gymData] = await Promise.all([getCalibrationStore(), getWorkoutData('gyms.json', { gyms: [] as any[] })]);
        const userGyms = (gymData.gyms || []).filter((g: any) => g.ownerId === userId);
        const stationKinds = stationKindIndex(userGyms);
        const stationMakeModels = stationMakeModelIndex(userGyms);
        await upsertCalibrationEntries(recalibrateAfterEdit(userId, before, workout, previousUserHistory, store, calcAverage1RM, stationKinds, stationMakeModels));
      } catch (error) {
        console.error('Recalibration after edit failed:', error);
      }
    }

    return NextResponse.json({ success: true, workout });
  } catch (error) {
    return handleApiError(error, 'Edit workout failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new ApiError(400, 'ID missing');

    await updateWorkoutData(HISTORY_FILE, { history: [] as any[] }, (data) => {
      const log = (data.history || []).find((h: any) => h.id === id);
      if (!log) throw new ApiError(404, 'Not found');
      if (log.userId !== userId) throw new ApiError(403, 'Forbidden');
      data.history = data.history.filter((h: any) => h.id !== id);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Delete workout failed');
  }
}
