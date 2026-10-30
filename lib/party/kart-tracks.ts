export type TrackId = 'sunny-circuit' | 'canyon-driftway' | 'frostbite-peak' | 'neon-starway';

export interface TrackSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  angle: number;
  s: number;
  progress: number;
}

export interface BoostPadDef {
  id: string;
  progress: number;
  lateral: number; // -0.6 to +0.6 of halfWidth
  x: number;
  z: number;
  angle: number;
}

export interface ItemBoxSpawnDef {
  id: string;
  progress: number;
  lateral: number;
  x: number;
  z: number;
}

export interface SceneryProp {
  x: number;
  z: number;
  kind: 'palm' | 'cactus' | 'rock' | 'pine' | 'snowman' | 'neon-pillar' | 'star-ring';
  scale: number;
  color: string;
}

export interface KartTrack {
  id: TrackId;
  name: string;
  emoji: string;
  tagline: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  roadWidth: number;
  wallWidth: number; // distance from centerline to outer bounce wall
  friction: number; // 1.0 = normal, <1.0 = icy/slippery
  theme: {
    skyTop: string;
    skyBottom: string;
    groundColor: string;
    roadColor: string;
    roadStripeColor: string;
    curbColorA: string;
    curbColorB: string;
    wallColor: string;
    accentColor: string;
    rainbowRoad?: boolean;
  };
  controlPoints: [number, number][];
  samples: TrackSample[];
  totalLength: number;
  boostPads: BoostPadDef[];
  itemBoxes: ItemBoxSpawnDef[];
  scenery: SceneryProp[];
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

function buildSplineSamples(controlPoints: [number, number][], subdivisionsPerSegment = 20): { samples: TrackSample[]; totalLength: number } {
  const n = controlPoints.length;
  const rawPts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];
    for (let s = 0; s < subdivisionsPerSegment; s++) {
      rawPts.push(catmullRomPoint(p0, p1, p2, p3, s / subdivisionsPerSegment));
    }
  }

  const m = rawPts.length;
  const cumulative: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i <= m; i++) {
    const prev = rawPts[i - 1];
    const curr = rawPts[i % m];
    const seg = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    totalLength += seg;
    if (i < m) cumulative.push(totalLength);
  }

  const samples: TrackSample[] = [];
  for (let i = 0; i < m; i++) {
    const prev = rawPts[(i - 1 + m) % m];
    const next = rawPts[(i + 1) % m];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    // Right-hand normal in XZ plane
    const nx = -tz;
    const nz = tx;
    const angle = Math.atan2(tx, tz);
    const s = cumulative[i];
    samples.push({
      x: rawPts[i][0],
      z: rawPts[i][1],
      tx,
      tz,
      nx,
      nz,
      angle,
      s,
      progress: s / totalLength,
    });
  }

  return { samples, totalLength };
}

