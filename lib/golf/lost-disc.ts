// Where a lost disc probably is, from your own throws rather than a physics model.
// Flight numbers are a maker's rating, not measurements, so they only set a starting
// guess until there are throws of yours to learn from.
//
// Distance and direction are each treated as a normal spread: distance from your
// throws with that disc (or similar ones), direction from how far your drives finish
// off the tee-to-target line. GPS and compass error widen both. The result is an
// arc-shaped area that holds the disc about 70% or 90% of the time.

import { angleBetween, bearing, distance, project } from './geo';
import type { ThrowRecord } from './stats';
import type { Disc, LatLon, ThrowHand } from './types';

export type Feel = 'normal' | 'big' | 'short';

/** +1 when a stable disc finishes left (right-hand backhand, left-hand forehand). */
export function fadeSide(hand: ThrowHand) {
  return hand === 'RHBH' || hand === 'LHFH' ? -1 : 1;
}

/** A starting guess for someone with no throws logged: metres for a disc of this speed. */
export function defaultDistance(speed: number) {
  return 45 + 5 * Math.max(1, Math.min(14, speed));
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A spread that one wild throw can't blow up: the median absolute deviation, scaled to match a standard deviation. */
function robustSpread(xs: number[]) {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export type Spread = { mean: number; sd: number; samples: number; source: 'disc' | 'similar' | 'guess' };

export const MIN_SAMPLES = 3;

/** How far this disc goes for you, in metres. */
export function distanceSpread(disc: Pick<Disc, 'id' | 'speed'>, throws: ThrowRecord[], speedOf: (discId: string) => number | undefined): Spread {
  const drives = throws.filter((t) => t.discId && t.kind !== 'other');
  const same = drives.filter((t) => t.discId === disc.id).map((t) => t.distance);
  const similar = drives.filter((t) => Math.abs((speedOf(t.discId!) ?? 99) - disc.speed) <= 2).map((t) => t.distance);
  const pick = same.length >= MIN_SAMPLES ? { xs: same, source: 'disc' as const } : similar.length >= MIN_SAMPLES ? { xs: similar, source: 'similar' as const } : null;
  if (!pick) {
    const mean = defaultDistance(disc.speed);
    return { mean, sd: mean * 0.2, samples: 0, source: 'guess' };
  }
  const mean = median(pick.xs);
  return { mean, sd: Math.max(5, mean * 0.08, robustSpread(pick.xs)), samples: pick.xs.length, source: pick.source };
}

/** Which way it goes for you, in degrees off the line you aimed (positive = right). */
export function angleSpread(disc: Pick<Disc, 'id' | 'turn' | 'fade'>, hand: ThrowHand, throws: ThrowRecord[]): Spread {
  const withAngle = throws.filter((t) => t.angle !== null && t.discId);
  const same = withAngle.filter((t) => t.discId === disc.id).map((t) => t.angle!);
  const any = withAngle.map((t) => t.angle!);
  const pick = same.length >= MIN_SAMPLES ? { xs: same, source: 'disc' as const } : any.length >= MIN_SAMPLES ? { xs: any, source: 'similar' as const } : null;
  if (!pick) {
    // Lean toward the finish: fade pulls one way, high-speed turn the other.
    const lean = fadeSide(hand) * (disc.fade * 1.5 - Math.max(0, -disc.turn) * 1.0);
    return { mean: lean, sd: 12, samples: 0, source: 'guess' };
  }
  return { mean: median(pick.xs), sd: Math.max(4, robustSpread(pick.xs)), samples: pick.xs.length, source: pick.source };
}

/** Each of distance and direction covers this much, so together they cover the target (√0.7, √0.9). */
const K = { 70: 1.39, 90: 1.95 } as const;

export type SearchArea = {
  from: LatLon;
  /** Bearing from the throw to the middle of the area. */
  centerBearing: number;
  center: LatLon;
  /** Metres from the throw. */
  distance: Spread;
  /** Degrees off the aimed line. */
  angle: Spread;
  /** Outlines on the ground, closed. */
  areas: Record<70 | 90, LatLon[]>;
};

export type SearchInput = {
  from: LatLon;
  /** The direction it was thrown, degrees from north. */
  heading: number;
  /** How sure that direction is, degrees (about 15 for a phone compass, 5 for a line dragged on the map). */
  headingError: number;
  /** GPS accuracy at the throw, metres. */
  gpsError: number;
  feel: Feel;
  distance: Spread;
  angle: Spread;
};

export function searchArea(input: SearchInput): SearchArea {
  const feel = input.feel === 'big' ? 1.12 : input.feel === 'short' ? 0.85 : 1;
  const mean = input.distance.mean * feel;
  const sdR = Math.hypot(input.distance.sd * feel, input.gpsError);
  // GPS error to the side, turned into degrees at that distance.
  const gpsDeg = (Math.atan2(input.gpsError, Math.max(mean, 10)) * 180) / Math.PI;
  const sdA = Math.hypot(input.angle.sd, input.headingError, gpsDeg);
  const centerBearing = input.heading + input.angle.mean;

  const outline = (k: number) => {
    const near = Math.max(3, mean - k * sdR);
    const far = mean + k * sdR;
    const a0 = centerBearing - k * sdA;
    const a1 = centerBearing + k * sdA;
    const steps = 16;
    const pts: LatLon[] = [];
    for (let i = 0; i <= steps; i++) pts.push(project(input.from, far, a0 + ((a1 - a0) * i) / steps));
    for (let i = steps; i >= 0; i--) pts.push(project(input.from, near, a0 + ((a1 - a0) * i) / steps));
    pts.push(pts[0]);
    return pts;
  };

  return {
    from: input.from,
    centerBearing,
    center: project(input.from, mean, centerBearing),
    distance: { ...input.distance, mean, sd: sdR },
    angle: { ...input.angle, mean: input.angle.mean, sd: sdA },
    areas: { 70: outline(K[70]), 90: outline(K[90]) },
  };
}

/** Whether a point (you, walking) is in the likely area, the wider one, or neither. */
export function whereInArea(area: SearchArea, point: LatLon): 'likely' | 'possible' | 'outside' {
  const r = distance(area.from, point);
  const off = Math.abs(angleBetween(area.centerBearing, bearing(area.from, point)));
  const within = (k: number) => Math.abs(r - area.distance.mean) <= k * area.distance.sd && off <= k * area.angle.sd;
  return within(K[70]) ? 'likely' : within(K[90]) ? 'possible' : 'outside';
}
