import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  boundsOf, eraseFromStroke, lassoCatchesBox, lassoCatchesStroke, moveBox, movePoints, packPoints, pointInBox, recognizeShape, shapeFromDrag, strokeTouches, unpackPoints,
} from './geometry';
import {
  cleanBookRecord, cleanElement, cleanLibraryRecord, emptyFile, folderPath, mergeChanges, orderBetween, recordsSince, sniffFile, wouldNest, MAX_STROKE_POINTS, type Folder, type PageElement,
} from './items';
import { appendUpload, finishUpload, NotebookGone, openStoredFile, readLibrary, syncBook, syncLibrary, syncPage, UploadRefused } from './store';
import { PAGE_SIZES, TEMPLATES, templateMarks } from './templates';

const NOW = 1_800_000_000_000;
const original = process.cwd();
let dir = '';

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-store-'));
  process.chdir(dir);
});

after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

const stroke = (id: string, updatedAt: number, pts = [10, 10, 0.5, 20, 20, 0.5]): PageElement => ({ id, kind: 'stroke', style: 'ball', color: '#112233', width: 1.5, p: packPoints(pts), createdAt: 1, updatedAt });
const notebook = (id: string, updatedAt = 10, extra = {}) => ({ id, kind: 'notebook' as const, title: 'Anatomy', createdAt: 1, updatedAt, ...extra });
const page = (id: string, updatedAt = 10) => ({ id, kind: 'page' as const, order: 1000, w: 612, h: 792, template: 'ruled' as const, paper: '#ffffff', createdAt: 1, updatedAt });
const stream = (bytes: Uint8Array | string) => new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;

test('points come back from storage where they were, near enough to never see', () => {
  const pts = [100.123, 200.456, 0.37, 101.5, 199.25, 0.42, 100, 200, 1];
  const back = unpackPoints(packPoints(pts));
  pts.forEach((value, i) => assert.ok(Math.abs(value - back[i]) <= (i % 3 === 2 ? 0.005 : 0.025), `${i}`));
});

test('packed strokes are small numbers after the first point', () => {
  const pts: number[] = [];
  for (let i = 0; i < 50; i++) pts.push(300 + i * 0.8, 400 + i * 0.3, 0.5);
  assert.ok(packPoints(pts).slice(3).every((n) => Math.abs(n) < 20));
});

test('touching a stroke finds it, and misses what is too far off', () => {
  const pts = [0, 0, 0.5, 100, 0, 0.5];
  assert.ok(strokeTouches(pts, 50, 4, 5));
  assert.ok(!strokeTouches(pts, 50, 8, 5));
  assert.ok(strokeTouches([5, 5, 0.5], 6, 6, 3), 'a dot counts too');
});

test('erasing the middle of a stroke leaves both ends as strokes of their own', () => {
  const pts: number[] = [];
  for (let x = 0; x <= 100; x += 2) pts.push(x, 0, 0.5);
  const runs = eraseFromStroke(pts, [50, -10], [50, 10], 5);
  assert.equal(runs?.length, 2);
  assert.ok(runs![0].every((v, i) => i % 3 !== 0 || v < 46));
  assert.ok(runs![1].every((v, i) => i % 3 !== 0 || v > 54));
  assert.equal(eraseFromStroke(pts, [50, 30], [50, 40], 5), null, 'not touched: nothing to do');
  assert.deepEqual(eraseFromStroke(pts, [-10, 0], [110, 0], 5), [], 'all of it');
});

test('the eraser catches a fast stroke whose points are far apart', () => {
  const runs = eraseFromStroke([0, 0, 0.5, 100, 0, 0.5], [50, -3], [50, 3], 2);
  assert.ok(runs && runs.length === 2);
  assert.equal(runs[0][0], 0);
  assert.equal(runs[1][runs[1].length - 3], 100);
});

test('a lasso takes what is mostly inside it', () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100];
  assert.ok(lassoCatchesStroke([10, 10, 0.5, 90, 90, 0.5], square));
  assert.ok(!lassoCatchesStroke([90, 90, 0.5, 200, 200, 0.5, 300, 300, 0.5], square));
  assert.ok(lassoCatchesBox({ x: 10, y: 10, w: 20, h: 20 }, square));
  assert.ok(!lassoCatchesBox({ x: 90, y: 90, w: 50, h: 50 }, square));
});

