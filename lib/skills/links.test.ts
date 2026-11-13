import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanQuestions } from '../notes/items';
import { readBookItems, readPageElements, syncLibrary, syncBook, syncPage } from '../notes/store';
import { libraryFile, saveProgress, syncNotes } from '../reader/store';
import { addResource, addSubject, addTopic, saveCard, tiePage, untiePage } from './edit';
import { describePages, materialFor, newTopicPage, skillsNotebook, syncReaderResources } from './links';
import { buildQueue } from './model';
import { buildQuestionsPrompt } from './prompts';
import { emptyProgress, emptySkills } from './types';

// Skills' ties to the Reader and Notes, against real stores in a scratch folder.

const USER = 'links-test';
const NOW = '2026-11-12T15:00:00.000Z';
const original = process.cwd();
let dir = '';
let n = 0;
const makeId = () => `id${++n}`;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-links-'));
  process.chdir(dir);
});

after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

function subjectWithBook() {
  const data = emptySkills();
  const subject = addSubject(data, { name: 'Controls' }, makeId, NOW);
  const topic = addTopic(subject, { name: 'PID' }, makeId, NOW);
  const book = addResource(subject, { title: 'Process Control', kind: 'book', readerBookId: 'book1', topicIds: [topic.id] }, makeId, '2026-11-12', NOW);
  return { data, subject, topic, book };
}

test('a linked book follows the Reader: started, pages read, finished', async () => {
  const { data, book } = subjectWithBook();
  assert.equal(book.readerBookId, 'book1');
  assert.equal(await syncReaderResources(USER, data), false, 'not opened yet: nothing to do');

  // The Reader only keeps progress for books on the shelf.
  await fs.mkdir(path.dirname(libraryFile(USER)), { recursive: true });
  await fs.writeFile(libraryFile(USER), JSON.stringify({ books: [{ id: 'book1', title: 'Process Control', author: '', format: 'pdf', size: 1, addedAt: NOW, hasCover: false }], folders: [], seqs: {} }));
  const started = Date.parse('2026-11-01T12:00:00Z');
  await saveProgress(USER, [{ book: 'book1', anchor: { page: 40 }, pct: 0.2, at: started, total: 200, startedAt: started }], started);
  assert.equal(await syncReaderResources(USER, data), true);
  assert.equal(book.status, 'doing');
  assert.equal(book.startedOn, '2026-11-01');
  assert.deepEqual(book.progress, { done: 40, total: 200, unit: 'pages' });
  assert.equal(await syncReaderResources(USER, data), false, 'nothing new the second time');

  const finished = Date.parse('2026-11-10T12:00:00Z');
  await saveProgress(USER, [{ book: 'book1', anchor: { page: 200 }, pct: 1, at: finished, total: 200, startedAt: started, finishedAt: finished }], finished);
  assert.equal(await syncReaderResources(USER, data), true);
  assert.equal(book.status, 'done');
  assert.equal(book.finishedOn, '2026-11-10');
  assert.equal(book.progress?.done, 200);
});

test('topic pages in Notes: made, described, untied; notes go into the prompt', async () => {
  const { data, subject, topic } = subjectWithBook();
  const notebook = await skillsNotebook(USER, data);
  assert.equal(data.notesNotebook, notebook);
  assert.equal(await skillsNotebook(USER, data), notebook, 'made once');

  const ref = await newTopicPage(USER, notebook, subject, topic, 'https://example.test');
  tiePage(subject, topic, ref, NOW);
  tiePage(subject, topic, ref, NOW);
  assert.equal(topic.notePages?.length, 1, 'tied once');
  const elements = await readPageElements(USER, notebook, ref.page);
  assert.ok(elements.some((e) => e.kind === 'text' && e.text === 'Controls: PID'));
  assert.ok(elements.some((e) => e.kind === 'mark' && e.target && 'url' in e.target && e.target.url === `https://example.test/skills/${subject.id}?tab=topics`));
  const [view] = await describePages(USER, topic.notePages!);
  assert.equal(view.label, 'Controls: PID (Skills, p. 1)');

  // Write on the page, and in the linked book: both come back as material.
  await syncPage(USER, notebook, ref.page, Number.MAX_SAFE_INTEGER, [{ id: 'typed', kind: 'text', x: 40, y: 300, w: 400, h: 20, rot: 0, text: 'Derivative kick: use derivative on measurement.', size: 12, color: '#000000', font: 'sans', createdAt: 1, updatedAt: 1 }], Date.now());
  await syncNotes(USER, 'book1', 0, [{ id: 'n1', kind: 'note', anchor: { page: 12 }, createdAt: 1, updatedAt: 1, text: 'Integral windup needs clamping.' }], Date.now());
  const material = await materialFor(USER, subject, [topic.id]);
  assert.deepEqual(material.map((m) => m.kind), ['book', 'page']);
  assert.ok(material[0].text.includes('p. 12: Integral windup'));
  assert.ok(material[1].text.includes('Derivative kick'));
  assert.ok(!material[1].text.includes('Controls: PID') && !material[1].text.includes('in Skills ↗'), 'the page’s own heading and link aren’t notes');
  const prompt = buildQuestionsPrompt({ subject: { name: 'Controls', resources: [], items: [] }, topics: [], count: 3, style: 'cards', difficulty: 'auto', material });
  assert.ok(prompt.includes('<<<NOTES: Your notes in Process Control\np. 12: Integral windup'));

  // A page thrown away in Notes drops out.
  await syncBook(USER, notebook, Number.MAX_SAFE_INTEGER, [{ ...(await readBookItems(USER, notebook))[0], deleted: true, updatedAt: Date.now() + 1 }], Date.now());
  assert.deepEqual(await describePages(USER, topic.notePages!), []);
  untiePage(subject, topic, ref.page, NOW);
  assert.equal(topic.notePages, undefined);

  // A trashed Skills notebook is replaced by a new one.
  await syncLibrary(USER, Number.MAX_SAFE_INTEGER, [{ id: notebook, kind: 'notebook', title: 'Skills', trashedAt: Date.now(), createdAt: 1, updatedAt: Date.now() + 5 }], Date.now());
  assert.notEqual(await skillsNotebook(USER, data), notebook);
});

test('one question by name, and Notes keeping its link back to Skills', () => {
  const data = emptySkills();
  const progress = emptyProgress();
  const subject = addSubject(data, { name: 'Paused one', status: 'paused' }, makeId, NOW);
  const topic = addTopic(subject, { name: 'T' }, makeId, NOW);
  const card = saveCard(subject, { topicId: topic.id, front: 'f', back: 'b' }, makeId, NOW);
  progress.attempts.push({ id: 'a', subjectId: subject.id, topicId: topic.id, itemId: card.id, day: '2026-11-12', at: NOW, score: 1, difficulty: 2 });
  assert.equal(buildQueue(data, progress, '2026-11-12').length, 0);
  assert.deepEqual(buildQueue(data, progress, '2026-11-12', { itemId: card.id }).map((e) => e.item.id), [card.id], 'even paused, even answered today');

  const links = cleanQuestions([
    { id: 'q1', date: '2026-11-12', title: 'A', href: '/skills/review?item=q1' },
    { id: 'q2', date: '2026-11-12', title: 'B', href: 'https://evil.example/x' },
  ]);
  assert.deepEqual(links, [{ id: 'q1', date: '2026-11-12', title: 'A', href: '/skills/review?item=q1' }, { id: 'q2', date: '2026-11-12', title: 'B' }]);
});
