import { NextResponse } from 'next/server';
import { TOP_FILMS } from '@/lib/movies-data';

export async function GET() {
  return NextResponse.json({ success: true, movies: TOP_FILMS }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