export function sampleTrackAtProgress(track: KartTrack, rawProgress: number): TrackSample {
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
    z,
    tx: nTx,
    tz: nTz,
    nx: -nTz,
    nz: nTx,
    angle: Math.atan2(nTx, nTz),
    s: p * track.totalLength,
    progress: p,
  };
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

  if (typeof hintSampleIdx === 'number' && hintSampleIdx >= 0 && hintSampleIdx < m) {
    // Search local window first (±25 samples), fallback to full search if far away
    const window = 28;
    for (let offset = -window; offset <= window; offset++) {
      const idx = (hintSampleIdx + offset + m) % m;
      const s = track.samples[idx];
      const dx = x - s.x;
      const dz = z - s.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
    if (bestDistSq > track.wallWidth * track.wallWidth * 2.5) {
      for (let idx = 0; idx < m; idx++) {
        const s = track.samples[idx];
        const dx = x - s.x;
        const dz = z - s.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }
  } else {
    for (let idx = 0; idx < m; idx++) {
      const s = track.samples[idx];
      const dx = x - s.x;
      const dz = z - s.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
  }

  const sample = track.samples[bestIdx];
  const dx = x - sample.x;
  const dz = z - sample.z;
  const lateralOffset = dx * sample.nx + dz * sample.nz;
  return {
    sampleIdx: bestIdx,
    progress: sample.progress,
    lateralOffset,
    distanceToCenter: Math.sqrt(bestDistSq),
    sample,
  };
}

function buildTrackFeatures(
  samples: TrackSample[],
  totalLength: number,
  roadWidth: number,
  wallWidth: number,
  boostProgresses: { progress: number; lateral: number }[],
  itemRowProgresses: number[],
  sceneryKind: SceneryProp['kind'],
  sceneryColors: string[],
): {
  boostPads: BoostPadDef[];
  itemBoxes: ItemBoxSpawnDef[];
  scenery: SceneryProp[];
} {
  const dummyTrack = { samples, totalLength } as KartTrack;
  const boostPads: BoostPadDef[] = boostProgresses.map((bp, i) => {
    const s = sampleTrackAtProgress(dummyTrack, bp.progress);
    const offset = bp.lateral * (roadWidth * 0.45);
    return {
      id: `boost_${i}`,
      progress: bp.progress,
      lateral: bp.lateral,
      x: s.x + s.nx * offset,
      z: s.z + s.nz * offset,
      angle: s.angle,
    };
  });

  const itemBoxes: ItemBoxSpawnDef[] = [];
  let boxCounter = 0;
  for (const rowP of itemRowProgresses) {
    const s = sampleTrackAtProgress(dummyTrack, rowP);
    for (const lat of [-0.55, -0.18, 0.18, 0.55]) {
      const offset = lat * (roadWidth * 0.48);
      itemBoxes.push({
        id: `box_${boxCounter++}`,
        progress: rowP,
        lateral: lat,
        x: s.x + s.nx * offset,
        z: s.z + s.nz * offset,
      });
    }
  }

  const scenery: SceneryProp[] = [];
  const step = Math.max(1, Math.floor(samples.length / 36));
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i];
    const side = i % (step * 2) === 0 ? 1 : -1;
    const dist = wallWidth + 10 + ((i * 17) % 18);
    const x = s.x + s.nx * side * dist;
    const z = s.z + s.nz * side * dist;
    // Ensure scenery prop doesn't overlap another part of the track
    let tooClose = false;
    for (let j = 0; j < samples.length; j += 8) {
      const other = samples[j];
      if (Math.hypot(x - other.x, z - other.z) < wallWidth + 5) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      scenery.push({
        x,
        z,
        kind: sceneryKind,
        scale: 0.85 + ((i * 13) % 10) * 0.08,
        color: sceneryColors[i % sceneryColors.length],
      });
    }
  }

  return { boostPads, itemBoxes, scenery };
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
  theme: KartTrack['theme'];
  controlPoints: [number, number][];
  boostProgresses: { progress: number; lateral: number }[];
  itemRowProgresses: number[];
  sceneryKind: SceneryProp['kind'];
  sceneryColors: string[];
}): KartTrack {
  const { samples, totalLength } = buildSplineSamples(config.controlPoints, 22);
  const { boostPads, itemBoxes, scenery } = buildTrackFeatures(
    samples,
    totalLength,
    config.roadWidth,
    config.wallWidth,
    config.boostProgresses,
    config.itemRowProgresses,
    config.sceneryKind,
    config.sceneryColors,
  );
  return {
    id: config.id,
    name: config.name,
    emoji: config.emoji,
    tagline: config.tagline,
    difficulty: config.difficulty,
    roadWidth: config.roadWidth,
    wallWidth: config.wallWidth,
    friction: config.friction,
    theme: config.theme,
    controlPoints: config.controlPoints,
    samples,
    totalLength,
    boostPads,
    itemBoxes,
    scenery,
  };
}

