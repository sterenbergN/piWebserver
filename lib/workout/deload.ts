import { computeMuscleFatigue } from './analytics';
import { detectStalledLifts } from './session-insights';

// Should today be a deload? Only ever a suggestion: the start screen shows it
// with its reasons and you choose to use it for this workout or ignore it.

export type DeloadSuggestion = { reasons: string[] };

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** Weeks of regular training after which a lighter week is worth suggesting. */
export const DELOAD_AFTER_WEEKS = 6;

type Workout = { timestamp: string; isDeload?: boolean; logs?: Record<string, { weight: number; reps: number }[]>; [key: string]: any };

const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function suggestDeload(
  history: Workout[] | undefined,
  allLifts: { id: string; primaryMuscle?: string }[],
  { programDue = false, now = Date.now() }: { programDue?: boolean; now?: number } = {},
): DeloadSuggestion | null {
  const workouts = (history || []).filter((w) => w.logs && Object.keys(w.logs).length > 0);
  const reasons: string[] = [];

  if (programDue) reasons.push('Your program has a deload scheduled now.');

  // Accumulated fatigue (the same model the analytics page uses).
  if (workouts.length >= 3) {
    const fatigued = computeMuscleFatigue(workouts, allLifts)
      .filter((f) => f.recommendation === 'deload_recommended')
      .map((f) => f.muscle);
    if (fatigued.length) reasons.push(`High fatigue in ${list(fatigued)}.`);
  }

  // Several lifts stuck at once usually means you need recovery, not effort.
  const stalled = detectStalledLifts(workouts).map((s) => s.name);
  if (stalled.length >= 2) reasons.push(`${stalled.length} lifts have stopped improving (${list(stalled.slice(0, 3))}).`);

  // Weeks of steady training since the last lighter week.
  const sorted = [...workouts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const lastDeload = [...sorted].reverse().find((w) => w.isDeload);
  const since = lastDeload ? new Date(lastDeload.timestamp).getTime() : sorted.length ? new Date(sorted[0].timestamp).getTime() : now;
  const weeks = Math.floor((now - since) / WEEK);
  const recent = sorted.filter((w) => new Date(w.timestamp).getTime() > since && !w.isDeload);
  // Only count it as "training hard" with at least ~2 sessions a week, and no long break (a break is a deload).
  const lastWorkout = sorted.length ? new Date(sorted[sorted.length - 1].timestamp).getTime() : 0;
  if (weeks >= DELOAD_AFTER_WEEKS && recent.length >= weeks * 2 && now - lastWorkout < 2 * WEEK) {
    reasons.push(`${weeks} weeks of training since your last ${lastDeload ? 'deload' : 'break'}.`);
  }

  return reasons.length ? { reasons } : null;
}
