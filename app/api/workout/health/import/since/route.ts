import { NextResponse } from 'next/server';
import { detailSinceMinutes } from '@/lib/workout/health';
import { importKeyFrom, readSyncBody, loadUserHealth, userForImportKey } from '@/lib/workout/health-store';
import { ApiError, handleApiError } from '@/lib/workout/api';

// Asked by daily shortcuts built from an older prompt: how many minutes of
// heart rate and energy readings to send ({ minutes }). Current prompts read
// a fixed day back instead (a date worked out at run time didn't work as a
// Health search filter); kept so those shortcuts don't break. Same key as
// the import.

export async function POST(request: Request) {
  try {
    const body = await readSyncBody(request);
    const key = importKeyFrom(request, body);
    const userId = key ? await userForImportKey(key) : null;
    if (!userId) throw new ApiError(401, 'Unknown or revoked health sync key');
    return NextResponse.json({ success: true, minutes: detailSinceMinutes(await loadUserHealth(userId)) });
  } catch (error) {
    const response = handleApiError(error, 'Health sync check failed');
    const { message } = await response.json();
    return NextResponse.json({ success: false, message, alert: `Health sync failed: ${message}` }, { status: response.status });
  }
}
