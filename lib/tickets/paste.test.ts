import test from 'node:test';
import { strict as assert } from 'node:assert';
import { pastedImage } from './paste';

test('a pasted screen snip is taken and named; text-only pastes are left alone', () => {
  const snip = new File([new Uint8Array([1, 2])], 'image.png', { type: 'image/png' });
  const got = pastedImage([snip]);
  assert.equal(got?.name, 'Pasted screenshot.png');
  assert.equal(got?.type, 'image/png');
  // A copied photo file keeps its own name.
  const photo = new File([new Uint8Array([1])], 'IMG_2041.jpeg', { type: 'image/jpeg' });
  assert.equal(pastedImage([new File(['x'], 'notes.txt', { type: 'text/plain' }), photo])?.name, 'IMG_2041.jpeg');
  assert.equal(pastedImage([]), null);
  assert.equal(pastedImage(null), null);
  assert.equal(pastedImage([new File(['x'], 'a.pdf', { type: 'application/pdf' })]), null);
});
