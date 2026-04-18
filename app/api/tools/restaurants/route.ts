import { NextResponse } from 'next/server';

const SERVERS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

type VibeKey = 'Fast Food' | 'Cafe' | 'Bar' | string;
const VIBE_AMENITY: Record<string, string> = {
  'Fast Food': 'fast_food',
  'Cafe': 'cafe',
  'Bar': 'bar',
  'Casual': 'restaurant',
  'Fancy': 'restaurant',
};

const CUISINE_MAP: Record<string, string> = {
  Italian: 'italian',
  Mexican: 'mexican',
  Asian: 'asian',
  American: 'american',
  Seafood: 'seafood',
};

function degreesForMeters(meters: number) {
  return meters / 111320; // rough degrees per meter
}

async function queryOverpass(query: string): Promise<any[] | null> {
  for (const server of SERVERS) {
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PiDashboard/1.0 (personal home server)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      if (text.startsWith('{')) {
        const data = JSON.parse(text);
        return data.elements || [];
      }
    } catch (e) {
      // try next server
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { lat, lng, cuisine, radius = 5000, vibe } = body;

    if (!lat || !lng) {
      return NextResponse.json({ success: false, message: 'Location required' }, { status: 400 });
    }

    // Use bounding box (much faster than around: filter)
    const delta = degreesForMeters(radius);
    const bbox = `${lat - delta},${lng - delta},${lat + delta},${lng + delta}`;

    const amenity = VIBE_AMENITY[vibe] || 'restaurant';
    const cuisineTag = CUISINE_MAP[cuisine] || '';

    // First: targeted query with cuisine filter if specified
    let elements: any[] | null = null;
    if (cuisineTag) {
      const targeted = `[out:json][timeout:10];node["amenity"="${amenity}"]["name"]["cuisine"~"${cuisineTag}",i](${bbox});out body 20;`;
      elements = await queryOverpass(targeted);
    }

    // If no cuisine match or no results, broad restaurant search
    if (!elements || elements.length === 0) {
      const broad = `[out:json][timeout:10];(node["amenity"="${amenity}"]["name"](${bbox});node["amenity"="restaurant"]["name"](${bbox}););out body 40;`;
      elements = await queryOverpass(broad);
    }

    if (elements === null) {
      return NextResponse.json({ success: false, message: 'Search service temporarily unavailable. Try again in a moment.' }, { status: 503 });
    }

    if (elements.length === 0) {
      return NextResponse.json({ success: true, results: [] });
    }

    // Deduplicate by name and score
    const seen = new Set<string>();
    const scored = elements
      .filter(e => {
        const name = e.tags?.name;
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map(e => {
        const tags = e.tags || {};
        let score = 0;
        if (tags.cuisine) score += 2;
        if (tags.phone || tags['contact:phone']) score += 1;
        if (tags.website || tags['contact:website']) score += 1;
        if (tags.opening_hours) score += 2;
        if (tags['addr:street']) score += 1;
        if (cuisineTag && tags.cuisine?.toLowerCase().includes(cuisineTag)) score += 5;

        const addressParts = [
          tags['addr:housenumber'],
          tags['addr:street'],
          tags['addr:city'],
        ].filter(Boolean);

        return {
          name: tags.name,
          cuisine: tags.cuisine || null,
          address: addressParts.join(' ') || null,
          phone: tags.phone || tags['contact:phone'] || null,
          website: tags.website || tags['contact:website'] || null,
          opening_hours: tags.opening_hours || null,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return NextResponse.json({ success: true, results: scored });
  } catch (err) {
    console.error('Restaurant error:', err);
    return NextResponse.json({ success: false, message: 'Failed to search restaurants.' }, { status: 500 });
  }
}
