import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { SAVED_MAX, cleanSaved, cleanSavedList, mergeSaved, withSaved, type SavedDiagram } from '@/lib/loop-lab/saved-diagrams';

// Block Studio's saved diagrams for the signed-in account, one file per user in .data/loop-lab/diagrams
// (kept by backups). Signed-out visitors get a 401 and keep their diagrams in the browser.

type Stored = { diagrams: unknown[] };

function diagramsFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(process.cwd(), '.data', 'loop-lab', 'diagrams', `${userId}.json`);
}

const respond = (diagrams: SavedDiagram[]) => NextResponse.json({ success: true, diagrams }, { headers: { 'Cache-Control': 'no-store, private' } });

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const stored = await readJson<Stored>(diagramsFile(userId), { diagrams: [] });
    return respond(cleanSavedList(stored.diagrams));
  } catch (error) {
    return handleApiError(error, 'Load saved diagrams failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const diagrams = await updateJson<Stored, SavedDiagram[]>(diagramsFile(userId), { diagrams: [] }, (stored) => {
      let list = cleanSavedList(stored.diagrams);
      if (body.action === 'save') {
        const entry = cleanSaved(body.entry);
        if (!entry) throw new ApiError(400, 'That isn’t a diagram this page can keep.');
        list = withSaved(list, entry);
      } else if (body.action === 'delete') {
        list = list.filter((e) => e.id !== body.id);
      } else if (body.action === 'merge') {
        // A browser's own list, brought into the account the first time it signs in.
        const incoming = Array.isArray(body.entries) ? cleanSavedList(body.entries.slice(0, SAVED_MAX)) : [];
        list = mergeSaved(list, incoming);
      } else {
        throw new ApiError(400, 'Unknown change');
      }
      stored.diagrams = list;
      return list;
    });
    return respond(diagrams);
  } catch (error) {
    return handleApiError(error, 'Save diagram failed');
  }
}
