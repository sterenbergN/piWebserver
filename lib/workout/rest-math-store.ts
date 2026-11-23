import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
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
  return updateJson<MathStats, MathStats>(mathFile(userId), emptyMathStats(), (stored) => {
    const current = normalizeMathStats(stored);
    const next = recordSprintStats(current, input);
    Object.assign(stored, next);
    return next;
  });
}
