// The Amazon price service: Amazon blocks ordinary page reads, so Amazon prices
// come from a program the admin runs (the free amazon-scraper on the Pi, usually
// http://127.0.0.1:8000, or its RapidAPI copy with a key). Settings live in
// .data/wishlist-private/, which backups leave out because the key is in it. The
// key never reaches a browser: only its last four characters do.

import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { cleanPrice } from './model';

export const PRICE_SERVICE_FOLDER = '.data/wishlist-private/';
export const PRICE_SERVICE_FILE = '.data/wishlist-private/price-service.json';
export const priceServiceFile = () => path.join(process.cwd(), PRICE_SERVICE_FILE);

export type PriceServiceSettings = { baseUrl: string; apiKey: string };
export type PriceServicePublic = { baseUrl: string; hasKey: boolean; keyHint: string; configured: boolean };

export class PriceServiceError extends Error {}

const MAX_KEY = 200;
const KEY_CHARS = /^[\x21-\x7e]*$/;

/** A usable http(s) address with no trailing slash, or '' (throws for something typed that isn't one). */
export function cleanBaseUrl(raw: unknown, strict = false): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  try {
    const url = new URL(text);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) {
      return (url.origin + url.pathname).replace(/\/+$/, '').slice(0, 300);
    }
  } catch {
    // fall through
  }
  if (strict) throw new PriceServiceError('That address should look like http://127.0.0.1:8000');
  return '';
}

export function normalizePriceService(raw: unknown): PriceServiceSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const key = typeof r.apiKey === 'string' && KEY_CHARS.test(r.apiKey.trim()) ? r.apiKey.trim().slice(0, MAX_KEY) : '';
  return { baseUrl: cleanBaseUrl(r.baseUrl), apiKey: key };
}

export const toPublicPriceService = (s: PriceServiceSettings): PriceServicePublic => ({
  baseUrl: s.baseUrl,
  hasKey: !!s.apiKey,
  keyHint: s.apiKey ? s.apiKey.slice(-4) : '',
  configured: !!s.baseUrl,
});

export async function loadPriceService(): Promise<PriceServiceSettings> {
  return normalizePriceService(await readJson<unknown>(priceServiceFile(), null).catch(() => null));
}

/** A blank key keeps the saved one; `clearKey` removes it. */
export async function savePriceService(patch: { baseUrl?: unknown; apiKey?: unknown; clearKey?: unknown }): Promise<PriceServiceSettings> {
  return updateJson<Record<string, unknown>, PriceServiceSettings>(priceServiceFile(), {}, (stored) => {
    const next = normalizePriceService(stored);
    if (typeof patch.baseUrl === 'string') next.baseUrl = cleanBaseUrl(patch.baseUrl, true);
    if (patch.clearKey === true) next.apiKey = '';
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      const key = patch.apiKey.trim();
      if (!KEY_CHARS.test(key) || key.length > MAX_KEY) throw new PriceServiceError('That key has characters it can’t have.');
      next.apiKey = key;
    }
    stored.baseUrl = next.baseUrl;
    stored.apiKey = next.apiKey;
    return next;
  });
}

/** Amazon store → the service's country code. */
export function countryForHost(host: string): string {
  const h = host.toLowerCase();
  if (/\.co\.uk$/.test(h)) return 'UK';
  if (/\.ca$/.test(h)) return 'CA';
  if (/\.de$/.test(h)) return 'DE';
  return 'US';
}

/** "$499.99", "1,299.00" or 449.99 → a price, or null. */
function readAmount(value: unknown): number | null {
  const n = cleanPrice(value);
  return n !== null && n > 0 ? n : null;
}

/** Pull `{ amount, currency }` out of the service's answer (at the top or under `data`). */
export function readServicePrice(json: unknown): { price: number; currency: string } | null {
  const tryNode = (node: unknown) => {
    if (!node || typeof node !== 'object') return null;
    const p = (node as Record<string, unknown>).price;
    if (!p || typeof p !== 'object') return null;
    const amount = readAmount((p as Record<string, unknown>).amount);
    if (amount === null) return null;
    const cur = (p as Record<string, unknown>).currency;
    return { price: amount, currency: typeof cur === 'string' && /^[A-Za-z]{3}$/.test(cur.trim()) ? cur.trim().toUpperCase() : '' };
  };
  const top = tryNode(json);
  if (top) return top;
  return tryNode(json && typeof json === 'object' ? (json as Record<string, unknown>).data : null);
}

/** Ask the service for an ASIN's price. Throws PriceServiceError with a short reason. */
export async function fetchAmazonPrice(
  settings: PriceServiceSettings,
  asin: string,
  country: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ price: number; currency: string }> {
  if (!settings.baseUrl) throw new PriceServiceError('The Amazon price service isn’t set up.');
  const url = `${settings.baseUrl}/products/details?product=${encodeURIComponent(asin)}&country=${encodeURIComponent(country)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (settings.apiKey) {
    headers['x-rapidapi-key'] = settings.apiKey;
    headers['x-rapidapi-host'] = new URL(settings.baseUrl).host;
  }
  let json: unknown;
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!res.ok) throw new PriceServiceError(`The price service answered with an error (${res.status}).`);
    json = await res.json();
  } catch (error) {
    if (error instanceof PriceServiceError) throw error;
    throw new PriceServiceError('Amazon price service didn’t answer.');
  }
  const found = readServicePrice(json);
  if (!found) throw new PriceServiceError('The price service didn’t show a price for that product.');
  return { price: found.price, currency: found.currency || 'USD' };
}
