import { NextResponse } from 'next/server';
import { getPrompts, savePrompts, PromptsData } from '@/lib/party/prompts';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET() {
  const prompts = await getPrompts();
  return NextResponse.json(prompts);
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const data: PromptsData = await request.json();
    await savePrompts(data);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to update prompts' }, { status: 500 });
  }
}
