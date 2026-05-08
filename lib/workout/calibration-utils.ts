const STRIP_PREFIXES = [
  'machine', 'cable', 'seated', 'standing', 'incline', 'decline',
  'flat', 'single arm', 'single leg', 'low', 'high', 'reverse',
];

export function normalizeLiftKey(name: string): string {
  let key = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Strip common prefixes that don't change the core lift identity
  for (const prefix of STRIP_PREFIXES) {
    if (key.startsWith(prefix + ' ')) {
      key = key.slice(prefix.length + 1);
    }
  }

  return key.trim();
}

/**
 * Check if two lift keys likely refer to the same exercise.
 * Returns true if they share >= 70% word overlap.
 */
export function areLiftKeysSimilar(keyA: string, keyB: string): boolean {
  if (keyA === keyB) return true;

  const wordsA = new Set(keyA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(keyB.split(' ').filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  const similarity = overlap / Math.min(wordsA.size, wordsB.size);
  return similarity >= 0.7;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
