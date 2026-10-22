import { MAX_MODEL_BYTES } from './models';
import { isOnshapeHost, type OnshapeRef } from './onshape';

// Exports a Part Studio from Onshape as a binary STL, with the API keys in
// ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY (from the Onshape developer portal).
// Onshape answers with a redirect to the file, which needs the keys again.

export class OnshapeError extends Error {}

export const onshapeConfigured = () => !!(process.env.ONSHAPE_ACCESS_KEY?.trim() && process.env.ONSHAPE_SECRET_KEY?.trim());

/** Whether bytes look like an STL: binary (an 84-byte header plus 50 bytes a triangle) or text. */
export function looksLikeStl(data: Uint8Array) {
  if (data.byteLength >= 84) {
    const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
    if (count > 0 && 84 + count * 50 === data.byteLength) return true;
  }
  return new TextDecoder().decode(data.subarray(0, 5)).toLowerCase() === 'solid';
}

export async function exportPartStudioStl(ref: OnshapeRef): Promise<Uint8Array> {
  if (!onshapeConfigured()) throw new OnshapeError('Onshape API keys aren’t set on the server (ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY).');
  const headers = {
    Authorization: `Basic ${Buffer.from(`${process.env.ONSHAPE_ACCESS_KEY!.trim()}:${process.env.ONSHAPE_SECRET_KEY!.trim()}`).toString('base64')}`,
    Accept: '*/*',
  };
  const signal = AbortSignal.timeout(120_000);
  const url = `https://${ref.host}/api/v6/partstudios/d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ref.eid}/stl?mode=binary&grouping=true&scale=1&units=millimeter`;

  let res: Response;
  try {
    res = await fetch(url, { headers, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') || '', url);
      if (next.protocol !== 'https:' || !isOnshapeHost(next.hostname)) throw new OnshapeError('Onshape sent the download somewhere unexpected.');
      res = await fetch(next, { headers, redirect: 'manual', signal });
    }
  } catch (error) {
    if (error instanceof OnshapeError) throw error;
    throw new OnshapeError('Couldn’t reach Onshape. Try again in a minute.');
  }

  if (res.status === 401 || res.status === 403) throw new OnshapeError('Onshape turned down the API keys. Check they’re right and that the account can see this document.');
  if (res.status === 404 || res.status === 400) throw new OnshapeError('Onshape couldn’t export that tab. The link needs to point at a Part Studio (assemblies aren’t supported yet).');
  if (res.status === 429) throw new OnshapeError('Onshape says too many requests. Try again later.');
  if (!res.ok) throw new OnshapeError(`Onshape didn’t send the model (status ${res.status}).`);
  if (Number(res.headers.get('content-length') || 0) > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_MODEL_BYTES) throw new OnshapeError('The exported model is over 50 MB.');
  if (!looksLikeStl(data)) throw new OnshapeError('Onshape sent something that isn’t a 3D model. Is the Part Studio empty?');
  return data;
}
