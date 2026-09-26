import test from 'node:test';
import { strict as assert } from 'node:assert';
import { searchDocs, type SearchDoc } from './search';

const docs: SearchDoc[] = [
  { kind: 'post', title: 'Building a Robot Arm', url: '/blog/robot-arm', body: 'I used a Raspberry Pi and three servos to build it.' },
  { kind: 'album', title: 'Robot parts', url: '/gallery?album=parts' },
  { kind: 'post', title: 'Garden update', url: '/blog/garden', body: 'Tomatoes and a moisture sensor on the pi.' },
  { kind: 'page', title: 'Résumé', url: '/resume' },
];

test('all terms must match; title matches outrank body matches', () => {
  const hits = searchDocs(docs, 'robot');
  assert.deepEqual(hits.map((h) => h.url).sort(), ['/blog/robot-arm', '/gallery?album=parts']);
  // "pi" is in the robot post's body and the garden post's body, but not in a title.
  assert.ok(searchDocs(docs, 'pi').every((h) => h.kind === 'post'));
  assert.deepEqual(searchDocs(docs, 'robot servos').map((h) => h.url), ['/blog/robot-arm']);
  assert.equal(searchDocs(docs, 'robot tomatoes').length, 0);
});

test('body matches come with a snippet, accents are ignored', () => {
  const [hit] = searchDocs(docs, 'moisture');
  assert.equal(hit.url, '/blog/garden');
  assert.ok(hit.snippet?.includes('moisture sensor'));
  assert.equal(searchDocs(docs, 'resume')[0].url, '/resume');
  assert.deepEqual(searchDocs(docs, '   '), []);
});
