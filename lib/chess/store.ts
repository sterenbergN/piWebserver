import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { emptyChessProgress, normalizeChessProgress, recordResult, type ChessProgress } from './rating';

// One small file per account: .data/workout/chess/<userId>.json, the puzzle
// rating and which puzzles have been done.

function chessFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');
  return path.join(process.cwd(), '.data', 'workout', 'chess', `${userId}.json`);
}

export async function readChessProgress(userId: string): Promise<ChessProgress> {
  return normalizeChessProgress(await readJson<unknown>(chessFile(userId), emptyChessProgress()));
}

export async function saveChessResult(userId: string, puzzle: { id: string; rating: number }, cleanSolve: boolean) {
  return updateJson<ChessProgress, { before: number; after: ChessProgress }>(chessFile(userId), emptyChessProgress(), (stored) => {
    const current = normalizeChessProgress(stored);
    const next = recordResult(current, puzzle, cleanSolve);
    Object.assign(stored, next);
    return { before: current.rating, after: next };
  });
}
