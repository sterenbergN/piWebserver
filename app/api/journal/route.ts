import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { addDays, isDateKey } from '@/lib/habits/dates';
import { emptyJournal, JournalInputError, listEntries, normalizeJournal, saveEntry, searchEntries, summarize, type JournalData } from '@/lib/journal/journal';

// The private journal of the signed-in account, one file per user in
// .data/journal (kept by backups). Every request reads or writes only the
// caller's own file; signed out there is nothing to see (401), and nothing is
// ever kept on the device.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

function journalFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(process.cwd(), '.data', 'journal', `${userId}.json`);
}

/** The user's local day as their browser reports it, if it's within a day of the server's. */
function userToday(value: unknown) {
  const serverDay = new Date().toISOString().slice(0, 10);
  return isDateKey(value) && value >= addDays(serverDay, -1) && value <= addDays(serverDay, 1) ? value : serverDay;
}

/** `?date=` one entry in full; `?q=` matching entries; otherwise every entry, summarised. */
export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const data = normalizeJournal(await readJson(journalFile(userId), emptyJournal()));

    const date = params.get('date');
    if (date !== null) {
      if (!isDateKey(date)) throw new ApiError(400, 'Invalid date');
      return NextResponse.json({ success: true, entry: data.entries[date] ?? null }, { headers: PRIVATE });
    }
    const q = params.get('q');
    const entries = q ? searchEntries(data, q.slice(0, 200)) : listEntries(data);
    return NextResponse.json({ success: true, entries }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load journal failed');
  }
}

/** Save the entry for one day: `{ date, text, mood?, today }`. Empty text and no mood deletes it. */
export async function PUT(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = userToday(body.today);
    const now = new Date().toISOString();

    const entry = await updateJson<JournalData, ReturnType<typeof saveEntry>>(journalFile(userId), emptyJournal(), (stored) => {
      const data = normalizeJournal(stored);
      try {
        const saved = saveEntry(data, body.date, body.text, body.mood, today, now);
        stored.entries = data.entries;
        return saved;
      } catch (error) {
        if (error instanceof JournalInputError) throw new ApiError(400, error.message);
        throw error;
      }
    });
    return NextResponse.json({ success: true, summary: entry ? summarize(body.date, entry) : null }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save journal failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const date = new URL(request.url).searchParams.get('date');
    if (!isDateKey(date)) throw new ApiError(400, 'Invalid date');
    await updateJson<JournalData, boolean>(journalFile(userId), emptyJournal(), (stored) => {
      if (!stored.entries?.[date]) return false;
      delete stored.entries[date];
      return true;
    });
    return NextResponse.json({ success: true }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Delete journal entry failed');
  }
}
