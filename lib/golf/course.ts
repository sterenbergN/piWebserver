// Courses and each account's bag and settings: checking what's stored or sent.

import { defaultPar, newId } from './round';
import type { Club, Course, CourseHole, Disc, GolfUser, LatLon, Layout, Sport, ThrowHand } from './types';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);

export function cleanPoint(v: any): LatLon | undefined {
  const lat = num(v?.lat, -90, 90);
  const lon = num(v?.lon, -180, 180);
  return lat === undefined || lon === undefined ? undefined : { lat, lon };
}

function cleanHole(v: any, i: number, sport: Sport, count: number): CourseHole {
  const hole: CourseHole = { n: i + 1, par: Math.round(num(v?.par, 2, 7) ?? defaultPar(sport)) };
  const length = num(v?.length, 1, 2500);
  if (length !== undefined) hole.length = Math.round(length);
  const si = num(v?.si, 1, count);
  if (si !== undefined) hole.si = Math.round(si);
  const tee = cleanPoint(v?.tee);
  if (tee) hole.tee = tee;
  const target = cleanPoint(v?.target);
  if (target) hole.target = target;
  return hole;
}

export function cleanLayout(v: any, sport: Sport): Layout | null {
  const count = Math.round(num(Array.isArray(v?.holes) ? v.holes.length : undefined, 1, 36) ?? 0);
  if (!count) return null;
  const layout: Layout = {
    id: isId(v?.id) ? v.id : newId(8),
    name: str(v?.name, 40) || (sport === 'golf' ? 'Tees' : 'Main'),
    holes: Array.from({ length: count }, (_, i) => cleanHole(v.holes[i], i, sport, count)),
  };
  const rating = num(v?.rating, 20, 90);
  const slope = num(v?.slope, 55, 155);
  if (sport === 'golf' && rating !== undefined && slope !== undefined) {
    layout.rating = Math.round(rating * 10) / 10;
    layout.slope = Math.round(slope);
  }
  return layout;
}

export function normalizeCourse(raw: any): Course | null {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return null;
  const sport: Sport = raw.sport === 'disc' ? 'disc' : 'golf';
  const layouts = (Array.isArray(raw.layouts) ? raw.layouts : []).map((l: unknown) => cleanLayout(l, sport)).filter(Boolean).slice(0, 12) as Layout[];
  if (!layouts.length) return null;
  const now = new Date().toISOString();
  const course: Course = {
    id: raw.id,
    sport,
    name: str(raw.name, 80) || 'Course',
    layouts,
    createdBy: isId(raw.createdBy) ? raw.createdBy : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
  const center = cleanPoint(raw.center);
  if (center) course.center = center;
  if (typeof raw.osm === 'string' && /^(way|relation)\/\d{1,15}$/.test(raw.osm)) course.osm = raw.osm;
  return course;
}

/** A layout of `holes` holes at the sport's usual par. */
export function blankLayout(sport: Sport, holes: number, name?: string): Layout {
  return { id: newId(8), name: name || (sport === 'golf' ? 'Tees' : 'Main'), holes: Array.from({ length: holes }, (_, i) => ({ n: i + 1, par: defaultPar(sport) })) };
}

/** The middle of every tee and target on a course, for finding courses nearby. */
export function courseCenter(course: Pick<Course, 'layouts' | 'center'>): LatLon | undefined {
  const pts = course.layouts.flatMap((l) => l.holes.flatMap((h) => [h.tee, h.target])).filter((p): p is LatLon => !!p);
  if (!pts.length) return course.center;
  return { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
}

const HANDS: ThrowHand[] = ['RHBH', 'RHFH', 'LHBH', 'LHFH'];

export function emptyGolfUser(): GolfUser {
  return { clubs: [], discs: [], hand: 'RHBH', units: 'imperial', keepAwake: true };
}

export function cleanDisc(v: any): Disc | null {
  const name = str(v?.name, 40);
  if (!name) return null;
  const disc: Disc = {
    id: isId(v?.id) ? v.id : newId(8),
    name,
    speed: num(v?.speed, 1, 15) ?? 7,
    glide: num(v?.glide, 0, 7) ?? 4,
    turn: num(v?.turn, -5, 2) ?? 0,
    fade: num(v?.fade, 0, 6) ?? 2,
    inBag: v?.inBag !== false,
  };
  const brand = str(v?.brand, 40);
  if (brand) disc.brand = brand;
  const plastic = str(v?.plastic, 40);
  if (plastic) disc.plastic = plastic;
  const color = str(v?.color, 24);
  if (color) disc.color = color;
  const weight = num(v?.weight, 100, 200);
  if (weight !== undefined) disc.weight = Math.round(weight);
  const where = cleanPoint(v?.lost?.where);
  if (where && typeof v.lost.at === 'string') disc.lost = { at: v.lost.at, where };
  return disc;
}

export function normalizeGolfUser(raw: any): GolfUser {
  const base = emptyGolfUser();
  if (!raw || typeof raw !== 'object') return base;
  const clubs: Club[] = (Array.isArray(raw.clubs) ? raw.clubs : [])
    .map((c: any) => (str(c?.name, 30) ? { id: isId(c.id) ? c.id : newId(8), name: str(c.name, 30) } : null))
    .filter(Boolean)
    .slice(0, 30);
  const discs = (Array.isArray(raw.discs) ? raw.discs : []).map(cleanDisc).filter(Boolean).slice(0, 200) as Disc[];
  return {
    clubs,
    discs,
    hand: HANDS.includes(raw.hand) ? raw.hand : base.hand,
    units: raw.units === 'metric' ? 'metric' : 'imperial',
    keepAwake: raw.keepAwake !== false,
  };
}

/** The usual 14 clubs, to start a golf bag from. */
export const STARTER_CLUBS = ['Driver', '3 wood', '5 wood', '4 hybrid', '5 iron', '6 iron', '7 iron', '8 iron', '9 iron', 'Pitching wedge', 'Gap wedge', 'Sand wedge', 'Lob wedge', 'Putter'];