export const KART_TRACKS: Record<TrackId, KartTrack> = {
  'sunny-circuit': createTrack({
    id: 'sunny-circuit',
    name: 'Sunny Circuit',
    emoji: '🌴',
    tagline: 'Wide tropical beach boardwalk with sweeping curves & boost pads',
    difficulty: 'Easy',
    roadWidth: 26,
    wallWidth: 38,
    friction: 1.0,
    theme: {
      skyTop: '#0284c7',
      skyBottom: '#bae6fd',
      groundColor: '#fde047',
      roadColor: '#334155',
      roadStripeColor: '#f8fafc',
      curbColorA: '#ef4444',
      curbColorB: '#ffffff',
      wallColor: '#0ea5e9',
      accentColor: '#22c55e',
    },
    controlPoints: [
      [0, -140],
      [0, -40],
      [15, 65],
      [95, 130],
      [185, 95],
      [210, 0],
      [165, -85],
      [195, -175],
      [120, -230],
      [20, -215],
    ],
    boostProgresses: [
      { progress: 0.16, lateral: 0.3 },
      { progress: 0.46, lateral: -0.25 },
      { progress: 0.78, lateral: 0.0 },
    ],
    itemRowProgresses: [0.1, 0.36, 0.64, 0.88],
    sceneryKind: 'palm',
    sceneryColors: ['#16a34a', '#15803d', '#22c55e'],
  }),

  'canyon-driftway': createTrack({
    id: 'canyon-driftway',
    name: 'Canyon Driftway',
    emoji: '🏜️',
    tagline: 'Sunset red-rock hairpins built for charging Orange Super Mini-Turbos',
    difficulty: 'Medium',
    roadWidth: 24,
    wallWidth: 35,
    friction: 0.96,
    theme: {
      skyTop: '#7c2d12',
      skyBottom: '#fb923c',
      groundColor: '#c2410c',
      roadColor: '#451a03',
      roadStripeColor: '#fcd34d',
      curbColorA: '#f97316',
      curbColorB: '#fef3c7',
      wallColor: '#9a3412',
      accentColor: '#f59e0b',
    },
    controlPoints: [
      [0, -150],
      [0, -35],
      [50, 75],
      [155, 115],
      [230, 45],
      [160, -25],
      [95, -5],
      [75, -85],
      [175, -145],
      [195, -225],
      [95, -255],
      [10, -225],
    ],
    boostProgresses: [
      { progress: 0.22, lateral: -0.35 },
      { progress: 0.52, lateral: 0.35 },
      { progress: 0.74, lateral: -0.2 },
      { progress: 0.91, lateral: 0.0 },
    ],
    itemRowProgresses: [0.12, 0.38, 0.62, 0.84],
    sceneryKind: 'cactus',
    sceneryColors: ['#15803d', '#b45309', '#92400e'],
  }),

  'frostbite-peak': createTrack({
    id: 'frostbite-peak',
    name: 'Frostbite Peak',
    emoji: '❄️',
    tagline: 'Slippery alpine glacier with fast straightaways & icy chicanes',
    difficulty: 'Hard',
    roadWidth: 24,
    wallWidth: 36,
    friction: 0.86, // Slippery ice feel
    theme: {
      skyTop: '#0f172a',
      skyBottom: '#38bdf8',
      groundColor: '#e0f2fe',
      roadColor: '#1e3a8a',
      roadStripeColor: '#7dd3fc',
      curbColorA: '#06b6d4',
      curbColorB: '#f0f9ff',
      wallColor: '#38bdf8',
      accentColor: '#67e8f9',
    },
    controlPoints: [
      [0, -145],
      [0, -30],
      [-55, 65],
      [15, 145],
      [125, 145],
      [205, 70],
      [150, -10],
      [215, -95],
      [175, -195],
      [80, -230],
      [5, -210],
    ],
    boostProgresses: [
      { progress: 0.19, lateral: 0.0 },
      { progress: 0.42, lateral: -0.3 },
      { progress: 0.68, lateral: 0.3 },
      { progress: 0.89, lateral: 0.0 },
    ],
    itemRowProgresses: [0.11, 0.33, 0.56, 0.8],
    sceneryKind: 'pine',
    sceneryColors: ['#0f766e', '#0369a1', '#e2e8f0'],
  }),

  'neon-starway': createTrack({
    id: 'neon-starway',
    name: 'Neon Starway',
    emoji: '🌈',
    tagline: 'Cosmic Rainbow Road highway in deep space with chaos item clusters',
    difficulty: 'Expert',
    roadWidth: 23,
    wallWidth: 33,
    friction: 1.0,
    theme: {
      skyTop: '#050510',
      skyBottom: '#1e1b4b',
      groundColor: '#090919',
      roadColor: '#1e1b4b',
      roadStripeColor: '#f472b6',
      curbColorA: '#ec4899',
      curbColorB: '#22d3ee',
      wallColor: '#a855f7',
      accentColor: '#facc15',
      rainbowRoad: true,
    },
    controlPoints: [
      [0, -150],
      [0, -30],
      [65, 55],
      [15, 135],
      [115, 185],
      [215, 115],
      [235, 5],
      [145, -55],
      [215, -140],
      [155, -235],
      [55, -245],
      [0, -215],
    ],
    boostProgresses: [
      { progress: 0.14, lateral: 0.25 },
      { progress: 0.31, lateral: -0.25 },
      { progress: 0.5, lateral: 0.0 },
      { progress: 0.69, lateral: 0.3 },
      { progress: 0.86, lateral: -0.25 },
    ],
    itemRowProgresses: [0.09, 0.26, 0.44, 0.63, 0.82],
    sceneryKind: 'neon-pillar',
    sceneryColors: ['#f472b6', '#22d3ee', '#a855f7', '#facc15'],
  }),
};

export const TRACK_LIST: KartTrack[] = [
  KART_TRACKS['sunny-circuit'],
  KART_TRACKS['canyon-driftway'],
  KART_TRACKS['frostbite-peak'],
  KART_TRACKS['neon-starway'],
];
