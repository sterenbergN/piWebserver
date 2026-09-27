import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { chooseFormat, contentTypeFor, roundWidth, thumbFile } from './thumbnails';

test('widths round up to a cached size', () => {
  assert.equal(roundWidth(300), 400);
  assert.equal(roundWidth(400), 400);
  assert.equal(roundWidth(5000), 1920);
});

test('WebP only when the browser accepts it, and never for GIFs', () => {
  const chrome = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
  assert.equal(chooseFormat(chrome, 'a.jpg'), 'webp');
  assert.equal(chooseFormat('image/png,image/*;q=0.8', 'a.jpg'), 'original');
  assert.equal(chooseFormat(null, 'a.jpg'), 'original');
  assert.equal(chooseFormat(chrome, 'party.gif'), 'original');
});

test('cache file names keep formats apart', () => {
  assert.equal(path.basename(thumbFile('uploads/gallery/a.jpg', 640, 'webp')), 'uploads_gallery_a.jpg_w640.webp');
  assert.equal(path.basename(thumbFile('uploads/gallery/a.jpg', 640, 'original')), 'uploads_gallery_a.jpg_w640.jpg');
  assert.equal(contentTypeFor('x_w640.webp'), 'image/webp');
});
