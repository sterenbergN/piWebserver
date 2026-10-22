import AdmZip from 'adm-zip';
import { MAX_MODEL_BYTES } from './models';
import { isOnshapeHost, type OnshapeRef } from './onshape';

// Exports a model from Onshape with the API keys in ONSHAPE_ACCESS_KEY /
// ONSHAPE_SECRET_KEY (from the Onshape developer portal).
//   - Part Studios: one request for a binary STL.
//   - Assemblies: Onshape only exports these as a background job, so a glTF
//     export is started, its status checked until it's done, then downloaded.
//     It's asked for as one file, Y-up (as glTF expects); if it still comes
//     zipped, the model is taken out of the zip.
// Downloads come as a redirect to the file, which needs the keys again.
// The request shapes follow Onshape's OpenAPI spec (cad.onshape.com/api/openapi).

export class OnshapeError extends Error {}

export const onshapeConfigured = () => !!(process.env.ONSHAPE_ACCESS_KEY?.trim() && process.env.ONSHAPE_SECRET_KEY?.trim());

export type TabKind = 'partstudio' | 'assembly';

/** The JSON type Onshape's API spec gives for its request and response bodies. */
const JSON_TYPE = 'application/json;charset=UTF-8; qs=0.09';

/** Whether bytes look like an STL: binary (an 84-byte header plus 50 bytes a triangle) or text. */
export function looksLikeStl(data: Uint8Array) {
  if (data.byteLength >= 84) {
    const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
    if (count > 0 && 84 + count * 50 === data.byteLength) return true;
  }
  return new TextDecoder().decode(data.subarray(0, 5)).toLowerCase() === 'solid';
}

const isZip = (data: Uint8Array) => data.byteLength > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;

/**
 * The glTF model inside a zip from Onshape: a .glb as it is, or a .gltf with
 * its .bin and image files embedded so it's one self-contained file.
 */
export function gltfFromZip(data: Uint8Array): Uint8Array {
  let zip: AdmZip;
  try { zip = new AdmZip(Buffer.from(data)); } catch { throw new OnshapeError('Onshape sent a zip that couldn’t be opened.'); }
  const files = zip.getEntries().filter((e) => !e.isDirectory);
  if (files.reduce((n, e) => n + e.header.size, 0) > MAX_MODEL_BYTES * 2) throw new OnshapeError('The exported model is over 50 MB.');
  const models = files.filter((e) => /\.(glb|gltf)$/i.test(e.entryName));
  if (models.length !== 1) {
    throw new OnshapeError(models.length ? `Onshape exported the parts as ${models.length} separate files instead of one model.` : 'Onshape’s export didn’t have a 3D model in it.');
  }
  const main = models[0];
  if (/\.glb$/i.test(main.entryName)) return new Uint8Array(main.getData());
  const json = JSON.parse(main.getData().toString('utf8'));
  const dir = main.entryName.includes('/') ? main.entryName.slice(0, main.entryName.lastIndexOf('/') + 1) : '';
  const embed = (uri: string, type: string) => {
    if (uri.startsWith('data:')) return uri;
    const entry = zip.getEntry(dir + decodeURIComponent(uri));
    if (!entry) throw new OnshapeError('Onshape’s export was missing part of the model.');
    return `data:${type};base64,${entry.getData().toString('base64')}`;
  };
  for (const buffer of json.buffers ?? []) if (buffer.uri) buffer.uri = embed(buffer.uri, 'application/octet-stream');
  for (const image of json.images ?? []) if (image.uri) image.uri = embed(image.uri, image.mimeType || (/\.png$/i.test(image.uri) ? 'image/png' : 'image/jpeg'));
  return new TextEncoder().encode(JSON.stringify(json));
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

function headers(accept: string, extra?: Record<string, string>) {
  return {
    Authorization: `Basic ${Buffer.from(`${process.env.ONSHAPE_ACCESS_KEY!.trim()}:${process.env.ONSHAPE_SECRET_KEY!.trim()}`).toString('base64')}`,
    Accept: accept,
    ...extra,
  };
}

/** A request to Onshape with the keys, following one redirect (only to Onshape) with them too. */
async function onshape(ref: OnshapeRef, path: string, init: { method?: string; body?: unknown; accept?: string } = {}) {
  if (!onshapeConfigured()) throw new OnshapeError('Onshape API keys aren’t set on the server (ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY).');
  const url = `https://${ref.host}/api/${path}`;
  const signal = AbortSignal.timeout(60_000);
  try {
    let res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: headers(init.accept ?? '*/*', init.body === undefined ? undefined : { 'Content-Type': JSON_TYPE }),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') || '', url);
      if (next.protocol !== 'https:' || !isOnshapeHost(next.hostname)) throw new OnshapeError('Onshape sent the download somewhere unexpected.');
      res = await fetch(next, { headers: headers(init.accept ?? '*/*'), redirect: 'manual', signal });
    }
    return res;
  } catch (error) {
    if (error instanceof OnshapeError) throw error;
    throw new OnshapeError('Couldn’t reach Onshape. Try again in a minute.');
  }
}

