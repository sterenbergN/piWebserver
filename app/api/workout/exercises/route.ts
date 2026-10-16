import { NextResponse } from 'next/server';
import { updateWorkoutData } from '@/lib/workout/data';
import { HISTORY_FILE } from '@/lib/workout/history';
import { exerciseKeyFromName } from '@/lib/workout/exercises';
import { renameInCalibrations, renameInGoals, renameInGyms, renameInHistory } from '@/lib/workout/exercise-admin';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

/**
 * Rename an exercise everywhere, or merge several into one:
 *   { action: 'rename', from: 'Bench', to: 'Bench Press' }
 *   { action: 'merge', from: ['Bench', 'Flat Bench'], to: 'Bench Press' }
 * Updates your gyms, saved workouts, goals and machine calibrations so the
 * exercise keeps all of its history.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const to = typeof body.to === 'string' ? body.to.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    const fromNames: string[] = (Array.isArray(body.from) ? body.from : [body.from])
      .filter((name: unknown): name is string => typeof name === 'string' && !!name.trim())
      .slice(0, 20);
    if (body.action !== 'rename' && body.action !== 'merge') throw new ApiError(400, 'Unknown action');
    if (!to) throw new ApiError(400, 'Enter the new name');
    if (fromNames.length === 0) throw new ApiError(400, 'Nothing to rename');
    const fromKeys = new Set(fromNames.map(exerciseKeyFromName));

    const gyms = await updateWorkoutData('gyms.json', { gyms: [] as any[] }, (data) => {
      const mine = (data.gyms || []).filter((gym: any) => gym.ownerId === userId);
      const changed = renameInGyms(mine, fromKeys, to);
      if (changed === 0) return false;
      mine.forEach((gym: any) => { gym.updatedAt = new Date().toISOString(); });
      return mine;
    });
    const workouts = await updateWorkoutData(HISTORY_FILE, { history: [] as any[] }, (data) => {
      const changed = renameInHistory((data.history || []).filter((w: any) => w.userId === userId), fromKeys, to);
      return changed === 0 ? false : changed;
    });
    await updateWorkoutData('goals.json', { goals: [] as any[] }, (data) => {
      const changed = renameInGoals((data.goals || []).filter((g: any) => g.ownerId === userId), fromKeys, to);
      return changed === 0 ? false : changed;
    });
    await updateWorkoutData('calibration.json', { calibrations: [] as any[] }, (data) => {
      const all = data.calibrations || [];
      const mine = all.filter((c: any) => c.userId === userId);
      const renamed = renameInCalibrations(mine, fromNames, to);
      if (renamed.length === mine.length && renamed.every((c, i) => c === mine[i])) return false;
      data.calibrations = [...all.filter((c: any) => c.userId !== userId), ...renamed];
    });

    return NextResponse.json({ success: true, gyms: gyms || null, workoutsUpdated: workouts || 0 });
  } catch (error) {
    return handleApiError(error, 'Rename exercise failed');
  }
}
