import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, displayName, otherTickets, OTHERS_LIMIT, parseReport } from './prompt';
import { addCommit, addComment, applyPatch, buildTicket, linkTickets, toMine, TicketInputError, type Ticket } from './tickets';

const mk = (over: Record<string, unknown> = {}, id = 'a', at = '2026-01-01T00:00:00Z', username = 'sam'): Ticket =>
  buildTicket({ kind: 'bug', message: 'Button broken', context: { path: '/golf', viewport: '390x664', errors: ['TypeError: x'] }, ...over }, { userId: 'u1', username }, { id, now: new Date(at) });

test('prompt has the sections, ticket facts and the JSON ask', () => {
  const t = mk({}, 'abc');
  t.image = 'IMG1234567890123456';
  t.note = 'private thing';
  const p = buildPrompt([t]);
  for (const s of ['Triage', '## Bugs (1', '#### abc', 'Created: 2026-01-01 00:00 UTC', 'Reported by: sam', 'Page: /golf', '390x664', 'TypeError: x', '/api/tickets/files/IMG1234567890123456', '> Button broken', '"status": "done"']) {
    assert.ok(p.includes(s), s);
  }
});

test('never shows an email, groups by kind and sorts oldest first', () => {
  const a = mk({ kind: 'idea', message: 'idea' }, 'b', '2026-02-01T00:00:00Z');
  const b = mk({}, 'old', '2026-01-01T00:00:00Z', 'pat@example.com');
  const c = mk({}, 'new', '2026-03-01T00:00:00Z');
  const p = buildPrompt([c, a, b]);
  assert.ok(!p.includes('example.com'));
  assert.equal(displayName({ username: 'pat@example.com', userId: 'x' }), 'pat');
  assert.ok(p.indexOf('#### old') < p.indexOf('#### new'));
  assert.ok(p.indexOf('## Bugs') < p.indexOf('## Ideas'));
  assert.ok(p.includes('Screenshot: none'));
});

test('includes comments and the reply so far, and quotes multi-line text', () => {
  const t = mk({ message: 'line1\n```\nline3' });
  t.comments = [{ text: 'still happens', at: '2026-01-02T00:00:00Z' }];
  t.reply = { text: 'looking', at: '2026-01-03T00:00:00Z' };
  const p = buildPrompt([t]);
  assert.ok(p.includes('still happens') && p.includes('looking'));
  assert.ok(p.includes('> ```'));
});

test('parses fenced, prose-wrapped and trailing-comma reports', () => {
  const fenced = 'Done!\n```json\n[{"id":"a","status":"done","reply":"Fixed"},]\n```\nbye';
  assert.deepEqual(parseReport(fenced)?.updates, [{ id: 'a', status: 'done', reply: 'Fixed' }]);
  const bare = 'Here: [{ "id": "b", "status": "in_progress" }] thanks';
  assert.deepEqual(parseReport(bare)?.updates, [{ id: 'b', status: 'in_progress' }]);
  const two = '```json\n{"not":"it"}\n```\n```json\n[{"id":"c","status":"wontfix","reply":"no, \\"sorry\\", ]"}]\n```';
  assert.equal(parseReport(two)?.updates[0].reply, 'no, "sorry", ]');
});

test('skips bad entries and returns null without JSON', () => {
  const r = parseReport('[{"id":"a","status":"finished"},{"status":"done"},{"id":"b"},{"id":"c","status":"Won\'t fix"},{"id":"d","status":"open"},{"id":"d","status":"done"}]');
  assert.deepEqual(r?.updates.map((u) => u.id), ['d']);
  assert.equal(r?.skipped.length, 5);
  assert.equal(parseReport('no json here'), null);
});

test('comments: only while open, clears the new dot, shows to the reporter', () => {
  const t = mk();
  t.seenAt = '2026-01-01T00:00:00Z';
  addComment(t, ' more info ', new Date('2026-01-02T00:00:00Z'));
  assert.equal(t.comments?.[0].text, 'more info');
  assert.equal(t.seenAt, undefined);
  assert.equal(toMine(t).comments.length, 1);
  assert.throws(() => addComment(t, '  ', new Date()), TicketInputError);
  t.status = 'done';
  assert.throws(() => addComment(t, 'x', new Date()), TicketInputError);
});

test('reads an optional commit and related tickets from the report', () => {
  const r = parseReport('```json\n[{"id":"a","status":"done","commit":"ABC1234","related":["b","b"," c ","a","../x",5]},{"id":"d","commit":"later"},{"id":"e","related":"f"}]\n```');
  assert.deepEqual(r?.updates, [
    { id: 'a', status: 'done', commit: 'abc1234', related: ['b', 'c'] },
    { id: 'e', related: ['f'] },
  ]);
  assert.ok(r?.skipped.some((s) => s.includes('later') && s.includes('isn’t a commit')));
  assert.ok(r?.skipped.some((s) => s.startsWith('d: nothing to change')));
});

