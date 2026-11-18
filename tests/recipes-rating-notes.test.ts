import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/recipes/route';
import {
  DEFAULT_RECIPES,
  formatRatingStars,
  normalizeCookLog,
  normalizeRating,
  normalizeRecipe,
  normalizeRecipesData,
  type CookLogEntry,
} from '@/lib/recipes/recipes';
import { createAdminAuthToken, createWorkoutAuthToken } from '@/lib/security/auth';

const originalCwd = process.cwd();
let tmpDir = '';

function makeRequest(
  body?: Record<string, unknown>,
  options: { cookie?: string; method?: string } = {},
): NextRequest {
  const method = options.method ?? (body ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  return new NextRequest('http://localhost/api/recipes', {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const asUser = (userId: string) => `workout_auth=${createWorkoutAuthToken(userId)}`;
const asAdmin = () => `pi_auth=${createAdminAuthToken()}`;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recipes-rating-notes-'));
  process.chdir(tmpDir);
});

beforeEach(async () => {
  await fs.rm(path.join(tmpDir, '.data'), { recursive: true, force: true });
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('normalizeRating parses 1-10 numbers/strings rounded to 1 decimal and rejects invalid values', () => {
  assert.equal(normalizeRating(1), 1);
  assert.equal(normalizeRating(10), 10);
  assert.equal(normalizeRating(8.56), 8.6);
  assert.equal(normalizeRating(7.44), 7.4);
  assert.equal(normalizeRating('9'), 9);
  assert.equal(normalizeRating(' 8.25 '), 8.3);

  assert.equal(normalizeRating(0), undefined);
  assert.equal(normalizeRating(-1), undefined);
  assert.equal(normalizeRating(10.1), undefined);
  assert.equal(normalizeRating(NaN), undefined);
  assert.equal(normalizeRating(Infinity), undefined);
  assert.equal(normalizeRating(null), undefined);
  assert.equal(normalizeRating(undefined), undefined);
  assert.equal(normalizeRating(''), undefined);
  assert.equal(normalizeRating('   '), undefined);
  assert.equal(normalizeRating('abc'), undefined);
  assert.equal(normalizeRating(true), undefined);
  assert.equal(normalizeRating([5]), undefined);
});

test('formatRatingStars formats valid ratings and returns empty string when unrated', () => {
  assert.equal(formatRatingStars(8), '★ 8.0');
  assert.equal(formatRatingStars(9.5), '★ 9.5');
  assert.equal(formatRatingStars(undefined), '');
  assert.equal(formatRatingStars(0), '');
  assert.equal(formatRatingStars(Number.NaN), '');
});

test('normalizeRecipe and normalizeRecipesData preserve cookLog (max 50) and 2000-char notes', () => {
  const manyEntries: CookLogEntry[] = Array.from({ length: 55 }, (_, i) => ({
    id: `entry-${i}`,
    cookedAt: `2026-11-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    servings: 2,
    rating: 8.54,
    note: `  Batch ${i}  `,
  }));

  const longNote = 'x'.repeat(2050);
  const normalized = normalizeRecipe({
    title: 'Test Pasta',
    notes: longNote,
    cookLog: manyEntries,
    sections: [{ name: 'Main', steps: ['Boil [200 g pasta] for [8 min].'] }],
  });

  assert.equal(normalized.notes?.length, 2000);
  assert.equal(normalized.cookLog?.length, 50);
  assert.equal(normalized.cookLog?.[0].rating, 8.5);
  assert.equal(normalized.cookLog?.[0].note, 'Batch 0');

  // RecipeEditor save payloads omit cookLog; existing cookLog must survive.
  const afterEditorSave = normalizeRecipe(
    {
      title: 'Test Pasta v2',
      sections: [{ name: 'Main', steps: ['Boil [200 g pasta] for [9 min].'] }],
    },
    normalized,
  );
  assert.equal(afterEditorSave.cookLog?.length, 50);

  // Reloading from disk preserves cookLog and drops invalid entries.
  const sanitizedLog = normalizeCookLog([
    { id: '', cookedAt: '2026-11-01T00:00:00Z' },
    { id: 'bad-date', cookedAt: 'not-a-date' },
    { id: 'ok', cookedAt: '2026-11-01T00:00:00Z', servings: 3, rating: 11, note: 'Great' },
  ]);
  assert.deepEqual(sanitizedLog, [{ id: 'ok', cookedAt: '2026-11-01T00:00:00.000Z', servings: 3, note: 'Great' }]);

  const reloaded = normalizeRecipesData({ version: 1, recipes: [afterEditorSave] });
  assert.equal(reloaded.recipes[0].cookLog?.length, 50);
  assert.equal(reloaded.recipes[0].notes?.length, 2000);
});

test('POST /api/recipes requires auth (401) and enforces private/modify permissions while letting signed-in users rate & note default recipes', async () => {
  const unauthRes = await POST(makeRequest({ type: 'rate', id: DEFAULT_RECIPES[0].id, rating: 8 }));
  assert.equal(unauthRes.status, 401);

  const defaultId = DEFAULT_RECIPES[0].id; // Built-in recipe without ownerId
  const saveAttempt = await POST(
    makeRequest(
      {
        type: 'save',
        recipe: {
          id: defaultId,
          title: 'Hijacked',
          sections: [{ name: 'Main', steps: ['Cook [1 min].'] }],
        },
      },
      { cookie: asUser('alice') },
    ),
  );
  assert.equal(saveAttempt.status, 403);

  const deleteAttempt = await POST(makeRequest({ type: 'delete', id: defaultId }, { cookie: asUser('alice') }));
  assert.equal(deleteAttempt.status, 403);

  // Non-admin signed-in user CAN rate and save notes on default household recipes.
  const rateRes = await POST(
    makeRequest(
      { type: 'rate', id: defaultId, rating: 8.74, notes: 'Extra crispy skin at 14 min' },
      { cookie: asUser('alice') },
    ),
  );
  assert.equal(rateRes.status, 200);
  const rateJson = await rateRes.json();
  assert.equal(rateJson.status, 'success');
  assert.equal(rateJson.data.rating, 8.7);
  assert.equal(rateJson.data.notes, 'Extra crispy skin at 14 min');

  // Create a private recipe owned by alice; bob must get 403 on cooked/rate/notes.
  const createRes = await POST(
    makeRequest(
      {
        type: 'save',
        recipe: {
          title: 'Alice Secret Soup',
          private: true,
          sections: [{ name: 'Main', steps: ['Simmer [10 min].'] }],
        },
      },
      { cookie: asUser('alice') },
    ),
  );
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  const privateId = created.recipe.id as string;

  for (const payload of [
    { type: 'cooked', id: privateId },
    { type: 'rate', id: privateId, rating: 9 },
    { type: 'notes', id: privateId, notes: 'Snooping' },
  ]) {
    const blocked = await POST(makeRequest(payload, { cookie: asUser('bob') }));
    assert.equal(blocked.status, 403);
  }

  // Admin can access and update notes on private recipe.
  const adminRes = await POST(
    makeRequest({ type: 'notes', id: privateId, notes: 'Admin note' }, { cookie: asAdmin() }),
  );
  assert.equal(adminRes.status, 200);
  const adminJson = await adminRes.json();
  assert.equal(adminJson.data.notes, 'Admin note');
});

test('POST /api/recipes type: cooked logs cook entry with rating/notes/cookNote/servings and supports undo', async () => {
  const id = DEFAULT_RECIPES[3].id; // Dan Dan noodles (no initial notes, timesCooked = 9)
  const initialCount = DEFAULT_RECIPES[3].timesCooked;

  const firstRes = await POST(
    makeRequest(
      {
        type: 'cooked',
        id,
        servings: 4,
        rating: 9.25,
        notes: 'Use extra chili crisp',
        cookNote: 'Doubled the sauce, great texture',
      },
      { cookie: asUser('alice') },
    ),
  );
  assert.equal(firstRes.status, 200);
  const firstJson = await firstRes.json();
  assert.equal(firstJson.status, 'success');
  assert.equal(firstJson.data.timesCooked, initialCount + 1);
  assert.equal(firstJson.data.rating, 9.3);
  assert.equal(firstJson.data.notes, 'Use extra chili crisp');
  assert.equal(firstJson.data.cookLog.length, 1);
  assert.equal(firstJson.data.cookLog[0].servings, 4);
  assert.equal(firstJson.data.cookLog[0].rating, 9.3);
  assert.equal(firstJson.data.cookLog[0].note, 'Doubled the sauce, great texture');
  const firstCookedAt = firstJson.data.cookLog[0].cookedAt;

  // Log a second cook with rating cleared (0) and no cookNote.
  const secondRes = await POST(
    makeRequest({ type: 'cooked', id, servings: 2, rating: 0 }, { cookie: asUser('bob') }),
  );
  assert.equal(secondRes.status, 200);
  const secondJson = await secondRes.json();
  assert.equal(secondJson.data.timesCooked, initialCount + 2);
  assert.equal(secondJson.data.rating, undefined);
  assert.equal(secondJson.data.cookLog.length, 2);
  assert.equal(secondJson.data.cookLog[0].servings, 2);
  assert.equal(secondJson.data.cookLog[0].rating, undefined);

  // Undo the second cook -> restores previous entry's cookedAt and decrements timesCooked.
  const undoRes = await POST(makeRequest({ type: 'cooked', id, undo: true }, { cookie: asUser('bob') }));
  assert.equal(undoRes.status, 200);
  const undoJson = await undoRes.json();
  assert.equal(undoJson.data.timesCooked, initialCount + 1);
  assert.equal(undoJson.data.cookLog.length, 1);
  assert.equal(undoJson.data.lastCookedAt, firstCookedAt);

  // Undo on a brand new recipe with 1 cook clears lastCookedAt when timesCooked hits 0.
  const freshRes = await POST(
    makeRequest(
      {
        type: 'save',
        recipe: {
          title: 'Quick Omelette',
          sections: [{ name: 'Main', steps: ['Whisk [2 eggs] and cook [2 min].'] }],
        },
      },
      { cookie: asUser('alice') },
    ),
  );
  const freshId = (await freshRes.json()).recipe.id as string;
  await POST(makeRequest({ type: 'cooked', id: freshId, cookNote: 'Fluffy' }, { cookie: asUser('alice') }));
  const undoFresh = await POST(makeRequest({ type: 'cooked', id: freshId, undo: true }, { cookie: asUser('alice') }));
  const undoFreshJson = await undoFresh.json();
  assert.equal(undoFreshJson.data.timesCooked, 0);
  assert.equal(undoFreshJson.data.lastCookedAt, undefined);
  assert.equal(undoFreshJson.data.cookLog.length, 0);
});

test('POST /api/recipes type: rate sets/clears rating, validates range, and updates cookEntryId', async () => {
  const id = DEFAULT_RECIPES[1].id;

  // Invalid out-of-range ratings return 400 even when notes are included.
  for (const badRating of [11, -1, 0.5, 'nope']) {
    const badRes = await POST(
      makeRequest({ type: 'rate', id, rating: badRating, notes: 'Should not save' }, { cookie: asUser('alice') }),
    );
    assert.equal(badRes.status, 400);
  }

  // Missing rating AND missing notes/cookNote returns 400.
  const emptyRate = await POST(makeRequest({ type: 'rate', id }, { cookie: asUser('alice') }));
  assert.equal(emptyRate.status, 400);

  // Create a cook log entry first.
  const cookedRes = await POST(
    makeRequest({ type: 'cooked', id, servings: 4, cookNote: 'Initial note' }, { cookie: asUser('alice') }),
  );
  const entryId = (await cookedRes.json()).data.cookLog[0].id as string;

  // Update rating, pinned notes, and the specific cookEntryId.
  const updateRes = await POST(
    makeRequest(
      {
        type: 'rate',
        id,
        rating: 9.6,
        notes: 'Use potato buns or flour tortillas',
        cookEntryId: entryId,
        cookNote: 'Crisp edges!',
      },
      { cookie: asUser('alice') },
    ),
  );
  assert.equal(updateRes.status, 200);
  const updateJson = await updateRes.json();
  assert.equal(updateJson.data.rating, 9.6);
  assert.equal(updateJson.data.notes, 'Use potato buns or flour tortillas');
  assert.equal(updateJson.data.cookLog[0].id, entryId);
  assert.equal(updateJson.data.cookLog[0].rating, 9.6);
  assert.equal(updateJson.data.cookLog[0].note, 'Crisp edges!');

  // Clear rating with null on both recipe and entry.
  const clearNullRes = await POST(
    makeRequest({ type: 'rate', id, rating: null, cookEntryId: entryId }, { cookie: asUser('alice') }),
  );
  const clearNullJson = await clearNullRes.json();
  assert.equal(clearNullJson.data.rating, undefined);
  assert.equal(clearNullJson.data.cookLog[0].rating, undefined);

  // Set again, then clear with 0.
  await POST(makeRequest({ type: 'rate', id, rating: 8 }, { cookie: asUser('alice') }));
  const clearZeroRes = await POST(makeRequest({ type: 'rate', id, rating: 0 }, { cookie: asUser('alice') }));
  const clearZeroJson = await clearZeroRes.json();
  assert.equal(clearZeroJson.data.rating, undefined);
});

test('POST /api/recipes type: notes updates pinned notes and adds/deletes cookLog entries, persisted across GET', async () => {
  const id = DEFAULT_RECIPES[2].id;

  const addRes = await POST(
    makeRequest(
      {
        type: 'notes',
        id,
        notes: 'Broil last 2 min for extra char',
        cookNote: 'Paired with jasmine rice',
        rating: 9.1,
        servings: 3,
      },
      { cookie: asUser('alice') },
    ),
  );
  assert.equal(addRes.status, 200);
  const addJson = await addRes.json();
  assert.equal(addJson.status, 'success');
  assert.equal(addJson.data.notes, 'Broil last 2 min for extra char');
  assert.equal(addJson.data.cookLog.length, 1);
  assert.equal(addJson.data.cookLog[0].note, 'Paired with jasmine rice');
  assert.equal(addJson.data.cookLog[0].rating, 9.1);
  assert.equal(addJson.data.cookLog[0].servings, 3);
  const entryId = addJson.data.cookLog[0].id as string;

  // Verify GET preserves cookLog and notes, and does not leak ownerId.
  const getRes = await GET(makeRequest(undefined, { cookie: asUser('alice') }));
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  const fetched = getJson.recipes.find((r: { id: string }) => r.id === id);
  assert.equal(fetched.notes, 'Broil last 2 min for extra char');
  assert.equal(fetched.cookLog.length, 1);
  assert.equal(fetched.cookLog[0].id, entryId);
  assert.equal('ownerId' in fetched, false);

  // Delete that cookLog entry and clear pinned notes.
  const delRes = await POST(
    makeRequest({ type: 'notes', id, notes: '   ', deleteLogEntryId: entryId }, { cookie: asUser('alice') }),
  );
  assert.equal(delRes.status, 200);
  const delJson = await delRes.json();
  assert.equal(delJson.data.notes, undefined);
  assert.equal(delJson.data.cookLog.length, 0);
});
