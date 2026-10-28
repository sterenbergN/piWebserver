import test from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanPost, imagesIn, IMAGE_PREFIX, isImageName, isPostId } from './private-posts';

const NOW = '2026-10-28T20:00:00.000Z';
const img = (name: string) => `${IMAGE_PREFIX}${name}`;

test('cleanPost keeps createdAt and only accepts the account’s own pictures as a cover', () => {
  const first = cleanPost({ id: 'abc123', title: 'Hi', markdown: 'text', cover: img('mh1-abcdef.webp') }, undefined, NOW);
  assert.equal(first.cover, img('mh1-abcdef.webp'));
  assert.equal(first.createdAt, NOW);
  const later = cleanPost({ id: 'abc123', title: 7, cover: '/api/media/uploads/blog/inline/1-a.jpg' }, first, '2026-10-29T00:00:00.000Z');
  assert.equal(later.createdAt, NOW);
  assert.equal(later.title, '');
  assert.equal(later.cover, '');
  assert.equal(cleanPost({ id: 'abc123', cover: img('../../x.webp') }, undefined, NOW).cover, '');
});

test('imagesIn finds the cover and pictures in the text', () => {
  const names = imagesIn({ cover: img('cover1-aa.webp'), markdown: `Hi ![a](${img('one111-bb.webp')}) and ![b](${img('two222-cc.webp')} "Caption") ![c](/api/media/x.jpg)` });
  assert.deepEqual([...names].sort(), ['cover1-aa.webp', 'one111-bb.webp', 'two222-cc.webp']);
});

test('ids and picture names reject paths', () => {
  assert.ok(isPostId('mh1x2-abc12345'));
  assert.ok(!isPostId('../etc'));
  assert.ok(isImageName('mh1x2-0a1b2c.webp'));
  assert.ok(!isImageName('../posts.json'));
  assert.ok(!isImageName('abcdef.svg'));
});