/** Onshape's own explanation from an error response, if it gave one. */
async function onshapeSays(res: Response) {
  const text = await res.text().catch(() => '');
  let message = text;
  try { message = JSON.parse(text)?.message ?? text; } catch { /* plain text */ }
  message = String(message).replace(/\s+/g, ' ').trim().slice(0, 200);
  return message && !message.startsWith('<') ? ` Onshape said: “${message}”` : '';
}

/** Turn Onshape's refusals into something to act on, with what Onshape said. */
async function check(res: Response, what: string) {
  if (res.ok) return;
  const says = await onshapeSays(res);
  if (res.status === 401 || res.status === 403) throw new OnshapeError(`Onshape turned down the API keys for ${what}. Check they’re right and that the account can see this document.${says}`);
  if (res.status === 404) throw new OnshapeError(`Onshape couldn’t find ${what}. Check the link still works.${says}`);
  if (res.status === 429) throw new OnshapeError(`Onshape says too many requests. Try again later.${says}`);
  throw new OnshapeError(`Onshape couldn’t export ${what} (status ${res.status}).${says}`);
}

async function download(res: Response, what: string) {
  await check(res, what);
  if (Number(res.headers.get('content-length') || 0) > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  return data;
}

const where = (ref: OnshapeRef) => `d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ref.eid}`;

/** Whether the linked tab is a Part Studio or an assembly. */
export async function tabKind(ref: OnshapeRef): Promise<TabKind> {
  const res = await onshape(ref, `v6/documents/d/${ref.did}/${ref.wvm}/${ref.wvmid}/elements?elementId=${ref.eid}&withThumbnails=false`, { accept: JSON_TYPE });
  await check(res, 'that document');
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
  // One grouped file (not a zip of parts), Y-up as glTF expects, without hidden parts.
  const body = { storeInDocument: false, grouping: true, isYAxisUp: true, excludeHiddenEntities: true, notifyUser: false, triggerAutoDownload: false };
  const res = await onshape(ref, `v11/assemblies/${where(ref)}/export/gltf`, { method: 'POST', body, accept: JSON_TYPE });
  await check(res, 'that assembly');
  const id = (await res.json().catch(() => null))?.id;
  if (!isTranslationId(id)) throw new OnshapeError('Onshape didn’t start the assembly export.');
  return id;
}

export const isTranslationId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);

/** The finished export, or null while Onshape is still working on it. */
export async function assemblyExportResult(ref: OnshapeRef, translationId: string): Promise<Uint8Array | null> {
  if (!isTranslationId(translationId)) throw new OnshapeError('That isn’t an Onshape export.');
  const res = await onshape(ref, `v11/translations/${translationId}`, { accept: JSON_TYPE });
  await check(res, 'that assembly export');
  const job: { requestState?: string; failureReason?: string; resultExternalDataIds?: string[]; documentId?: string } = await res.json().catch(() => ({}));
  if (job.documentId && job.documentId !== ref.did) throw new OnshapeError('That export belongs to another document.');
  if (job.requestState === 'ACTIVE') return null;
  if (job.requestState === 'FAILED') throw new OnshapeError(`Onshape couldn’t export the assembly${job.failureReason ? `: ${job.failureReason}` : '.'}`);
  const file = job.resultExternalDataIds?.[0];
  if (job.requestState !== 'DONE' || !file || !/^[\w-]{1,64}$/.test(file)) throw new OnshapeError('Onshape’s assembly export didn’t produce a file.');
  const raw = await download(await onshape(ref, `v6/documents/d/${ref.did}/externaldata/${file}`, { accept: 'application/octet-stream' }), 'the exported assembly');
  const data = isZip(raw) ? gltfFromZip(raw) : raw;
  if (data.byteLength > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  if (!looksLikeGltf(data)) throw new OnshapeError('Onshape sent something that isn’t a glTF model. Is the assembly empty?');
  return data;
}
