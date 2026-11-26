import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addComment, applyBulk, applyPatch, buildTicket, canReporterReopen, cleanContext, dropLinksTo, enforceCap, linkTickets, normalizeSettings, reopenByReporter, toMine, TicketInputError, unlinkTickets, type Ticket } from './tickets';

const who = { userId: 'u1', username: 'sam' };
const mk = (over: Record<string, unknown> = {}, id = 'a') =>
  buildTicket({ kind: 'bug', message: '  broken  ', severity: 'blocking', ...over }, who, { id, now: new Date('2026-01-01T00:00:00Z') });

test('builds a ticket with identity from the server', () => {
  const t = mk({ context: { path: '/golf?x=1', userId: 'evil' } });
  assert.equal(t.userId, 'u1');
  assert.equal(t.message, 'broken');
  assert.equal(t.severity, 'blocking');
  assert.equal(t.status, 'open');
  assert.equal(t.context.path, '/golf?x=1');
});

test('rejects bad kind and empty message', () => {
  assert.throws(() => mk({ kind: 'x' }), TicketInputError);
  assert.throws(() => mk({ message: '   ' }), TicketInputError);
});

test('severity only applies to bugs', () => {
  assert.equal(mk({ kind: 'idea' }).severity, undefined);
});

test('context keeps own-site paths and the last errors, trimmed', () => {
  assert.equal(cleanContext({ path: '//evil.com' }).path, '/');
  assert.equal(cleanContext({ path: 'https://evil.com' }).path, '/');
  const errors = Array.from({ length: 15 }, (_, i) => `e${i}`);
  const c = cleanContext({ path: '/a', errors, pixelRatio: 2.345, userAgent: 'x'.repeat(900) });
  assert.equal(c.errors.length, 10);
  assert.equal(c.errors[9], 'e14');
  assert.equal(c.userAgent?.length, 400);
  assert.equal(c.pixelRatio, 2.35);
});

test('cap drops oldest closed first', () => {
  const t = (id: string, status: Ticket['status']): Ticket => ({ ...mk({}, id), status });
  const list = () => [t('new', 'open'), t('mid', 'done'), t('old', 'open'), t('oldest-closed', 'wontfix')];
  assert.deepEqual(enforceCap(list(), 3).map((x) => x.id), ['oldest-closed']);
  assert.deepEqual(enforceCap(list(), 2).map((x) => x.id), ['oldest-closed', 'mid']);
  assert.deepEqual(enforceCap(list(), 1).map((x) => x.id), ['oldest-closed', 'mid', 'old']);
});

test('patch sets status, reply, note and marks seen', () => {
  const t = mk();
  applyPatch(t, { status: 'done', reply: ' fixed ', note: 'private' }, new Date('2026-01-02T00:00:00Z'));
  assert.equal(t.status, 'done');
  assert.equal(t.reply?.text, 'fixed');
  assert.ok(t.seenAt);
  assert.equal(toMine(t).reply?.text, 'fixed');
  assert.ok(!('note' in toMine(t)));
  applyPatch(t, { reply: '', note: '' }, new Date());
  assert.equal(t.reply, undefined);
  assert.equal(t.note, undefined);
  assert.throws(() => applyPatch(t, { status: 'nope' }, new Date()), TicketInputError);
});

test('settings keep only valid unique ids', () => {
  assert.deepEqual(normalizeSettings({ enabledUserIds: ['a', 'a', '../x', 5, 'b'] }).enabledUserIds, ['a', 'b']);
  assert.deepEqual(normalizeSettings(null).enabledUserIds, []);
});

// ── Timeline, links, reopening ────────────────────────────────────────────────

const day = (d: number) => new Date(Date.UTC(2026, 0, d));
const kinds = (t: Ticket) => (t.history ?? []).map((e) => e.kind);

test('status, reply, note and comment each go into the timeline', () => {
  const t = mk();
  applyPatch(t, { status: 'in_progress' }, day(2));
  applyPatch(t, { reply: 'looking', note: 'probably the cache' }, day(3));
  applyPatch(t, { reply: 'looking', note: 'probably the cache' }, day(4)); // unchanged: nothing new
  addComment(t, 'still broken', day(5));
  applyPatch(t, { status: 'done' }, day(6), 'claude');
  assert.deepEqual(kinds(t), ['filed', 'status', 'reply', 'note', 'comment', 'status']);
  const [, first, reply, note, comment, done] = t.history!;
  assert.ok(first.kind === 'status' && first.from === 'open' && first.to === 'in_progress' && first.by === 'admin');
  assert.ok(reply.kind === 'reply' && reply.text === 'looking');
  assert.ok(note.kind === 'note' && note.text === 'probably the cache');
  assert.ok(comment.kind === 'comment' && comment.by === 'reporter');
  assert.ok(done.kind === 'status' && done.by === 'claude' && done.at === day(6).toISOString());
  // The old fields still work for everything else.
  assert.equal(t.reply?.text, 'looking');
  assert.equal(t.comments?.length, 1);
});

