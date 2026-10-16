// Programs: a pre-planned rotation of workout days (e.g. Push → Pull → Legs).
// Each day uses one of your workout types (its muscles, rep range and pinned
// lifts). Where you are in the rotation comes from history, so nothing has to
// be kept in sync: the next day is the one after the last workout you did
// from this program.

export type ProgramDay = {
  /** Workout type this day uses. */
  typeId: string;
  /** Optional label, e.g. "Heavy Push" (defaults to the type's name). */
  name?: string;
  /** How many lifts to plan (default 5). */
  lifts?: number;
};

export type Program = {
  id: string;
  ownerId?: string;
  name: string;
  days: ProgramDay[];
  /** Suggest a deload week every N weeks (optional). */
  deloadEveryWeeks?: number;
  /** Gym this program is usually done at (optional). */
  gymId?: string;
  isPublic?: boolean;
};

type ProgramWorkout = { timestamp?: string; programId?: string; programDay?: number; isDeload?: boolean };

const WEEK = 7 * 24 * 60 * 60 * 1000;

function programWorkouts(program: Pick<Program, 'id'>, history: ProgramWorkout[] | undefined) {
  return (history || [])
    .filter((w) => w.programId === program.id)
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
}

/** Index of the day to do next (the day after the last one done; day 1 to start). */
export function nextProgramDay(program: Program, history: ProgramWorkout[] | undefined): number {
  if (program.days.length === 0) return 0;
  const last = programWorkouts(program, history)[0];
  if (!last || !Number.isInteger(last.programDay)) return 0;
  return ((last.programDay as number) + 1) % program.days.length;
}

/** How many times through the whole rotation you've gone. */
export function completedCycles(program: Program, history: ProgramWorkout[] | undefined) {
  if (program.days.length === 0) return 0;
  return Math.floor(programWorkouts(program, history).length / program.days.length);
}

/**
 * True when the program's deload is due: `deloadEveryWeeks` have passed since
 * its last deload workout (or since you started it).
 */
export function programDeloadDue(program: Program, history: ProgramWorkout[] | undefined, now = Date.now()) {
  if (!program.deloadEveryWeeks || program.deloadEveryWeeks < 1) return false;
  const workouts = programWorkouts(program, history);
  if (workouts.length === 0) return false;
  const lastDeload = workouts.find((w) => w.isDeload);
  const since = new Date((lastDeload || workouts[workouts.length - 1]).timestamp || 0).getTime();
  return now - since >= program.deloadEveryWeeks * WEEK;
}
