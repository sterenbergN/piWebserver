import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientAddress,
  createLimiter,
  loginRetryAfter,
  recordLoginFailure,
  recordLoginSuccess,
} from './rate-limit';

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

test('clientAddress ignores proxy headers unless TRUST_PROXY=1', () => {
  const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });
  const prev = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(clientAddress(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '4.4.4.4', 'x-forwarded-for': '2.2.2.2' })), 'unknown');

    process.env.TRUST_PROXY = '1';
    assert.equal(clientAddress(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' })), '1.1.1.1');
    assert.equal(clientAddress(req({ 'x-real-ip': '4.4.4.4', 'x-forwarded-for': '2.2.2.2' })), '4.4.4.4');
    assert.equal(clientAddress(req({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1' })), '3.3.3.3');
    assert.equal(clientAddress(req({})), 'unknown');
  } finally {
    if (prev === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prev;
  }
});

test('login rate limit isolates LAN identifiers without proxy headers and resists header spoofing', async () => {
  const prev = process.env.TRUST_PROXY;
  const req = (ua: string, spoofIp?: string) =>
    new Request('http://x/', {
      headers: {
        'user-agent': ua,
        ...(spoofIp ? { 'x-forwarded-for': spoofIp, 'cf-connecting-ip': spoofIp } : {}),
      },
    });
  try {
    delete process.env.TRUST_PROXY;
    const aliceReq = req('PhoneA');
    const bobReq = req('PhoneA');
    for (let i = 0; i < 5; i++) {
      await recordLoginFailure(aliceReq, 'workout', 'alice');
    }
    assert.ok(loginRetryAfter(aliceReq, 'workout', 'alice') > 0, 'alice is locked out after 5 failures');
    // Spoofing proxy headers when TRUST_PROXY != 1 must not bypass the lockout.
    assert.ok(loginRetryAfter(req('PhoneA', '9.9.9.9'), 'workout', 'alice') > 0, 'spoofed IP cannot bypass lockout');
    // Another user on the same unproxied LAN is unaffected.
    assert.equal(loginRetryAfter(bobReq, 'workout', 'bob'), 0, 'different workout identifier is not locked out');

    recordLoginSuccess(aliceReq, 'workout', 'alice');
    assert.equal(loginRetryAfter(aliceReq, 'workout', 'alice'), 0, 'reset clears alice');

    // Admin scope isolates unproxied LAN clients by User-Agent fallback.
    const adminA = req('Browser-A');
    const adminB = req('Browser-B');
    for (let i = 0; i < 5; i++) {
      await recordLoginFailure(adminA, 'admin', 'admin');
    }
    assert.ok(loginRetryAfter(adminA, 'admin', 'admin') > 0);
    assert.equal(loginRetryAfter(adminB, 'admin', 'admin'), 0, 'distinct UA admin client is not locked out');
    recordLoginSuccess(adminA, 'admin', 'admin');
  } finally {
    if (prev === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prev;
  }
});
