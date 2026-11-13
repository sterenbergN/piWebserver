import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { requireDailyManager } from '@/lib/daily/store';
import { localToday } from '@/lib/habits/dates';
import { SkillsInputError, findSubject, importQuestions } from '@/lib/skills/edit';
import { parseQuestionsReply } from '@/lib/skills/parse';
import { readSkills, readSkillsProgress, updateSkills } from '@/lib/skills/store';
import { topUpRequest } from '@/lib/skills/topup';

// The weekly question writer's way into Skills (scripts/daily-pack.ts "skills"
// commands, with the daily upload token). It only ever sees subjects whose owner
// switched "weekly questions" on, and it can only add questions to them.
//
// GET:  what each of those subjects needs, with the prompt to write it from.
// POST: { userId, subjectId, questions, check? }: check (or add) one subject's
//       questions, in the same JSON shape the prompt asks for.

const NO_STORE = { 'Cache-Control': 'no-store, private' };
const newId = () => crypto.randomBytes(9).toString('base64url');
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);

async function accounts() {
  const root = path.join(process.cwd(), '.data', 'skills');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && isId(e.name)).map((e) => e.name);
}

export async function GET(request: Request) {
  try {
    await requireDailyManager(request);
    const today = localToday();
    const requests = [];
    for (const userId of await accounts()) {
      // One account's damaged file shouldn't stop everyone else's questions.
      const [data, progress] = await Promise.all([readSkills(userId), readSkillsProgress(userId)]).catch(() => [null, null] as const);
      if (!data || !progress) continue;
      for (const subject of data.subjects) {
        const req = topUpRequest(subject, progress, today);
        if (req) requests.push({ userId, ...req });
      }
    }
    return NextResponse.json({ success: true, today, requests }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error, 'Load skills top-up failed');
  }
}

export async function POST(request: Request) {
  try {
    await requireDailyManager(request);
    const body = await readJsonObject(request);
    if (!isId(body.userId) || !(await accounts()).includes(body.userId)) throw new ApiError(404, 'No such account');
    const reply = typeof body.questions === 'string' ? body.questions : JSON.stringify(body.questions ?? null);
    const data = await readSkills(body.userId);
    const subject = findSubject(data, body.subjectId);
    if (!subject.autoTopUp) throw new ApiError(403, `Weekly questions are switched off for ${subject.name}.`);

    if (body.check === true) {
      const parsed = parseQuestionsReply(reply, subject);
      return NextResponse.json({
        success: true,
        ready: parsed.questions.filter((q) => q.ok).length,
        problems: parsed.questions.flatMap((q, i) => (q.ok ? (q.warning ? [`${i + 1}. ${q.title}: ${q.warning}`] : []) : [`${i + 1}. ${q.title}: ${q.errors.join('; ')}`])),
      }, { headers: NO_STORE });
    }
    const now = new Date().toISOString();
    const result = await updateSkills(body.userId, (fresh) => {
      const target = findSubject(fresh, body.subjectId);
      if (!target.autoTopUp) throw new ApiError(403, `Weekly questions are switched off for ${target.name}.`);
      return importQuestions(target, reply, {}, newId, now, 'weekly');
    });
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SkillsInputError) return handleApiError(new ApiError(400, error.message));
    return handleApiError(error, 'Skills top-up failed');
  }
}
