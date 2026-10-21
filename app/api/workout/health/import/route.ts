import { NextResponse } from 'next/server';
import { applyHealthImport, describeSync, refreshWorkoutHealth } from '@/lib/workout/health';
import { updateUserHealth, userForImportKey } from '@/lib/workout/health-store';
import { loadUserHistory } from '@/lib/workout/history';
import { logBodyweights } from '@/lib/workout/bodyweight';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';

// Where the phone sends Apple Health data (an iOS Shortcut's "Get Contents of
// URL"). It has no login cookie, so the user's import key authorises it:
// header "Authorization: Bearer nsh_...". The format is in lib/workout/health.ts.

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const bearer = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1];
    const key = (bearer || request.headers.get('x-health-key') || String(body.key || '')).trim();
    const userId = key ? await userForImportKey(key) : null;
    if (!userId) throw new ApiError(401, 'Unknown or revoked health sync key');

    const history = await loadUserHistory(userId);
    const { summary, weights } = await updateUserHealth(userId, (health) => {
      const result = applyHealthImport(health, body);
      Object.assign(health, result.health);
      refreshWorkoutHealth(health, history);
      return result;
    });
    // Scale readings join the bodyweight log (and set the profile weight).
    await logBodyweights(userId, weights);

    // The shortcut shows this as a notification, so problems are spelled out.
    return NextResponse.json({ success: true, received: summary, message: describeSync(summary) });
  } catch (error) {
    return handleApiError(error, 'Health import failed');
  }
}
