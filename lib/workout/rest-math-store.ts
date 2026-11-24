import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { getSiteTuning } from '@/lib/tuning/site';
import {
  emptyMathStats,
  normalizeMathStats,
  recordSprintStats,
  type MathAnswerRecord,
  type MathStats,
} from './rest-math-stats';

// One small file per account: .data/workout/math/<userId>.json.

function mathFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');
  return path.join(process.cwd(), '.data', 'workout', 'math', `${userId}.json`);
}

export async function readMathStats(userId: string): Promise<MathStats> {
  return normalizeMathStats(await readJson<unknown>(mathFile(userId), emptyMathStats()));
}

export async function saveMathSprint(
  userId: string,
  input: { score: number; answers: MathAnswerRecord[]; mode?: 'sprint' | 'drill' },
): Promise<MathStats> {
  const { mathStreakUp } = await getSiteTuning();
  return updateJson<MathStats, MathStats>(mathFile(userId), emptyMathStats(), (stored) => {
    const current = normalizeMathStats(stored);
    const next = recordSprintStats(current, input, new Date(), mathStreakUp);
    Object.assign(stored, next);
    return next;
  });
}

/** Forget the tuned level rule, back to the site's starting point. */
export async function resetMathLevelRule(userId: string): Promise<MathStats> {
  return updateJson<MathStats, MathStats>(mathFile(userId), emptyMathStats(), (stored) => {
    const current = normalizeMathStats(stored);
    delete current.levelRule;
    delete (stored as Partial<MathStats>).levelRule;
    return current;
  });
}
