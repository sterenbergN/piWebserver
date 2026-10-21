import { NextResponse } from 'next/server';
import { isOpenAt } from '@/lib/tools/opening-hours';
import { CUISINES } from '@/lib/tools/restaurants';

// Nearby food from OpenStreetMap. The Overpass API gives the full list
// (restaurants are mapped as points *or* building outlines, so search nodes and
// ways alike, "nwr", and ask for a centre point for outlines). Public Overpass
// servers are often queued for half a minute, so all of them are asked at once,
// and if none has answered after a few seconds Nominatim's category search
// (fast, but at most 40 per type) fills in.

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NoahStufTools/1.2 (https://noahstuf.com/tools)' };
const OVERPASS_TIMEOUT_MS = 30000;
/** How long to wait on Overpass alone before asking Nominatim too. */
const FALLBACK_AFTER_MS = 5000;
const CACHE_MS = 15 * 60 * 1000;
/** Enough for "pick from everything nearby"; the page shows them a page at a time. */
const MAX_RESULTS = 200;

const KINDS: Record<string, string> = {
  any: 'restaurant|fast_food|cafe',
  restaurant: 'restaurant',
  fast_food: 'fast_food',
  cafe: 'cafe',
  bar: 'bar|pub',
};

type Place = {
  id: string; name: string; kind: string; cuisine: string | null; lat: number; lon: number; distance: number;
  address: string | null; phone: string | null; website: string | null; hours: string | null; open: boolean | null;
};
/** One place as either source gives it: its coordinates and OSM tags. */
type Found = { id: string; lat: number; lon: number; tags: Record<string, string> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** The first Overpass server to answer, or null when none does. */
async function overpass(query: string): Promise<Found[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    return await Promise.any(SERVERS.map(async (server) => {
      const res = await fetch(server, { method: 'POST', headers: HEADERS, body: 'data=' + encodeURIComponent(query), signal: controller.signal });
      if (!res.ok) throw new Error(`${server}: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.elements)) throw new Error(`${server}: no elements`);
      return data.elements.map((e: any): Found => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags || {} }));
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort(); // stop the servers that lost the race
  }
}

/** Nominatim's category search over the box around the circle, one request per type (its policy: one a second). */
async function nominatim(kinds: string[], lat: number, lng: number, radius: number): Promise<Found[] | null> {
  const dLat = radius / 111320;
  const dLng = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const box = [lng - dLng, lat + dLat, lng + dLng, lat - dLat].join(',');
  const found: Found[] = [];
  let answered = false;
  for (const [i, kind] of kinds.entries()) {
    if (i) await sleep(1000);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&amenity=${kind}&viewbox=${box}&bounded=1&limit=40&extratags=1&addressdetails=1`, {
        headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      answered = true;
      for (const hit of await res.json()) {
        const a = hit.address || {};
        found.push({
          id: `${hit.osm_type}/${hit.osm_id}`,
          lat: Number(hit.lat),
          lon: Number(hit.lon),
          tags: { ...hit.extratags, name: hit.name, amenity: hit.type, 'addr:housenumber': a.house_number, 'addr:street': a.road },
        });
      }
    } catch { /* this type is skipped */ }
  }
  return answered ? found : null;
}

/** Overpass if it answers quickly; otherwise whichever of Overpass and Nominatim comes back with something. */
async function findPlaces(kinds: string, cuisine: string, lat: number, lng: number, radius: number) {
  const cuisineFilter = cuisine ? `["cuisine"~"(^|;)\\s*(${cuisine})\\s*($|;)",i]` : '';
  const query = `[out:json][timeout:25];nwr["amenity"~"^(${kinds})$"]["name"]${cuisineFilter}(around:${radius},${lat},${lng});out center tags 1500;`;
  const full = overpass(query);
  const quick = await Promise.race([full, sleep(FALLBACK_AFTER_MS).then(() => undefined)]);
  if (quick) return { found: quick, complete: true };

  const partial = await nominatim(kinds.split('|'), lat, lng, radius);
  // Overpass may have finished while Nominatim was being asked.
  const late = await Promise.race([full, sleep(0).then(() => undefined)]);
  if (late) return { found: late, complete: true };
  if (partial) {
    const re = cuisine ? new RegExp(`(^|;)\\s*(${cuisine})\\s*($|;)`, 'i') : null;
    return { found: re ? partial.filter((f) => re.test(f.tags.cuisine || '')) : partial, complete: false };
  }
  const slow = await full;
  return slow ? { found: slow, complete: true } : null;
}

// Recent searches, so changing "open now" or searching again doesn't wait on the map servers.
const cache = new Map<string, { at: number; found: Found[]; complete: boolean }>();

async function cachedPlaces(kinds: string, cuisine: string, lat: number, lng: number, radius: number) {
  const key = [kinds, cuisine, lat.toFixed(3), lng.toFixed(3), radius].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const result = await findPlaces(kinds, cuisine, lat, lng, radius);
  if (!result) return null;
  // Partial (Nominatim) results are only kept briefly, so a full list replaces them soon.
  const entry = { at: result.complete ? Date.now() : Date.now() - CACHE_MS + 60_000, ...result };
  for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  return entry;
}

/** A typed place ("Austin, TX", a ZIP code) → coordinates, via OpenStreetMap's Nominatim. */
async function geocode(place: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, {
    headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  });
  const hit = res.ok ? (await res.json())[0] : null;
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: String(hit.display_name).split(',').slice(0, 3).join(',') } : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let lat = Number(body.lat);
    let lng = Number(body.lng);
    let placeLabel: string | null = null;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(body.lat == null || body.lng == null);
    if (!hasCoords) {
      const place = typeof body.place === 'string' ? body.place.trim().slice(0, 120) : '';
      if (!place) return NextResponse.json({ success: false, message: 'Share your location or type a place.' }, { status: 400 });
      const found = await geocode(place).catch(() => null);
      if (!found) return NextResponse.json({ success: false, message: `Couldn’t find “${place}”. Try a city, neighbourhood or ZIP code.` }, { status: 404 });
      ({ lat, lng } = found);
      placeLabel = found.label;
    }
    const radius = Math.min(Math.max(Number(body.radius) || 3000, 300), 25000);
    const kinds = KINDS[body.kind] || KINDS.any;
    const cuisine = CUISINES[body.cuisine] || '';
    // The visitor's own clock (weekday 0–6, minutes since midnight), so "open now" matches their time zone.
    const day = Number.isInteger(body.day) ? body.day : new Date().getDay();
    const minute = Number.isInteger(body.minute) ? body.minute : new Date().getHours() * 60 + new Date().getMinutes();

    const result = await cachedPlaces(kinds, cuisine, lat, lng, radius);
    if (!result) {
      return NextResponse.json({ success: false, message: 'The map service is busy. Try again in a minute.' }, { status: 503 });
    }

    const seen = new Set<string>();
    const places: Place[] = [];
    for (const { id, lat: pLat, lon: pLon, tags: t } of result.found) {
      if (!t.name || !Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;
      const distance = Math.round(metersBetween(lat, lng, pLat, pLon));
      if (distance > radius * 1.05) continue; // Nominatim searches a box, not a circle
      // Chains and duplicate node+building entries: keep the closest of each name.
      const key = t.name.toLowerCase();
      if (seen.has(key)) {
        const other = places.find((p) => p.name.toLowerCase() === key)!;
        if (distance < other.distance) Object.assign(other, { lat: pLat, lon: pLon, distance });
        continue;
      }
      seen.add(key);
      const hours = t.opening_hours || null;
      places.push({
        id,
        name: t.name,
        kind: t.amenity,
        cuisine: t.cuisine ? String(t.cuisine).split(';').map((c: string) => c.trim().replace(/_/g, ' ')).join(', ') : null,
        lat: pLat,
        lon: pLon,
        distance,
        address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
        phone: t.phone || t['contact:phone'] || null,
        website: t.website || t['contact:website'] || null,
        hours,
        open: isOpenAt(hours, day, minute),
      });
    }

    // Closest first, always. "Open now" only drops places known to be closed; unknown hours stay.
    const openOnly = body.openNow === true;
    const results = places
      .filter((p) => !openOnly || p.open !== false)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_RESULTS);

    return NextResponse.json({ success: true, results, total: places.length, place: placeLabel, partial: !result.complete });
  } catch (err) {
    console.error('Restaurant error:', err);
    return NextResponse.json({ success: false, message: 'Failed to search restaurants.' }, { status: 500 });
  }
}
