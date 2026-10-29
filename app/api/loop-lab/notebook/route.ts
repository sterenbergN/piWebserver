import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { NOTEBOOK_LIMIT, cleanEntry, cleanNotebook, serializeEntry, type NotebookEntry } from '@/lib/loop-lab/setup';

// The Loop Lab notebook for the signed-in account, one file per user in
// .data/loop-lab (kept by backups). Signed-out visitors get a 401 and keep
// their notebook on the device.

type Stored = { entries: unknown[] };

function notebookFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(process.cwd(), '.data', 'loop-lab', `${userId}.json`);
}

const respond = (entries: NotebookEntry[]) => NextResponse.json({ success: true, entries: entries.map(serializeEntry) }, { headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const stored = await readJson<Stored>(notebookFile(userId), { entries: [] });
    return respond(cleanNotebook(stored.entries));
  } catch (error) {
    return handleApiError(error, 'Load notebook failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const entries = await updateJson<Stored, NotebookEntry[]>(notebookFile(userId), { entries: [] }, (stored) => {
      let list = cleanNotebook(stored.entries);
      if (body.action === 'add') {
        const entry = cleanEntry(body.entry);
        if (!entry) throw new ApiError(400, 'Invalid experiment');
        list = [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, NOTEBOOK_LIMIT);
      } else if (body.action === 'update') {
        list = list.map((e) => (e.id === body.id
          ? { ...e, name: typeof body.name === 'string' ? body.name.slice(0, 120) || e.name : e.name, note: typeof body.note === 'string' ? body.note.slice(0, 2000) : e.note }
          : e));
      } else if (body.action === 'delete') {
        list = list.filter((e) => e.id !== body.id);
      } else {
        throw new ApiError(400, 'Unknown change');
      }
      stored.entries = list.map(serializeEntry);
      return list;
    });
    return respond(entries);
  } catch (error) {
    return handleApiError(error, 'Save notebook failed');
  }
}
