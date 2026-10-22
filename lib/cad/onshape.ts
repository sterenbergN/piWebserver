// Onshape links: which document, version and tab a CAD entry's link points at,
// so its Part Studio can be exported as the 3D model (see onshape-export.ts).

export type OnshapeRef = {
  host: string;
  did: string;
  /** w = a workspace (the latest design), v = a saved version, m = a microversion. */
  wvm: 'w' | 'v' | 'm';
  wvmid: string;
  eid: string;
};

/** Only Onshape's own hosts (cad.onshape.com, or a company's name.onshape.com) get the API keys. */
export const isOnshapeHost = (host: string) => host === 'onshape.com' || host.endsWith('.onshape.com');

const ID = '([0-9a-f]{24})';
const PATH = new RegExp(`^/documents/${ID}/([wvm])/${ID}/e/${ID}/?$`, 'i');

/** The parts of an Onshape tab link, e.g. https://cad.onshape.com/documents/<d>/w/<w>/e/<e>; null for anything else. */
export function parseOnshapeLink(link: string | undefined): OnshapeRef | null {
  let url: URL;
  try { url = new URL((link ?? '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || !isOnshapeHost(url.hostname.toLowerCase())) return null;
  const m = url.pathname.match(PATH);
  if (!m) return null;
  return { host: url.hostname.toLowerCase(), did: m[1].toLowerCase(), wvm: m[2].toLowerCase() as OnshapeRef['wvm'], wvmid: m[3].toLowerCase(), eid: m[4].toLowerCase() };
}
