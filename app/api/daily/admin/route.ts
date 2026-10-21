import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { isDateKey } from '@/lib/habits/dates';
import { validatePack } from '@/lib/daily/validate';
import { bufferDays, clampToday, deleteDay, listDates, practiceSet, readDay, requireDailyManager, saveDays, savePractice } from '@/lib/daily/store';

// Managing questions: the admin page, and the weekly generator with the upload token.
//   GET            every stored day (summary) and how many days are ready ahead
//   GET ?date=     one full day, answer key and check notes included
//   PUT            a pack { version: 1, days: [...], practice? }: checked, then saved (replacing those dates;
//                  practice questions are added, replacing any with the same id)
//   DELETE ?date=  remove a day (signed-in admin only)

export async function GET(request: Request) {
  try {
    await requireDailyManager(request);
    const params = new URL(request.url).searchParams;
    const date = params.get('date');
    if (date) {
      const day = isDateKey(date) ? await readDay(date) : null;
      if (!day) throw new ApiError(404, 'No questions for that day');
      return NextResponse.json({ success: true, day });
    }
    const today = clampToday(params.get('today'));
    const days = [];
    for (const d of await listDates()) {
      const day = await readDay(d);
      if (!day) continue;
      days.push({
        date: d,
        boss: !!day.boss,
        questions: [day.core, ...day.bonus].map((q, i) => ({ id: q.id, title: q.title, track: q.track, topic: q.topic, difficulty: q.difficulty, core: i === 0 })),
      });
    }
    const practice = (await practiceSet()).questions.map((q) => ({ id: q.id, title: q.title, track: q.track, topic: q.topic, difficulty: q.difficulty }));
    return NextResponse.json({ success: true, today, buffer: await bufferDays(today), days, practice }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load daily questions failed');
  }
}

export async function PUT(request: Request) {
  try {
    await requireDailyManager(request);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError(400, 'Invalid JSON'); }
    const { pack, errors } = validatePack(body);
    if (!pack) return NextResponse.json({ success: false, message: 'The pack has problems.', errors }, { status: 400 });
    const saved = pack.days.length ? await saveDays(pack.days) : { added: 0, replaced: 0 };
    const practice = pack.practice ? await savePractice(pack.practice) : null;
    const today = clampToday(new URL(request.url).searchParams.get('today'));
    return NextResponse.json({ success: true, ...saved, dates: pack.days.map((d) => d.date), buffer: await bufferDays(today), practice });
  } catch (error) {
    return handleApiError(error, 'Upload daily questions failed');
  }
}

export async function DELETE(request: Request) {
  try {
    if (!(await isAdminAuthenticated())) throw new ApiError(401, 'Unauthorized');
    const date = new URL(request.url).searchParams.get('date');
    if (!isDateKey(date)) throw new ApiError(400, 'Invalid date');
    await deleteDay(date);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Delete daily questions failed');
  }
}
