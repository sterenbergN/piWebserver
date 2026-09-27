import { NextResponse } from 'next/server';
import { pickFilmPage } from '@/lib/tools/film-lookup';

// Wikimedia throttles anonymous-looking clients hard; identify the site
// (their API etiquette asks for a name and a way to reach the operator).
const HEADERS = { 'User-Agent': 'NoahStufTools/1.2 (https://noahstuf.com/tools)', Accept: 'application/json' };

type Details = { title: string; description: string; poster: string | null; year: string | null; url: string | null };

// Films don't change: remember lookups for the life of the server so a
// spin never asks Wikipedia twice for the same film.
const cache = new Map<string, Details | null>();

async function getJson(url: string) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Wikimedia ${res.status}`);
  return res.json();
}

/** Exact English Wikipedia page for an IMDb id, via Wikidata (IMDb ID = property P345). */
async function pageForImdbId(imdbId: string): Promise<string | null> {
  const search = await getJson(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P345=${imdbId}`)}&srlimit=1&format=json`);
  const qid = search.query?.search?.[0]?.title;
  if (!qid) return null;
  const entity = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=enwiki&format=json`);
  return entity.entities?.[qid]?.sitelinks?.enwiki?.title || null;
}

async function summaryOf(page: string): Promise<Details | null> {
  const sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`);
  const short = `${sum.description || ''}`;
  // The short description ("1975 film by Andrei Tarkovsky") says what the page is about; without
  // one, the first sentence must call it a film. A year keeps out pages *about* film ("Close-up").
  const FILM = /\b(18|19|20)\d{2}\b[^.]*\b(film|movie|documentary)\b/i;
  const firstSentence = String(sum.extract || '').split(/(?<=\.)\s/)[0];
  const isFilm = short ? FILM.test(short) : /\bis an? /i.test(firstSentence) && FILM.test(firstSentence);
  if (!isFilm) return null;
  return {
    title: String(sum.title || page).replace(/ \((\d{4} )?film\)$/, ''),
    description: sum.extract || 'No description available.',
    poster: sum.thumbnail?.source || null,
    year: short.match(/\b(18|19|20)\d{2}\b/)?.[0] || firstSentence.match(/\b(18|19|20)\d{2}\b/)?.[0] || null,
    url: sum.content_urls?.desktop?.page || null,
  };
}

async function lookup(title: string, imdbId: string | null, year: string | null): Promise<Details | null> {
  if (imdbId) {
    const page = await pageForImdbId(imdbId).catch(() => null);
    const found = page ? await summaryOf(page) : null;
    if (found) return found;
  }
  // Fallback: search by title (and year when known), checking candidates in order.
  const search = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${title} ${year || ''} film`)}&format=json&srlimit=10&srnamespace=0&srprop=`);
  let candidates = pickFilmPage(title, (search.query?.search || []).map((r: { title: string }) => r.title));
  if (year) candidates = [...candidates.filter((c) => c.includes(`(${year} film)`)), ...candidates.filter((c) => !c.includes(`(${year} film)`))];
  for (const page of candidates.slice(0, 4)) {
    const found = await summaryOf(page);
    if (found && (!year || !found.year || found.year === year)) return found;
  }
  return null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get('title')?.trim();
  const imdbId = /^tt\d{5,10}$/.test(params.get('id') || '') ? params.get('id') : null;
  const year = /^\d{4}$/.test(params.get('year') || '') ? params.get('year') : null;
  if (!title) return NextResponse.json({ success: false, message: 'Title required' }, { status: 400 });

  const key = imdbId || `${title}|${year || ''}`;
  try {
    if (!cache.has(key)) cache.set(key, await lookup(title, imdbId, year));
    const details = cache.get(key);
    if (!details) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, ...details }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch (err) {
    console.error('Movie details error:', err);
    // Not cached, so a later spin can try again once Wikipedia is reachable.
    return NextResponse.json({ success: false, message: 'Could not reach Wikipedia right now' }, { status: 502 });
  }
}
