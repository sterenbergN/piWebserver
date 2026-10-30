import { promises as dns } from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { Readable } from 'stream';
import zlib from 'zlib';

// Fetching a page at a URL someone typed in. The server sits on a home network,
// so a link must never reach anything but the public internet: only http(s) on
// the usual ports, and every hostname is checked as the connection is made (so
// a redirect, or DNS changing its answer, can't get around it).

export class ImportFetchError extends Error {}

const MAX_REDIRECTS = 5;

function isPublicV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast/reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind !== 6) return false;
  const lower = ip.toLowerCase().split('%')[0];
  // IPv4 inside IPv6 (::ffff:10.0.0.1, or the same in hex) is judged as the IPv4 it is.
  const mapped = lower.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    if (mapped[1]) return isPublicV4(mapped[1]);
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return isPublicV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower === '::' || lower === '::1') return false;
  // Only global unicast (2000::/3) is public; that rules out fc00::/7, fe80::/10,
  // ff00::/8 and the NAT64/compat ranges that can hide an IPv4 address.
  return /^[23]/.test(lower) && !lower.startsWith('2001:db8');
}

/** The URL if it's one we'd try at all; throws an ImportFetchError if not. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportFetchError('That doesn’t look like a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ImportFetchError('Only http and https links can be imported.');
  if (url.username || url.password) throw new ImportFetchError('Links with a username or password can’t be imported.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new ImportFetchError('That link uses an unusual port.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) ? !isPublicAddress(host) : /^localhost$|\.(local|localhost|internal|lan|home)$/i.test(host) || !host.includes('.')) {
    throw new ImportFetchError('Only public websites can be imported.');
  }
  return url;
}

// Connect only to public addresses; a hostname with any private answer is refused.
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns
    .lookup(hostname, { all: true })
    .then((addresses) => {
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
        const error = new ImportFetchError('Only public websites can be imported.') as NodeJS.ErrnoException;
        callback(error, '', 0);
        return;
      }
      if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    })
    .catch((error) => callback(error, '', 0));
};

type Fetched = { body: Buffer; contentType: string; finalUrl: string };

function requestOnce(url: URL, accept: string, maxBytes: number, timeoutMs: number): Promise<Fetched & { redirect?: string; status: number }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup: publicLookup,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          Accept: accept,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, redirect: res.headers.location, body: Buffer.alloc(0), contentType: '', finalUrl: url.toString() });
          return;
        }
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        const stream: Readable =
          encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : encoding === 'deflate' ? res.pipe(zlib.createInflate()) : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new ImportFetchError('That page is too large to import.'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, body: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || ''), finalUrl: url.toString() }));
        stream.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new ImportFetchError('That site took too long to answer.')));
    req.on('error', reject);
    req.end();
  });
}

/** GET a public URL, following redirects, with every hop checked. */
export async function fetchPublic(
  rawUrl: string,
  { accept = 'text/html,application/xhtml+xml,*/*;q=0.8', maxBytes = 5 * 1024 * 1024, timeoutMs = 12_000 } = {},
): Promise<Fetched> {
  let url = checkUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let result;
    try {
      result = await requestOnce(url, accept, maxBytes, timeoutMs);
    } catch (error) {
      if (error instanceof ImportFetchError) throw error;
      throw new ImportFetchError('Couldn’t reach that site.');
    }
    if (result.redirect) {
      url = checkUrl(new URL(result.redirect, url).toString());
      continue;
    }
    if (result.status === 401 || result.status === 403 || result.status === 429 || result.status === 503) {
      throw new ImportFetchError('That site doesn’t allow its pages to be read automatically. Copy the recipe text and paste it instead.');
    }
    if (result.status < 200 || result.status >= 300) throw new ImportFetchError(`That page answered with an error (${result.status}).`);
    return result;
  }
  throw new ImportFetchError('That link redirects too many times.');
}
