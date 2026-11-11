import { NextResponse } from 'next/server';
import { getMovieProviders } from '@/lib/tools/tmdb';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const region = url.searchParams.get('region') || 'US';

    if (!id || !id.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required id parameter',
          providers: null,
        },
        { status: 400 }
      );
    }

    const providers = await getMovieProviders(id.trim(), region.trim());

    return NextResponse.json(
      {
        success: true,
        providers,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('Movies watch providers error:', error);
    return NextResponse.json(
      {
        success: false,
        providers: null,
        error: error instanceof Error ? error.message : 'Failed to retrieve providers',
      },
      { status: 500 }
    );
  }
}
