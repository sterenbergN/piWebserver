// Choosing the right Wikipedia page for a film title: the top search hit is
// often another film with a similar name ("Mirror" → "Mirror Mirror").

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9½]+/g, ' ').trim();

/**
 * Search results ordered best-first: the bare title (Wikipedia gives it to
 * the best-known subject — Tati's "Playtime", not the 2024 one), then
 * "Title (film)" / "Title (1975 film)" pages in search order, then other
 * pages that start with the title and mention film. Unrelated hits are
 * dropped. The caller checks each summary really is a film, so a bare
 * title that's the physics of "Heat" falls through to "Heat (1995 film)".
 */
export function pickFilmPage(title: string, results: string[]): string[] {
  const want = norm(title);
  const rank = (page: string) => {
    const m = page.match(/^(.*?)(?: \((?:(\d{4}) )?(film|movie)\))?$/i);
    const base = norm(m?.[1] || page);
    const isFilmPage = !!m?.[3];
    if (base === want && !isFilmPage) return 0;
    if (base === want) return 1;
    if (base.startsWith(want) && /film|movie/i.test(page)) return 2;
    return -1;
  };
  return results
    .map((page, i) => ({ page, r: rank(page), i }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.page);
}
