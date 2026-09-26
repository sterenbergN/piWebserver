import { NextResponse } from 'next/server';
import { pickFilmPage } from '@/lib/tools/film-lookup';

// Wikimedia throttles anonymous-looking clients hard; identify the site
// (their API etiquette asks for a name and a way to reach the operator).
const HEADERS = { 'User-Agent': 'NoahStufTools/1.1 (https://noahstuf.com/tools)', Accept: 'application/json' };

type Details = { title: string; description: string; poster: string | null; year: string | null; url: string | null };

// Films don't change: remember lookups for the life of the server so a
// spin never asks Wikipedia twice for the same title.
const cache = new Map<string, Details | null>();

async function getJson(url: string) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  return res.json();
}

async function lookup(title: string): Promise<Details | null> {
  const search = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${title} film`)}&format=json&srlimit=10&srnamespace=0&srprop=`);
  const candidates = pickFilmPage(title, (search.query?.search || []).map((r: { title: string }) => r.title));
  // Check candidates in order; accept the first whose summary says it's a film.
  for (const page of candidates.slice(0, 4)) {
    const sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`);
    const short = `${sum.description || ''}`;
    // The short description ("1975 film by Andrei Tarkovsky") says what the page is about;
    // without one, the first sentence must call it a film ("X is a 1994 Hong Kong film").
    const firstSentence = String(sum.extract || '').split(/(?<=\.)\s/)[0];
    // A year keeps out pages *about* film ("Close-up", a camera shot) that aren't a film.
    const FILM = /\b(18|19|20)\d{2}\b[^.]*\b(film|movie|documentary)\b/i;
    const isFilm = short ? FILM.test(short) : /\bis an? /i.test(firstSentence) && FILM.test(firstSentence);
    if (!isFilm) continue;
    return {
      title: String(sum.title || page).replace(/ \((\d{4} )?film\)$/, ''),
      description: sum.extract || 'No description available.',
      poster: sum.thumbnail?.source || null,
      year: short.match(/\b(18|19|20)\d{2}\b/)?.[0] || String(sum.extract || '').match(/\b(18|19|20)\d{2}\b/)?.[0] || null,
      url: sum.content_urls?.desktop?.page || null,
    };
  }
  return null;
}

export async function GET(request: Request) {
  const title = new URL(request.url).searchParams.get('title')?.trim();
  if (!title) return NextResponse.json({ success: false, message: 'Title required' }, { status: 400 });

  try {
    if (!cache.has(title)) cache.set(title, await lookup(title));
    const details = cache.get(title);
    if (!details) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, ...details }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch (err) {
    console.error('Movie details error:', err);
    // Not cached, so a later spin can try again once Wikipedia is reachable.
    return NextResponse.json({ success: false, message: 'Could not reach Wikipedia right now' }, { status: 502 });
  }
}
