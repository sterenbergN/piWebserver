import { NextResponse } from 'next/server';
import { getCalibrationStore, upsertCalibrationEntry } from '@/lib/workout/calibration';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const store = await getCalibrationStore();
    const calibrations = store.calibrations.filter(c => c.userId === userId);
    return NextResponse.json({ success: true, calibrations });
  } catch (error) {
    return handleApiError(error, 'List calibrations failed');
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { gymId, liftKey, stationType, scaleFactor, confidence } = await readJsonObject(request);

    if (typeof gymId !== 'string' || !gymId || typeof liftKey !== 'string' || !liftKey.trim()) {
      throw new ApiError(400, 'Missing gymId or liftKey');
    }

    // upsertCalibrationEntry normalizes the key and clamps scale/confidence.
    const entry = await upsertCalibrationEntry({
      userId,
      gymId,
      liftKey,
      stationType: stationType === 'cable' ? 'cable' : 'stack',
      scaleFactor: typeof scaleFactor === 'number' ? scaleFactor : 1.0,
      confidence: typeof confidence === 'number' ? confidence : 0.5,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    return handleApiError(error, 'Save calibration failed');
  }
}
