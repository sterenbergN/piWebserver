import { NextResponse } from 'next/server';
import { getPrompts, normalizePrompts, savePrompts } from '@/lib/party/prompts';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

// Admin-only: the trivia list includes the answers.
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await getPrompts());
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid prompts' }, { status: 400 });
  }
  try {
    const prompts = normalizePrompts(body);
    await savePrompts(prompts);
    return NextResponse.json({ success: true, prompts });
  } catch (err) {
    console.error('Failed to save party prompts:', err);
    return NextResponse.json({ error: 'Failed to update prompts' }, { status: 500 });
  }
}
