import { NextResponse } from 'next/server';
import { searchMoviesWithSource, isTmdbConfigured } from '@/lib/tools/tmdb';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const yearParam = url.searchParams.get('year');
    const parsedYear = yearParam ? parseInt(yearParam, 10) : undefined;
    const year = parsedYear && !isNaN(parsedYear) && parsedYear >= 1880 && parsedYear <= 2100 ? parsedYear : undefined;

    const { results, source } = await searchMoviesWithSource(q, year);

    return NextResponse.json(
      {
        success: true,
        source,
        configured: isTmdbConfigured(),
        results,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('Movies search error:', error);
    return NextResponse.json(
      {
        success: false,
        source: 'local',
        configured: isTmdbConfigured(),
        results: [],
        error: error instanceof Error ? error.message : 'Search failed',
      },
      { status: 500 }
    );
  }
}
