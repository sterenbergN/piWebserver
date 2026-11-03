import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { createLimiter } from '@/lib/security/rate-limit';
import { OVERPASS_URL, overpassQuery, parseOverpass, type OsmCourse } from '@/lib/golf/osm';

// Overpass is a free shared service: ask once per course, and remember answers.
const limiter = createLimiter({ max: 6, windowMs: 10 * 60 * 1000 });
const cache = new Map<string, { at: number; courses: OsmCourse[] }>();
const DAY = 24 * 60 * 60 * 1000;

/** Courses mapped on OpenStreetMap near ?lat=&lon=, with their holes' tees and targets. */
export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const lat = Number(params.get('lat'));
    const lon = Number(params.get('lon'));
    const sport = params.get('sport') === 'disc' ? 'disc' : 'golf';
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ApiError(400, 'Need a position');
    // About 100 m squares, so standing a few steps away still hits the cache.
    const key = `${sport}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < DAY) return NextResponse.json({ success: true, courses: hit.courses });

    const wait = limiter.retryAfter(userId);
    if (wait) throw new ApiError(429, `Map lookups are paused for ${Math.ceil(wait / 60)} min`);
    limiter.hit(userId);
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NoahStufGolf/1.0 (https://noahstuf.com/golf)' },
      body: `data=${encodeURIComponent(overpassQuery(sport, { lat, lon }))}`,
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (!res || !res.ok) throw new ApiError(502, 'OpenStreetMap didn\'t answer. Try again later, or add the holes by hand.');
    const courses = parseOverpass(await res.json(), { lat, lon }, sport);
    cache.set(key, { at: Date.now(), courses });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return NextResponse.json({ success: true, courses });
  } catch (error) {
    return handleApiError(error, 'OpenStreetMap courses');
  }
}
