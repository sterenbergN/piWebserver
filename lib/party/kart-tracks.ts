export type TrackId =
  | 'sunny-circuit'
  | 'canyon-driftway'
  | 'frostbite-peak'
  | 'neon-starway'
  | 'volcano-inferno'
  | 'cyber-metro';

export interface TrackSample {
  x: number;
  y: number; // road surface height at the centerline (visual only, physics is 2D)
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  angle: number;
  curvature: number;
  bank: number; // radians of road camber; the outside of a corner is raised
  s: number;
  progress: number;
}

export interface BoostPadDef {
  id: string;
  progress: number;
  lateral: number; // -1..1 of the half road
  x: number;
  y: number;
  z: number;
  angle: number;
}

export interface ItemBoxSpawnDef {
  id: string;
  progress: number;
  lateral: number;
  x: number;
  y: number;
  z: number;
}

export interface CoinSpawnDef {
  id: string;
  progress: number;
  lateral: number;
  x: number;
  y: number;
  z: number;
}

/** A jump across the full road width. Crossing it launches the kart. */
export interface RampDef {
  id: string;
  progress: number;
  x: number;
  y: number;
  z: number;
  angle: number;
}

export interface SplitSectionDef {
  id: string;
  name?: string;
  startProgress: number;
  endProgress: number;
  extraHalfWidth: number;
  dividerHalfWidth: number;
  upperSide?: -1 | 1;
  theme: 'island' | 'mesa-pillar' | 'ice-bridge' | 'neon-split' | 'lava-chasm' | 'median';
  leftPerk: 'boosts' | 'coins' | 'boxes' | 'fast';
  rightPerk: 'boosts' | 'coins' | 'boxes' | 'fast';
}

export interface ShortcutPoint {
  x: number;
  y: number;
  z: number;
  progress: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

export interface ShortcutDef {
  id: string;
  name: string;
  entryProgress: number;
  exitProgress: number;
  side: -1 | 1;
  width: number;
  kind: 'offroad-cut' | 'boost-gate' | 'hidden-ramp';
  points: ShortcutPoint[];
}

export type TrackFeatureKind = 'boost_ring' | 'moving_hazard' | 'mega_ramp';

export interface TrackFeatureDef {
  id: string;
  kind: TrackFeatureKind;
  progress: number;
  lateral: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  patrolWidth?: number;
  speed?: number;
  phase?: number;
  radius?: number;
  label?: string;
}

export type TrackBiome = 'beach' | 'canyon' | 'snow' | 'space' | 'lava' | 'city';

export interface KartTrack {
  id: TrackId;
  name: string;
  emoji: string;
  tagline: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  roadWidth: number;
  wallWidth: number; // distance from centerline to the barrier
  friction: number; // 1.0 = normal, <1.0 = icy, karts slide further
  biome: TrackBiome;
  theme: {
    skyTop: string;
    skyHorizon: string;
    fog: string;
    fogDensity: number;
    sun: string;
    sunDir: [number, number, number];
    ambient: string;
    groundLow: string;
    groundHigh: string;
    shoulder: string;
    roadColor: string;
    roadGrain: string;
    roadStripeColor: string;
    curbColorA: string;
    curbColorB: string;
    wallColor: string;
    wallTop: string;
    wallHeight: number;
    accentColor: string;
    rainbowRoad?: boolean;
    glowRoad?: boolean;
  };
  music: { root: number; bpm: number; chords: number[][]; lead: number[] };
  controlPoints: [number, number][];
  samples: TrackSample[];
  totalLength: number;
  boostPads: BoostPadDef[];
  itemBoxes: ItemBoxSpawnDef[];
  ramps: RampDef[];
  coins: CoinSpawnDef[];
  splitSections: SplitSectionDef[];
  shortcuts: ShortcutDef[];
  features: TrackFeatureDef[];
}

export const SAMPLE_COUNT = 600;

/** Every shortcut is a 20-point Bezier path. */
export const SHORTCUT_POINT_COUNT = 20;
/**
 * A 'hidden-ramp' shortcut climbs from this point index to HIDDEN_RAMP_TOP_INDEX and launches the
 * kart off the top. The lift is baked into ShortcutPoint.y so physics, scene and coins agree.
 */
export const HIDDEN_RAMP_START_INDEX = 5;
export const HIDDEN_RAMP_TOP_INDEX = 11;
export const HIDDEN_RAMP_LIFT = 2.2;
/** Shortcut path progress (0..1 along its points) where a hidden ramp launches the kart. */
export const HIDDEN_RAMP_LAUNCH_T = HIDDEN_RAMP_TOP_INDEX / (SHORTCUT_POINT_COUNT - 1);

/** Half the width of a mega ramp, shared by the physics trigger and the drawn ramp. */
export function megaRampHalfWidth(halfRoad: number): number {
  return Math.min(halfRoad * 0.8, Math.max(10, halfRoad * 0.72));
}

/** Every course is drawn at this size. The one place to make all maps larger or smaller. */
const TRACK_SCALE = 1.65;

function wrapAngle(a: number): number {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

function catmullRomPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const z =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, z];
}

/**
 * Build uniform arc-length resampled spline samples so sample[i].progress === i / targetCount
 * and sampleTrackAtProgress / projectOntoTrack are consistent everywhere on the loop.
 */
