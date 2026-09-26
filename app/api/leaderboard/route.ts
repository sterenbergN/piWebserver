import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { MAX_SCORE, POINTS_PER_FOOD } from '@/lib/games/snake';

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

    await fs.mkdir(saveDir, { recursive: true });
    
    let leaderboard = [];
    try {
      const raw = await fs.readFile(leaderboardFile, 'utf-8');
      leaderboard = JSON.parse(raw);
    } catch { /* brand new leaderboard */ }

    leaderboard.push({ name, score, date: new Date().toISOString() });
    
    // Sort descending and enforce hard 10 retention
    leaderboard.sort((a: any, b: any) => b.score - a.score);
    leaderboard = leaderboard.slice(0, 10);

    await fs.writeFile(leaderboardFile, JSON.stringify(leaderboard, null, 2));
    
    return NextResponse.json({ success: true, leaderboard });
  } catch (err) {
    console.error("Leaderboard Save Error:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
