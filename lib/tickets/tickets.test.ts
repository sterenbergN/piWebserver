import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch, buildTicket, cleanContext, enforceCap, normalizeSettings, toMine, TicketInputError, type Ticket } from './tickets';

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