function buildSplineSamples(
  controlPoints: [number, number][],
  hills: [number, number, number][],
  targetCount = SAMPLE_COUNT,
): { samples: TrackSample[]; totalLength: number } {
  const n = controlPoints.length;
  const denseSub = 40;
  const densePts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];
    for (let s = 0; s < denseSub; s++) {
      densePts.push(catmullRomPoint(p0, p1, p2, p3, s / denseSub));
    }
  }

  const denseLen = densePts.length;
  const cumArc: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i <= denseLen; i++) {
    const prev = densePts[i - 1];
    const curr = densePts[i % denseLen];
    totalLength += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    cumArc.push(totalLength);
  }

  const rawPts: [number, number][] = [];
  let cursor = 0;
  for (let k = 0; k < targetCount; k++) {
    const targetS = (k / targetCount) * totalLength;
    while (cursor < denseLen - 1 && cumArc[cursor + 1] < targetS) {
      cursor++;
    }
    const s0 = cumArc[cursor];
    const s1 = cumArc[cursor + 1];
    const frac = s1 > s0 ? (targetS - s0) / (s1 - s0) : 0;
    const a = densePts[cursor];
    const b = densePts[(cursor + 1) % denseLen];
    rawPts.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
  }

  const m = rawPts.length;
  const ds = totalLength / m;
  const samples: TrackSample[] = [];
  for (let i = 0; i < m; i++) {
    const prev = rawPts[(i - 1 + m) % m];
    const next = rawPts[(i + 1) % m];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    // Right-hand normal in XZ plane (+n is the right side of the road when facing +tangent)
    const nx = -tz;
    const nz = tx;
    const angle = Math.atan2(tx, tz);
    const progress = i / m;
    // Whole-number wave counts keep the elevation seamless around the loop; the grid straddles
    // progress 0, so hills fade out around the start line.
    const startFade = Math.min(1, Math.min(progress, 1 - progress) / 0.06);
    const y = hills.reduce((sum, [waves, amp, phase]) => sum + Math.sin(progress * Math.PI * 2 * waves + phase) * amp, 0) * startFade * startFade;
    samples.push({
      x: rawPts[i][0],
      y,
      z: rawPts[i][1],
      tx,
      tz,
      nx,
      nz,
      angle,
      curvature: 0,
      bank: 0,
      s: progress * totalLength,
      progress,
    });
  }

  // Smoothed signed curvature (rad per world unit) and corner camber
  const raw = samples.map((_, i) => {
    const prev = samples[(i - 2 + m) % m];
    const next = samples[(i + 2) % m];
    return wrapAngle(next.angle - prev.angle) / (4 * ds);
  });
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let o = -3; o <= 3; o++) sum += raw[(i + o + m) % m];
    samples[i].curvature = sum / 7;
  }
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let o = -6; o <= 6; o++) sum += samples[(i + o + m) % m].curvature;
    samples[i].bank = Math.max(-0.14, Math.min(0.14, (sum / 13) * 9));
  }

  return { samples, totalLength };
}

export function sampleTrackAtProgress(track: Pick<KartTrack, 'samples' | 'totalLength'>, rawProgress: number): TrackSample {
  const p = ((rawProgress % 1) + 1) % 1;
  const m = track.samples.length;
  const exact = p * m;
  const i0 = Math.floor(exact) % m;
  const i1 = (i0 + 1) % m;
  const frac = exact - Math.floor(exact);
  const a = track.samples[i0];
  const b = track.samples[i1];

  const x = a.x + (b.x - a.x) * frac;
  const z = a.z + (b.z - a.z) * frac;
  const tx = a.tx + (b.tx - a.tx) * frac;
  const tz = a.tz + (b.tz - a.tz) * frac;
  const tLen = Math.hypot(tx, tz) || 1;
  const nTx = tx / tLen;
  const nTz = tz / tLen;
  return {
    x,
    y: a.y + (b.y - a.y) * frac,
    z,
    tx: nTx,
    tz: nTz,
    nx: -nTz,
    nz: nTx,
    angle: Math.atan2(nTx, nTz),
    curvature: a.curvature + (b.curvature - a.curvature) * frac,
    bank: a.bank + (b.bank - a.bank) * frac,
    s: p * track.totalLength,
    progress: p,
  };
}

/** Road surface height at a lateral offset from the centerline at this progress. */
export function trackHeightAt(track: Pick<KartTrack, 'samples' | 'totalLength'>, progress: number, lateral: number): number {
  const s = sampleTrackAtProgress(track, progress);
  return s.y + Math.sin(s.bank) * lateral;
}

function wrapProgressDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

/** Smooth raised-cosine envelope (0..1) inside a split section, tapering to 0 at both ends. */
export function splitEnvelope(progress: number, split: SplitSectionDef): number {
  const p = ((progress % 1) + 1) % 1;
  if (split.startProgress <= split.endProgress) {
    if (p < split.startProgress || p > split.endProgress) return 0;
    const t = (p - split.startProgress) / Math.max(1e-6, split.endProgress - split.startProgress);
    return 0.5 - 0.5 * Math.cos(Math.PI * 2 * t);
  }
  // Wrap-around support
  const span = 1 - split.startProgress + split.endProgress;
  let rel = -1;
  if (p >= split.startProgress) rel = p - split.startProgress;
  else if (p <= split.endProgress) rel = 1 - split.startProgress + p;
  if (rel < 0) return 0;
  const t = rel / Math.max(1e-6, span);
  return 0.5 - 0.5 * Math.cos(Math.PI * 2 * t);
}

/** Road/barrier/divider bounds at a given progress, accounting for split-path widenings. */
export function getTrackBoundsAt(
  track: Pick<KartTrack, 'roadWidth' | 'wallWidth' | 'splitSections'>,
  progress: number,
): {
  halfRoad: number;
  wallWidth: number;
  dividerHalf: number;
  upperSide: -1 | 1 | 0;
  upperLift: number;
  split: SplitSectionDef | null;
} {
  const p = ((progress % 1) + 1) % 1;
  let activeSplit: SplitSectionDef | null = null;
  let env = 0;
  for (const s of track.splitSections) {
    const e = splitEnvelope(p, s);
    if (e > env) {
      env = e;
      activeSplit = s;
    }
  }
  const baseHalf = track.roadWidth * 0.5;
  if (!activeSplit || env <= 0) {
    return {
      halfRoad: baseHalf,
      wallWidth: track.wallWidth,
      dividerHalf: 0,
      upperSide: 0,
      upperLift: 0,
      split: null,
    };
  }
  return {
    halfRoad: baseHalf + activeSplit.extraHalfWidth * env,
    wallWidth: track.wallWidth + activeSplit.extraHalfWidth * env,
    dividerHalf: activeSplit.dividerHalfWidth * env,
    upperSide: activeSplit.upperSide ?? 0,
    upperLift: activeSplit.upperSide ? 4.8 * env : 0,
    split: activeSplit,
  };
}

export function isShortcutWallOpening(
  track: Pick<KartTrack, 'shortcuts'>,
  progress: number,
  side: -1 | 1,
): boolean {
  const p = ((progress % 1) + 1) % 1;
  return track.shortcuts.some(
    (sc) => sc.side === side && (wrapProgressDist(p, sc.entryProgress) <= 0.015 || wrapProgressDist(p, sc.exitProgress) <= 0.015),
  );
}

/**
 * The nearest point on a shortcut path within `reach` × its width (true distance, so a kart off
 * either end of the path does not match). `only` limits it to one shortcut, and with
 * `reach: Infinity` always finds that shortcut's nearest point (for a kart already on it).
 */
