import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnshapeLink } from './onshape';
import { assemblyExportResult, exportPartStudioStl, looksLikeGltf, looksLikeStl, OnshapeError, startAssemblyExport, tabKind } from './onshape-export';

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

test('looksLikeGltf takes binary and self-contained JSON glTF only', () => {
  assert.equal(looksLikeGltf(new TextEncoder().encode('glTF\u0002\u0000\u0000\u0000\u0000\u0000\u0000\u0000')), true);
  assert.equal(looksLikeGltf(new TextEncoder().encode('{"asset":{"version":"2.0"},"buffers":[{"uri":"data:application/octet-stream;base64,AAAA"}]}')), true);
  assert.equal(looksLikeGltf(new TextEncoder().encode('{"asset":{"version":"2.0"},"buffers":[{"uri":"model.bin"}]}')), false);
  assert.equal(looksLikeGltf(new TextEncoder().encode('{"message":"nope"}')), false);
});

test('tabKind tells Part Studios from assemblies', async () => {
  for (const [type, kind] of [['PARTSTUDIO', 'partstudio'], ['ASSEMBLY', 'assembly']] as const) {
    await withFakeOnshape(() => Response.json([{ id: E, elementType: type }]), async (calls) => {
      assert.equal(await tabKind(ref), kind);
      assert.match(calls[0].url, new RegExp(`/documents/d/${D}/w/${W}/elements[?]elementId=${E}`));
    });
  }
  await withFakeOnshape(() => Response.json([{ id: E, elementType: 'BILLOFMATERIALS' }]), async () => {
    await assert.rejects(tabKind(ref), /Part Studio or an assembly/);
  });
});

test('assembly export: start, wait while active, then download the glTF', async () => {
  const T = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const glb = new TextEncoder().encode('glTF\u0002\u0000\u0000\u0000\u0000\u0000\u0000\u0000');
  let state = 'ACTIVE';
  await withFakeOnshape((url) => {
    if (url.endsWith('/export/gltf')) return Response.json({ id: T });
    if (url.includes(`/translations/${T}`)) return Response.json({ requestState: state, documentId: D, resultExternalDataIds: ['file1'] });
    if (url.endsWith(`/documents/d/${D}/externaldata/file1`)) return new Response(null, { status: 307, headers: { location: 'https://cad.onshape.com/blob/file1' } });
    if (url === 'https://cad.onshape.com/blob/file1') return new Response(glb);
    return new Response(null, { status: 500 });
  }, async (calls) => {
    assert.equal(await startAssemblyExport(ref), T);
    assert.match(calls[0].url, new RegExp(`/assemblies/d/${D}/w/${W}/e/${E}/export/gltf$`));
    assert.equal(await assemblyExportResult(ref, T), null);
    state = 'DONE';
    assert.equal((await assemblyExportResult(ref, T))?.byteLength, glb.byteLength);
  });
});

test('assembly export reports failures and refuses odd ids', async () => {
  await withFakeOnshape(() => Response.json({ requestState: 'FAILED', failureReason: 'Too big', documentId: D }), async () => {
    await assert.rejects(assemblyExportResult(ref, 'aaaaaaaaaaaaaaaaaaaaaaaa'), /Too big/);
  });
  await withFakeOnshape(() => Response.json({ requestState: 'DONE', documentId: 'b'.repeat(24), resultExternalDataIds: ['f'] }), async () => {
    await assert.rejects(assemblyExportResult(ref, 'aaaaaaaaaaaaaaaaaaaaaaaa'), /another document/);
  });
  await withFakeOnshape(() => Response.json({}), async (calls) => {
    await assert.rejects(assemblyExportResult(ref, '../../etc'), OnshapeError);
    assert.equal(calls.length, 0);
  });
});

test('exportPartStudioStl explains refused keys and non-Part-Studio tabs', async () => {
  await withFakeOnshape(() => new Response('{}', { status: 401 }), async () => {
    await assert.rejects(exportPartStudioStl(ref), /API keys/);
  });
  await withFakeOnshape(() => new Response('{}', { status: 404 }), async () => {
    await assert.rejects(exportPartStudioStl(ref), /Part Studio/);
  });
});