test('moving, scaling and turning a selection keeps points and boxes together', () => {
  const move = { dx: 10, dy: 0, scale: 2, rot: 0, cx: 50, cy: 50 };
  assert.deepEqual(movePoints([60, 50, 0.5], move), [80, 50, 0.5]);
  assert.deepEqual(moveBox({ x: 40, y: 40, w: 20, h: 20, rot: 0 }, move), { x: 40, y: 30, w: 40, h: 40, rot: 0 });
  const quarter = movePoints([60, 50, 0.5], { dx: 0, dy: 0, scale: 1, rot: Math.PI / 2, cx: 50, cy: 50 });
  assert.ok(Math.abs(quarter[0] - 50) < 1e-9 && Math.abs(quarter[1] - 60) < 1e-9);
  assert.ok(pointInBox(50, 50, { x: 0, y: 45, w: 100, h: 10, rot: Math.PI / 2 }));
  assert.ok(!pointInBox(10, 50, { x: 0, y: 45, w: 100, h: 10, rot: Math.PI / 2 }));
});

const wobble = (fn: (t: number) => [number, number], steps = 60, jitter = 1.2) => {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const [x, y] = fn(i / steps);
    pts.push(x + Math.sin(i * 7) * jitter, y + Math.cos(i * 5) * jitter, 0.5);
  }
  return pts;
};

test('a wobbly line becomes a straight one, level if it nearly was', () => {
  const shape = recognizeShape(wobble((t) => [100 + t * 200, 100 + t * 6]));
  assert.equal(shape?.kind, 'line');
  const box = boundsOf(shape!.pts);
  assert.ok(box.h < 3, `level: ${box.h}`);
});

test('a hand-drawn circle, box and triangle are recognised', () => {
  const circle = recognizeShape(wobble((t) => [200 + 80 * Math.cos(t * Math.PI * 2), 200 + 80 * Math.sin(t * Math.PI * 2)]));
  assert.equal(circle?.kind, 'ellipse');
  const corners = (t: number, points: [number, number][]): [number, number] => {
    const at = t * (points.length - 1);
    const i = Math.min(points.length - 2, Math.floor(at));
    const f = at - i;
    return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f];
  };
  const rect = recognizeShape(wobble((t) => corners(t, [[100, 100], [300, 100], [300, 240], [100, 240], [100, 100]]), 120));
  assert.equal(rect?.kind, 'rect');
  const tri = recognizeShape(wobble((t) => corners(t, [[200, 100], [300, 280], [100, 280], [200, 100]]), 90));
  assert.equal(tri?.kind, 'triangle');
});

test('handwriting is not mistaken for a shape', () => {
  assert.equal(recognizeShape(wobble((t) => [100 + t * 200, 100 + Math.sin(t * 20) * 30], 80, 0)), null);
  assert.equal(recognizeShape([10, 10, 0.5, 11, 11, 0.5]), null);
});

test('dragging out each shape draws it between the two corners', () => {
  for (const kind of ['line', 'arrow', 'rect', 'ellipse', 'triangle'] as const) {
    const pts = shapeFromDrag(kind, 10, 10, 110, 60);
    assert.equal(pts.length % 3, 0);
    assert.ok(pts.length >= 6, kind);
  }
  assert.deepEqual(boundsOf(shapeFromDrag('rect', 110, 60, 10, 10)), { x: 10, y: 10, w: 100, h: 50 });
});

test('a new page goes between its neighbours, whichever end it is at', () => {
  assert.equal(orderBetween(undefined, undefined), 1000);
  assert.equal(orderBetween(1000, undefined), 2000);
  assert.equal(orderBetween(undefined, 1000), 0);
  assert.equal(orderBetween(1000, 2000), 1500);
});

test('folders know where they sit, and a loop from two devices does not hang', () => {
  const folder = (id: string, parent?: string): Folder => ({ id, kind: 'folder', name: id, createdAt: 1, updatedAt: 1, ...(parent ? { parent } : {}) });
  const folders = [folder('a'), folder('b', 'a'), folder('c', 'b'), folder('x', 'y'), folder('y', 'x')];
  assert.deepEqual(folderPath(folders, 'c').map((f) => f.id), ['a', 'b', 'c']);
  assert.equal(folderPath(folders, 'x').length, 2);
  assert.ok(wouldNest(folders, 'a', 'c'));
  assert.ok(!wouldNest(folders, 'c', 'a'));
});

