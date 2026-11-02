// Sharing a test with other accounts. A share is a link to one of her tests, and
// publishing it also lists it for everyone signed in. Whoever opens it can add a
// copy to their own tests, where it's theirs: their tries, their miss bank. The
// link always shows the test as it is now, and stopping sharing ends it at once.
// Pure, so the server and the tests share it.

import { StudyInputError, type StudyTest, type TestsData } from './study';

export type Share = { id: string; testId: string; public: boolean; createdAt: string };
export type SharesData = { shares: Share[] };

export const emptyShares = (): SharesData => ({ shares: [] });

export const isShareId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{16,40}$/.test(value);

export function normalizeShares(raw: Partial<SharesData> | null | undefined): SharesData {
  const shares = Array.isArray(raw?.shares) ? raw.shares.filter((s) => isShareId(s?.id) && typeof s.testId === 'string') : [];
  return { shares: shares.map((s) => ({ id: s.id, testId: s.testId, public: s.public === true, createdAt: String(s.createdAt ?? '') })) };
}

export const shareOf = (data: SharesData, testId: string) => data.shares.find((s) => s.testId === testId) ?? null;

/** Share a test, or change whether it's listed for everyone. The link stays the same either way. */
export function shareTest(data: SharesData, tests: TestsData, testId: string, isPublic: boolean, makeToken: () => string, now: string) {
  const test = tests.tests.find((t) => t.id === testId);
  if (!test) throw new StudyInputError('That test isn’t here any more.', 'missing');
  if (!test.questions.length) throw new StudyInputError('A test with no questions has nothing to share.');
  if (test.source) throw new StudyInputError(`This is ${test.source.by}’s test, so it’s theirs to share.`);
  const existing = shareOf(data, testId);
  if (existing) {
    existing.public = isPublic;
    return existing;
  }
  const share: Share = { id: makeToken(), testId, public: isPublic, createdAt: now };
  data.shares.push(share);
  return share;
}

export function unshareTest(data: SharesData, testId: string) {
  data.shares = data.shares.filter((s) => s.testId !== testId);
}

/** Shares whose test has been deleted go with it. */
export function dropMissing(data: SharesData, tests: TestsData) {
  const ids = new Set(tests.tests.map((t) => t.id));
  data.shares = data.shares.filter((s) => ids.has(s.testId));
}

const SAMPLE = 3;

/** Tests in a set are just "Test 2", which says nothing to anyone else, so the set's name goes in front. */
export function sharedTitle(test: StudyTest, tests: TestsData) {
  const set = tests.sets.find((s) => s.id === test.setId);
  return set ? `${set.title}: ${test.title}` : test.title;
}

/** What someone sees before adding a test: enough to tell what it covers, and none of the answers. */
export function sharePreview(share: Share, test: StudyTest, by: string, title = test.title) {
  const topics = [...new Set(test.questions.map((q) => q.topic).filter((t) => t && t !== 'General'))];
  return {
    id: share.id,
    public: share.public,
    sharedAt: share.createdAt,
    by,
    title,
    course: test.course,
    count: test.questions.length,
    topics: topics.slice(0, 12),
    moreTopics: Math.max(0, topics.length - 12),
    sample: test.questions.slice(0, SAMPLE).map((q) => q.stem),
    ...(test.difficulty ? { difficulty: test.difficulty } : {}),
  };
}
export type SharePreview = ReturnType<typeof sharePreview>;

export const copyOf = (tests: TestsData, shareId: string) => tests.tests.find((t) => t.source?.shareId === shareId) ?? null;

/** Their own copy of someone's test. Adding the same one twice opens the first copy instead. */
export function addSharedTest(tests: TestsData, shareId: string, from: StudyTest, by: string, makeId: () => string, now: string, title = from.title) {
  const existing = copyOf(tests, shareId);
  if (existing) return { test: existing, added: false };
  const test: StudyTest = {
    id: makeId(),
    title,
    course: from.course,
    createdAt: now,
    questions: from.questions.map((q) => ({ ...structuredClone(q), id: makeId() })),
    ...(from.difficulty ? { difficulty: from.difficulty } : {}),
    source: { shareId, by, addedAt: now },
  };
  tests.tests.unshift(test);
  return { test, added: true };
}

/** The test as a guest takes it: questions and answers, nothing about the owner's set or where it came from. */
export function guestCopy(test: StudyTest, title = test.title): StudyTest {
  return {
    id: test.id,
    title,
    course: test.course,
    createdAt: test.createdAt,
    questions: structuredClone(test.questions),
    ...(test.difficulty ? { difficulty: test.difficulty } : {}),
  };
}
