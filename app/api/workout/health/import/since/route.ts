import { NextResponse } from 'next/server';
import { detailSinceMinutes } from '@/lib/workout/health';
import { importKeyFrom, updateUserHealth, userForImportKey } from '@/lib/workout/health-store';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';

// Asked by the daily shortcut before it reads Health: how many minutes of
// heart rate and energy readings to send ({ minutes }), so it only sends
// what's new. Same key as the import.

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const key = importKeyFrom(request, body);
    const userId = key ? await userForImportKey(key) : null;
    if (!userId) throw new ApiError(401, 'Unknown or revoked health sync key');
    // Noted so a sync that then sends no heart rate can say which step failed.
    const minutes = await updateUserHealth(userId, (health) => {
      const answer = detailSinceMinutes(health);
      health.lastSinceAsk = { at: new Date().toISOString(), minutes: answer };
      return answer;
    });
    return NextResponse.json({ success: true, minutes });
  } catch (error) {
    const response = handleApiError(error, 'Health sync check failed');
    const { message } = await response.json();
    return NextResponse.json({ success: false, message, alert: `Health sync failed: ${message}` }, { status: response.status });
  }
}