test('every template fits its page', () => {
  for (const { id } of TEMPLATES) {
    for (const { w, h } of PAGE_SIZES) {
      const marks = templateMarks(id, w, h);
      for (const [x1, y1, x2, y2] of marks.lines) assert.ok([x1, y1, x2, y2].every(Number.isFinite), id);
      for (const label of marks.labels) assert.ok(label.x < w && label.y < h, `${id} ${label.text}`);
    }
  }
  assert.equal(templateMarks('blank', 612, 792).lines.length, 0);
  assert.ok(templateMarks('weekly', 612, 792).labels.some((l) => l.text === 'Sunday'));
});

test('records from a device are checked before they are kept', () => {
  assert.equal(cleanElement({ ...stroke('a', 5), p: 'nonsense' }, NOW), null);
  assert.equal(cleanElement({ ...stroke('a', 5), color: 'red' }, NOW), null);
  assert.equal(cleanElement({ ...stroke('a/../b', 5) }, NOW), null);
  assert.equal(cleanElement({ ...stroke('a', 5), p: new Array((MAX_STROKE_POINTS + 1) * 3).fill(1) }, NOW), null);
  assert.equal(cleanElement({ id: 'a', kind: 'image', x: 0, y: 0, w: 10, h: 10, createdAt: 1, updatedAt: 2, file: '../secret' }, NOW), null);
  assert.equal(cleanElement({ id: 'a', kind: 'text', x: 0, y: 0, w: 10, h: 10, createdAt: 1, updatedAt: 2, text: 'hi', size: 2000, color: '#000000' }, NOW), null);
  assert.equal(cleanLibraryRecord({ id: 'f', kind: 'folder', name: '  ', createdAt: 1, updatedAt: 1 }, NOW), null);
  assert.equal(cleanBookRecord({ ...page('p'), w: 10 }, NOW), null);
  assert.equal(cleanBookRecord({ ...page('p'), pdf: { file: '../x', page: 0 } }, NOW)?.kind, 'page');
  assert.equal((cleanBookRecord({ ...page('p'), pdf: { file: '../x', page: 0 } }, NOW) as { pdf?: unknown }).pdf, undefined);
  assert.equal(cleanElement(stroke('a', NOW + 99_999), NOW)?.updatedAt, NOW, 'a clock in the future does not win forever');
});

test('a deleted record loses its content but keeps its place in the history', () => {
  const gone = cleanElement({ ...stroke('a', 5), deleted: true, color: undefined }, NOW);
  assert.equal(gone?.deleted, true);
  assert.deepEqual((gone as { p?: number[] }).p, []);
  const folder = cleanLibraryRecord({ id: 'f', kind: 'folder', createdAt: 1, updatedAt: 3, deleted: true }, NOW);
  assert.equal(folder?.deleted, true);
});

test('the newest edit wins, whichever order they arrive in', () => {
  const file = emptyFile<PageElement>();
  mergeChanges(file, [stroke('a', 10)], cleanElement, NOW);
  assert.equal(mergeChanges(file, [stroke('a', 5)], cleanElement, NOW).length, 0, 'older edit is ignored');
  assert.equal(mergeChanges(file, [stroke('a', 20)], cleanElement, NOW).length, 1);
  assert.equal(file.items.a.updatedAt, 20);
  assert.equal(file.seq, 2);
  assert.deepEqual(recordsSince(file, 1).map((r) => r.id), ['a']);
  assert.deepEqual(recordsSince(file, 2), []);
});

test('files are only kept if they are what the notes hold', () => {
  const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(20).fill(0)]);
  assert.equal(sniffFile(new TextEncoder().encode('%PDF-1.7 and the rest of it')), 'pdf');
  assert.equal(sniffFile(bytes(0xff, 0xd8, 0xff)), 'jpeg');
  assert.equal(sniffFile(bytes(0x89, 0x50, 0x4e, 0x47)), 'png');
  assert.equal(sniffFile(bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70)), 'audio');
  assert.equal(sniffFile(bytes(0x1a, 0x45, 0xdf, 0xa3)), 'audio');
  assert.equal(sniffFile(new TextEncoder().encode('<html><script>alert(1)</script></html>')), null);
});

