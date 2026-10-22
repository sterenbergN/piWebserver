import { MAX_MODEL_BYTES } from './models';
import { isOnshapeHost, type OnshapeRef } from './onshape';

// Exports a model from Onshape with the API keys in ONSHAPE_ACCESS_KEY /
// ONSHAPE_SECRET_KEY (from the Onshape developer portal).
//   - Part Studios: one request for a binary STL.
//   - Assemblies: Onshape only exports these as a background job, so a glTF
//     export is started, its status checked until it's done, then downloaded.
// Downloads come as a redirect to the file, which needs the keys again.

export class OnshapeError extends Error {}

export const onshapeConfigured = () => !!(process.env.ONSHAPE_ACCESS_KEY?.trim() && process.env.ONSHAPE_SECRET_KEY?.trim());

export type TabKind = 'partstudio' | 'assembly';

/** Whether bytes look like an STL: binary (an 84-byte header plus 50 bytes a triangle) or text. */
export function looksLikeStl(data: Uint8Array) {
  if (data.byteLength >= 84) {
    const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
    if (count > 0 && 84 + count * 50 === data.byteLength) return true;
  }
  return new TextDecoder().decode(data.subarray(0, 5)).toLowerCase() === 'solid';
}

/** Whether bytes are a self-contained glTF: binary (.glb), or JSON with every buffer embedded. */
export function looksLikeGltf(data: Uint8Array) {
  if (data.byteLength >= 12 && new TextDecoder().decode(data.subarray(0, 4)) === 'glTF') return true;
  try {
    const json = JSON.parse(new TextDecoder().decode(data));
    return !!json?.asset && (json.buffers ?? []).every((b: { uri?: string }) => !b.uri || b.uri.startsWith('data:'));
  } catch {
    return false;
  }
}

function headers(extra?: Record<string, string>) {
  return {
    Authorization: `Basic ${Buffer.from(`${process.env.ONSHAPE_ACCESS_KEY!.trim()}:${process.env.ONSHAPE_SECRET_KEY!.trim()}`).toString('base64')}`,
    Accept: '*/*',
    ...extra,
  };
}

/** A request to Onshape with the keys, following one redirect (only to Onshape) with them too. */
async function onshape(ref: OnshapeRef, path: string, init: { method?: string; body?: unknown } = {}) {
  if (!onshapeConfigured()) throw new OnshapeError('Onshape API keys aren’t set on the server (ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY).');
  const url = `https://${ref.host}/api/${path}`;
  const signal = AbortSignal.timeout(60_000);
  try {
    let res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: headers(init.body === undefined ? undefined : { 'Content-Type': 'application/json' }),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') || '', url);
      if (next.protocol !== 'https:' || !isOnshapeHost(next.hostname)) throw new OnshapeError('Onshape sent the download somewhere unexpected.');
      res = await fetch(next, { headers: headers(), redirect: 'manual', signal });
    }
    return res;
  } catch (error) {
    if (error instanceof OnshapeError) throw error;
    throw new OnshapeError('Couldn’t reach Onshape. Try again in a minute.');
  }
}

/** Turn Onshape's usual refusals into something to act on. */
function check(res: Response, what: string) {
  if (res.status === 401 || res.status === 403) throw new OnshapeError('Onshape turned down the API keys. Check they’re right and that the account can see this document.');
  if (res.status === 404) throw new OnshapeError(`Onshape couldn’t find ${what}. Check the link still works.`);
  if (res.status === 429) throw new OnshapeError('Onshape says too many requests. Try again later.');
  if (!res.ok) throw new OnshapeError(`Onshape couldn’t export ${what} (status ${res.status}).`);
}

async function download(res: Response, what: string) {
  check(res, what);
  if (Number(res.headers.get('content-length') || 0) > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  return data;
}

const where = (ref: OnshapeRef) => `d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ref.eid}`;

/** Whether the linked tab is a Part Studio or an assembly. */
export async function tabKind(ref: OnshapeRef): Promise<TabKind> {
  const res = await onshape(ref, `v6/documents/d/${ref.did}/${ref.wvm}/${ref.wvmid}/elements?elementId=${ref.eid}&withThumbnails=false`);
  check(res, 'that document');
  const elements: { id?: string; elementType?: string }[] = await res.json().catch(() => []);
  const type = (Array.isArray(elements) ? elements.find((e) => e.id === ref.eid) ?? elements[0] : null)?.elementType;
  if (type === 'PARTSTUDIO') return 'partstudio';
  if (type === 'ASSEMBLY') return 'assembly';
  throw new OnshapeError(type ? `That tab is a ${type.toLowerCase().replace(/_/g, ' ')}. Link a Part Studio or an assembly.` : 'Onshape couldn’t find that tab. Check the link still works.');
}

export async function exportPartStudioStl(ref: OnshapeRef): Promise<Uint8Array> {
  const data = await download(await onshape(ref, `v6/partstudios/${where(ref)}/stl?mode=binary&grouping=true&scale=1&units=millimeter`), 'that Part Studio');
  if (!looksLikeStl(data)) throw new OnshapeError('Onshape sent something that isn’t a 3D model. Is the Part Studio empty?');
  return data;
}

/** Start exporting an assembly as glTF; the id to check on with `assemblyExportResult`. */
export async function startAssemblyExport(ref: OnshapeRef): Promise<string> {
  const res = await onshape(ref, `v11/assemblies/${where(ref)}/export/gltf`, { method: 'POST', body: { storeInDocument: false } });
  check(res, 'that assembly');
  const id = (await res.json().catch(() => null))?.id;
  if (!isTranslationId(id)) throw new OnshapeError('Onshape didn’t start the assembly export.');
  return id;
}

export const isTranslationId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);

/** The finished export, or null while Onshape is still working on it. */
export async function assemblyExportResult(ref: OnshapeRef, translationId: string): Promise<Uint8Array | null> {
  if (!isTranslationId(translationId)) throw new OnshapeError('That isn’t an Onshape export.');
  const res = await onshape(ref, `v11/translations/${translationId}`);
  check(res, 'that assembly export');
  const job: { requestState?: string; failureReason?: string; resultExternalDataIds?: string[]; documentId?: string } = await res.json().catch(() => ({}));
  if (job.documentId && job.documentId !== ref.did) throw new OnshapeError('That export belongs to another document.');
  if (job.requestState === 'ACTIVE') return null;
  if (job.requestState === 'FAILED') throw new OnshapeError(`Onshape couldn’t export the assembly${job.failureReason ? `: ${job.failureReason}` : '.'}`);
  const file = job.resultExternalDataIds?.[0];
  if (job.requestState !== 'DONE' || !file || !/^[\w-]{1,64}$/.test(file)) throw new OnshapeError('Onshape’s assembly export didn’t produce a file.');
  const data = await download(await onshape(ref, `v6/documents/d/${ref.did}/externaldata/${file}`), 'the exported assembly');
  if (!looksLikeGltf(data)) throw new OnshapeError('Onshape sent something that isn’t a 3D model. Is the assembly empty?');
  return data;
}
