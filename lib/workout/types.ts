// Shared shapes and option lists for the workout feature (client and server).

export type StationType = 'plates' | 'stack' | 'cable' | 'dumbbells' | 'bodyweight';
export type ProgressionProfile = 'standard' | 'high-rep' | 'endurance';

export interface Lift {
  id: string;
  name: string;
  singleArmLeg: boolean;
  primaryMuscle: string;
  secondaryMuscle: string;
  attachment?: string;
  progressionProfile?: ProgressionProfile;
  /** Free-text setup reminder, e.g. "seat 4, pin 3, neutral grip". */
  notes?: string;
  /**
   * The exercise this lift counts as when that differs from its name (e.g. a
   * lift renamed from "Bench Press", or "Bench" at home that is "Bench Press"
   * elsewhere). Lifts with the same exercise share history across gyms.
   * See lib/workout/exercises.ts.
   */
  exercise?: string;
}

export interface Station {
  id: string;
  name: string;
  type: StationType;
  baseWeight?: number;
  plateSets?: number[];
  minWeight?: number;
  maxWeight?: number;
  increment?: number;
  additionalWeights?: number[];
  additionalWeight?: number; // legacy single add-on weight
  attachments?: string[];
  dumbbellPairs?: number[];
  bodyWeightAdditions?: number[];
  /** Photo id (see lib/workout/photos.ts), to recognise the machine. */
  photo?: string;
  lifts: Lift[];
}

export interface Gym {
  id: string;
  name: string;
  emoji?: string;
  ownerId: string;
  isPublic?: boolean;
  stations: Station[];
  /** Secret for share links; only present for the gym's owner. */
  shareToken?: string;
}

export interface WorkoutType {
  id: string;
  ownerId?: string;
  name: string;
  muscles: string[];
  intensity: number;
  minReps: number;
  maxReps: number;
  sets: number;
  isPublic?: boolean;
  /** Lifts always included, in order. Remaining slots are filled randomly. */
  fixedLifts?: FixedLiftRef[];
}

/** A pinned lift in a template; matched by id first, then by name at other gyms. */
export type FixedLiftRef = { liftId: string; name: string };

export const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] as const;
/** Muscle options for a lift's secondary muscle, which may be empty. */
export const MUSCLE_OPTIONS_WITH_NONE = [...MUSCLE_GROUPS, 'None'];

export const STATION_TYPE_OPTIONS: { value: StationType; label: string }[] = [
  { value: 'plates', label: 'Barbell / Plate Loaded' },
  { value: 'stack', label: 'Machine Weight Stack' },
  { value: 'cable', label: 'Cable Machine' },
  { value: 'dumbbells', label: 'Dumbbells' },
  { value: 'bodyweight', label: 'Bodyweight' },
];

export const PROGRESSION_PROFILE_OPTIONS: { value: ProgressionProfile; label: string }[] = [
  { value: 'standard', label: 'Standard (weight-first)' },
  { value: 'high-rep', label: 'High-Rep (rep-first, 12–30)' },
  { value: 'endurance', label: 'Endurance (volume-first)' },
];

export const GYM_EMOJIS = ['🏋️', '💪', '🏠', '🏢', '🏟️', '🏃', '🔥', '⚡', '🎯', '🏆', '🦾', '🧗'];

export const EMPTY_LIFT: Partial<Lift> = {
  singleArmLeg: false,
  primaryMuscle: 'Chest',
  secondaryMuscle: 'None',
  progressionProfile: 'standard',
};

export function isLoadStation(type: StationType | undefined) {
  return type === 'stack' || type === 'cable';
}
