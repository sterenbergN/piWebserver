import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { MAX_SCORE, POINTS_PER_FOOD } from '@/lib/games/snake';
import { updateJson } from '@/lib/json-store';

const saveDir = path.join(process.cwd(), 'public', 'uploads', 'leaderboard');
const leaderboardFile = path.join(saveDir, 'leaderboard.json');

export async function GET() {
  try {
    const raw = await fs.readFile(leaderboardFile, 'utf-8');
    return NextResponse.json({ success: true, leaderboard: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ success: true, leaderboard: [] });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json().catch(() => null);
    const name = typeof data?.name === 'string' ? data.name.trim().substring(0, 20) : '';
    const score = data?.score;

    // Only scores the game can actually produce: whole food multiples up to a full board.
    if (!name || !Number.isInteger(score) || score <= 0 || score > MAX_SCORE || score % POINTS_PER_FOOD !== 0) {
      return NextResponse.json({ success: false, message: "Invalid name or score." }, { status: 400 });
    }

    type Entry = { name: string; score: number; date: string };
    const leaderboard = await updateJson<Entry[], Entry[]>(leaderboardFile, [], (list) => {
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
