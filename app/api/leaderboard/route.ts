import { NextResponse } from 'next/server';
import path from 'path';
import { GAMES, isGameId, type GameId } from '@/lib/games/registry';
import { readJson, updateJson } from '@/lib/json-store';
import { clientAddress, createLimiter } from '@/lib/security/rate-limit';

// A real game takes a while; more than a few scores a minute from one address is a script.
const submissions = createLimiter({ max: 5, windowMs: 10 * 60_000 });

const saveDir = path.join(process.cwd(), 'public', 'uploads', 'leaderboard');
type Entry = { name: string; score: number; date: string };

// Each game has its own top-10 file (Snake's predates the others) and its own idea of a possible score.
const fileFor = (id: GameId) => path.join(saveDir, id === 'snake' ? 'leaderboard.json' : `leaderboard-${id}.json`);

function gameFrom(value: unknown) {
  const id: GameId = isGameId(value) ? value : 'snake';
  return { file: fileFor(id), valid: GAMES.find((g) => g.id === id)!.valid as (score: number) => boolean };
}

export async function GET(request: Request) {
  const game = gameFrom(new URL(request.url).searchParams.get('game'));
  return NextResponse.json({ success: true, leaderboard: await readJson<Entry[]>(game.file, []) });
}

export async function POST(request: Request) {
  try {
    const ip = clientAddress(request);
    if (submissions.retryAfter(ip)) {
      return NextResponse.json({ success: false, message: 'Too many scores from here — try again in a few minutes.' }, { status: 429 });
    }
    submissions.hit(ip);
    const data = await request.json().catch(() => null);
    const game = gameFrom(data?.game);
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
