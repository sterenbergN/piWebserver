import { NextResponse } from 'next/server';
import { LETTERBOXD_TOP_500 } from '@/lib/movies-data';

export async function GET() {
  return NextResponse.json({ success: true, movies: LETTERBOXD_TOP_500, source: 'hardcoded' });
}
