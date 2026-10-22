import test from 'node:test';
import assert from 'node:assert/strict';
import { posterExtension } from './files';

test('posterExtension knows PNG, JPEG and WebP by their first bytes', () => {
  assert.equal(posterExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), '.png');
  assert.equal(posterExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), '.jpg');
  assert.equal(posterExtension(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')), '.webp');
  assert.equal(posterExtension(new TextEncoder().encode('<svg onload="x()">')), null);
  assert.equal(posterExtension(new Uint8Array()), null);
});