export function projectOntoShortcut(
  track: Pick<KartTrack, 'shortcuts'>,
  x: number,
  z: number,
  opts: { only?: string | null; reach?: number } = {},
): { shortcut: ShortcutDef; point: ShortcutPoint; dist: number; lateral: number; t: number } | null {
  const reach = opts.reach ?? 0.65;
  let best: { shortcut: ShortcutDef; point: ShortcutPoint; dist: number; lateral: number; t: number } | null = null;
  for (const sc of track.shortcuts) {
    if (opts.only && sc.id !== opts.only) continue;
    const pts = sc.points;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const lenSq = sx * sx + sz * sz || 1;
      const u = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / lenSq));
      const px = a.x + sx * u;
      const py = a.y + (b.y - a.y) * u;
      const pz = a.z + sz * u;
      const tx = a.tx + (b.tx - a.tx) * u;
      const tz = a.tz + (b.tz - a.tz) * u;
      const tLen = Math.hypot(tx, tz) || 1;
      const nTx = tx / tLen;
      const nTz = tz / tLen;
      const nx = -nTz;
      const nz = nTx;
      const dx = x - px;
      const dz = z - pz;
      const dist = Math.hypot(dx, dz);
      const lateral = dx * nx + dz * nz;
      if (dist < sc.width * reach && (!best || dist < best.dist)) {
        best = {
          shortcut: sc,
          point: {
            x: px,
            y: py,
            z: pz,
            progress: a.progress + (b.progress - a.progress) * u,
            tx: nTx,
            tz: nTz,
            nx,
            nz,
          },
          dist,
          lateral,
          t: (i + u) / (pts.length - 1),
        };
      }
    }
  }
  return best;
}

export function getMovingHazardPosition(
  track: Pick<KartTrack, 'samples' | 'totalLength' | 'roadWidth' | 'wallWidth' | 'splitSections'>,
  f: TrackFeatureDef,
  raceTimeSec: number,
): { x: number; y: number; z: number; lateralOffset: number; angle: number } {
  const s = sampleTrackAtProgress(track, f.progress);
  const bounds = getTrackBoundsAt(track, f.progress);
  const patrol = f.patrolWidth ?? 0.72;
  const speed = f.speed ?? 1.6;
  const phase = f.phase ?? 0;
  const lateralOffset = Math.sin(raceTimeSec * speed + phase) * bounds.halfRoad * patrol;
  const lift = bounds.upperSide !== 0 && Math.sign(lateralOffset) === bounds.upperSide ? bounds.upperLift : 0;
  return {
    x: s.x + s.nx * lateralOffset,
    y: s.y + Math.sin(s.bank) * lateralOffset + lift,
    z: s.z + s.nz * lateralOffset,
    lateralOffset,
    angle: s.angle,
  };
}

/** Road surface height at a progress and lateral offset, including a split's raised deck. */
export function roadSurfaceY(
  track: Pick<KartTrack, 'samples' | 'totalLength' | 'roadWidth' | 'wallWidth' | 'splitSections'>,
  progress: number,
  lateral: number,
): number {
  const s = sampleTrackAtProgress(track, progress);
  const b = getTrackBoundsAt(track, progress);
  const lift = b.upperSide !== 0 && Math.sign(lateral) === b.upperSide ? b.upperLift : 0;
  return s.y + Math.sin(s.bank) * lateral + lift;
}

export const BOOST_PAD_WIDTH = 7.4;
export const BOOST_PAD_LENGTH = 10;

/**
 * A boost pad as a grid of points laid on the road (it follows the camber, hills and a raised
 * deck instead of being a flat card that sinks into one side). `u` runs across the pad (0 on the
 * left), `v` along it (0 at the back).
 */
export function boostPadSurface(
  track: Pick<KartTrack, 'samples' | 'totalLength' | 'roadWidth' | 'wallWidth' | 'splitSections'>,
  pad: Pick<BoostPadDef, 'progress' | 'lateral'>,
  opts: { cols?: number; rows?: number; lift?: number } = {},
): { cols: number; rows: number; points: { x: number; y: number; z: number; u: number; v: number }[] } {
  const cols = opts.cols ?? 4;
  const rows = opts.rows ?? 6;
  const lift = opts.lift ?? 0.12;
  const center = pad.lateral * getTrackBoundsAt(track, pad.progress).halfRoad;
  const points: { x: number; y: number; z: number; u: number; v: number }[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const p = pad.progress + ((v - 0.5) * BOOST_PAD_LENGTH) / track.totalLength;
    const s = sampleTrackAtProgress(track, p);
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const lat = center + (u - 0.5) * BOOST_PAD_WIDTH;
      points.push({
        x: s.x + s.nx * lat,
        y: roadSurfaceY(track, p, lat) + lift,
        z: s.z + s.nz * lat,
        u,
        v,
      });
    }
  }
  return { cols, rows, points };
}

export function projectOntoTrack(
  track: KartTrack,
  x: number,
  z: number,
  hintSampleIdx?: number,
): {
  sampleIdx: number;
  progress: number;
  lateralOffset: number;
  distanceToCenter: number;
  sample: TrackSample;
} {
  const m = track.samples.length;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  const scan = (idx: number) => {
    const s = track.samples[idx];
    const dx = x - s.x;
    const dz = z - s.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = idx;
    }
  };

  if (typeof hintSampleIdx === 'number' && hintSampleIdx >= 0 && hintSampleIdx < m) {
    // A local window keeps karts on their own stretch of road where sections run close together
    const window = 36;
    for (let offset = -window; offset <= window; offset++) scan((hintSampleIdx + offset + m) % m);
    if (bestDistSq > track.wallWidth * track.wallWidth * 2.6) {
      for (let idx = 0; idx < m; idx++) scan(idx);
    }
  } else {
    for (let idx = 0; idx < m; idx++) scan(idx);
  }

  const sample = track.samples[bestIdx];
  const dx = x - sample.x;
  const dz = z - sample.z;
  const lateralOffset = dx * sample.nx + dz * sample.nz;
  const alongOffset = dx * sample.tx + dz * sample.tz;
  const rawProgress = sample.progress + alongOffset / track.totalLength;
  const progress = ((rawProgress % 1) + 1) % 1;

  return {
    sampleIdx: bestIdx,
    progress,
    lateralOffset,
    distanceToCenter: Math.sqrt(bestDistSq),
    sample,
  };
}

