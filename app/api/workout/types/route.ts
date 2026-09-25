import { createOwnedCollectionHandlers } from '@/lib/workout/owned-collection';
import { ApiError } from '@/lib/workout/api';

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
  };
}

export const { GET, POST, PUT, DELETE } = createOwnedCollectionHandlers({
  file: 'workout_types.json',
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
  }),
  validate: (type) => {
    if (!type.name) throw new ApiError(400, 'Workout type name is required');
    if (type.minReps > type.maxReps) throw new ApiError(400, 'Min reps cannot exceed max reps');
  },
});
