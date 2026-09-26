import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaPath, mediaSrc, mediaSrcSet } from './media-url';

test('mediaPath routes stored paths through /api/media', () => {
  assert.equal(mediaPath('/uploads/blog/a.jpg'), '/api/media/uploads/blog/a.jpg');
  assert.equal(mediaPath('uploads/blog/a.jpg'), '/api/media/uploads/blog/a.jpg');
  assert.equal(mediaPath('/api/media/uploads/gallery/b.jpg'), '/api/media/uploads/gallery/b.jpg');
  assert.equal(mediaPath('https://example.com/c.jpg'), 'https://example.com/c.jpg');
});

test('mediaSrc adds a width only for our own media', () => {
  assert.equal(mediaSrc('/uploads/gallery/b.jpg', 640), '/api/media/uploads/gallery/b.jpg?w=640&v=2');
  assert.equal(mediaSrc('/uploads/gallery/b.jpg'), '/api/media/uploads/gallery/b.jpg');
  assert.equal(mediaSrc('https://example.com/c.jpg', 640), 'https://example.com/c.jpg');
});

test('mediaSrcSet lists each width', () => {
  assert.equal(mediaSrcSet('/uploads/x.jpg', [400, 800]), '/api/media/uploads/x.jpg?w=400&v=2 400w, /api/media/uploads/x.jpg?w=800&v=2 800w');
  assert.equal(mediaSrcSet('https://example.com/c.jpg'), undefined);
});
