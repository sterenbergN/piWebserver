import test from 'node:test';
import { strict as assert } from 'node:assert';
import { fractionDone, listenOrder, listenPlace, nowPlayingLabel, resumeSeconds } from './audio-player';
import type { Progress } from './items';

const book = (id: string, addedAt: string, format: 'audio' | 'epub' = 'audio') => ({ id, format, addedAt });
const progress = (at: number, extra: Partial<Progress> = {}): Progress => ({ anchor: { page: 100 }, pct: 0.2, at, startedAt: at, ...extra });

test('the picker offers audio books you’ve started first, latest listened first, finished last', () => {
  const books = [
    book('new-old', '2026-01-01'), book('new-recent', '2026-05-01'), book('read', '2026-02-01', 'epub'),
    book('done', '2026-03-01'), book('a', '2026-03-02'), book('b', '2026-03-03'),
  ];
  const order = listenOrder(books, { a: progress(10), b: progress(20), done: progress(99, { finishedAt: 99 }) });
  assert.deepEqual(order.map((x) => x.id), ['b', 'a', 'new-recent', 'new-old', 'done']);
});

test('where to start: the saved second, or the top when finished or at the very end', () => {
  assert.equal(resumeSeconds(undefined, 600), 0);
  assert.equal(resumeSeconds(progress(1, { anchor: { page: 250 } }), 600), 250);
  assert.equal(resumeSeconds(progress(1, { anchor: { page: 590 } }), 600), 0);
  assert.equal(resumeSeconds(progress(1, { finishedAt: 5 }), 600), 0);
  assert.equal(resumeSeconds(progress(1, { anchor: { page: 250 } }), 600, 40), 40);
});

test('the saved place carries the second, chapter and whether it’s the end', () => {
  const chapters = [{ start: 0, title: 'One' }, { start: 100, title: 'Two' }];
  assert.deepEqual(listenPlace(130.7, 300, chapters), { anchor: { page: 130, chapter: 'Two' }, pct: 130.7 / 300, total: 300, atEnd: false });
  assert.equal(listenPlace(0.2, 300, []).anchor.page, 1);
  assert.equal(listenPlace(280, 300, []).atEnd, true);
  assert.equal(listenPlace(400, 300, []).pct, 1);
});

test('the mini player names the chapter, else the book, and the line stays in range', () => {
  const chapters = [{ start: 0, title: 'One' }, { start: 100, title: 'Two' }];
  assert.equal(nowPlayingLabel(chapters, 120, 'Dune'), 'Two');
  assert.equal(nowPlayingLabel([], 120, 'Dune'), 'Dune');
  assert.equal(fractionDone(50, 200), 0.25);
  assert.equal(fractionDone(5, 0), 0);
  assert.equal(fractionDone(500, 200), 1);
});
