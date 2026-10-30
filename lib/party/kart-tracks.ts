export type TrackId =
  | 'sunny-circuit'
  | 'canyon-driftway'
  | 'frostbite-peak'
  | 'neon-starway'
  | 'volcano-inferno'
  | 'cyber-metro';

export interface TrackSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  angle: number;
  curvature: number;
  bank?: number; // radians of road bank/camber into corner
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
  kind: 'palm' | 'cactus' | 'rock' | 'pine' | 'snowman' | 'neon-pillar' | 'star-ring' | 'lava-spire' | 'cyber-arch';
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
 * and sampleTrackAtProgress / projectOntoTrack are 100% consistent everywhere on the loop.
 */
function buildSplineSamples(
  controlPoints: [number, number][],
  targetCount = 240,
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

  // Resample at uniform arc-length steps around the closed loop
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
    // Right-hand normal in XZ plane (+nx is right side of road when facing +tangent)
    const nx = -tz;
    const nz = tx;
    const angle = Math.atan2(tx, tz);
    const s = (i / m) * totalLength;
    samples.push({
      x: rawPts[i][0],
      z: rawPts[i][1],
      tx,
      tz,
      nx,
      nz,
      angle,
      curvature: 0,
      bank: 0,
      s,
      progress: i / m,
    });
  }

  // Compute smoothed signed curvature (rad per world unit) and corner banking camber
  for (let i = 0; i < m; i++) {
    const prev = samples[(i - 2 + m) % m];
    const next = samples[(i + 2) % m];
    const curv = wrapAngle(next.angle - prev.angle) / (4 * ds);
    samples[i].curvature = curv;
    // Bank angle (radians): outside curb is elevated, inside is lowered into the curve
    samples[i].bank = Math.max(-0.24, Math.min(0.24, curv * 14));
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
    curvature: a.curvature + (b.curvature - a.curvature) * frac,
    bank: (a.bank ?? 0) + ((b.bank ?? 0) - (a.bank ?? 0)) * frac,
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
    // Search local window first (±22 samples), fallback to full search if far away
    const window = 22;
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
    if (bestDistSq > track.wallWidth * track.wallWidth * 2.2) {
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

  // Sub-sample projection along tangent for smooth continuous progress & lateral offset
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
    const offset = bp.lateral * (roadWidth * 0.38);
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
    for (const lat of [-0.52, -0.18, 0.18, 0.52]) {
      const offset = lat * (roadWidth * 0.42);
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
  const step = Math.max(1, Math.floor(samples.length / 44));
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i];
    for (const side of [-1, 1]) {
      if ((i + (side > 0 ? 1 : 0)) % 2 !== 0) continue;
      const dist = wallWidth + 12 + ((i * 17) % 24);
      const x = s.x + s.nx * side * dist;
      const z = s.z + s.nz * side * dist;
      let tooClose = false;
      for (let j = 0; j < samples.length; j += 6) {
        const other = samples[j];
        if (Math.hypot(x - other.x, z - other.z) < wallWidth + 7) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        const kind = (sceneryKind === 'lava-spire' && (i % 2 === 0))
          ? 'rock'
          : (sceneryKind === 'cyber-arch' && (i % 2 === 0))
          ? 'neon-pillar'
          : sceneryKind;
        scenery.push({
          x,
          z,
          kind,
          scale: 0.95 + ((i * 13) % 10) * 0.09,
          color: sceneryColors[i % sceneryColors.length],
        });
      }
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
  const { samples, totalLength } = buildSplineSamples(config.controlPoints, 240);
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
    tagline: 'Wide tropical beach speedway with sweeping banked curves & boost pads',
    difficulty: 'Easy',
    roadWidth: 36,
    wallWidth: 28,
    friction: 1.0,
    theme: {
      skyTop: '#0284c7',
      skyBottom: '#bae6fd',
      groundColor: '#15803d',
      roadColor: '#334155',
      roadStripeColor: '#f8fafc',
      curbColorA: '#ef4444',
      curbColorB: '#ffffff',
      wallColor: '#0ea5e9',
      accentColor: '#22c55e',
    },
    controlPoints: [
      [0, -150],
      [0, -25],
      [30, 95],
      [120, 155],
      [220, 120],
      [260, 0],
      [230, -110],
      [240, -200],
      [145, -268],
      [35, -245],
    ],
    boostProgresses: [
      { progress: 0.16, lateral: 0.25 },
      { progress: 0.46, lateral: -0.22 },
      { progress: 0.78, lateral: 0.0 },
    ],
    itemRowProgresses: [0.1, 0.36, 0.64, 0.88],
    sceneryKind: 'palm',
    sceneryColors: ['#16a34a', '#22c55e', '#4ade80'],
  }),

  'canyon-driftway': createTrack({
    id: 'canyon-driftway',
    name: 'Canyon Driftway',
    emoji: '🏜️',
    tagline: 'Sunset red-rock bends built for charging Orange Super Mini-Turbos',
    difficulty: 'Medium',
    roadWidth: 34,
    wallWidth: 27,
    friction: 0.98,
    theme: {
      skyTop: '#7c2d12',
      skyBottom: '#fb923c',
      groundColor: '#9a3412',
      roadColor: '#292524',
      roadStripeColor: '#fcd34d',
      curbColorA: '#f97316',
      curbColorB: '#fef3c7',
      wallColor: '#ea580c',
      accentColor: '#f59e0b',
    },
    controlPoints: [
      [0, -155],
      [0, -20],
      [50, 95],
      [170, 145],
      [275, 85],
      [292, -25],
      [232, -100],
      [246, -192],
      [170, -268],
      [70, -272],
      [10, -232],
    ],
    boostProgresses: [
      { progress: 0.22, lateral: -0.28 },
      { progress: 0.52, lateral: 0.28 },
      { progress: 0.74, lateral: -0.2 },
      { progress: 0.91, lateral: 0.0 },
    ],
    itemRowProgresses: [0.12, 0.38, 0.62, 0.84],
    sceneryKind: 'cactus',
    sceneryColors: ['#15803d', '#d97706', '#b45309'],
  }),

  'frostbite-peak': createTrack({
    id: 'frostbite-peak',
    name: 'Frostbite Peak',
    emoji: '❄️',
    tagline: 'Alpine glacier speedway with fast straightaways & sweeping S-curves',
    difficulty: 'Hard',
    roadWidth: 34,
    wallWidth: 27,
    friction: 0.92,
    theme: {
      skyTop: '#0f172a',
      skyBottom: '#38bdf8',
      groundColor: '#cbd5e1',
      roadColor: '#1e293b',
      roadStripeColor: '#7dd3fc',
      curbColorA: '#06b6d4',
      curbColorB: '#f0f9ff',
      wallColor: '#38bdf8',
      accentColor: '#67e8f9',
    },
    controlPoints: [
      [0, -150],
      [0, -15],
      [-55, 85],
      [25, 175],
      [155, 175],
      [245, 85],
      [195, -25],
      [245, -125],
      [195, -225],
      [85, -255],
      [10, -225],
    ],
    boostProgresses: [
      { progress: 0.19, lateral: 0.0 },
      { progress: 0.42, lateral: -0.25 },
      { progress: 0.68, lateral: 0.25 },
      { progress: 0.89, lateral: 0.0 },
    ],
    itemRowProgresses: [0.11, 0.33, 0.56, 0.8],
    sceneryKind: 'pine',
    sceneryColors: ['#0f766e', '#0284c7', '#f8fafc'],
  }),

  'neon-starway': createTrack({
    id: 'neon-starway',
    name: 'Neon Starway',
    emoji: '🌈',
    tagline: 'Cosmic Rainbow Road highway in deep space with turbo star gates',
    difficulty: 'Expert',
    roadWidth: 34,
    wallWidth: 27,
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
      [0, -155],
      [0, -20],
      [45, 85],
      [60, 175],
      [150, 228],
      [258, 152],
      [282, 22],
      [208, -65],
      [248, -172],
      [168, -262],
      [58, -264],
      [6, -222],
    ],
    boostProgresses: [
      { progress: 0.14, lateral: 0.22 },
      { progress: 0.31, lateral: -0.22 },
      { progress: 0.5, lateral: 0.0 },
      { progress: 0.69, lateral: 0.25 },
      { progress: 0.86, lateral: -0.22 },
    ],
    itemRowProgresses: [0.09, 0.26, 0.44, 0.63, 0.82],
    sceneryKind: 'neon-pillar',
    sceneryColors: ['#f472b6', '#22d3ee', '#a855f7', '#facc15'],
  }),

  'volcano-inferno': createTrack({
    id: 'volcano-inferno',
    name: 'Volcano Inferno',
    emoji: '🌋',
    tagline: 'Molten basalt highway with bubbling magma rivers, basalt spires & extreme drift chicanes',
    difficulty: 'Expert',
    roadWidth: 34,
    wallWidth: 27,
    friction: 0.96,
    theme: {
      skyTop: '#450a0a',
      skyBottom: '#dc2626',
      groundColor: '#1c1917',
      roadColor: '#262626',
      roadStripeColor: '#f97316',
      curbColorA: '#ef4444',
      curbColorB: '#facc15',
      wallColor: '#ea580c',
      accentColor: '#f97316',
    },
    controlPoints: [
      [0, -160],
      [0, -30],
      [-70, 70],
      [-30, 160],
      [80, 180],
      [180, 140],
      [240, 40],
      [190, -40],
      [230, -130],
      [180, -220],
      [60, -250],
      [-10, -220],
    ],
    boostProgresses: [
      { progress: 0.12, lateral: -0.22 },
      { progress: 0.35, lateral: 0.25 },
      { progress: 0.58, lateral: 0.0 },
      { progress: 0.77, lateral: -0.22 },
      { progress: 0.92, lateral: 0.22 },
    ],
    itemRowProgresses: [0.08, 0.28, 0.52, 0.72, 0.88],
    sceneryKind: 'lava-spire',
    sceneryColors: ['#7f1d1d', '#991b1b', '#b91c1c', '#f97316'],
  }),

  'cyber-metro': createTrack({
    id: 'cyber-metro',
    name: 'Cyber Metropolis',
    emoji: '🌃',
    tagline: 'Midnight skyscraper canyons, high-speed overpasses & holographic lightspeed gates',
    difficulty: 'Hard',
    roadWidth: 35,
    wallWidth: 28,
    friction: 1.0,
    theme: {
      skyTop: '#020617',
      skyBottom: '#0f172a',
      groundColor: '#090d16',
      roadColor: '#0f172a',
      roadStripeColor: '#00f5ff',
      curbColorA: '#06b6d4',
      curbColorB: '#ec4899',
      wallColor: '#00f5ff',
      accentColor: '#38bdf8',
    },
    controlPoints: [
      [0, -150],
      [0, -10],
      [75, 90],
      [140, 170],
      [230, 170],
      [275, 80],
      [220, 0],
      [280, -90],
      [220, -190],
      [120, -260],
      [20, -240],
    ],
    boostProgresses: [
      { progress: 0.15, lateral: 0.25 },
      { progress: 0.38, lateral: -0.25 },
      { progress: 0.62, lateral: 0.0 },
      { progress: 0.83, lateral: 0.22 },
    ],
    itemRowProgresses: [0.10, 0.32, 0.55, 0.75, 0.90],
    sceneryKind: 'cyber-arch',
    sceneryColors: ['#00f5ff', '#ec4899', '#a855f7', '#38bdf8'],
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
