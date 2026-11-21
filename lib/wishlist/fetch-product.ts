// Add by link: fetch the page with the site's safe fetcher, read what it says
// about the product, keep its picture. When a shop won't talk to us (Amazon
// often doesn't) the name is worked out from the link and the rest is left for
// the person to fill in, with a list of what we couldn't get.

import { checkUrl, fetchPublic, ImportFetchError } from '@/lib/recipes/import-fetch';
import { cleanUrl, storeFromUrl } from './model';
import { parseProductHtml, titleFromUrl } from './parse';
import { saveImageFromUrl } from './store';

export type ImportResult = {
  url: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  store: string;
  /** Id of the kept picture, or '' */
  image: string;
  /** Plain-English list of what couldn't be filled in. */
  missing: string[];
  /** Why the page couldn't be read, if it couldn't. */
  warning: string;
};

/**
 * Did the shop send us somewhere other than the product? Some (IKEA, for one) answer
 * a server with a redirect to a general page, whose title ("Products") would be wrong.
 * A short link to another site (amzn.to → amazon.com) is fine: that's where it leads.
 */
export function landedElsewhere(requested: string, finalUrl: string): boolean {
  try {
    const a = new URL(requested);
    const b = new URL(finalUrl);
    const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
    if (host(a) !== host(b)) return false;
    const segments = (u: URL) => u.pathname.toLowerCase().split('/').filter(Boolean);
    const [from, to] = [segments(a), segments(b)];
    if (from.join('/') === to.join('/')) return false;
    // The product's own part of the address is gone: a general page, not this product.
    const last = from[from.length - 1] ?? '';
    return !!last && !to.includes(last);
  } catch {
    return false;
  }
}

export async function importFromLink(ownerId: string, rawUrl: string): Promise<ImportResult> {
  const url = cleanUrl(rawUrl);
  if (!url) throw new ImportFetchError('That doesn’t look like a web address.');
  checkUrl(url); // refuses private addresses before anything is fetched

  const result: ImportResult = { url, title: '', description: '', price: null, currency: 'USD', store: storeFromUrl(url), image: '', missing: [], warning: '' };
  let imageUrl = '';
  try {
    const page = await fetchPublic(url, { maxBytes: 3 * 1024 * 1024 });
    // Redirects (short links) can land on the real shop page; keep the address typed in.
    if (landedElsewhere(url, page.finalUrl)) throw new ImportFetchError('The shop sent us to a different page, so the details couldn’t be read. Add them by hand.');
    const info = parseProductHtml(page.body.toString('utf8'), page.finalUrl);
    result.title = info.title;
    result.description = info.description;
    result.price = info.price;
    result.currency = info.currency;
    imageUrl = info.imageUrl;
  } catch (error) {
    result.warning = error instanceof ImportFetchError ? error.message.replace(/Copy the recipe text and paste it instead./, 'Add the details by hand.') : 'Couldn’t read that page.';
  }

  if (!result.title) result.title = titleFromUrl(url);
  if (imageUrl) {
    result.image = (await saveImageFromUrl(ownerId, imageUrl)) ?? '';
  }

  if (!result.title) result.missing.push('name');
  if (!result.image) result.missing.push('picture');
  if (!result.description) result.missing.push('description');
  if (result.price === null) result.missing.push('price');
  return result;
}
