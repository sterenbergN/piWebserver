import { handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { ankiFile } from '@/lib/study/anki';
import { readTests, updateProgress } from '@/lib/study/store';
import { withQuestions } from '@/lib/study/study';

// The miss bank as a file Anki can import: `scope` is "new" (not exported yet) or
// "all" (every active miss), and `handOff` stops showing them in review here
// because Anki has taken over. A POST, since it marks what it hands over.

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const now = new Date().toISOString();
    const tests = await readTests(userId);

    const rows = await updateProgress(userId, (progress) => {
      const active = Object.values(progress.misses).filter((m) => m.state === 'active');
      const chosen = withQuestions(tests, body.scope === 'all' ? active : active.filter((m) => !m.exportedAt));
      for (const { miss } of chosen) {
        miss.exportedAt = now;
        if (body.handOff === true) miss.state = 'anki';
      }
      return chosen.map(({ question, course }) => ({ question, course }));
    });

    return new Response(ankiFile(rows), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="missed-questions-${today}.txt"`,
        'Cache-Control': 'no-store, private',
        'X-Study-Count': String(rows.length),
      },
    });
  } catch (error) {
    return handleApiError(error, 'Anki export failed');
  }
}
