import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCommit, closedAt, historyOf, MAX_HISTORY, recordEvent, reporterHistory, withHistory } from './history';
import { addCommit, addComment, applyPatch, buildTicket, linkTickets, toMineAmong, type Ticket } from './tickets';

const mk = (id = 'a', userId = 'u1', at = '2026-01-01T00:00:00Z'): Ticket =>
  buildTicket({ kind: 'bug', message: `ticket ${id}` }, { userId, username: 'sam' }, { id, now: new Date(at) });

/** A ticket as it was stored before timelines existed. */
const legacy = (): Ticket => ({
  id: 'old', userId: 'u1', username: 'sam', kind: 'bug', message: 'old one', status: 'done',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z', context: { path: '/', errors: [] },
  comments: [{ text: 'more', at: '2026-01-02T00:00:00.000Z' }], reply: { text: 'fixed it', at: '2026-01-04T00:00:00.000Z' }, note: 'secret',
});

test('a new ticket starts its timeline with being filed', () => {
  const t = mk();
  assert.deepEqual(t.history, [{ at: '2026-01-01T00:00:00.000Z', by: 'reporter', kind: 'filed' }]);
});

test('an old ticket gets a timeline at read time without being changed', () => {
  const t = legacy();
  const before = JSON.stringify(t);
  const h = historyOf(t);
  assert.deepEqual(h.map((e) => e.kind), ['filed', 'comment', 'reply', 'status']);
  assert.equal(h[0].at, t.createdAt);
  assert.equal(h[1].by, 'reporter');
  const status = h[3];
  assert.ok(status.kind === 'status' && status.to === 'done' && status.approx);
  assert.equal(JSON.stringify(t), before, 'reading must not write a history into the ticket');
  assert.equal(withHistory(t).history?.length, 4);
  assert.equal(t.history, undefined);
});

test('recording on an old ticket keeps what came before', () => {
  const t = legacy();
  recordEvent(t, { by: 'admin', kind: 'note', text: 'x' }, new Date('2026-02-01T00:00:00Z'));
  assert.deepEqual(t.history?.map((e) => e.kind), ['filed', 'comment', 'reply', 'status', 'note']);
});

test('the timeline is capped, dropping the oldest', () => {
  const t = mk();
  for (let i = 0; i < MAX_HISTORY + 10; i++) recordEvent(t, { by: 'admin', kind: 'note', text: `n${i}` });
  assert.equal(t.history?.length, MAX_HISTORY);
  const last = t.history![MAX_HISTORY - 1];
  assert.ok(last.kind === 'note' && last.text === `n${MAX_HISTORY + 9}`);
  assert.notEqual(t.history![0].kind, 'filed');
});

test('closedAt is the last time it was closed', () => {
  const t = mk();
  assert.equal(closedAt(t), undefined);
  applyPatch(t, { status: 'done' }, new Date('2026-03-01T00:00:00Z'));
  assert.equal(closedAt(t), '2026-03-01T00:00:00.000Z');
  // An old ticket falls back to when it last changed.
  assert.equal(closedAt(legacy()), '2026-01-05T00:00:00.000Z');
});

test('commit hashes: 7 to 40 hex characters', () => {
  assert.equal(cleanCommit(' ABC1234 '), 'abc1234');
  assert.equal(cleanCommit('a'.repeat(40)), 'a'.repeat(40));
  for (const bad of ['abc123', 'a'.repeat(41), 'xyz1234', 'abc1234; rm', 7, null]) assert.equal(cleanCommit(bad), undefined, String(bad));
});

test('the reporter sees no notes, no commit hashes and no links to other people’s tickets', () => {
  const list = [mk('a'), mk('b'), mk('theirs', 'u2')];
  const [a] = list;
  const now = new Date('2026-01-02T00:00:00Z');
  applyPatch(a, { note: 'private thing', reply: 'on it' }, now);
  addCommit(a, 'abc1234', 'fix(golf): the button', 'claude', now);
  linkTickets(list, 'a', 'b', 'related', 'admin', now);
  linkTickets(list, 'a', 'theirs', 'duplicate_of', 'admin', now);
  addComment(a, 'thanks', now);

  const own = new Set(['a', 'b']);
  const view = reporterHistory(a, own);
  const text = JSON.stringify(view);
  assert.ok(!text.includes('private thing'));
  assert.ok(!text.includes('abc1234') && !text.includes('fix(golf)'));
  assert.ok(!text.includes('theirs'));
  assert.ok(view.some((e) => e.kind === 'commit'));
  assert.ok(view.some((e) => e.kind === 'linked' && e.other === 'b'));
  assert.ok(view.every((e) => e.by === 'reporter' || e.by === 'admin'), 'Claude and the site read as the admin');

  const mine = toMineAmong(a, own);
  assert.deepEqual(mine.links, [{ id: 'b', rel: 'related' }]);
  assert.ok(!('note' in mine));
  assert.ok(!JSON.stringify(mine).includes('private thing'));
  assert.ok(!JSON.stringify(mine).includes('theirs'));
});

test('a withdrawn reply disappears from the reporter’s timeline', () => {
  const t = mk();
  applyPatch(t, { reply: 'oops, wrong ticket' }, new Date('2026-01-02T00:00:00Z'));
  applyPatch(t, { reply: '' }, new Date('2026-01-03T00:00:00Z'));
  applyPatch(t, { reply: 'the real answer' }, new Date('2026-01-04T00:00:00Z'));
  const replies = reporterHistory(t, new Set()).filter((e) => e.kind === 'reply');
  assert.deepEqual(replies.map((e) => e.kind === 'reply' && e.text), ['the real answer']);
});