test('the admin reopening a closed ticket must say why', () => {
  const t = mk();
  applyPatch(t, { status: 'done' }, day(2));
  assert.throws(() => applyPatch(t, { status: 'open' }, day(3)), /why/);
  assert.throws(() => applyPatch(t, { status: 'in_progress', reason: '   ' }, day(3)), TicketInputError);
  assert.equal(t.status, 'done');
  applyPatch(t, { status: 'in_progress', reason: 'still happens on iPhone' }, day(3));
  const last = t.history!.at(-1)!;
  assert.ok(last.kind === 'reopened' && last.from === 'done' && last.to === 'in_progress' && last.reason === 'still happens on iPhone');
  // Done to won't fix is not a reopen.
  applyPatch(t, { status: 'done' }, day(4));
  applyPatch(t, { status: 'wontfix' }, day(5));
  assert.equal(t.history!.at(-1)!.kind, 'status');
});

test('the reporter can reopen their closed ticket with a reason, within 60 days', () => {
  const t = mk();
  assert.throws(() => reopenByReporter(t, 'x', day(2)), /still open/);
  applyPatch(t, { status: 'done' }, day(2));
  t.seenAt = day(2).toISOString();
  assert.throws(() => reopenByReporter(t, '  ', day(3)), TicketInputError);
  assert.throws(() => addComment(t, 'hello?', day(3)), /closed/);
  reopenByReporter(t, 'it came back', day(3));
  assert.equal(t.status, 'open');
  assert.equal(t.seenAt, undefined, 'lights the new dot again');
  const last = t.history!.at(-1)!;
  assert.ok(last.kind === 'reopened' && last.by === 'reporter' && last.reason === 'it came back');
  assert.equal(toMine(t).history.at(-1)?.kind, 'reopened');

  // Closed on day 4: day 63 is inside the window, day 65 isn't.
  applyPatch(t, { status: 'wontfix' }, day(4));
  assert.equal(canReporterReopen(t, day(63)), true);
  assert.equal(canReporterReopen(t, day(65)), false);
  assert.throws(() => reopenByReporter(t, 'please', day(65)), /a while ago/);
});

test('the reporter can only reopen a few times', () => {
  const t = mk();
  for (let i = 0; i < 5; i++) {
    applyPatch(t, { status: 'done' }, day(2 + i * 2));
    reopenByReporter(t, `again ${i}`, day(3 + i * 2));
  }
  applyPatch(t, { status: 'done' }, day(20));
  assert.equal(canReporterReopen(t, day(21)), false);
  assert.throws(() => reopenByReporter(t, 'once more', day(21)), TicketInputError);
});

test('links are two-sided, validated, and undone on both sides', () => {
  const list = [mk({}, 'a'), mk({}, 'b'), mk({}, 'c')];
  const [a, b] = list;
  assert.deepEqual(linkTickets(list, 'a', 'b', 'duplicate_of', 'admin', day(2)).map((t) => t.id), ['a', 'b']);
  assert.deepEqual(a.links?.map((l) => [l.id, l.rel]), [['b', 'duplicate_of']]);
  assert.deepEqual(b.links?.map((l) => [l.id, l.rel]), [['a', 'duplicated_by']]);
  assert.ok(a.history!.at(-1)!.kind === 'linked' && b.history!.at(-1)!.kind === 'linked');
  // Again with the same relation: nothing changes. With another: replaced on both sides.
  assert.deepEqual(linkTickets(list, 'b', 'a', 'duplicated_by', 'admin', day(2)), []);
  linkTickets(list, 'a', 'b', 'related', 'admin', day(3));
  assert.deepEqual(a.links?.map((l) => l.rel), ['related']);
  assert.deepEqual(b.links?.map((l) => l.rel), ['related']);

  assert.throws(() => linkTickets(list, 'a', 'a', 'related', 'admin', day(3)), /itself/);
  assert.throws(() => linkTickets(list, 'a', 'zzz', 'related', 'admin', day(3)), /No ticket/);
  assert.throws(() => linkTickets(list, 'a', '../x', 'related', 'admin', day(3)), /a ticket id/);
  assert.throws(() => linkTickets(list, 'a', 'c', 'blocks', 'admin', day(3)), /kind of link/);

  assert.equal(unlinkTickets(list, 'b', 'a', 'admin', day(4)).length, 2);
  assert.equal(a.links, undefined);
  assert.equal(b.links, undefined);
  assert.ok(a.history!.at(-1)!.kind === 'unlinked' && b.history!.at(-1)!.kind === 'unlinked');
  assert.throws(() => unlinkTickets(list, 'a', 'b', 'admin', day(4)), /linked/);

  // A deleted ticket's links go from the others.
  linkTickets(list, 'a', 'c', 'related', 'admin', day(5));
  dropLinksTo(list, ['c']);
  assert.equal(a.links, undefined);
});

