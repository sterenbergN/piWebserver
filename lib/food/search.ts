import type { Food, FoodSource } from './types';

// Text search over food names: words in any order, each matching the start of a
// word in the name ("chick bre" finds "Chicken breast"), scored so short, close
// names rank above long ones. Used in-process for USDA and the library, and to
// merge every source's results into one ranked list.

const STOP = new Set(['and', 'with', 'or', 'the', 'of', 'in', 'a', 'an', 'w', 'n']);

/** Lowercase, accents and punctuation gone, runs of spaces folded. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** A word's plural folded away, so "eggs" and "egg" match (not short words like "gas"). */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter((w) => w && !STOP.has(w)).map(stem);
}

/**
 * How well `query` matches a food's name (and brand): 0 when any query word is
 * missing. Whole-word matches beat prefixes, a name that starts with the first
 * word beats one that only contains it, and shorter names beat longer ones.
 */
export function scoreMatch(query: string | string[], name: string, brand?: string): number {
  const q = Array.isArray(query) ? query : tokenize(query);
  if (!q.length) return 0;
  const nameTokens = tokenize(name);
  const brandTokens = brand ? tokenize(brand) : [];
  let score = 0;
  for (const word of q) {
    const exactAt = nameTokens.indexOf(word);
    if (exactAt >= 0) { score += 10 - Math.min(exactAt, 6); continue; }
    const prefixAt = nameTokens.findIndex((t) => t.startsWith(word));
    if (prefixAt >= 0) { score += 6 - Math.min(prefixAt, 4); continue; }
    if (brandTokens.some((t) => t === word || t.startsWith(word))) { score += 4; continue; }
    // Long words: a match inside a compound ("peanutbutter", "wholewheat").
    if (word.length >= 5 && nameTokens.some((t) => t.includes(word))) { score += 2; continue; }
    return 0;
  }
  if (nameTokens[0] === q[0]) score += 6;
  else if (nameTokens[0]?.startsWith(q[0])) score += 3;
  const phrase = normalizeText(name);
  if (phrase === normalizeText(q.join(' '))) score += 10;
  // Fewer extra words: "Banana, raw" before "Banana bread, made with margarine".
  score -= Math.max(0, nameTokens.length - q.length) * 0.6;
  return Math.max(score, 0.1);
}

/** A prefix-searchable index over items' names, built once and kept in memory. */
export class TokenIndex<T> {
  private readonly byToken = new Map<string, number[]>();
  private readonly tokens: string[];

  constructor(private readonly items: T[], private readonly textOf: (item: T) => { name: string; brand?: string }) {
    items.forEach((item, i) => {
      const { name, brand } = textOf(item);
      for (const t of new Set([...tokenize(name), ...(brand ? tokenize(brand) : [])])) {
        const list = this.byToken.get(t);
        if (list) list.push(i); else this.byToken.set(t, [i]);
      }
    });
    this.tokens = [...this.byToken.keys()];
  }

  get size() { return this.items.length; }

  /** The best `limit` matches, best first. */
  search(query: string, limit = 25): { item: T; score: number }[] {
    const q = tokenize(query);
    if (!q.length) return [];
    // Candidates: items with a word starting with the rarest-looking (longest) query word.
    const key = [...q].sort((a, b) => b.length - a.length)[0];
    const candidates = new Set<number>();
    for (const t of this.tokens) {
      if (t.startsWith(key) || (key.length >= 5 && t.includes(key))) for (const i of this.byToken.get(t)!) candidates.add(i);
    }
    const hits: { item: T; score: number }[] = [];
    for (const i of candidates) {
      const { name, brand } = this.textOf(this.items[i]);
      const score = scoreMatch(q, name, brand);
      if (score > 0) hits.push({ item: this.items[i], score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export type SearchHit = { food: Food; score: number };
export type Usage = { count: number; last: string };

/** Sources in the order they win a tie or a duplicate: your own first, then the most reliable. */
const SOURCE_RANK: Record<FoodSource, number> = { custom: 0, fatsecret: 1, usda: 2, off: 3, quick: 4, recipe: 5 };

/**
 * One list from every source: duplicates (same id, or same name and brand)
 * collapsed onto the better source, foods this account logs often or lately
 * lifted, then best first.
 */
export function mergeResults(hits: SearchHit[], usage: Record<string, Usage> = {}, todayKey = '', libraryIds: Set<string> = new Set()): SearchHit[] {
  const boosted = hits.map((h) => {
    const u = usage[h.food.id];
    let bonus = 0;
    if (u) {
      bonus += Math.min(Math.log2(1 + u.count) * 3, 12);
      if (todayKey && u.last) {
        const age = (Date.parse(todayKey) - Date.parse(u.last)) / 86_400_000;
        if (age <= 14) bonus += 4 - age / 4;
      }
    }
    if (libraryIds.has(h.food.id)) bonus += 2;
    return { ...h, score: h.score + bonus };
  });
  const keyOf = (f: Food) => `${normalizeText(f.name)}|${normalizeText(f.brand || '')}`;
  const best = new Map<string, SearchHit>();
  const byId = new Map<string, string>();
  for (const h of boosted) {
    const key = byId.get(h.food.id) ?? keyOf(h.food);
    byId.set(h.food.id, key);
    const current = best.get(key);
    if (!current) { best.set(key, h); continue; }
    const better = h.score > current.score + 0.5
      || (Math.abs(h.score - current.score) <= 0.5 && SOURCE_RANK[h.food.source] < SOURCE_RANK[current.food.source]);
    if (better) best.set(key, { ...h, score: Math.max(h.score, current.score) });
    else current.score = Math.max(h.score, current.score);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || SOURCE_RANK[a.food.source] - SOURCE_RANK[b.food.source] || a.food.name.localeCompare(b.food.name));
}