function createTrack(config: {
  id: TrackId;
  name: string;
  emoji: string;
  tagline: string;
  difficulty: KartTrack['difficulty'];
  roadWidth: number;
  wallWidth: number;
  friction: number;
  biome: TrackBiome;
  theme: KartTrack['theme'];
  music: KartTrack['music'];
  controlPoints: [number, number][];
  hills: [number, number, number][];
  boosts: { progress: number; lateral: number }[];
  itemRows: number[];
  ramps: number[];
  splitSections: SplitSectionDef[];
  shortcuts: Omit<ShortcutDef, 'points'>[];
  features: {
    kind: TrackFeatureKind;
    progress: number;
    lateral: number;
    patrolWidth?: number;
    speed?: number;
    phase?: number;
    radius?: number;
    label?: string;
  }[];
}): KartTrack {
  const controlPoints = config.controlPoints.map(([x, z]): [number, number] => [x * TRACK_SCALE, z * TRACK_SCALE]);
  const { samples, totalLength } = buildSplineSamples(controlPoints, config.hills);
  const at = (progress: number) => sampleTrackAtProgress({ samples, totalLength }, progress);
  const boundsAt = (progress: number) =>
    getTrackBoundsAt({ roadWidth: config.roadWidth, wallWidth: config.wallWidth, splitSections: config.splitSections }, progress);

  const surfaceYAt = (progress: number, lateralOffset: number) => {
    const s = at(progress);
    const b = boundsAt(progress);
    const lift = b.upperSide !== 0 && Math.sign(lateralOffset) === b.upperSide ? b.upperLift : 0;
    return s.y + Math.sin(s.bank) * lateralOffset + lift;
  };

  const boostPads: BoostPadDef[] = config.boosts.map((bp, i) => {
    const s = at(bp.progress);
    const b = boundsAt(bp.progress);
    let offset = bp.lateral * b.halfRoad;
    if (b.dividerHalf > 0.5 && Math.abs(offset) < b.dividerHalf + 2.5) {
      const side = Math.sign(bp.lateral) || 1;
      offset = side * (b.dividerHalf + (b.halfRoad - b.dividerHalf) * 0.5);
    }
    return {
      id: `boost_${i}`,
      progress: bp.progress,
      lateral: offset / b.halfRoad,
      x: s.x + s.nx * offset,
      y: surfaceYAt(bp.progress, offset),
      z: s.z + s.nz * offset,
      angle: s.angle,
    };
  });

  const itemBoxes: ItemBoxSpawnDef[] = [];
  config.itemRows.forEach((rowP) => {
    const s = at(rowP);
    const b = boundsAt(rowP);
    const lats = b.dividerHalf > 0.5 ? [-0.78, -0.52, 0.52, 0.78] : [-0.66, -0.22, 0.22, 0.66];
    for (const lat of lats) {
      const offset = lat * b.halfRoad;
      itemBoxes.push({
        id: `box_${itemBoxes.length}`,
        progress: rowP,
        lateral: lat,
        x: s.x + s.nx * offset,
        y: surfaceYAt(rowP, offset),
        z: s.z + s.nz * offset,
      });
    }
  });

  const ramps: RampDef[] = config.ramps.map((progress, i) => {
    const s = at(progress);
    return { id: `ramp_${i}`, progress, x: s.x, y: s.y, z: s.z, angle: s.angle };
  });

  const features: TrackFeatureDef[] = config.features.map((f, i) => {
    const s = at(f.progress);
    const b = boundsAt(f.progress);
    const offset = f.lateral * b.halfRoad;
    return {
      id: `feat_${i}`,
      kind: f.kind,
      progress: f.progress,
      lateral: f.lateral,
      x: s.x + s.nx * offset,
      y: surfaceYAt(f.progress, offset),
      z: s.z + s.nz * offset,
      angle: s.angle,
      patrolWidth: f.patrolWidth,
      speed: f.speed,
      phase: f.phase,
      radius: f.radius,
      label: f.label,
    };
  });

  const shortcuts: ShortcutDef[] = config.shortcuts.map((sc) => {
    const entryS = at(sc.entryProgress);
    const exitS = at(sc.exitProgress);
    const entryB = boundsAt(sc.entryProgress);
    const exitB = boundsAt(sc.exitProgress);
    const p0x = entryS.x + entryS.nx * sc.side * (entryB.wallWidth * 0.9);
    const p0y = entryS.y + Math.sin(entryS.bank) * sc.side * (entryB.wallWidth * 0.9);
    const p0z = entryS.z + entryS.nz * sc.side * (entryB.wallWidth * 0.9);
    const p2x = exitS.x + exitS.nx * sc.side * (exitB.wallWidth * 0.9);
    const p2y = exitS.y + Math.sin(exitS.bank) * sc.side * (exitB.wallWidth * 0.9);
    const p2z = exitS.z + exitS.nz * sc.side * (exitB.wallWidth * 0.9);
    const midP = (sc.entryProgress + sc.exitProgress) * 0.5;
    const midS = at(midP);
    // Chord midpoint pulled slightly inside the bend so the path stays crisp and clear of main walls
    const chordMidX = (p0x + p2x) * 0.5;
    const chordMidZ = (p0z + p2z) * 0.5;
    const p1x = chordMidX + midS.nx * sc.side * 6;
    const p1y = (p0y + p2y) * 0.5 + (sc.kind === 'hidden-ramp' ? 2.5 : 0);
    const p1z = chordMidZ + midS.nz * sc.side * 6;

    const count = SHORTCUT_POINT_COUNT;
    const rawPts: { x: number; y: number; z: number; progress: number }[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const omt = 1 - t;
      const rampLift =
        sc.kind === 'hidden-ramp' && i >= HIDDEN_RAMP_START_INDEX && i <= HIDDEN_RAMP_TOP_INDEX
          ? ((i - HIDDEN_RAMP_START_INDEX) / (HIDDEN_RAMP_TOP_INDEX - HIDDEN_RAMP_START_INDEX)) * HIDDEN_RAMP_LIFT
          : 0;
      rawPts.push({
        x: omt * omt * p0x + 2 * omt * t * p1x + t * t * p2x,
        y: omt * omt * p0y + 2 * omt * t * p1y + t * t * p2y + rampLift,
        z: omt * omt * p0z + 2 * omt * t * p1z + t * t * p2z,
        progress: sc.entryProgress + (sc.exitProgress - sc.entryProgress) * t,
      });
    }
    const points: ShortcutPoint[] = rawPts.map((pt, i) => {
      const prev = rawPts[Math.max(0, i - 1)];
      const next = rawPts[Math.min(count - 1, i + 1)];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      return {
        x: pt.x,
        y: pt.y,
        z: pt.z,
        progress: pt.progress,
        tx,
        tz,
        nx: -tz,
        nz: tx,
      };
    });
    return { ...sc, points };
  });

  const megaRamps = config.features.filter((f) => f.kind === 'mega_ramp').map((f) => f.progress);
  const allRampProgresses = [...config.ramps, ...megaRamps];
  const inSplit = (p: number) => config.splitSections.some((s) => splitEnvelope(p, s) > 0.02);

  const isCoinSpotClear = (p: number) =>
    p >= 0.04 &&
    p <= 0.93 &&
    !inSplit(p) &&
    config.itemRows.every((r) => wrapProgressDist(p, r) >= 0.02) &&
    allRampProgresses.every((r) => wrapProgressDist(p, r) >= 0.025);

  const validStarts: number[] = [];
  for (let p = 0.04; p <= 0.908 + 1e-9; p += 0.002) {
    const pRound = Math.round(p * 1000) / 1000;
    if (isCoinSpotClear(pRound) && isCoinSpotClear(pRound + 0.011) && isCoinSpotClear(pRound + 0.022)) {
      validStarts.push(pRound);
    }
  }

  const pickStarts = (minSpacing: number): number[] => {
    const chosen: number[] = [];
    for (const p of validStarts) {
      if (chosen.length === 0 || p - chosen[chosen.length - 1] >= minSpacing) {
        chosen.push(p);
      }
    }
    return chosen;
  };

  let groupStarts = pickStarts(0.068);
  if (groupStarts.length < 9) groupStarts = pickStarts(0.042);
  if (groupStarts.length > 10) {
    const targetGroups = 10;
    groupStarts = Array.from({ length: targetGroups }, (_, i) =>
      groupStarts[Math.floor((i * groupStarts.length) / targetGroups)],
    );
  }

  const straightOffsets = [0, 0.3, -0.3];
  const coins: CoinSpawnDef[] = [];
  groupStarts.forEach((baseP, gIdx) => {
    const straightLat = straightOffsets[gIdx % straightOffsets.length];
    for (let c = 0; c < 3; c++) {
      const progress = Math.round((baseP + c * 0.011) * 10000) / 10000;
      const s = at(progress);
      const b = boundsAt(progress);
      const lat = Math.abs(s.curvature) > 0.004 ? -Math.sign(s.curvature) * 0.45 : straightLat;
      const offset = lat * b.halfRoad;
      coins.push({
        id: `coin_${coins.length}`,
        progress,
        lateral: lat,
        x: s.x + s.nx * offset,
        y: surfaceYAt(progress, offset),
        z: s.z + s.nz * offset,
      });
    }
  });

  // Add coins on BOTH branches of each split section
  for (const split of config.splitSections) {
    const mid = (split.startProgress + split.endProgress) * 0.5;
    for (const side of [-1, 1] as const) {
      for (const offsetP of [-0.016, 0, 0.016]) {
        const progress = Math.round((mid + offsetP) * 10000) / 10000;
        const s = at(progress);
        const b = boundsAt(progress);
        const laneCenter = side * (b.dividerHalf + (b.halfRoad - b.dividerHalf) * 0.5);
        coins.push({
          id: `coin_${coins.length}`,
          progress,
          lateral: laneCenter / b.halfRoad,
          x: s.x + s.nx * laneCenter,
          y: surfaceYAt(progress, laneCenter),
          z: s.z + s.nz * laneCenter,
        });
      }
    }
  }

  // Add coins along each hidden shortcut
  for (const sc of shortcuts) {
    for (const idx of [4, 8, 12, 16]) {
      const pt = sc.points[idx];
      if (!pt) continue;
      coins.push({
        id: `coin_${coins.length}`,
        progress: pt.progress,
        lateral: 0,
        x: pt.x,
        y: pt.y,
        z: pt.z,
      });
    }
  }

  return {
    id: config.id,
    name: config.name,
    emoji: config.emoji,
    tagline: config.tagline,
    difficulty: config.difficulty,
    roadWidth: config.roadWidth,
    wallWidth: config.wallWidth,
    friction: config.friction,
    biome: config.biome,
    theme: config.theme,
    music: config.music,
    controlPoints,
    samples,
    totalLength,
    boostPads,
    itemBoxes,
    ramps,
    coins: coins.slice(0, 45),
    splitSections: config.splitSections,
    shortcuts,
    features,
  };
}

