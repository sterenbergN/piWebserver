import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { createLimiter } from '@/lib/security/rate-limit';
import { OVERPASS_URLS, overpassQuery, parseOverpass, type OsmCourse } from '@/lib/golf/osm';

// Overpass is a free shared service: ask once per course, and remember answers.
const limiter = createLimiter({ max: 6, windowMs: 10 * 60 * 1000 });
const cache = new Map<string, { at: number; courses: OsmCourse[] }>();
const DAY = 24 * 60 * 60 * 1000;
/** Well inside Cloudflare's 100-second limit, so the phone always gets this route's own answer. */
const BUDGET_MS = 25_000;

/** The first server that answers with real data, trying the next when one is busy, down or slow. */
async function askOverpass(query: string): Promise<unknown | null> {
  const started = Date.now();
  for (let i = 0; i < OVERPASS_URLS.length; i++) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 3000) break;
    // Share what's left between the servers not tried yet, so one slow server can't use it all.
    const timeout = Math.min(left, Math.max(7000, left / (OVERPASS_URLS.length - i)));
    try {
      const res = await fetch(OVERPASS_URLS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NoahStufGolf/1.0 (https://noahstuf.com/golf)' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // Timed out, unreachable, or not JSON: try the next one.
    }
  }
  return null;
}

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
    const json = await askOverpass(overpassQuery(sport, { lat, lon }));
    // 503, not 502: Cloudflare swaps a 502 from the Pi for its own error page, which hides this message.
    if (!json) {
      return NextResponse.json(
        { success: false, message: 'OpenStreetMap\'s lookup servers are busy right now. Try again in a few minutes, or start the course anyway: each hole fills in as you play it.' },
        { status: 503, headers: { 'Retry-After': '120' } },
      );
    }
    const courses = parseOverpass(json as Parameters<typeof parseOverpass>[0], { lat, lon }, sport);
    cache.set(key, { at: Date.now(), courses });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return NextResponse.json({ success: true, courses });
  } catch (error) {
    return handleApiError(error, 'OpenStreetMap courses');
  }
}
