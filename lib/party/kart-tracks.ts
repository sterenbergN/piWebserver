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

/** A jump across the full road width. Crossing it launches the kart. */
export interface RampDef {
  id: string;
  progress: number;
  x: number;
  y: number;
  z: number;
  angle: number;
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
}

export const SAMPLE_COUNT = 360;

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
    samples[i].bank = Math.max(-0.14, Math.min(0.14, (sum / 13) * 7));
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
    const window = 24;
    for (let offset = -window; offset <= window; offset++) scan((hintSampleIdx + offset + m) % m);
    if (bestDistSq > track.wallWidth * track.wallWidth * 2.2) {
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
}): KartTrack {
  const { samples, totalLength } = buildSplineSamples(config.controlPoints, config.hills);
  const halfRoad = config.roadWidth * 0.5;
  const at = (progress: number) => sampleTrackAtProgress({ samples, totalLength }, progress);

  const boostPads: BoostPadDef[] = config.boosts.map((bp, i) => {
    const s = at(bp.progress);
    const offset = bp.lateral * halfRoad;
    return {
      id: `boost_${i}`,
      progress: bp.progress,
      lateral: bp.lateral,
      x: s.x + s.nx * offset,
      y: s.y + Math.sin(s.bank) * offset,
      z: s.z + s.nz * offset,
      angle: s.angle,
    };
  });

  const itemBoxes: ItemBoxSpawnDef[] = [];
  config.itemRows.forEach((rowP) => {
    const s = at(rowP);
    for (const lat of [-0.66, -0.22, 0.22, 0.66]) {
      const offset = lat * halfRoad;
      itemBoxes.push({
        id: `box_${itemBoxes.length}`,
        progress: rowP,
        lateral: lat,
        x: s.x + s.nx * offset,
        y: s.y + Math.sin(s.bank) * offset,
        z: s.z + s.nz * offset,
      });
    }
  });

  const ramps: RampDef[] = config.ramps.map((progress, i) => {
    const s = at(progress);
    return { id: `ramp_${i}`, progress, x: s.x, y: s.y, z: s.z, angle: s.angle };
  });

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
    controlPoints: config.controlPoints,
    samples,
    totalLength,
    boostPads,
    itemBoxes,
    ramps,
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
      [0, -170], [0, -40], [0, 90], [35, 195], [135, 250], [265, 225], [345, 130], [305, 25],
      [225, -25], [240, -115], [325, -180], [315, -285], [205, -345], [85, -330], [15, -270],
    ],
    hills: [[2, 3.5, 0.6], [3, 1.6, 2.1]],
    boosts: [
      { progress: 0.1, lateral: 0.3 },
      { progress: 0.4, lateral: -0.3 },
      { progress: 0.62, lateral: 0.0 },
      { progress: 0.84, lateral: -0.25 },
    ],
    itemRows: [0.06, 0.29, 0.5, 0.74, 0.93],
    ramps: [0.17],
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
      { progress: 0.42, lateral: 0.3 },
      { progress: 0.69, lateral: -0.2 },
      { progress: 0.86, lateral: 0.0 },
    ],
    itemRows: [0.11, 0.33, 0.56, 0.8],
    ramps: [0.63],
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
      { progress: 0.45, lateral: -0.3 },
      { progress: 0.66, lateral: 0.3 },
      { progress: 0.88, lateral: 0.0 },
    ],
    itemRows: [0.13, 0.36, 0.55, 0.78],
    ramps: [0.17],
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
      { progress: 0.5, lateral: 0.0 },
      { progress: 0.68, lateral: 0.3 },
      { progress: 0.89, lateral: -0.3 },
    ],
    itemRows: [0.1, 0.3, 0.47, 0.6, 0.83],
    ramps: [0.365, 0.625],
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
      [0, -190], [0, -70], [-30, 40], [-105, 125], [-95, 235], [0, 305], [125, 320], [220, 255],
      [240, 160], [320, 95], [385, -5], [330, -105], [235, -125], [175, -200], [195, -300],
      [110, -365], [10, -320],
    ],
    hills: [[2, 4.5, 3.6], [3, 2.2, 0.5]],
    boosts: [
      { progress: 0.07, lateral: -0.3 },
      { progress: 0.26, lateral: 0.3 },
      { progress: 0.55, lateral: 0.0 },
      { progress: 0.8, lateral: -0.3 },
    ],
    itemRows: [0.12, 0.22, 0.48, 0.71, 0.91],
    ramps: [0.305],
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
      { progress: 0.08, lateral: 0.3 },
      { progress: 0.28, lateral: -0.3 },
      { progress: 0.47, lateral: 0.0 },
      { progress: 0.68, lateral: 0.3 },
    ],
    itemRows: [0.11, 0.25, 0.42, 0.59, 0.78, 0.92],
    ramps: [0.53],
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
