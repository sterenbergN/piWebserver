import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { publicQuestion } from '@/lib/daily/grade';
import { generatorList } from '@/lib/daily/generated';
import { scoreAttempt } from '@/lib/daily/progress';
import { answeredView, clampToday, findQuestion, practiceSet, questionIndex, readFeedback, readUserDaily } from '@/lib/daily/store';

// Practice: as many questions as you like.
//   - every question from past days (core and bonus): half XP, as catching up
//   - saved practice-only questions uploaded with the weekly pack (newest first)
//   - generated questions (fresh numbers every time) from the generators listed
// Without `id`: the pool to choose from, with how you did on each (signed in).
// With `id`: one question ready to answer. Answers go through /api/daily/answer.

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const userId = await getAuthenticatedWorkoutUserId();
    const mine = userId ? await readUserDaily(userId) : null;
    const id = params.get('id');

    if (!id) {
      const [index, practice] = await Promise.all([questionIndex(), practiceSet()]);
      const status = (qid: string, q: Parameters<typeof scoreAttempt>[1]) => {
        const attempt = mine?.attempts.find((a) => a.questionId === qid);
        return attempt ? scoreAttempt(attempt, q).result.status : null;
      };
      const past = [...index.values()]
        .filter((at) => at.date <= today)
        .map((at) => ({
          id: at.question.id, date: at.date as string | null, source: 'day' as const, core: at.core, boss: at.boss,
          track: at.question.track, topic: at.question.topic, difficulty: at.question.difficulty, title: at.question.title,
          status: status(at.question.id, at.question),
        }))
        .sort((a, b) => b.date!.localeCompare(a.date!) || Number(b.core) - Number(a.core));
      // Newest uploads first (the file keeps upload order; older questions have no date).
      const pool = practice.questions.map((q) => ({
        id: q.id, date: null, added: practice.added?.[q.id] ?? null, source: 'pool' as const, core: false, boss: false,
        track: q.track, topic: q.topic, difficulty: q.difficulty, title: q.title, status: status(q.id, q),
      })).reverse();
      // Generated questions you've done, so the tally counts them.
      const generatedDone = (mine?.attempts ?? []).filter((a) => a.questionId.startsWith('gen-')).length;
      return NextResponse.json({ success: true, signedIn: !!userId, questions: [...pool, ...past], generators: generatorList(), generatedDone }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const at = await findQuestion(id);
    if (!at || (at.date && at.date > today)) throw new ApiError(404, 'Question not found');
    const attempt = mine?.attempts.find((a) => a.questionId === id);
    const fb = attempt && userId ? (await readFeedback()).entries.find((e) => e.questionId === id && e.userId === userId) : undefined;
    return NextResponse.json({
      success: true,
      date: at.date,
      core: at.core,
      boss: at.boss,
      source: at.generated ? 'generated' : at.practice ? 'pool' : 'day',
      question: publicQuestion(at.question),
      formulas: at.formulas,
      answered: attempt ? answeredView(at.question, attempt, fb) : null,
      tries: mine?.pending?.[id] ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load practice questions failed');
  }
}
