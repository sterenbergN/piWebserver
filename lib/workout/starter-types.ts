import { generateId, updateWorkoutData } from './data';

export const WORKOUT_TYPES_FILE = 'workout_types.json';

export const STARTER_WORKOUT_TYPE_DEFS = [
  { name: 'Push', muscles: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', muscles: ['Back', 'Biceps'] },
  { name: 'Legs', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
  { name: 'Upper Body', muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { name: 'Lower Body', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
] as const;

export type StarterWorkoutType = {
  id: string;
  ownerId: string;
  name: string;
  muscles: string[];
  intensity: number;
  minReps: number;
  maxReps: number;
  sets: number;
  fixedLifts: [];
  isPublic: false;
  createdAt: string;
};

type WorkoutTypesStore = {
  types: any[];
  seededUsers?: string[];
};

/** Build the 5 default workout templates for a user. */
export function buildStarterWorkoutTypes(ownerId: string): StarterWorkoutType[] {
  const createdAt = new Date().toISOString();
  return STARTER_WORKOUT_TYPE_DEFS.map((def) => ({
    id: generateId(),
    ownerId,
    name: def.name,
    muscles: [...def.muscles],
    intensity: 75,
    minReps: 8,
    maxReps: 12,
    sets: 4,
    fixedLifts: [],
    isPublic: false,
    createdAt,
  }));
}

/**
 * Seed starter workout templates once per user when they have 0 owned types
 * and have not yet been seeded (so deleting all 5 later keeps them deleted).
 */
export async function ensureStarterWorkoutTypes(userId: string): Promise<boolean> {
  if (!userId) return false;
  return updateWorkoutData<WorkoutTypesStore, boolean>(
    WORKOUT_TYPES_FILE,
    { types: [], seededUsers: [] },
    (data) => {
      if (!Array.isArray(data.types)) data.types = [];
      const seededUsers = Array.isArray(data.seededUsers) ? data.seededUsers : [];
      if (seededUsers.includes(userId)) return false;
      if (data.types.some((t: any) => t && t.ownerId === userId)) return false;
      data.types.push(...buildStarterWorkoutTypes(userId));
      data.seededUsers = [...seededUsers, userId];
      return true;
    },
  );
}
