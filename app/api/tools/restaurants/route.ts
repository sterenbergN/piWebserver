import { NextResponse } from 'next/server';
import { isOpenAt } from '@/lib/tools/opening-hours';
import { CUISINES } from '@/lib/tools/restaurants';

// Nearby food from OpenStreetMap (Overpass API). Restaurants are mapped as
// points *or* building outlines, so search nodes and ways alike ("nwr")
// within a true radius, and ask for a centre point for outlines.

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NoahStufTools/1.1 (https://noahstuf.com/tools)' };

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

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

async function overpass(query: string, retry = true): Promise<any[] | null> {
  for (const server of SERVERS) {
    try {
      const res = await fetch(server, { method: 'POST', headers: HEADERS, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.elements)) return data.elements;
    } catch { /* try the next server */ }
  }
  // Overpass allows only a couple of queries at once per address; wait and try once more.
  if (retry) { await new Promise((r) => setTimeout(r, 2500)); return overpass(query, false); }
  return null;
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

    const cuisineFilter = cuisine ? `["cuisine"~"(^|;)\\s*(${cuisine})\\s*($|;)",i]` : '';
    const query = `[out:json][timeout:15];nwr["amenity"~"^(${kinds})$"]["name"]${cuisineFilter}(around:${radius},${lat},${lng});out center tags 200;`;
    const elements = await overpass(query);
    if (elements === null) {
      return NextResponse.json({ success: false, message: 'The map service is busy. Try again in a moment.' }, { status: 503 });
    }

    const seen = new Set<string>();
    const places: Place[] = [];
    for (const e of elements) {
      const t = e.tags || {};
      const pLat = e.lat ?? e.center?.lat;
      const pLon = e.lon ?? e.center?.lon;
      if (!t.name || !Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;
      // Chains and duplicate node+building entries: keep the closest of each name.
      const key = t.name.toLowerCase();
      const distance = Math.round(metersBetween(lat, lng, pLat, pLon));
      if (seen.has(key)) {
        const other = places.find((p) => p.name.toLowerCase() === key)!;
        if (distance < other.distance) Object.assign(other, { lat: pLat, lon: pLon, distance });
        continue;
      }
      seen.add(key);
      const hours = t.opening_hours || null;
      places.push({
        id: `${e.type}/${e.id}`,
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

    const openOnly = body.openNow === true;
    const results = places
      .filter((p) => !openOnly || p.open !== false) // unknown hours stay, listed after known-open ones
      .sort((a, b) => (openOnly ? Number(b.open === true) - Number(a.open === true) : 0) || a.distance - b.distance)
      .slice(0, 40);

    return NextResponse.json({ success: true, results, total: places.length, place: placeLabel });
  } catch (err) {
    console.error('Restaurant error:', err);
    return NextResponse.json({ success: false, message: 'Failed to search restaurants.' }, { status: 500 });
  }
}
