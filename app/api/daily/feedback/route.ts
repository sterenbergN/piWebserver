import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { scoreAll } from '@/lib/daily/progress';
import { listUserIds, questionIndex, readFeedback, readUserDaily, requireDailyManager, updateFeedback, type Feedback } from '@/lib/daily/store';
import { REPORT_KINDS } from '@/lib/daily/types';

/** Rate a question you've answered, or report a problem with it. One entry per person per question. */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const index = await questionIndex();
    const at = index.get(body.questionId);
    if (!at) throw new ApiError(404, 'Question not found');
    const { attempts } = await readUserDaily(userId);
    if (!attempts.some((a) => a.questionId === at.question.id)) throw new ApiError(400, 'Answer the question first.');

    const report = body.report && (REPORT_KINDS as readonly string[]).includes(body.report.kind)
      ? { kind: body.report.kind as string, note: typeof body.report.note === 'string' ? body.report.note.trim().slice(0, 1000) : '' }
      : undefined;
    const saved = await updateFeedback((data) => {
      let entry = data.entries.find((e) => e.questionId === at.question.id && e.userId === userId);
      if (!entry) {
        entry = { questionId: at.question.id, date: at.date, userId, at: '' };
        data.entries.push(entry);
      }
      entry.at = new Date().toISOString();
      if (body.rating === 'up' || body.rating === 'down' || body.rating === null) {
        if (body.rating) entry.rating = body.rating; else delete entry.rating;
      }
      if (['easy', 'right', 'hard'].includes(body.difficulty)) entry.difficulty = body.difficulty;
      if (report) entry.report = report;
      if (body.report === null) delete entry.report;
      return { rating: entry.rating ?? null, difficulty: entry.difficulty ?? null, report: entry.report ?? null };
    });
    return NextResponse.json({ success: true, feedback: saved });
  } catch (error) {
    return handleApiError(error, 'Save feedback failed');
  }
}

/**
 * For the admin page and the weekly generator: every question that has been
 * answered or rated, with how people did and what they said.
 * ?since=YYYY-MM-DD limits it to questions dated from then on.
 */
export async function GET(request: Request) {
  try {
    await requireDailyManager(request);
    const since = new URL(request.url).searchParams.get('since');
    const from = isDateKey(since) ? since : '0000-00-00';
    const [index, { entries }, ids] = await Promise.all([questionIndex(), readFeedback(), listUserIds()]);
    const questions = new Map([...index].map(([id, at]) => [id, at.question]));

    type Row = { questionId: string; date: string; title: string; track: string; topic: string; difficulty: number; core: boolean;
      answered: number; solved: number; partial: number; wrong: number; studied: number; hintsUsed: number;
      up: number; down: number; easy: number; right: number; hard: number; reports: { kind: string; note: string; at: string }[] };
    const rows = new Map<string, Row>();
    const row = (id: string): Row | null => {
      const at = index.get(id);
      if (!at || at.date < from) return null;
      if (!rows.has(id)) rows.set(id, {
        questionId: id, date: at.date, title: at.question.title, track: at.question.track, topic: at.question.topic, difficulty: at.question.difficulty, core: at.core,
        answered: 0, solved: 0, partial: 0, wrong: 0, studied: 0, hintsUsed: 0, up: 0, down: 0, easy: 0, right: 0, hard: 0, reports: [],
      });
      return rows.get(id)!;
    };

    for (const id of ids) {
      for (const a of scoreAll((await readUserDaily(id)).attempts, questions)) {
        const r = row(a.questionId);
        if (!r) continue;
        r[a.status]++;
        if (a.status !== 'studied') r.answered++;
        r.hintsUsed += a.hints;
      }
    }
    for (const e of entries as Feedback[]) {
      const r = row(e.questionId);
      if (!r) continue;
      if (e.rating) r[e.rating]++;
      if (e.difficulty) r[e.difficulty]++;
      if (e.report) r.reports.push({ ...e.report, at: e.at });
    }
    return NextResponse.json({ success: true, questions: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load feedback failed');
  }
}
