import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnshapeLink } from './onshape';
import { exportPartStudioStl, looksLikeStl, OnshapeError } from './onshape-export';

const D = '0123456789abcdef01234567';
const W = 'abcdef0123456789abcdef01';
const E = 'fedcba9876543210fedcba98';

test('parseOnshapeLink reads workspace, version and company links', () => {
  assert.deepEqual(parseOnshapeLink(`https://cad.onshape.com/documents/${D}/w/${W}/e/${E}`), { host: 'cad.onshape.com', did: D, wvm: 'w', wvmid: W, eid: E });
  assert.equal(parseOnshapeLink(`https://cad.onshape.com/documents/${D}/v/${W}/e/${E}?renderMode=0`)?.wvm, 'v');
  assert.equal(parseOnshapeLink(` https://acme.onshape.com/documents/${D}/w/${W}/e/${E}/ `)?.host, 'acme.onshape.com');
});

test('parseOnshapeLink refuses other sites and incomplete links', () => {
  assert.equal(parseOnshapeLink(`https://evil.example/documents/${D}/w/${W}/e/${E}`), null);
  assert.equal(parseOnshapeLink(`https://onshape.com.evil.example/documents/${D}/w/${W}/e/${E}`), null);
  assert.equal(parseOnshapeLink(`http://cad.onshape.com/documents/${D}/w/${W}/e/${E}`), null);
  assert.equal(parseOnshapeLink(`https://cad.onshape.com/documents/${D}`), null);
  assert.equal(parseOnshapeLink('not a link'), null);
  assert.equal(parseOnshapeLink(undefined), null);
});

test('looksLikeStl knows binary and text STL', () => {
  const binary = new Uint8Array(84 + 50);
  new DataView(binary.buffer).setUint32(80, 1, true);
  assert.equal(looksLikeStl(binary), true);
  assert.equal(looksLikeStl(new TextEncoder().encode('solid part\nendsolid')), true);
  assert.equal(looksLikeStl(new TextEncoder().encode('{"message":"nope"}')), false);
});

/** Runs `fn` with fake API keys and a stand-in fetch that answers from `reply`. */
async function withFakeOnshape(reply: (url: string) => Response, fn: (calls: { url: string; auth: string | null }[]) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const calls: { url: string; auth: string | null }[] = [];
  process.env.ONSHAPE_ACCESS_KEY = 'access';
  process.env.ONSHAPE_SECRET_KEY = 'secret';
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return reply(url);
  }) as typeof fetch;
  try { await fn(calls); } finally {
    globalThis.fetch = realFetch;
    delete process.env.ONSHAPE_ACCESS_KEY;
    delete process.env.ONSHAPE_SECRET_KEY;
  }
}

const ref = parseOnshapeLink(`https://cad.onshape.com/documents/${D}/w/${W}/e/${E}`)!;
const stl = () => { const b = new Uint8Array(84 + 50); new DataView(b.buffer).setUint32(80, 1, true); return b; };

test('exportPartStudioStl follows the redirect with the keys', async () => {
  await withFakeOnshape(
    (url) => (url.includes('/api/v6/partstudios/') ? new Response(null, { status: 307, headers: { location: 'https://cad.onshape.com/download/1' } }) : new Response(stl())),
    async (calls) => {
      const data = await exportPartStudioStl(ref);
      assert.equal(data.byteLength, 134);
      assert.match(calls[0].url, new RegExp(`/partstudios/d/${D}/w/${W}/e/${E}/stl[?]mode=binary`));
      assert.equal(calls[1].url, 'https://cad.onshape.com/download/1');
      const basic = `Basic ${Buffer.from('access:secret').toString('base64')}`;
      assert.deepEqual(calls.map((c) => c.auth), [basic, basic]);
    },
  );
});

test('exportPartStudioStl never sends the keys off Onshape', async () => {
  await withFakeOnshape(
    () => new Response(null, { status: 307, headers: { location: 'https://evil.example/steal' } }),
    async (calls) => {
      await assert.rejects(exportPartStudioStl(ref), OnshapeError);
      assert.equal(calls.length, 1);
    },
  );
});

test('exportPartStudioStl explains refused keys and non-Part-Studio tabs', async () => {
  await withFakeOnshape(() => new Response('{}', { status: 401 }), async () => {
    await assert.rejects(exportPartStudioStl(ref), /API keys/);
  });
  await withFakeOnshape(() => new Response('{}', { status: 404 }), async () => {
    await assert.rejects(exportPartStudioStl(ref), /Part Studio/);
  });
});