export const KART_TRACKS: Record<TrackId, KartTrack> = {
  'sunny-circuit': createTrack({
    id: 'sunny-circuit',
    name: 'Sunny Circuit',
    emoji: '🌴',
    tagline: 'A wide seaside speedway with a kink on the back straight and an easy jump over the dunes',
    difficulty: 'Easy',
    roadWidth: 38,
    wallWidth: 30,
    friction: 1.0,
    biome: 'beach',
    theme: {
      skyTop: '#1d7fe0',
      skyHorizon: '#cdeeff',
      fog: '#bfe6fb',
      fogDensity: 0.0011,
      sun: '#fff6d8',
      sunDir: [0.45, 0.75, 0.35],
      ambient: '#dff1ff',
      groundLow: '#e9d38f',
      groundHigh: '#3fa34d',
      shoulder: '#58b65a',
      roadColor: '#4a5160',
      roadGrain: '#5c6474',
      roadStripeColor: '#ffffff',
      curbColorA: '#ef3b3b',
      curbColorB: '#ffffff',
      wallColor: '#2f8fe0',
      wallTop: '#ffffff',
      wallHeight: 2.2,
      accentColor: '#22c55e',
    },
    music: { root: 60, bpm: 138, chords: [[0, 4, 7], [5, 9, 12], [9, 12, 16], [7, 11, 14]], lead: [12, 16, 19, 16, 14, 12, 9, 12] },
    controlPoints: [
      [0, -210], [0, -50], [0, 110], [45, 245], [175, 315], [340, 285], [440, 165], [390, 35],
      [290, -25], [310, -145], [420, -225], [405, -360], [265, -430], [110, -405], [15, -330],
    ],
    hills: [[2, 3.5, 0.6], [3, 1.6, 2.1]],
    boosts: [
      { progress: 0.1, lateral: 0.3 },
      { progress: 0.28, lateral: -0.65 },
      { progress: 0.34, lateral: -0.65 },
      { progress: 0.43, lateral: -0.3 },
      { progress: 0.62, lateral: 0.0 },
      { progress: 0.78, lateral: 0.3 },
      { progress: 0.91, lateral: -0.25 },
    ],
    itemRows: [0.06, 0.23, 0.32, 0.5, 0.74, 0.86, 0.95],
    ramps: [0.17, 0.89],
    splitSections: [
      {
        id: 'palm-oasis',
        name: 'Palm Oasis',
        startProgress: 0.24,
        endProgress: 0.39,
        extraHalfWidth: 16,
        dividerHalfWidth: 7,
        theme: 'island',
        leftPerk: 'boosts',
        rightPerk: 'boxes',
      },
    ],
    shortcuts: [
      {
        id: 'dune-cut',
        name: 'Dune Cut',
        entryProgress: 0.65,
        exitProgress: 0.77,
        side: -1,
        width: 14,
        kind: 'offroad-cut',
      },
    ],
    features: [
      { kind: 'moving_hazard', progress: 0.12, lateral: 0, patrolWidth: 0.7, speed: 1.5, phase: 0.2, radius: 3.0, label: '🦀 CRAB PINCHED!' },
      { kind: 'boost_ring', progress: 0.48, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.79, lateral: 0, patrolWidth: 0.72, speed: 1.75, phase: 2.1, radius: 3.0, label: '🦀 CRAB PINCHED!' },
      { kind: 'mega_ramp', progress: 0.83, lateral: 0 },
    ],
  }),

  'canyon-driftway': createTrack({
    id: 'canyon-driftway',
    name: 'Canyon Driftway',
    emoji: '🏜️',
    tagline: 'Sunset hairpins between red mesas, built for chaining long Super Mini-Turbos',
    difficulty: 'Medium',
    roadWidth: 34,
    wallWidth: 27,
    friction: 0.97,
    biome: 'canyon',
    theme: {
      skyTop: '#5b2a86',
      skyHorizon: '#ffb26b',
      fog: '#f4a36a',
      fogDensity: 0.0014,
      sun: '#ffd3a1',
      sunDir: [-0.7, 0.42, 0.45],
      ambient: '#ffd9c2',
      groundLow: '#c8743d',
      groundHigh: '#8c3b1f',
      shoulder: '#d8955a',
      roadColor: '#4b3b35',
      roadGrain: '#5e4a41',
      roadStripeColor: '#fcd34d',
      curbColorA: '#f97316',
      curbColorB: '#fef3c7',
      wallColor: '#a4492a',
      wallTop: '#e8a15f',
      wallHeight: 4.5,
      accentColor: '#f59e0b',
    },
    music: { root: 57, bpm: 132, chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]], lead: [12, 15, 17, 15, 12, 10, 12, 7] },
    controlPoints: [
      [0, -170], [0, -30], [10, 100], [75, 190], [175, 175], [205, 80], [175, -25], [225, -105],
      [320, -75], [355, 40], [420, 135], [530, 110], [570, 0], [535, -130], [510, -250],
      [420, -335], [295, -320], [175, -350], [60, -310],
    ],
    hills: [[3, 5, 1.2], [5, 2, 0.4]],
    boosts: [
      { progress: 0.07, lateral: -0.3 },
      { progress: 0.26, lateral: 0.25 },
      { progress: 0.42, lateral: 0.3 },
      { progress: 0.63, lateral: -0.65 },
      { progress: 0.69, lateral: -0.65 },
      { progress: 0.81, lateral: 0.25 },
      { progress: 0.91, lateral: 0.0 },
    ],
    itemRows: [0.11, 0.24, 0.4, 0.56, 0.66, 0.79, 0.94],
    ramps: [0.14, 0.45],
    splitSections: [
      {
        id: 'twin-mesa',
        name: 'Twin Mesa',
        startProgress: 0.58,
        endProgress: 0.74,
        extraHalfWidth: 16,
        dividerHalfWidth: 7.5,
        upperSide: -1,
        theme: 'mesa-pillar',
        leftPerk: 'fast',
        rightPerk: 'coins',
      },
    ],
    shortcuts: [
      {
        id: 'bandit-tunnel',
        name: 'Bandit Tunnel',
        entryProgress: 0.29,
        exitProgress: 0.4,
        side: 1,
        width: 14,
        kind: 'boost-gate',
      },
    ],
    features: [
      { kind: 'boost_ring', progress: 0.26, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.49, lateral: 0, patrolWidth: 0.72, speed: 1.65, phase: 0.7, radius: 3.1, label: '🪨 BOULDER SMASH!' },
      { kind: 'moving_hazard', progress: 0.84, lateral: 0, patrolWidth: 0.7, speed: 1.9, phase: 2.5, radius: 3.1, label: '🪨 BOULDER SMASH!' },
      { kind: 'mega_ramp', progress: 0.88, lateral: 0 },
    ],
  }),

  'frostbite-peak': createTrack({
    id: 'frostbite-peak',
    name: 'Frostbite Peak',
    emoji: '❄️',
    tagline: 'Long icy straights and sliding chicanes under the mountain, the grip is not your friend',
    difficulty: 'Hard',
    roadWidth: 34,
    wallWidth: 27,
    friction: 0.82,
    biome: 'snow',
    theme: {
      skyTop: '#2b5da8',
      skyHorizon: '#d8ecfb',
      fog: '#d9e9f5',
      fogDensity: 0.0017,
      sun: '#ffffff',
      sunDir: [0.3, 0.6, -0.65],
      ambient: '#dbeeff',
      groundLow: '#f4f9ff',
      groundHigh: '#a8c0d8',
      shoulder: '#e8f2fb',
      roadColor: '#5f7c95',
      roadGrain: '#8aa5bb',
      roadStripeColor: '#e0f7ff',
      curbColorA: '#06b6d4',
      curbColorB: '#f0f9ff',
      wallColor: '#8fd3f0',
      wallTop: '#ffffff',
      wallHeight: 3,
      accentColor: '#67e8f9',
    },
    music: { root: 62, bpm: 128, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], lead: [19, 15, 12, 15, 17, 14, 10, 14] },
    controlPoints: [
      [0, -220], [0, -80], [0, 70], [0, 220], [30, 310], [120, 345], [205, 300], [220, 205],
      [175, 120], [220, 40], [320, 25], [420, 55], [495, 10], [500, -90], [425, -160],
      [310, -180], [205, -205], [145, -285], [75, -345], [10, -310],
    ],
    hills: [[2, 7, 2.4], [4, 2.5, 0.9]],
    boosts: [
      { progress: 0.09, lateral: 0.0 },
      { progress: 0.23, lateral: -0.25 },
      { progress: 0.38, lateral: 0.3 },
      { progress: 0.57, lateral: -0.2 },
      { progress: 0.73, lateral: 0.65 },
      { progress: 0.78, lateral: 0.65 },
      { progress: 0.9, lateral: 0.0 },
    ],
    itemRows: [0.05, 0.14, 0.28, 0.36, 0.59, 0.75, 0.93],
    ramps: [0.17, 0.87],
    splitSections: [
      {
        id: 'glacier-crevasse',
        name: 'Glacier Crevasse',
        startProgress: 0.69,
        endProgress: 0.81,
        extraHalfWidth: 16,
        dividerHalfWidth: 7,
        upperSide: 1,
        theme: 'ice-bridge',
        leftPerk: 'boxes',
        rightPerk: 'boosts',
      },
    ],
    shortcuts: [
      {
        id: 'ice-cave',
        name: 'Ice Cave',
        entryProgress: 0.41,
        exitProgress: 0.5,
        side: 1,
        width: 14,
        kind: 'boost-gate',
      },
    ],
    features: [
      { kind: 'boost_ring', progress: 0.09, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.12, lateral: 0, patrolWidth: 0.72, speed: 1.55, phase: 0.4, radius: 3.1, label: '⛄ SNOWBALLED!' },
      { kind: 'mega_ramp', progress: 0.54, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.64, lateral: 0, patrolWidth: 0.7, speed: 1.85, phase: 1.9, radius: 3.1, label: '⛄ SNOWBALLED!' },
    ],
  }),

  'neon-starway': createTrack({
    id: 'neon-starway',
    name: 'Neon Starway',
    emoji: '🌈',
    tagline: 'A narrow rainbow ribbon through deep space with blind jumps and no margin for error',
    difficulty: 'Expert',
    roadWidth: 30,
    wallWidth: 24,
    friction: 1.0,
    biome: 'space',
    theme: {
      skyTop: '#04031a',
      skyHorizon: '#2a1266',
      fog: '#160b3a',
      fogDensity: 0.0009,
      sun: '#d8c8ff',
      sunDir: [0.2, 0.9, 0.3],
      ambient: '#b9a8ff',
      groundLow: '#090520',
      groundHigh: '#1a0d45',
      shoulder: '#17103f',
      roadColor: '#241a5c',
      roadGrain: '#34277a',
      roadStripeColor: '#f472b6',
      curbColorA: '#ec4899',
      curbColorB: '#22d3ee',
      wallColor: '#7c3aed',
      wallTop: '#22d3ee',
      wallHeight: 1.5,
      accentColor: '#facc15',
      rainbowRoad: true,
      glowRoad: true,
    },
    music: { root: 64, bpm: 150, chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [3, 7, 10]], lead: [12, 19, 24, 19, 15, 22, 19, 15] },
    controlPoints: [
      [0, -170], [0, -40], [35, 75], [-30, 180], [25, 285], [140, 275], [205, 175], [305, 195],
      [400, 255], [490, 180], [465, 85], [375, 5], [465, -80], [475, -190], [370, -255],
      [265, -225], [195, -175], [115, -235], [40, -280],
    ],
    hills: [[3, 9, 0.2], [5, 3.5, 1.7]],
    boosts: [
      { progress: 0.06, lateral: 0.3 },
      { progress: 0.26, lateral: -0.3 },
      { progress: 0.39, lateral: 0.0 },
      { progress: 0.55, lateral: 0.25 },
      { progress: 0.71, lateral: -0.65 },
      { progress: 0.77, lateral: -0.65 },
      { progress: 0.84, lateral: 0.2 },
      { progress: 0.91, lateral: -0.25 },
    ],
    itemRows: [0.1, 0.2, 0.3, 0.53, 0.66, 0.74, 0.84, 0.95],
    ramps: [0.27, 0.365],
    splitSections: [
      {
        id: 'twin-star-ribbons',
        name: 'Twin Star Ribbons',
        startProgress: 0.67,
        endProgress: 0.82,
        extraHalfWidth: 14.5,
        dividerHalfWidth: 6.5,
        upperSide: -1,
        theme: 'neon-split',
        leftPerk: 'boosts',
        rightPerk: 'fast',
      },
    ],
    shortcuts: [
      {
        id: 'starlight-warp',
        name: 'Starlight Warp',
        entryProgress: 0.42,
        exitProgress: 0.53,
        side: -1,
        width: 13.5,
        kind: 'hidden-ramp',
      },
    ],
    features: [
      { kind: 'boost_ring', progress: 0.06, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.22, lateral: 0, patrolWidth: 0.72, speed: 1.75, phase: 0.5, radius: 3.0, label: '🛸 UFO ZAP!' },
      { kind: 'mega_ramp', progress: 0.625, lateral: 0 },
      { kind: 'boost_ring', progress: 0.8, lateral: 0.65 },
      { kind: 'moving_hazard', progress: 0.89, lateral: 0, patrolWidth: 0.7, speed: 2.0, phase: 2.4, radius: 3.0, label: '🛸 UFO ZAP!' },
    ],
  }),

  'volcano-inferno': createTrack({
    id: 'volcano-inferno',
    name: 'Volcano Inferno',
    emoji: '🌋',
    tagline: 'A lap around an erupting crater over lava rivers, with drift chicanes along the rim',
    difficulty: 'Expert',
    roadWidth: 32,
    wallWidth: 26,
    friction: 0.96,
    biome: 'lava',
    theme: {
      skyTop: '#1c0606',
      skyHorizon: '#c2410c',
      fog: '#5a1a0a',
      fogDensity: 0.0019,
      sun: '#ffb38a',
      sunDir: [-0.35, 0.6, -0.55],
      ambient: '#ffb199',
      groundLow: '#2a1512',
      groundHigh: '#4a2219',
      shoulder: '#36201b',
      roadColor: '#3a3236',
      roadGrain: '#4c4247',
      roadStripeColor: '#fb923c',
      curbColorA: '#ef4444',
      curbColorB: '#facc15',
      wallColor: '#44241c',
      wallTop: '#f97316',
      wallHeight: 2.6,
      accentColor: '#f97316',
    },
    music: { root: 52, bpm: 144, chords: [[0, 3, 7], [1, 4, 8], [-2, 2, 5], [0, 3, 7]], lead: [12, 13, 15, 12, 10, 8, 7, 8] },
    controlPoints: [
      [0, -210], [0, -75], [-35, 45], [-120, 140], [-110, 265], [0, 345], [140, 360], [250, 290],
      [270, 180], [360, 110], [435, -5], [375, -120], [265, -145], [195, -225], [220, -340],
      [125, -410], [10, -355],
    ],
    hills: [[2, 4.5, 3.6], [3, 2.2, 0.5]],
    boosts: [
      { progress: 0.07, lateral: -0.3 },
      { progress: 0.21, lateral: 0.3 },
      { progress: 0.32, lateral: 0.65 },
      { progress: 0.37, lateral: 0.65 },
      { progress: 0.57, lateral: 0.0 },
      { progress: 0.8, lateral: -0.3 },
      { progress: 0.9, lateral: 0.25 },
    ],
    itemRows: [0.12, 0.22, 0.34, 0.48, 0.62, 0.71, 0.84, 0.95],
    ramps: [0.11, 0.86],
    splitSections: [
      {
        id: 'magma-caldera',
        name: 'Magma Caldera',
        startProgress: 0.27,
        endProgress: 0.4,
        extraHalfWidth: 15.5,
        dividerHalfWidth: 7,
        upperSide: 1,
        theme: 'lava-chasm',
        leftPerk: 'boxes',
        rightPerk: 'boosts',
      },
    ],
    shortcuts: [
      {
        id: 'obsidian-bridge',
        name: 'Obsidian Bridge',
        entryProgress: 0.68,
        exitProgress: 0.79,
        side: 1,
        width: 13.5,
        kind: 'boost-gate',
      },
    ],
    features: [
      { kind: 'moving_hazard', progress: 0.15, lateral: 0, patrolWidth: 0.7, speed: 1.7, phase: 0.3, radius: 3.0, label: '🌋 LAVA ERUPTION!' },
      { kind: 'boost_ring', progress: 0.21, lateral: 0 },
      { kind: 'mega_ramp', progress: 0.54, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.63, lateral: 0, patrolWidth: 0.72, speed: 1.95, phase: 2.2, radius: 3.0, label: '🌋 LAVA ERUPTION!' },
    ],
  }),

  'cyber-metro': createTrack({
    id: 'cyber-metro',
    name: 'Cyber Metropolis',
    emoji: '🌃',
    tagline: 'Hard city-block corners and rain-slick boulevards between towers of neon',
    difficulty: 'Hard',
    roadWidth: 33,
    wallWidth: 26,
    friction: 0.95,
    biome: 'city',
    theme: {
      skyTop: '#05061c',
      skyHorizon: '#47197a',
      fog: '#1c0f3f',
      fogDensity: 0.0016,
      sun: '#b7c8ff',
      sunDir: [0.4, 0.7, 0.3],
      ambient: '#a9b7ff',
      groundLow: '#0d1022',
      groundHigh: '#1a1b38',
      shoulder: '#1a1d36',
      roadColor: '#23263e',
      roadGrain: '#32365a',
      roadStripeColor: '#00f5ff',
      curbColorA: '#06b6d4',
      curbColorB: '#ec4899',
      wallColor: '#23263e',
      wallTop: '#00f5ff',
      wallHeight: 2.2,
      accentColor: '#38bdf8',
      glowRoad: true,
    },
    music: { root: 55, bpm: 146, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], lead: [12, 15, 19, 22, 19, 15, 12, 10] },
    controlPoints: [
      [0, -190], [0, -60], [0, 70], [20, 165], [100, 200], [200, 195], [265, 225], [290, 300],
      [365, 345], [470, 325], [510, 245], [515, 120], [515, -10], [480, -95], [395, -120],
      [290, -115], [215, -85], [150, -80], [110, -160], [115, -260], [65, -320], [10, -290],
    ],
    hills: [[2, 4, 1.0], [6, 1.4, 0.3]],
    boosts: [
      { progress: 0.07, lateral: 0.3 },
      { progress: 0.23, lateral: -0.3 },
      { progress: 0.36, lateral: 0.0 },
      { progress: 0.49, lateral: -0.65 },
      { progress: 0.55, lateral: -0.65 },
      { progress: 0.71, lateral: 0.3 },
      { progress: 0.84, lateral: -0.2 },
    ],
    itemRows: [0.05, 0.14, 0.25, 0.42, 0.52, 0.66, 0.76, 0.94],
    ramps: [0.09, 0.69],
    splitSections: [
      {
        id: 'skyline-flyover',
        name: 'Skyline Flyover',
        startProgress: 0.44,
        endProgress: 0.59,
        extraHalfWidth: 15.5,
        dividerHalfWidth: 7,
        upperSide: -1,
        theme: 'median',
        leftPerk: 'fast',
        rightPerk: 'boxes',
      },
    ],
    shortcuts: [
      {
        id: 'neon-alley',
        name: 'Neon Alley',
        entryProgress: 0.87,
        exitProgress: 0.96,
        side: -1,
        width: 14,
        kind: 'boost-gate',
      },
    ],
    features: [
      { kind: 'moving_hazard', progress: 0.13, lateral: 0, patrolWidth: 0.7, speed: 1.65, phase: 0.8, radius: 3.0, label: '🤖 DRONE SHOCK!' },
      { kind: 'boost_ring', progress: 0.22, lateral: 0 },
      { kind: 'mega_ramp', progress: 0.39, lateral: 0 },
      { kind: 'moving_hazard', progress: 0.63, lateral: 0, patrolWidth: 0.72, speed: 1.9, phase: 2.7, radius: 3.0, label: '🤖 DRONE SHOCK!' },
      { kind: 'boost_ring', progress: 0.73, lateral: 0 },
    ],
  }),
};

export const TRACK_LIST: KartTrack[] = [
  KART_TRACKS['sunny-circuit'],
  KART_TRACKS['canyon-driftway'],
  KART_TRACKS['frostbite-peak'],
  KART_TRACKS['neon-starway'],
  KART_TRACKS['volcano-inferno'],
  KART_TRACKS['cyber-metro'],
];
