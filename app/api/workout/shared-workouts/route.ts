import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { HISTORY_FILE } from '@/lib/workout/history';
import { findWorkoutUser } from '@/lib/workout/users';
import { buildShareSnapshot, findImportedGym, missingFromGym, SHARES_FILE, type SharedWorkout } from '@/lib/workout/workout-share';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import type { Gym } from '@/lib/workout/types';

// Share a finished workout by link (see lib/workout/workout-share.ts). Anyone
// logged in with the link can see it, import its gym once, and do it with their
// own weights.

type SharesFile = { shares: SharedWorkout[] };
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);

    // Either a saved workout (history id) or the one just finished (its save payload).
    let workout: any = null;
    if (typeof body.historyId === 'string') {
      const data = await getWorkoutData<{ history: any[] }>(HISTORY_FILE, { history: [] });
      workout = (data.history || []).find((w) => w.id === body.historyId && w.userId === userId);
      if (!workout) throw new ApiError(404, 'Workout not found');
    } else if (body.workout && typeof body.workout === 'object') {
      workout = body.workout;
    } else {
      throw new ApiError(400, 'Nothing to share');
    }

    const gyms = await getWorkoutData<{ gyms: Gym[] }>('gyms.json', { gyms: [] });
    const gym = (gyms.gyms || []).find((g) => g.id === workout.gymId && g.ownerId === userId);
    if (!gym) throw new ApiError(400, 'Only workouts at one of your own gyms can be shared');
    const snapshot = buildShareSnapshot(workout, gym);
    if (snapshot.lifts.length === 0) throw new ApiError(400, 'This workout has no logged lifts to share');

    const owner = await findWorkoutUser(userId);
    const share: SharedWorkout = {
      token: crypto.randomBytes(12).toString('base64url'),
      ownerId: userId,
      ownerName: String(owner?.username || 'Someone'),
      createdAt: new Date().toISOString(),
      title: String(workout.type?.name || workout.name || 'Workout').slice(0, 120),
      typeName: typeof workout.type?.name === 'string' ? workout.type.name.slice(0, 120) : undefined,
      timestamp: typeof workout.timestamp === 'string' ? workout.timestamp : new Date().toISOString(),
      durationSecs: Number.isFinite(Number(workout.durationSecs)) ? Number(workout.durationSecs) : undefined,
      ...snapshot,
    };
    await updateWorkoutData<SharesFile>(SHARES_FILE, { shares: [] }, (data) => {
      const cutoff = Date.now() - MAX_AGE_MS;
      data.shares = [...(data.shares || []).filter((s) => new Date(s.createdAt).getTime() > cutoff), share];
    });
    return NextResponse.json({ success: true, token: share.token });
  } catch (error) {
    return handleApiError(error, 'Share workout failed');
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const token = new URL(request.url).searchParams.get('token') || '';
    if (!TOKEN.test(token)) throw new ApiError(404, 'Link not found');
    const data = await getWorkoutData<SharesFile>(SHARES_FILE, { shares: [] });
    const share = (data.shares || []).find((s) => s.token === token);
    if (!share) throw new ApiError(404, 'This workout link has expired');

    const gyms = await getWorkoutData<{ gyms: Gym[] }>('gyms.json', { gyms: [] });
    const mine = (gyms.gyms || []).filter((g) => g.ownerId === userId);
    const isOwner = share.ownerId === userId;
    const imported = isOwner ? mine.find((g) => g.id === share.gym.id) : findImportedGym(mine, share.ownerId, share.gym.id);
    return NextResponse.json({
      success: true,
      share,
      isOwner,
      imported: imported ? { gymId: imported.id, name: imported.name, emoji: imported.emoji, missing: missingFromGym(imported, share.gym) } : null,
    });
  } catch (error) {
    return handleApiError(error, 'Open shared workout failed');
  }
}