test('the prompt asks for commit and related, and shows links and the recent timeline', () => {
  const list = [mk({}, 'a'), mk({}, 'b')];
  const [a] = list;
  applyPatch(a, { reply: 'try reloading' }, new Date('2026-01-02T00:00:00Z'));
  applyPatch(a, { status: 'done', reply: 'Fixed for real' }, new Date('2026-01-03T00:00:00Z'));
  applyPatch(a, { status: 'open', reason: 'Still broken on my phone' }, new Date('2026-01-04T00:00:00Z'));
  applyPatch(a, { note: 'secret plan' }, new Date('2026-01-04T00:00:00Z'));
  linkTickets(list, 'a', 'b', 'duplicate_of', 'admin', new Date('2026-01-05T00:00:00Z'));
  const p = buildPrompt([a]);
  for (const s of ['"commit": "<short hash>"', '"related": [', 'Linked tickets: duplicate of b', 'Timeline (latest last)', 'reopened (done → open), because:', '> Still broken on my phone', 'earlier reply:', '> try reloading', 'linked as duplicate of b']) {
    assert.ok(p.includes(s), s);
  }
  // The current reply is shown once, as the reply; the note only as the note.
  assert.equal(p.split('Fixed for real').length - 1, 1);
  assert.equal(p.split('secret plan').length - 1, 1);
});

test('reads duplicate_of from the report, and never lists the duplicate as related too', () => {
  const r = parseReport('```json\n[{"id":"a","status":"done","duplicate_of":" b ","related":["b","c"]},{"id":"d","duplicateOf":["e"]},{"id":"f","duplicate_of":"f"},{"id":"g","duplicate_of":"../x","status":"open"}]\n```');
  assert.deepEqual(r?.updates, [
    { id: 'a', status: 'done', related: ['c'], duplicateOf: 'b' },
    { id: 'd', duplicateOf: 'e' },
    { id: 'g', status: 'open' },
  ]);
  assert.ok(r?.skipped.some((s) => s.startsWith('f:')), 'a ticket can’t duplicate itself');
  assert.ok(r?.skipped.some((s) => s.startsWith('g:') && s.includes('duplicate left out')));
});

test('the prompt lists the newest other tickets for linking, with their fixes', () => {
  const batch = [mk({ message: 'New bug' }, 'new1', '2026-03-01T00:00:00Z')];
  const old = mk({ message: 'Chart label cut off\nmore detail', context: { path: '/workout/health' } }, 'old1', '2026-01-01T00:00:00Z');
  applyPatch(old, { status: 'done' }, new Date('2026-01-02T00:00:00Z'));
  addCommit(old, 'abcdef1234', 'fix', 'claude', new Date('2026-01-02T00:00:00Z'));
  const site = mk({ message: 'x'.repeat(300) }, 'auto1', '2026-02-01T00:00:00Z');
  site.auto = { source: 'server', key: 'k', count: 3, firstSeen: site.createdAt, lastSeen: site.createdAt, pages: [], builds: [], samples: [] } as unknown as Ticket['auto'];
  const all = [...batch, old, site];
  const others = otherTickets(all, batch);
  assert.deepEqual(others.map((t) => t.id), ['auto1', 'old1'], 'newest first, batch left out');
  const p = buildPrompt(batch, new Date('2026-03-02T00:00:00Z'), others);
  assert.ok(p.includes('## Other tickets, for linking (2'));
  assert.ok(p.includes('- old1 (bug, done, 2026-01-01, by sam, /workout/health, fixed in abcdef1): “Chart label cut off”'), p);
  assert.ok(p.includes('- auto1 (bug, open, 2026-02-01, filed by the site,'));
  assert.ok(p.includes(`“${'x'.repeat(109)}…”`), 'long first lines are cut');
  assert.ok(p.includes('"duplicate_of": "<ticket id>"'));
  assert.ok(p.includes('here or in the list for linking'));
  // Without others, no section and the plain wording.
  const plain = buildPrompt(batch);
  assert.ok(!plain.includes('Other tickets, for linking'));
  assert.ok(plain.includes('duplicate of another ticket here.'));
  // Capped.
  const many = Array.from({ length: OTHERS_LIMIT + 5 }, (_, i) => mk({}, `t${i}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`));
  assert.equal(otherTickets(many, []).length, OTHERS_LIMIT);
});
