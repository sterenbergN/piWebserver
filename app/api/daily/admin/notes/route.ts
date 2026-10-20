import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { readNotes, requireDailyManager, writeNotes } from '@/lib/daily/store';

// Generator notes: guidance the weekly generator reads at the start of every
// run ("watch kN vs N", "more PID tuning"). Editable on the admin page; the
// generator appends what it learned from feedback.

export async function GET(request: Request) {
  try {
    await requireDailyManager(request);
    return NextResponse.json({ success: true, notes: await readNotes() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load notes failed');
  }
}

export async function PUT(request: Request) {
  try {
    await requireDailyManager(request);
    const { notes } = await readJsonObject(request);
    if (typeof notes !== 'string') throw new ApiError(400, 'notes must be text');
    await writeNotes(notes);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Save notes failed');
  }
}
