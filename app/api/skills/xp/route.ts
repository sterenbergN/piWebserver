import { NextResponse } from 'next/server';
import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { readSkills, readSkillsProgress } from '@/lib/skills/store';
import { skillsXp } from '@/lib/skills/xp';

// Skills' share of the site-wide level. Just a number, for the pages that show a level.

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const [data, progress] = await Promise.all([readSkills(userId), readSkillsProgress(userId)]);
    return NextResponse.json({ success: true, xp: skillsXp(data, progress) }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Load skills XP failed');
  }
}
