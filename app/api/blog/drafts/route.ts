import { NextResponse } from 'next/server';
import { deleteDraft, listDrafts, saveDraft } from '@/lib/blog/drafts';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export const dynamic = 'force-dynamic';

const unauthorized = () => NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

// Post drafts: list them, save one (create or update), or throw one away.
export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  return NextResponse.json({ success: true, drafts: await listDrafts() });
}

export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, message: 'Invalid draft' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, draft: await saveDraft(body) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Could not save the draft' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const id = new URL(request.url).searchParams.get('id') || '';
  return NextResponse.json({ success: await deleteDraft(id) });
}
