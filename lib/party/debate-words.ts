// Debate Duel's word switching, shared by the game (server) and the phones that
// pick a word to switch, so both agree on which words can be switched.

export const MAX_SWITCH_WORD = 24;

/**
 * Filler words not worth switching. Words that change the meaning stay
 * switchable ("We need more spiders" → "We need hotter spiders").
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'its', 'our', 'your', 'their', 'than', 'then', 'that', 'this', 'these', 'those',
  'with', 'from', 'into', 'onto', 'have', 'has', 'had', 'been', 'being', 'but', 'who', 'what', 'which', 'does', 'did',
]);

/** Split a proposition into words, keeping punctuation attached so it reads back the same. */
export const toWords = (text: string) => text.split(' ').filter(Boolean);

/** A word without the punctuation around it. */
export const wordCore = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Whether a word of the proposition can be switched. */
export function isSwitchable(word: string): boolean {
  const c = wordCore(word);
  return c.length >= 3 && !STOP_WORDS.has(c.toLowerCase());
}

/** Swap one word, keeping the punctuation around it ("pizza?" -> "toasters?"). */
export function switchWord(words: string[], index: number, replacement: string): string[] {
  const word = words[index];
  const c = wordCore(word);
  const start = word.indexOf(c);
  const next = [...words];
  next[index] = word.slice(0, start) + replacement + word.slice(start + c.length);
  return next;
}

/** A replacement word as typed: letters, digits, spaces, apostrophes and hyphens only. */
export function cleanSwitchWord(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^\p{L}\p{N}' -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_SWITCH_WORD);
}
