import test from 'node:test';
import { strict as assert } from 'node:assert';
import AdmZip from 'adm-zip';
import { isImageName, naturalSort, ZipReader } from './zip';

function sample() {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('OEBPS/Chapter One.xhtml', Buffer.from('<p>'.repeat(5000)));
  zip.addFile('OEBPS/images/', Buffer.alloc(0));
  zip.addFile('OEBPS/images/é.png', Buffer.from([1, 2, 3, 4]));
  return new Blob([new Uint8Array(zip.toBuffer())]);
}

test('reads named files out of a zip, without reading all of it', async () => {
  const zip = await ZipReader.open(sample());
  assert.deepEqual(zip.names().sort(), ['OEBPS/Chapter One.xhtml', 'OEBPS/images/é.png', 'mimetype']);
  assert.equal(await zip.text('mimetype'), 'application/epub+zip');
  assert.equal((await zip.text('OEBPS/Chapter One.xhtml')).length, 15_000);
  assert.deepEqual([...await zip.bytes('OEBPS/images/é.png')], [1, 2, 3, 4]);
});

test('forgives links with the wrong capitals, and says what is missing', async () => {
  const zip = await ZipReader.open(sample());
  assert.equal(await zip.text('MIMETYPE'), 'application/epub+zip');
  await assert.rejects(zip.bytes('nope.css'), /nope\.css/);
});

test('turns away files that are not zips', async () => {
  await assert.rejects(ZipReader.open(new Blob(['just some text, not a zip at all'])), /zip/);
});

test('comic pages go in the order people number them', () => {
  assert.deepEqual(naturalSort(['p10.jpg', 'p9.jpg', 'p1.jpg']), ['p1.jpg', 'p9.jpg', 'p10.jpg']);
  assert.ok(isImageName('a/b/Page.JPG'));
  assert.ok(!isImageName('ComicInfo.xml'));
});
