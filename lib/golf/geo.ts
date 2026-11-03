// Distances and directions on the ground. Haversine is plenty: at 300 m its error
// is centimetres, and a phone's GPS is off by metres.

import type { LatLon } from './types';

const EARTH_RADIUS_M = 6371000;
export const M_TO_YD = 1.0936133;
export const M_TO_FT = 3.2808399;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Metres between two points. */
export function distance(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0–360 (0 = north, 90 = east). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `metres` away from `start` along `bearingDeg`. */
export function project(start: LatLon, metres: number, bearingDeg: number): LatLon {
  const d = metres / EARTH_RADIUS_M;
  const t = rad(bearingDeg);
  const lat1 = rad(start.lat);
  const lon1 = rad(start.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
  const lon2 = lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** The turn from one bearing to another, −180 to 180; positive is to the right. */
export function angleBetween(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/**
 * How far a shot from `start` to `end` finished off the line toward `aim`:
 * `along` is metres down the line, `offline` metres to the side (positive = right).
 */
export function offLine(start: LatLon, aim: LatLon, end: LatLon) {
  const d = distance(start, end);
  const turn = rad(angleBetween(bearing(start, aim), bearing(start, end)));
  return { along: d * Math.cos(turn), offline: d * Math.sin(turn) };
}

export type DistanceUnit = 'yd' | 'ft' | 'm';

/** Golf distances are in yards and disc golf in feet, unless metric is chosen. */
export function unitFor(sport: 'golf' | 'disc', units: 'imperial' | 'metric'): DistanceUnit {
  return units === 'metric' ? 'm' : sport === 'golf' ? 'yd' : 'ft';
}

export function fromMetres(metres: number, unit: DistanceUnit) {
  return unit === 'yd' ? metres * M_TO_YD : unit === 'ft' ? metres * M_TO_FT : metres;
}

export function formatDistance(metres: number, unit: DistanceUnit) {
  return `${Math.round(fromMetres(metres, unit))} ${unit}`;
}
