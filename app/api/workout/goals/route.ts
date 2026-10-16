import { createOwnedCollectionHandlers } from '@/lib/workout/owned-collection';
import { ApiError } from '@/lib/workout/api';

// Goals per exercise (see lib/workout/goals.ts). Always private.

function normalizeGoal(goal: any) {
  const weight = Number(goal?.targetWeight);
  const reps = Math.round(Number(goal?.targetReps));
  const deadline = typeof goal?.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(goal.deadline) ? goal.deadline : undefined;
  const achievedAt = typeof goal?.achievedAt === 'string' && !Number.isNaN(Date.parse(goal.achievedAt)) ? goal.achievedAt : undefined;
  return {
    ...goal,
    exercise: typeof goal?.exercise === 'string' ? goal.exercise.trim().slice(0, 120) : '',
    targetWeight: Number.isFinite(weight) && weight > 0 ? Math.round(weight * 100) / 100 : 0,
    targetReps: Number.isFinite(reps) ? Math.min(50, Math.max(1, reps)) : 1,
    deadline,
    achievedAt,
    isPublic: false,
  };
}

export const { GET, POST, PUT, DELETE } = createOwnedCollectionHandlers({
  file: 'goals.json',
  key: 'goals',
  itemKey: 'goal',
  normalize: normalizeGoal,
  buildNew: (payload) => ({
    exercise: payload.exercise,
    targetWeight: payload.targetWeight,
    targetReps: payload.targetReps,
    deadline: payload.deadline,
  }),
  validate: (goal) => {
    if (!goal.exercise) throw new ApiError(400, 'Pick an exercise for the goal');
    if (!(goal.targetWeight > 0)) throw new ApiError(400, 'Set a target weight');
  },
});
