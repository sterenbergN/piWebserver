import { calcAverage1RM } from './analytics';
import { exerciseKeyFromName } from './exercises';
import { liftSessions } from './session-insights';

// Goals per exercise ("Bench Press 225 × 1 by March"): progress from your
// best recent estimated 1RM, and a projected date from the trend.

export type Goal = {
  id: string;
  ownerId?: string;
  /** Exercise name (see exercises.ts) — the goal follows it across gyms. */
  exercise: string;
  targetWeight: number;
  targetReps: number;
  /** Optional target date, YYYY-MM-DD. */
  deadline?: string;
  createdAt?: string;
  achievedAt?: string;
};

export type GoalProgress = {
  targetE1RM: number;
  /** Best estimated 1RM over your last few sessions of the exercise. */
  currentE1RM: number;
  /** 0–1. */
  fraction: number;
  achieved: boolean;
  /** When the trend reaches the target (null: no upward trend yet). */
  projectedDate: Date | null;
  /** Deadline set and the projection misses it (or there's no projection). */
  behind: boolean;
  sessions: number;
};

export const goalKey = (goal: Pick<Goal, 'exercise'>) => exerciseKeyFromName(goal.exercise);

export const goalLabel = (goal: Pick<Goal, 'exercise' | 'targetWeight' | 'targetReps'>) =>
  `${goal.exercise} ${goal.targetWeight} × ${goal.targetReps}`;

/** A set that meets the goal outright. */
export function setMeetsGoal(set: { weight: number; reps: number }, goal: Pick<Goal, 'targetWeight' | 'targetReps'>) {
  return Number(set.weight) >= goal.targetWeight && Number(set.reps) >= goal.targetReps;
}

const DAY = 24 * 60 * 60 * 1000;

export function goalProgress(goal: Goal, history: any[] | undefined, now = Date.now()): GoalProgress {
  const targetE1RM = calcAverage1RM(goal.targetWeight, goal.targetReps);
  const sessions = liftSessions(history, '', goal.exercise);
  const achieved = !!goal.achievedAt || sessions.some((s) => s.sets.some((set) => setMeetsGoal(set, goal)));
  const recent = sessions.slice(-3);
  const currentE1RM = recent.length ? Math.max(...recent.map((s) => s.e1rm)) : 0;

  // Least-squares trend of session bests over the last ten sessions.
  let projectedDate: Date | null = null;
  const points = sessions.slice(-10).map((s) => ({ x: new Date(s.timestamp).getTime() / DAY, y: s.e1rm }));
  if (!achieved && points.length >= 3) {
    const n = points.length;
    const mx = points.reduce((a, p) => a + p.x, 0) / n;
    const my = points.reduce((a, p) => a + p.y, 0) / n;
    const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const slope = sxx > 0 ? points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0;
    if (slope > 0.01) {
      const intercept = my - slope * mx;
      const day = (targetE1RM - intercept) / slope;
      // Ignore projections more than two years out — not a meaningful date.
      if (Number.isFinite(day) && day * DAY < now + 730 * DAY) projectedDate = new Date(Math.max(now, day * DAY));
    }
  }

  const deadline = goal.deadline ? new Date(`${goal.deadline}T23:59:59`).getTime() : null;
  return {
    targetE1RM,
    currentE1RM,
    fraction: achieved ? 1 : targetE1RM > 0 ? Math.min(1, currentE1RM / targetE1RM) : 0,
    achieved,
    projectedDate,
    behind: !achieved && deadline !== null && (!projectedDate || projectedDate.getTime() > deadline),
    sessions: sessions.length,
  };
}

/** Open goals for an exercise. */
export function goalsFor(goals: Goal[] | undefined, exercise: string) {
  const key = exerciseKeyFromName(exercise);
  return (goals || []).filter((g) => !g.achievedAt && goalKey(g) === key);
}

export function formatProjection(progress: GoalProgress) {
  if (progress.achieved) return 'reached 🎯';
  if (!progress.projectedDate) return progress.sessions < 3 ? 'log a few sessions for a projection' : 'no upward trend yet';
  return `on pace for ${progress.projectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: progress.projectedDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}`;
}
