import { NextResponse } from 'next/server';
import { applyHealthImport, describeSync, refreshWorkoutHealth, syncAlert } from '@/lib/workout/health';
import { importKeyFrom, updateUserHealth, userForImportKey } from '@/lib/workout/health-store';
import { loadUserHistory } from '@/lib/workout/history';
import { logBodyweights } from '@/lib/workout/bodyweight';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';

// Where the phone sends Apple Health data (an iOS Shortcut's "Get Contents of
// URL"). It has no login cookie, so the user's import key authorises it:
// header "Authorization: Bearer nsh_...". The format is in lib/workout/health.ts.

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const key = importKeyFrom(request, body);
    const userId = key ? await userForImportKey(key) : null;
    if (!userId) throw new ApiError(401, 'Unknown or revoked health sync key');

    const history = await loadUserHistory(userId);
    const { summary, weights, newestHeartRateMs, sinceAsk } = await updateUserHealth(userId, (health) => {
      const newest = health.hr.length ? health.hr[health.hr.length - 1][0] * 1000 : null;
      const asked = health.lastSinceAsk;
      const result = applyHealthImport(health, body);
      Object.assign(health, result.health);
      refreshWorkoutHealth(health, history);
      return { ...result, newestHeartRateMs: newest, sinceAsk: asked };
    });
    // Scale readings join the bodyweight log (and set the profile weight).
    await logBodyweights(userId, weights);

    // "message" is what arrived (the 30-day shortcut shows it). The daily one
    // runs on its own and only shows "alert", which is empty when all is well.
    return NextResponse.json({ success: true, received: summary, message: describeSync(summary), alert: syncAlert(summary, newestHeartRateMs, Date.now(), sinceAsk) });
  } catch (error) {
    const response = handleApiError(error, 'Health import failed');
    const { message } = await response.json();
    return NextResponse.json({ success: false, message, alert: `Health sync failed: ${message}` }, { status: response.status });
  }
}
