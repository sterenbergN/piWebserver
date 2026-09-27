import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress, createLimiter } from './rate-limit';

test('blocks a key after max events until the window ends', () => {
  const l = createLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) { assert.equal(l.retryAfter('a', 0), 0); l.hit('a', 0); }
  assert.equal(l.retryAfter('a', 100), 1);
  assert.equal(l.retryAfter('b', 100), 0, 'other keys are unaffected');
  assert.equal(l.retryAfter('a', 1000), 0, 'window over');
});

test('reset clears a key', () => {
  const l = createLimiter({ max: 1, windowMs: 60_000 });
  l.hit('a', 0);
  assert.ok(l.retryAfter('a', 1) > 0);
  l.reset('a');
  assert.equal(l.retryAfter('a', 1), 0);
});

test('clientAddress prefers proxy headers', () => {
  const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });
  assert.equal(clientAddress(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' })), '1.1.1.1');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1' })), '3.3.3.3');
  assert.equal(clientAddress(req({})), 'unknown');
});