test('two devices sync through the library, a notebook and a page', async () => {
  const first = await syncLibrary('ann', 0, [notebook('nb1')], NOW);
  assert.equal(first.items.length, 1);
  assert.equal(first.cursor, 1);

  const book = await syncBook('ann', 'nb1', 0, [page('p1')], NOW);
  assert.equal(book.items[0].id, 'p1');

  const written = await syncPage('ann', 'nb1', 'p1', 0, [stroke('s1', 11), stroke('s2', 12)], NOW);
  assert.equal(written.cursor, 2);

  // The other device, which knows nothing yet, can see there's news and fetch it level by level.
  const library = await syncLibrary('ann', 0, [], NOW);
  assert.deepEqual(library.items.map((r) => r.id), ['nb1']);
  assert.equal(library.revs.nb1, 2);
  const seen = await syncBook('ann', 'nb1', 0, [], NOW);
  assert.equal(seen.pageSeqs.p1, 2);
  const contents = await syncPage('ann', 'nb1', 'p1', 0, [], NOW);
  assert.deepEqual(contents.items.map((r) => r.id).sort(), ['s1', 's2']);

  // Already seen: nothing comes back, and nothing is counted as a change.
  const quiet = await syncPage('ann', 'nb1', 'p1', 2, [], NOW);
  assert.deepEqual(quiet.items, []);
  assert.equal((await syncLibrary('ann', 1, [], NOW)).revs.nb1, 2);
});

test('one account never reads another’s', async () => {
  await syncLibrary('ann2', 0, [notebook('nb9')], NOW);
  await assert.rejects(() => syncBook('ben2', 'nb9', 0, [], NOW), NotebookGone);
  await assert.rejects(() => syncPage('ben2', 'nb9', 'p', 0, [], NOW), NotebookGone);
  assert.deepEqual((await readLibrary('ben2')).items, {});
  await assert.rejects(() => syncBook('../ann2', 'nb9', 0, [], NOW));
});

test('a file goes up in pieces, a resent piece is not doubled, and the wrong kind is refused', async () => {
  await syncLibrary('cy', 0, [notebook('nb')], NOW);
  assert.equal(await appendUpload('cy', 'nb', 'f1', 0, stream('%PDF')), 4);
  assert.equal(await appendUpload('cy', 'nb', 'f1', 4, stream('-1.7 hello')), 14);
  assert.equal(await appendUpload('cy', 'nb', 'f1', 4, stream('-1.7 hello')), 14);
  await assert.rejects(() => appendUpload('cy', 'nb', 'f1', 99, stream('x')), UploadRefused);
  assert.equal(await openStoredFile('cy', 'nb', 'f1'), null, 'not there until it is finished');
  await finishUpload('cy', 'nb', 'f1');
  assert.equal((await openStoredFile('cy', 'nb', 'f1'))?.size, 14);

  await appendUpload('cy', 'nb', 'bad', 0, stream('<html><script>alert(1)</script></html>'));
  await assert.rejects(() => finishUpload('cy', 'nb', 'bad'), UploadRefused);
  assert.equal(await openStoredFile('cy', 'nb', 'bad'), null);
  await assert.rejects(() => appendUpload('cy', 'nope', 'f', 0, stream('x')), NotebookGone);
});

test('deleting a notebook for good takes its pages and files, and stays deleted', async () => {
  await syncLibrary('dee', 0, [notebook('nb')], NOW);
  await syncBook('dee', 'nb', 0, [page('p1')], NOW);
  await syncPage('dee', 'nb', 'p1', 0, [stroke('s1', 11)], NOW);
  await appendUpload('dee', 'nb', 'f1', 0, stream('%PDF-1.7 hello'));
  await finishUpload('dee', 'nb', 'f1');

  // In the trash it's all still there.
  await syncLibrary('dee', 0, [notebook('nb', 20, { trashedAt: NOW })], NOW);
  assert.equal((await syncPage('dee', 'nb', 'p1', 0, [], NOW)).items.length, 1);

  const out = await syncLibrary('dee', 0, [{ id: 'nb', kind: 'notebook', createdAt: 1, updatedAt: 30, deleted: true }], NOW);
  assert.equal(out.items[0].deleted, true, 'other devices hear about it');
  await assert.rejects(() => syncPage('dee', 'nb', 'p1', 0, [], NOW), NotebookGone);
  assert.equal(await openStoredFile('dee', 'nb', 'f1'), null);
  // A device that had it open and edited it offline can't bring it back with an older edit.
  await syncLibrary('dee', 0, [notebook('nb', 25)], NOW);
  assert.equal((await readLibrary('dee')).items.nb.deleted, true);
});
