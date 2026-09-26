// Site-wide search over published content. Pure scoring so it's testable; the
// API route gathers the documents from disk.

export type SearchDoc = {
  kind: 'post' | 'album' | 'photo' | 'document' | 'project' | 'page';
  title: string;
  url: string;
  /** Short line shown under the title. */
  subtitle?: string;
  /** Extra searchable text that isn't shown (e.g. a post's markdown). */
  body?: string;
};

export type SearchHit = SearchDoc & { score: number; snippet?: string };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** A short excerpt of `text` around the first match of any term. */
function snippet(text: string, terms: string[]) {
  const lower = norm(text);
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return undefined;
  const start = Math.max(0, at - 40);
  const clean = text.slice(start, at + 100).replace(/[#*_`>\[\]()!]/g, '').replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${clean}…`;
}

/**
 * Rank documents for a query: every term must appear somewhere; matches in
 * the title count most, then the subtitle, then the body.
 */
export function searchDocs(docs: SearchDoc[], query: string, limit = 20): SearchHit[] {
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 0).slice(0, 8);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const title = norm(doc.title);
    const subtitle = norm(doc.subtitle || '');
    const body = norm(doc.body || '');
    let score = 0;
    let all = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inSub = subtitle.includes(term);
      const inBody = body.includes(term);
      if (!inTitle && !inSub && !inBody) { all = false; break; }
      score += (inTitle ? 10 : 0) + (inSub ? 4 : 0) + (inBody ? 1 : 0);
      if (title.startsWith(term)) score += 3;
    }
    if (!all) continue;
    if (doc.kind === 'post' || doc.kind === 'project') score += 1;
    const inTitleOnly = terms.every((t) => title.includes(t));
    hits.push({ ...doc, score, snippet: !inTitleOnly && doc.body ? snippet(doc.body, terms) : undefined });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/** Static pages worth finding by name. */
export const SITE_PAGES: SearchDoc[] = [
  { kind: 'page', title: 'About / Home', url: '/', subtitle: 'Experience, skills and projects', body: 'resume about me cv' },
  { kind: 'page', title: 'Resume', url: '/resume', subtitle: 'Printable resume', body: 'cv pdf print experience' },
  { kind: 'page', title: 'Posts', url: '/blog', subtitle: 'Blog and build logs', body: 'blog articles writing' },
  { kind: 'page', title: 'Gallery', url: '/gallery', subtitle: 'Photo albums', body: 'photos pictures images' },
  { kind: 'page', title: 'Library', url: '/library', subtitle: 'Documents and PDFs', body: 'pdf documents files' },
  { kind: 'page', title: 'Snake', url: '/game?game=snake', subtitle: 'Play snake, beat the leaderboard', body: 'game play arcade' },
  { kind: 'page', title: '2048', url: '/game?game=2048', subtitle: 'Slide and merge tiles', body: 'game play arcade puzzle' },
  { kind: 'page', title: 'Party games', url: '/party', subtitle: 'Quip Clash, The Faker, Trivia Death, Bracket Battles, Ready Set Bet', body: 'jackbox party host join' },
  { kind: 'page', title: 'Workout tracker', url: '/workout', subtitle: 'Gym log, analytics and reports', body: 'gym lift fitness training' },
  { kind: 'page', title: 'Unit converter', url: '/tools', subtitle: 'Tools', body: 'calculator convert length weight temperature' },
  { kind: 'page', title: 'Movie picker', url: '/tools', subtitle: 'Tools', body: 'film watch random' },
  { kind: 'page', title: 'Restaurant finder', url: '/tools', subtitle: 'Tools', body: 'food eat dinner' },
  { kind: 'page', title: 'Golf score tracker', url: '/tools', subtitle: 'Tools', body: 'golf scorecard' },
  { kind: 'page', title: 'System stats', url: '/stats', subtitle: 'Raspberry Pi temperature, memory and storage', body: 'server pi cpu' },
];
