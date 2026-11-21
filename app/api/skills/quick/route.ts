import { NextResponse } from 'next/server';
import { clampToday } from '@/lib/daily/store';
import { publicQuestion } from '@/lib/daily/grade';
import { asDailyQuestion } from '@/lib/skills/edit';
import { quickQueue, QUICK_MAX } from '@/lib/skills/quick';
import { readSkills, readSkillsProgress } from '@/lib/skills/store';
import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';

// A few Skills questions small enough to answer between workout sets. Graded
// ones come without their answer key, as in a review; answers go back through
// POST /api/skills (answer, rate-card), so they count exactly like a review.

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const limit = Math.min(QUICK_MAX, Math.max(1, Number(params.get('limit')) || QUICK_MAX));
    const [data, progress] = await Promise.all([readSkills(userId), readSkillsProgress(userId)]);
    const items = quickQueue(data, progress, today, limit).map(({ item, subject, topic, quickReason }) => {
      const base = { id: item.id, subjectId: subject.id, subjectName: subject.name, subjectIcon: subject.icon, topicName: topic.name, reason: quickReason };
      return item.kind === 'card'
        ? { ...base, kind: 'card' as const, front: item.front, back: item.back }
        : { ...base, kind: 'graded' as const, question: publicQuestion(asDailyQuestion(item.question, topic.name)) };
    });
    // So an empty list can say "add some questions" rather than "all done for today".
    const hasItems = data.subjects.some((s) => s.items.some((i) => !i.retired));
    return NextResponse.json({ success: true, items, hasItems }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Load quick skills questions failed');
  }
}
