import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

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
    const data = await request.json();
    const { name, score } = data;
    
    if (!name || typeof score !== 'number') {
      return NextResponse.json({ success: false, message: "Invalid payload format." }, { status: 400 });
    }

    await fs.mkdir(saveDir, { recursive: true });
    
    let leaderboard = [];
    try {
      const raw = await fs.readFile(leaderboardFile, 'utf-8');
      leaderboard = JSON.parse(raw);
    } catch { /* brand new leaderboard */ }

    leaderboard.push({ name: name.trim().substring(0, 20), score, date: new Date().toISOString() });
    
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
