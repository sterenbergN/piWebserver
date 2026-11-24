import { NextResponse } from 'next/server';
import { readRefillLog } from '@/lib/chess/puzzles';
import { readChessProgress } from '@/lib/chess/store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getSiteTuning, updateSiteTuning } from '@/lib/tuning/site';
import { applySuggestion, suggestTuning, type PersonTuning } from '@/lib/tuning/suggest';
import { readMathStats } from '@/lib/workout/rest-math-store';
import { loadUsersData } from '@/lib/workout/users';

// Admin › Tuning: the site-wide values features tune around, each person's own tuned
// values, and suggestions to accept or dismiss.
//   GET                          → { tuning, people, suggestions, refills }
//   POST { action: 'accept' | 'dismiss', id } → the same, after the change

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store, private' };

async function view() {
  const [tuning, { users }, refills] = await Promise.all([getSiteTuning(), loadUsersData(), readRefillLog()]);
  const people = await Promise.all(users.map(async (u) => {
    const [math, chess] = await Promise.all([readMathStats(u.id).catch(() => null), readChessProgress(u.id).catch(() => null)]);
    return {
      name: String(u.username ?? u.id),
      math: math?.levelRule ? { streakUp: math.levelRule.streakUp, sample: math.levelRule.ups, changes: math.levelRule.changes } : null,
      chess: chess?.aim ? { offset: chess.aim.offset, sample: chess.aim.results.length, changes: chess.aim.changes } : null,
    };
  }));
  // Only values that have actually moved say anything about where people settle.
  const tuned: PersonTuning[] = people.map((p) => ({
    name: p.name,
    ...(p.math?.changes.length ? { mathStreakUp: p.math.streakUp } : {}),
    ...(p.chess?.changes.length ? { chessAimOffset: p.chess.offset } : {}),
  }));
  return { tuning, people: people.filter((p) => p.math || p.chess), suggestions: suggestTuning(tuning, tuned, refills), refills: refills.slice(-15).reverse() };
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ success: true, ...(await view()) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string };
  const current = await view();
  const s = current.suggestions.find((x) => x.id === body.id);
  if (!s || (body.action !== 'accept' && body.action !== 'dismiss')) return NextResponse.json({ error: 'That suggestion isn’t there any more.' }, { status: 400 });
  await updateSiteTuning((t) => {
    if (body.action === 'accept') applySuggestion(t, s);
    else t.dismissed[s.id] = String(s.suggested);
  });
  return NextResponse.json({ success: true, ...(await view()) }, { headers: NO_STORE });
}