test('a pasted report records the commit and links related tickets, as Claude', () => {
  const list = [mk({}, 'a'), mk({}, 'b'), mk({}, 'c')];
  const [a, b, c] = list;
  c.status = 'done';
  const out = applyBulk(list, [
    { id: 'a', status: 'done', reply: 'Fixed the button', commit: 'ABCDEF1', related: ['b', 'nope', 'a'] },
    { id: 'c', status: 'open', reply: 'Not fixed after all, the cache kept the old page' },
    { id: 'gone', status: 'done' },
  ], 'claude', day(2));
  assert.deepEqual(out.missing, ['gone']);
  assert.deepEqual(out.changed.map((t) => t.id).sort(), ['a', 'b', 'c']);
  assert.equal(out.skippedLinks.length, 2, 'unknown and self links are skipped, not fatal');
  assert.equal(a.status, 'done');
  const commit = a.history!.find((e) => e.kind === 'commit');
  assert.ok(commit && commit.kind === 'commit' && commit.hash === 'abcdef1' && commit.by === 'claude');
  assert.deepEqual(b.links?.map((l) => [l.id, l.rel]), [['a', 'related']]);
  // Reopening from a report takes the reply as its reason.
  const reopened = c.history!.find((e) => e.kind === 'reopened');
  assert.ok(reopened && reopened.kind === 'reopened' && reopened.by === 'claude' && reopened.reason.startsWith('Not fixed'));
  // A link made by hand keeps its kind when a report says "related".
  linkTickets(list, 'c', 'b', 'duplicate_of', 'admin', day(2));
  applyBulk(list, [{ id: 'c', related: ['b'] }], 'claude', day(3));
  assert.deepEqual(c.links?.find((l) => l.id === 'b')?.rel, 'duplicate_of');
  // The same commit again isn't recorded twice; a bad one rejects the lot.
  applyBulk(list, [{ id: 'a', commit: 'abcdef1234' }], 'claude', day(3));
  assert.equal(a.history!.filter((e) => e.kind === 'commit').length, 1);
  assert.throws(() => applyBulk(list, [{ id: 'a', commit: 'not-a-hash' }], 'claude', day(3)), TicketInputError);
  // From the admin (not a report), reopening still needs its reason.
  a.status = 'done';
  assert.throws(() => applyBulk(list, [{ id: 'a', status: 'open' }], 'admin', day(4)), /why/);
});

test('a report can mark a duplicate: linked both ways as one, replacing a "related" link', () => {
  const list = [mk({}, 'a'), mk({}, 'b'), mk({}, 'c')];
  const [a, b, c] = list;
  linkTickets(list, 'a', 'b', 'related', 'claude', day(1));
  const out = applyBulk(list, [{ id: 'a', status: 'done', duplicateOf: 'b' }, { id: 'c', duplicateOf: 'missing' }], 'claude', day(2));
  assert.deepEqual(a.links?.map((l) => [l.id, l.rel]), [['b', 'duplicate_of']]);
  assert.deepEqual(b.links?.map((l) => [l.id, l.rel]), [['a', 'duplicated_by']]);
  assert.ok(a.history!.some((e) => e.kind === 'linked' && e.by === 'claude' && e.rel === 'duplicate_of'));
  assert.equal(a.status, 'done', 'its status is whatever the report set');
  assert.equal(c.links, undefined);
  assert.equal(out.skippedLinks.length, 1, 'an unknown duplicate is skipped, not fatal');
  // The same report pasted twice changes nothing more.
  const before = a.history!.length;
  applyBulk(list, [{ id: 'a', duplicateOf: 'b' }], 'claude', day(3));
  assert.equal(a.history!.length, before);
});
