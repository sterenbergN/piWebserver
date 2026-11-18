import { createOwnedCollectionHandlers } from '@/lib/workout/owned-collection';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { getWorkoutData } from '@/lib/workout/data';
import { ensureStarterWorkoutTypes, WORKOUT_TYPES_FILE } from '@/lib/workout/starter-types';

function toInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeType(type: any) {
  return {
    ...type,
    name: typeof type?.name === 'string' ? type.name.trim() : '',
    muscles: Array.isArray(type?.muscles) ? type.muscles.filter((m: unknown) => typeof m === 'string') : [],
    intensity: toInt(type?.intensity, 75, 1, 100),
    minReps: toInt(type?.minReps, 8, 1, 100),
    maxReps: toInt(type?.maxReps, 12, 1, 100),
    sets: toInt(type?.sets, 4, 1, 20),
    isPublic: type?.isPublic === true,
    fixedLifts: Array.isArray(type?.fixedLifts)
      ? type.fixedLifts
          .filter((ref: any) => ref && typeof ref.liftId === 'string' && typeof ref.name === 'string')
          .slice(0, 20)
          .map((ref: any) => ({ liftId: ref.liftId.slice(0, 80), name: ref.name.slice(0, 120) }))
      : [],
  };
}

const handlers = createOwnedCollectionHandlers({
  file: WORKOUT_TYPES_FILE,
  key: 'types',
  itemKey: 'type',
  normalize: normalizeType,
  buildNew: (payload) => ({
    name: payload.name,
    muscles: payload.muscles,
    intensity: payload.intensity,
    minReps: payload.minReps,
    maxReps: payload.maxReps,
    sets: payload.sets,
    fixedLifts: payload.fixedLifts,
  }),
  validate: (type) => {
    if (!type.name) throw new ApiError(400, 'Workout type name is required');
    if (type.minReps > type.maxReps) throw new ApiError(400, 'Min reps cannot exceed max reps');
  },
});

export const { POST, PUT, DELETE } = handlers;

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const data = await getWorkoutData<{ types?: any[]; seededUsers?: string[] }>(WORKOUT_TYPES_FILE, { types: [], seededUsers: [] });
    const list = Array.isArray(data.types) ? data.types : [];
    const alreadySeeded = Array.isArray(data.seededUsers) && data.seededUsers.includes(userId);
    if (!alreadySeeded && !list.some((t) => t?.ownerId === userId)) {
      await ensureStarterWorkoutTypes(userId);
    }
  } catch (error) {
    return handleApiError(error, 'List types failed');
  }
  return handlers.GET(request);
}
