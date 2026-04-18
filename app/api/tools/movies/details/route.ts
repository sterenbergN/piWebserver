import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');

  if (!title) {
    return NextResponse.json({ success: false, message: 'Title required' }, { status: 400 });
  }

  try {
    // Step 1: Use Wikipedia's search API to find the correct page for this film
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title + ' film')}&format=json&srlimit=3&srnamespace=0`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'PiDashboard/1.0 personal home server' },
      signal: AbortSignal.timeout(5000),
    });
    const searchData = await searchRes.json();
    const results: any[] = searchData.query?.search || [];

    // Pick best result - prefer exact title match or "film" in title
    let pageTitle = results[0]?.title;
    for (const r of results) {
      const t = r.title.toLowerCase();
      if (t === title.toLowerCase() || t === `${title.toLowerCase()} (film)`) {
        pageTitle = r.title;
        break;
      }
      if (t.includes('(film)') || t.includes('(movie)')) {
        pageTitle = r.title;
        break;
      }
    }

    if (!pageTitle) {
      return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }

    // Step 2: Fetch summary + thumbnail for that page
    const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
    const sumRes = await fetch(sumUrl, {
      headers: { 'User-Agent': 'PiDashboard/1.0 personal home server' },
      signal: AbortSignal.timeout(5000),
    });
    const sum = await sumRes.json();

    return NextResponse.json({
      success: true,
      title: sum.title || pageTitle,
      description: sum.extract || 'No description available.',
      poster: sum.thumbnail?.source || null,
    });
  } catch (err) {
    console.error('Movie details error:', err);
    return NextResponse.json({ success: false, message: 'Failed to fetch details' }, { status: 500 });
  }
}
