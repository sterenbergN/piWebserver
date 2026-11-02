// Finding words in text a machine read from handwriting, which gets some letters wrong
// ("brachial" as "branchial"). Typed text and PDFs are matched exactly; handwriting also counts
// a word that's within a letter or two of what you searched for.

function distance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

/** How many letters a word of this length may be off by and still count. Short words have to be exact. */
export const allowedSlips = (length: number) => (length >= 8 ? 2 : length >= 5 ? 1 : 0);

/**
 * Where a search is found in text, as [start, length], or null. `loose` lets each searched word
 * match a word that's nearly the same, for text read from handwriting. Every searched word has
 * to be there; the place given is the first one's.
 */
export function findInText(text: string, query: string, loose = false): [number, number] | null {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return [exact, needle.length];
  if (!loose) return null;
  const words = [...haystack.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ word: m[0], at: m.index ?? 0 }));
  let first: [number, number] | null = null;
  for (const term of needle.split(/\s+/)) {
    const slips = allowedSlips(term.length);
    const found = words.find(({ word }) => word.includes(term) || (slips > 0 && distance(word, term, slips) <= slips));
    if (!found) return null;
    first ??= [found.at, found.word.length];
  }
  return first;
}
