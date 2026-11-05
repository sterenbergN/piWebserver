// Course layouts from OpenStreetMap. Mapped golf courses draw each hole as a line
// from tee to green (golf=hole); disc golf uses disc_golf=hole the same way, though
// far fewer disc courses are mapped. The course outline decides which holes belong
// to the course you're standing at when two courses are side by side.

import { distance } from './geo';
import type { CourseHole, LatLon, Sport } from './types';

/**
 * Public Overpass servers, tried in this order. They're free and shared, and any of
 * them can be full or down for a while (the main one answers "at capacity" with a 502).
 */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
export const SEARCH_RADIUS_M = 1500;

export function overpassQuery(sport: Sport, at: LatLon, radius = SEARCH_RADIUS_M) {
  const around = `(around:${radius},${at.lat.toFixed(6)},${at.lon.toFixed(6)})`;
  const [area, hole] = sport === 'golf' ? ['["leisure"="golf_course"]', '["golf"="hole"]'] : ['["leisure"="disc_golf_course"]', '["disc_golf"="hole"]'];
  return `[out:json][timeout:20];(way${area}${around};relation${area}${around};way${hole}${around};);out geom tags;`;
}

type Element = {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
};

export type OsmCourse = { osm: string; name: string; center: LatLon; holes: CourseHole[] };

function inside(p: LatLon, ring: LatLon[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) hit = !hit;
  }
  return hit;
}

function centerOf(points: LatLon[]): LatLon {
  return { lat: points.reduce((a, p) => a + p.lat, 0) / points.length, lon: points.reduce((a, p) => a + p.lon, 0) / points.length };
}

/** Outer rings of a course outline (a closed way, or a multipolygon's outer members). */
function rings(el: Element): LatLon[][] {
  if (el.type === 'way' && el.geometry && el.geometry.length > 3) return [el.geometry];
  if (el.type === 'relation') return (el.members || []).filter((m) => m.role === 'outer' && m.geometry && m.geometry.length > 3).map((m) => m.geometry!);
  return [];
}

/**
 * Courses found near `at`, nearest first. Holes with no number are dropped, and a
 * number used twice keeps the line closest to the course.
 */
export function parseOverpass(json: { elements?: Element[] }, at: LatLon, sport: Sport): OsmCourse[] {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const holeTag = sport === 'golf' ? 'golf' : 'disc_golf';
  const holeWays = elements.filter((e) => e.type === 'way' && e.tags?.[holeTag] === 'hole' && (e.geometry?.length || 0) >= 2);
  const courses = elements
    .filter((e) => e.tags?.leisure === (sport === 'golf' ? 'golf_course' : 'disc_golf_course'))
    .map((e) => ({ el: e, rings: rings(e) }))
    .filter((c) => c.rings.length);

  const out: OsmCourse[] = [];
  for (const c of courses) {
    const all = c.rings.flat();
    const center = centerOf(all);
    const byNumber = new Map<number, { hole: CourseHole; d: number }>();
    for (const way of holeWays) {
      const pts = way.geometry!;
      const tee = pts[0];
      if (!c.rings.some((ring) => inside(tee, ring) || inside(pts[pts.length - 1], ring))) continue;
      const n = parseInt(way.tags?.ref || '', 10);
      if (!(n >= 1 && n <= 36)) continue;
      const par = parseInt(way.tags?.par || way.tags?.[`${holeTag}:par`] || '', 10);
      const hole: CourseHole = { n, par: par >= 2 && par <= 7 ? par : sport === 'golf' ? 4 : 3, tee: { lat: tee.lat, lon: tee.lon }, target: { lat: pts[pts.length - 1].lat, lon: pts[pts.length - 1].lon } };
      const si = parseInt(way.tags?.handicap || '', 10);
      if (si >= 1 && si <= 36) hole.si = si;
      const d = distance(center, tee);
      const seen = byNumber.get(n);
      if (!seen || d < seen.d) byNumber.set(n, { hole, d });
    }
    if (!byNumber.size) continue;
    const holes = [...byNumber.values()].map((h) => h.hole).sort((a, b) => a.n - b.n);
    out.push({ osm: `${c.el.type}/${c.el.id}`, name: (c.el.tags?.name || '').slice(0, 80), center, holes });
  }
  // The course you're standing on first, then the nearest.
  return out.sort((a, b) => distance(at, a.center) - distance(at, b.center));
}
