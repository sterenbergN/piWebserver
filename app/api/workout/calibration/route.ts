import { NextResponse } from 'next/server';
import { getCalibrationStore, upsertCalibrationEntry } from '@/lib/workout/calibration';
import { normalizeLiftKey } from '@/lib/workout/calibration-utils';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

export async function GET() {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

  const store = await getCalibrationStore();
  const calibrations = store.calibrations.filter(c => c.userId === userId);
  return NextResponse.json({ success: true, calibrations });
}

export async function PATCH(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

  try {
    const { gymId, liftKey: rawLiftKey, stationType, scaleFactor, confidence } = await request.json();

    if (!gymId || !rawLiftKey) {
      return NextResponse.json({ success: false, message: 'Missing gymId or liftKey' }, { status: 400 });
    }

    const entry = await upsertCalibrationEntry({
      userId,
      gymId,
      liftKey: normalizeLiftKey(rawLiftKey),
      stationType: stationType || 'stack',
      scaleFactor: typeof scaleFactor === 'number' ? scaleFactor : 1.0,
      confidence: typeof confidence === 'number' ? confidence : 0.5,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}
