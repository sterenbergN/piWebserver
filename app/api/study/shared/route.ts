import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { findWorkoutUser } from '@/lib/workout/users';
import { addSharedTest, copyOf, isShareId, sharedTitle, shareTest, sharePreview, unshareTest, type Share } from '@/lib/study/sharing';
import { everyShare, readTests, updateShares, updateTests } from '@/lib/study/store';
import { StudyInputError } from '@/lib/study/study';

// Tests shared between accounts. Everything here needs an account. A link shows its
// test only while it's shared, and only what the owner chose to share: never their
// tries, misses or anything else of theirs.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const json = (body: Record<string, unknown>) => NextResponse.json({ success: true, ...body }, { headers: PRIVATE });
const newId = () => crypto.randomBytes(9).toString('base64url');
const newToken = () => crypto.randomBytes(16).toString('base64url');

const nameOf = async (userId: string) => {
  const user = await findWorkoutUser(userId);
  return typeof user?.username === 'string' ? user.username : 'Someone';
};

/** The shared test behind a link, as it is right now. */
async function openShare(id: unknown) {
  if (!isShareId(id)) throw new ApiError(404, 'That link isn’t shared any more.');
  const found = (await everyShare()).find(({ share }) => share.id === id);
  const tests = found ? await readTests(found.ownerId) : null;
  const test = tests?.tests.find((t) => t.id === found!.share.testId);
  if (!found || !tests || !test) throw new ApiError(404, 'That link isn’t shared any more.');
  return { ...found, test, title: sharedTitle(test, tests) };
}

async function previews(list: { ownerId: string; share: Share }[]) {
  const testsOf = new Map<string, Awaited<ReturnType<typeof readTests>>>();
  const out = [];
  for (const { ownerId, share } of list) {
    if (!testsOf.has(ownerId)) testsOf.set(ownerId, await readTests(ownerId));
    const test = testsOf.get(ownerId)!.tests.find((t) => t.id === share.testId);
    if (test) out.push(sharePreview(share, test, await nameOf(ownerId), sharedTitle(test, testsOf.get(ownerId)!)));
  }
  return out.sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id');
    if (id !== null) {
      const { ownerId, share, test, title } = await openShare(id);
      const copy = copyOf(await readTests(userId), share.id);
      return json({ preview: sharePreview(share, test, await nameOf(ownerId), title), mine: ownerId === userId, ...(ownerId === userId ? { testId: test.id } : {}), addedId: copy?.id ?? null });
    }
    const all = await everyShare();
    const [pool, mine, tests] = await Promise.all([
      previews(all.filter(({ share }) => share.public)),
      previews(all.filter(({ ownerId }) => ownerId === userId)),
      readTests(userId),
    ]);
    const added = Object.fromEntries(pool.flatMap((p) => { const copy = copyOf(tests, p.id); return copy ? [[p.id, copy.id]] : []; }));
    return json({ pool, mine, added });
  } catch (error) {
    return handleApiError(error, 'Load shared tests failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const now = new Date().toISOString();

    switch (body.action) {
      case 'share': {
        const tests = await readTests(userId);
        const share = await updateShares(userId, (data) => ({ ...shareTest(data, tests, String(body.testId), body.public === true, newToken, now) }));
        return json({ share });
      }
      case 'unshare':
        await updateShares(userId, (data) => unshareTest(data, String(body.testId)));
        return json({});
      case 'add': {
        const { ownerId, share, test, title } = await openShare(body.id);
        if (ownerId === userId) throw new ApiError(400, 'This one’s already yours.');
        const by = await nameOf(ownerId);
        const { test: copy, added } = await updateTests(userId, (data) => addSharedTest(data, share.id, test, by, newId, now, title));
        return json({ testId: copy.id, added });
      }
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    if (error instanceof StudyInputError) return handleApiError(new ApiError(error.kind === 'missing' ? 404 : 400, error.message), 'Sharing failed');
    return handleApiError(error, 'Sharing failed');
  }
}

