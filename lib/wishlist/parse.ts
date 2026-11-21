// Reading a product page: OpenGraph / Twitter cards, JSON-LD Product, then <title>.
// Pure (HTML in, fields out) so it's testable; the fetching is in fetch-product.ts.

import { cleanPrice, cleanText, cleanUrl, storeFromUrl } from './model';

export type ProductInfo = {
  title: string;
  description: string;
  /** An absolute image link on the product's own site (to be downloaded once). */
  imageUrl: string;
  price: number | null;
  currency: string;
  store: string;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', trade: '™', reg: '®', copy: '©' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** <meta property|name|itemprop="key" content="…"> in either attribute order. */
export function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = /\b(?:property|name|itemprop)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!key || !content) continue;
    const name = (key[1] ?? key[2]).toLowerCase();
    const value = decodeEntities(content[1] ?? content[2]).trim();
    if (value && !tags.has(name)) tags.set(name, value);
  }
  return tags;
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    if (Array.isArray(value)) { value.forEach((v) => visit(v, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    nodes.push(node);
    if (node['@graph']) visit(node['@graph'], depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(decodeEntities(match[1]).trim()), 0);
    } catch {
      // Sites sometimes ship broken JSON-LD; the other sources still work.
    }
  }
  return nodes;
}

const isType = (node: Record<string, unknown>, type: string) => {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
};
const asText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function firstImage(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(firstImage).find(Boolean) ?? '';
  if (v && typeof v === 'object') return asText((v as Record<string, unknown>).url) || asText((v as Record<string, unknown>).contentUrl);
  return '';
}

function offerOf(offers: unknown): { price: unknown; currency: string } | null {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const offer = o as Record<string, unknown>;
    const spec = Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification;
    const price = offer.price ?? offer.lowPrice ?? (spec as Record<string, unknown> | undefined)?.price;
    const currency = asText(offer.priceCurrency) || asText((spec as Record<string, unknown> | undefined)?.priceCurrency);
    if (price !== undefined && price !== '') return { price, currency };
    const nested = offerOf(offer.offers);
    if (nested) return nested;
  }
  return null;
}

function pageTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

/** A readable name from a link's path, for shops that won't let us read the page. */
export function titleFromUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return ''; }
  const skip = /^(dp|gp|product|products|p|ip|item|itm|dp|b|c|collections|catalog|shop|buy|pd|en|us|ref)$/i;
  const segments = url.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const words = (s: string) => s.replace(/\.(html?|php|aspx?)$/i, '').split(/[-_+\s]+/).filter((w) => /[a-z]/i.test(w) && !/^\d+$/.test(w));
  let best = '';
  let bestWords = 0;
  for (const segment of segments) {
    if (skip.test(segment) || /^[A-Z0-9]{8,}$/.test(segment)) continue; // product codes like B0C1234XYZ
    const w = words(segment);
    if (w.length > bestWords || (w.length === bestWords && segment.length > best.length)) { best = segment; bestWords = w.length; }
  }
  if (!bestWords) return '';
  const text = words(best).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Everything useful the page says about the product. Fields it couldn't find come back empty. */
export function parseProductHtml(html: string, pageUrl: string): ProductInfo {
  const meta = metaTags(html);
  const product = jsonLdNodes(html).find((n) => isType(n, 'Product'));
  const offer = product ? offerOf(product.offers) : null;

  const title = cleanText(
    asText(product?.name) || meta.get('og:title') || meta.get('twitter:title') || pageTitle(html),
    200,
  );
  const description = cleanText(
    asText(product?.description) || meta.get('og:description') || meta.get('twitter:description') || meta.get('description') || '',
    600,
    true,
  );
  const rawImage = firstImage(product?.image) || meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image') || meta.get('twitter:image:src') || '';
  let imageUrl = '';
  if (rawImage) {
    try { imageUrl = cleanUrl(new URL(decodeEntities(rawImage), pageUrl).toString()); } catch { imageUrl = ''; }
  }

  const price = cleanPrice(offer?.price ?? meta.get('product:price:amount') ?? meta.get('og:price:amount') ?? meta.get('twitter:data1')?.match(/[\d.,]+/)?.[0]);
  const currencyRaw = offer?.currency || meta.get('product:price:currency') || meta.get('og:price:currency') || '';
  const currency = /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : 'USD';

  return { title, description, imageUrl, price, currency, store: storeFromUrl(pageUrl) };
}
