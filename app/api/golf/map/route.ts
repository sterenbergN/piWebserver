import { NextResponse } from 'next/server';

// Read when asked, not when the site is built: builds run on GitHub Actions and the
// key lives only in the Pi's environment (GOLF_MAP_KEY, GOLF_MAP_PROVIDER).
export const dynamic = 'force-dynamic';

const PROVIDERS: Record<string, { url: string; attribution: string; maxZoom: number }> = {
  esri: {
    url: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token={key}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  maptiler: {
    url: 'https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key={key}',
    attribution: '© MapTiler © OpenStreetMap contributors',
    maxZoom: 20,
  },
};

const STREETS = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
};

/**
 * Where the golf map gets its tiles. With a key: satellite imagery. Without one: the
 * OpenStreetMap street map, which shows where the course is but not its fairways.
 * The key has to reach the browser to load tiles, so restrict it to this site's
 * address in the provider's dashboard.
 */
export async function GET() {
  const key = process.env.GOLF_MAP_KEY?.trim();
  const provider = PROVIDERS[process.env.GOLF_MAP_PROVIDER?.trim().toLowerCase() || 'esri'] || PROVIDERS.esri;
  const satellite = key ? { ...provider, url: provider.url.replace('{key}', encodeURIComponent(key)) } : null;
  return NextResponse.json({ satellite, streets: STREETS }, { headers: { 'Cache-Control': 'no-store' } });
}
