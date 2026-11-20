import { NextResponse } from 'next/server';
import { AiError } from '@/lib/ai/providers';
import { aiCaller, aiJobs } from '@/lib/ai/server';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { 'not-set-up': 503, 'not-allowed': 403, rate: 429, busy: 409, empty: 400, 'too-long': 413 };

/** Start writing a reply to a prompt. Answers with a job id to check on. */
export async function POST(request: Request) {
  const caller = await aiCaller();
  if (!caller) return NextResponse.json({ error: 'Sign in to use the AI.' }, { status: 401 });
  let prompt: unknown;
  try {
    prompt = ((await request.json()) as { prompt?: unknown })?.prompt;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  try {
    const job = await aiJobs.start(caller.key, typeof prompt === 'string' ? prompt : '', caller.who);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ error: error.message, errorKind: error.kind }, { status: STATUS[error.kind] ?? 500 });
    console.error('AI job could not start');
    return NextResponse.json({ error: 'Couldn’t start the AI.' }, { status: 500 });
  }
}

/** How a job is going: running, done (with the text) or error. */
export async function GET(request: Request) {
  const caller = await aiCaller();
  if (!caller) return NextResponse.json({ error: 'Sign in to use the AI.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const job = aiJobs.get(caller.key, id);
  if (!job) return NextResponse.json({ error: 'That job is gone. Try again.' }, { status: 404 });
  return NextResponse.json(job, { headers: { 'Cache-Control': 'no-store' } });
}

/** Stop a job that's still running. */
export async function DELETE(request: Request) {
  const caller = await aiCaller();
  if (!caller) return NextResponse.json({ error: 'Sign in to use the AI.' }, { status: 401 });
  aiJobs.cancel(caller.key, new URL(request.url).searchParams.get('id') ?? '');
  return NextResponse.json({ ok: true });
}
