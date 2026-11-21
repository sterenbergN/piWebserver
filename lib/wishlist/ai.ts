// Gift ideas from an AI: a prompt to copy out, and the reply read back in. Like
// the recipe and study helpers, it works with whichever AI you already use.

import { cleanText, cleanUrl, formatPrice, type WishItem } from './model';

export type IdeaHints = {
  /** Who the ideas are for ("me", "my wife"…). */
  forWho: string;
  occasion: string;
  budget: string;
  interests: string;
};

export type Suggestion = { title: string; why: string; priceRange: string; searchQuery: string; url: string };

export function buildIdeasPrompt(listName: string, items: Pick<WishItem, 'title' | 'price' | 'currency' | 'priority'>[], hints: IdeaHints, count = 8): string {
  const lines: string[] = [];
  lines.push(`I keep a wishlist called "${listName}" and I'd like ${count} new gift ideas I haven't thought of.`);
  const who = cleanText(hints.forWho, 80);
  if (who) lines.push(`The ideas are for: ${who}.`);
  if (cleanText(hints.occasion, 80)) lines.push(`Occasion: ${cleanText(hints.occasion, 80)}.`);
  if (cleanText(hints.budget, 80)) lines.push(`Budget: ${cleanText(hints.budget, 80)}.`);
  if (cleanText(hints.interests, 400)) lines.push(`Interests and things to keep in mind: ${cleanText(hints.interests, 400)}.`);
  const have = items.slice(0, 60).map((i) => `${i.title}${i.price !== null ? ` (${formatPrice(i.price, i.currency)})` : ''}`);
  if (have.length) lines.push(`What's already on the list (don't suggest these or near-duplicates, but use them to judge my taste): ${have.join('; ')}.`);
  lines.push(
    '',
    'Reply with ONLY a JSON array, with no other text, in this shape:',
    '[',
    '  { "title": "Specific product or thing", "why": "One sentence on why it fits", "priceRange": "$30-50", "searchQuery": "words to find it in a shop", "url": "optional direct link if you are sure of it" }',
    ']',
    'Rules: real, specific things people can buy (a model or type, not "a nice jacket"); a mix of price points; leave "url" out unless you are certain it is a real, working link, because "searchQuery" is what I will use to find it.',
  );
  return lines.join('\n');
}

export class IdeasReplyError extends Error {}

/** Cut the JSON out of a reply: code fences, an intro sentence or trailing chatter are all fine. */
function jsonFrom(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text.trim(), fenced?.[1]?.trim() ?? ''];
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next way of cutting it out.
    }
  }
  return undefined;
}

/** Read suggestions from a reply; throws an IdeasReplyError the page can show when none can be found. */
export function parseSuggestions(text: string): Suggestion[] {
  const data = jsonFrom(typeof text === 'string' ? text : '');
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    const found = Object.values(data as Record<string, unknown>).find(Array.isArray);
    if (found) list = found as unknown[];
  }
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const entry of list.slice(0, 30)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = cleanText(e.title ?? e.name, 160);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({
      title,
      why: cleanText(e.why ?? e.reason, 300),
      priceRange: cleanText(e.priceRange ?? e.price, 40),
      searchQuery: cleanText(e.searchQuery ?? e.search, 120) || title,
      url: cleanUrl(e.url),
    });
  }
  if (!out.length) throw new IdeasReplyError('I couldn’t find any ideas in that. Paste the whole reply: it should be a JSON list.');
  return out;
}

/** Where to look for a suggestion that came without a link. */
export const shoppingSearchUrl = (query: string) => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
