import { NextResponse } from 'next/server';
import { getCalibrationStore } from '@/lib/workout/calibration';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

export async function GET() {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

  const store = await getCalibrationStore();
  const calibrations = store.calibrations.filter(c => c.userId === userId);
  return NextResponse.json({ success: true, calibrations });
}
