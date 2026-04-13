import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCalibrationStore } from '@/lib/workout/calibration';

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('workout_auth')?.value;
  if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

  const store = await getCalibrationStore();
  const calibrations = store.calibrations.filter(c => c.userId === userId);
  return NextResponse.json({ success: true, calibrations });
}
