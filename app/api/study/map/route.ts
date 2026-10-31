import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { coverageMap, deckRows, MapInputError, saveClass, setMatch, unmatchedTags } from '@/lib/study/coverage';
import { readAnki, readMap, readProgress, readTests, removeAnki, updateMap } from '@/lib/study/store';

// The signed-in account's PANCE map: her classes, how her Anki decks match up
// to organ systems, and what all her evidence adds up to.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const newId = () => crypto.randomBytes(9).toString('base64url');
/** Longest list of forgotten cards to send to the page. */
const LEECHES_SHOWN = 30;

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const [tests, progress, map, anki] = await Promise.all([readTests(userId), readProgress(userId), readMap(userId), readAnki(userId)]);
    const coverage = coverageMap(tests, progress, map, anki);
    const listed = new Set(map.classes.map((c) => c.name.toLowerCase()));
    return NextResponse.json({
      success: true,
      coverage,
      classes: map.classes,
      // Classes named on her tests that she hasn't added yet, to offer in one tap.
      courses: [...new Set(tests.tests.map((t) => t.course).filter(Boolean))].filter((c) => !listed.has(c.toLowerCase())).sort(),
      anki: anki && {
        importedAt: anki.importedAt,
        fileName: anki.fileName,
        hasHistory: anki.hasHistory,
        cards: anki.groups.reduce((n, g) => n + g.cards, 0),
        reviewed: anki.groups.reduce((n, g) => n + g.cards - g.fresh, 0),
        decks: deckRows(anki, map),
        unmatched: unmatchedTags(anki, map),
        leeches: anki.leeches.slice(0, LEECHES_SHOWN).map((l) => ({ deck: anki.decks[l.deck] ?? '', front: l.front, back: l.back, lapses: l.lapses })),
        leechCount: anki.leeches.length,
      },
    }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load map failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    switch (body.action) {
      case 'save-class': {
        const entry = await updateMap(userId, (map) => saveClass(map, body, newId));
        return NextResponse.json({ success: true, entry }, { headers: PRIVATE });
      }
      case 'delete-class': {
        await updateMap(userId, (map) => { map.classes = map.classes.filter((c) => c.id !== body.id); });
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'match': {
        await updateMap(userId, (map) => setMatch(map, body.kind, body.name, body.value));
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'remove-anki': {
        await removeAnki(userId);
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    if (error instanceof MapInputError) return handleApiError(new ApiError(400, error.message));
    return handleApiError(error, 'Map update failed');
  }
}
