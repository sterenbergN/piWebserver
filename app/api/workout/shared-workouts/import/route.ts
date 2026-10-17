import { NextResponse } from 'next/server';
import { generateId, getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { findImportedGym, gymFromSnapshot, mergeSnapshotIntoGym, SHARES_FILE, type SharedWorkout } from '@/lib/workout/workout-share';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import type { Gym } from '@/lib/workout/types';

/**
 * Bring a shared workout's gym into your account: the first time it creates a
 * copy (remembering where it came from); after that it adds only the machines
 * and lifts your copy doesn't have yet. Returns the gym to do the workout in.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { token } = await readJsonObject(request);
    const shares = await getWorkoutData<{ shares: SharedWorkout[] }>(SHARES_FILE, { shares: [] });
    const share = (shares.shares || []).find((s) => s.token === token);
    if (!share) throw new ApiError(404, 'This workout link has expired');
    if (share.ownerId === userId) throw new ApiError(400, 'This is your own workout — its gym is already yours');

    const result = await updateWorkoutData('gyms.json', { gyms: [] as Gym[] }, (data) => {
      const mine = (data.gyms || []).filter((g) => g.ownerId === userId);
      const existing = findImportedGym(mine, share.ownerId, share.gym.id);
      if (existing) {
        const merged = mergeSnapshotIntoGym(existing, share.gym);
        if (merged.addedStations === 0 && merged.addedLifts === 0) return { gym: existing, created: false, addedStations: 0, addedLifts: 0 };
        existing.stations = merged.stations;
        (existing as any).updatedAt = new Date().toISOString();
        return { gym: existing, created: false, addedStations: merged.addedStations, addedLifts: merged.addedLifts };
      }
      const gym = {
        id: generateId(),
        ownerId: userId,
        isPublic: false,
        createdAt: new Date().toISOString(),
        ...gymFromSnapshot(share.gym, { id: share.ownerId, name: share.ownerName }),
      } as Gym;
      data.gyms = [...(data.gyms || []), gym];
      return { gym, created: true, addedStations: gym.stations.length, addedLifts: gym.stations.reduce((n, s) => n + s.lifts.length, 0) };
    });

    return NextResponse.json({ success: true, gym: result.gym, created: result.created, addedStations: result.addedStations, addedLifts: result.addedLifts });
  } catch (error) {
    return handleApiError(error, 'Import shared workout failed');
  }
}
