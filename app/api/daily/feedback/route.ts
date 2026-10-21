import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { scoreAll } from '@/lib/daily/progress';
import { analyze, partRate } from '@/lib/daily/analysis';
import { analysisAttempts, clampToday, findQuestion, gradingMap, listUserIds, practiceSet, questionIndex, readFeedback, readUserDaily, requireDailyManager, updateFeedback, type Feedback } from '@/lib/daily/store';
import { REPORT_KINDS } from '@/lib/daily/types';

/** Rate a question you've answered, or report a problem with it. One entry per person per question. */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const at = await findQuestion(body.questionId);
    if (!at) throw new ApiError(404, 'Question not found');
    const { attempts } = await readUserDaily(userId);
    if (!attempts.some((a) => a.questionId === at.question.id)) throw new ApiError(400, 'Answer the question first.');

    const report = body.report && (REPORT_KINDS as readonly string[]).includes(body.report.kind)
      ? { kind: body.report.kind as string, note: typeof body.report.note === 'string' ? body.report.note.trim().slice(0, 1000) : '' }
      : undefined;
    const saved = await updateFeedback((data) => {
      let entry = data.entries.find((e) => e.questionId === at.question.id && e.userId === userId);
      if (!entry) {
        entry = { questionId: at.question.id, date: at.date ?? 'practice', userId, at: '' };
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
 * `topics` sums up everyone's strengths and weaknesses per track/topic (all
 * questions, practice included) so the generator can aim practice questions
 * where people struggle.
 */
export async function GET(request: Request) {
  try {
    await requireDailyManager(request);
    const since = new URL(request.url).searchParams.get('since');
    const from = isDateKey(since) ? since : '0000-00-00';
    const [index, practice, { entries }, ids, questions] = await Promise.all([questionIndex(), practiceSet(), readFeedback(), listUserIds(), gradingMap()]);
    // Practice-only questions have no day; they're listed with date "practice" (and always included).
    const lookup = (id: string) => index.get(id) ?? (() => {
      const q = practice.questions.find((x) => x.id === id);
      return q ? { question: q, date: 'practice', core: false } : undefined;
    })();

    type Row = { questionId: string; date: string; title: string; track: string; topic: string; difficulty: number; core: boolean;
      answered: number; solved: number; partial: number; wrong: number; studied: number; hintsUsed: number;
      up: number; down: number; easy: number; right: number; hard: number; reports: { kind: string; note: string; at: string }[] };
    const rows = new Map<string, Row>();
    const row = (id: string): Row | null => {
      const at = lookup(id);
      if (!at || at.date < from) return null;
      if (!rows.has(id)) rows.set(id, {
        questionId: id, date: at.date, title: at.question.title, track: at.question.track, topic: at.question.topic, difficulty: at.question.difficulty, core: at.core,
        answered: 0, solved: 0, partial: 0, wrong: 0, studied: 0, hintsUsed: 0, up: 0, down: 0, easy: 0, right: 0, hard: 0, reports: [],
      });
      return rows.get(id)!;
    };

    type TopicRow = { track: string; topic: string; people: number; answered: number; studied: number; partRate: number | null; ability: number; weakFor: number };
    const topics = new Map<string, TopicRow & { abilities: number[]; right: number; total: number }>();
    const today = clampToday(null);
    for (const id of ids) {
      const { attempts } = await readUserDaily(id);
      for (const t of analyze(await analysisAttempts(attempts), today).topics) {
        const key = `${t.track}/${t.topic}`;
        const row = topics.get(key) ?? { track: t.track, topic: t.topic, people: 0, answered: 0, studied: 0, partRate: null, ability: 0, weakFor: 0, abilities: [], right: 0, total: 0 };
        row.people++;
        row.answered += t.answered;
        row.studied += t.studied;
        row.right += t.partsRight;
        row.total += t.partsTotal;
        row.abilities.push(t.ability);
        if (t.label === 'weakness') row.weakFor++;
        topics.set(key, row);
      }
      for (const a of scoreAll(attempts, questions)) {
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
    const topicRows: TopicRow[] = [...topics.values()].map(({ abilities, right, total, ...row }) => ({
      ...row, partRate: partRate({ partsRight: right, partsTotal: total }), ability: Math.round((abilities.reduce((a, b) => a + b, 0) / abilities.length) * 100) / 100,
    })).sort((a, b) => a.ability - b.ability);
    return NextResponse.json({ success: true, questions: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)), topics: topicRows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load feedback failed');
  }
}
