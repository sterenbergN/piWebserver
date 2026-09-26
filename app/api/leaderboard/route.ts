import { NextResponse } from 'next/server';
import path from 'path';
import { MAX_SCORE, POINTS_PER_FOOD } from '@/lib/games/snake';
import { MAX_2048_SCORE } from '@/lib/games/g2048';
import { readJson, updateJson } from '@/lib/json-store';

const saveDir = path.join(process.cwd(), 'public', 'uploads', 'leaderboard');
type Entry = { name: string; score: number; date: string };

// Each game has its own top-10 file and its own idea of a possible score.
const GAMES = {
  snake: {
    file: path.join(saveDir, 'leaderboard.json'),
    // Whole food multiples up to a full board.
    valid: (score: number) => score <= MAX_SCORE && score % POINTS_PER_FOOD === 0,
  },
  '2048': {
    file: path.join(saveDir, 'leaderboard-2048.json'),
    // Every merge adds an even tile value.
    valid: (score: number) => score <= MAX_2048_SCORE && score % 2 === 0,
  },
} as const;

function gameFrom(value: unknown) {
  return (typeof value === 'string' && value in GAMES ? value : 'snake') as keyof typeof GAMES;
}

export async function GET(request: Request) {
  const game = GAMES[gameFrom(new URL(request.url).searchParams.get('game'))];
  return NextResponse.json({ success: true, leaderboard: await readJson<Entry[]>(game.file, []) });
}

export async function POST(request: Request) {
  try {
    const data = await request.json().catch(() => null);
    const game = GAMES[gameFrom(data?.game)];
    const name = typeof data?.name === 'string' ? data.name.trim().substring(0, 20) : '';
    const score = data?.score;

    if (!name || !Number.isInteger(score) || score <= 0 || !game.valid(score)) {
      return NextResponse.json({ success: false, message: "Invalid name or score." }, { status: 400 });
    }

    const leaderboard = await updateJson<Entry[], Entry[]>(game.file, [], (list) => {
      list.push({ name, score, date: new Date().toISOString() });
      // Keep the top 10, highest first.
      list.sort((a, b) => b.score - a.score);
      list.splice(10);
      return list;
    });

    return NextResponse.json({ success: true, leaderboard });
  } catch (err) {
    console.error("Leaderboard Save Error:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
