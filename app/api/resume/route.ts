import { NextResponse } from 'next/server';
import { getResume, saveResume } from '@/lib/resume-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ success: true, resume: await getResume() });
}

// Saves the whole resume (profile, experience, skills, projects) in one go so
// reordering and edits across sections land together.
export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid resume' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, resume: await saveResume(body) });
  } catch (error) {
    console.error('Failed to save resume:', error);
    return NextResponse.json({ success: false, error: 'Failed to save' }, { status: 500 });
  }
}
