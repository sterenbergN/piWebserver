import { NextResponse } from 'next/server';
import { ACCLAIMED_FILMS } from '@/lib/movies-data';

export async function GET() {
  return NextResponse.json({ success: true, movies: ACCLAIMED_FILMS });
}
