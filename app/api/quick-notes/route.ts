import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { generateId } from '@/lib/workout/data';
import {
  applyQuickNoteAction, emptyQuickNotes, normalizeQuickNotes, QuickNoteInputError, type QuickNoteAction, type QuickNotesData,
} from '@/lib/quick-notes/quick-notes';

// Quick notes for the signed-in account, one file per user in .data/quick-notes
// (kept by backups and in the account export). Signed out, it's a 401.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

function notesFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(process.cwd(), '.data', 'quick-notes', `${userId}.json`);
}

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const data = normalizeQuickNotes(await readJson(notesFile(userId), emptyQuickNotes()));
    return NextResponse.json({ success: true, data }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load quick notes failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const action = body.action as QuickNoteAction;
    if (!action || typeof action !== 'object') throw new ApiError(400, 'Missing change');

    const data = await updateJson<QuickNotesData, QuickNotesData>(notesFile(userId), emptyQuickNotes(), (stored) => {
      const next = normalizeQuickNotes(stored);
      try {
        applyQuickNoteAction(next, action, new Date(), generateId);
      } catch (error) {
        if (error instanceof QuickNoteInputError) throw new ApiError(400, error.message);
        throw error;
      }
      stored.notes = next.notes;
      return next;
    });
    return NextResponse.json({ success: true, data }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save quick notes failed');
  }
}
