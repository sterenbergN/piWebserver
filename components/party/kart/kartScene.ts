// The TV's 3D renderer. One scene is rendered once per viewport, so everything static is merged
// or instanced to keep draw calls low enough for eight split screens on a modest machine.
// All art is generated in code: no asset files to host.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRIFT_TIER_COLORS, KartItemType } from '@/lib/party/kart-shared';
import {
  KartTrack,
  SplitSectionDef,
  TrackFeatureDef,
  getMovingHazardPosition,
  getTrackBoundsAt,
  isShortcutWallOpening,
  projectOntoShortcut,
  projectOntoTrack,
  sampleTrackAtProgress,
} from '@/lib/party/kart-tracks';
import type { KartEvent, KartTelemetrySnapshot } from '@/lib/party/kart-physics';

export type CameraMode = 'split' | 'leader' | 'helicopter' | 'action';
type SnapKart = KartTelemetrySnapshot['karts'][number];
type SnapHazard = KartTelemetrySnapshot['hazards'][number];

const IDEAL_TILE_ASPECT = 1.6;

/** Grid for the split screen, chosen to keep each tile close to a widescreen shape. */
export function computeSplitGrid(count: number, aspect = 16 / 9): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  let best = { cols: count, rows: 1 };
  let bestScore = Infinity;
  for (let cols = 1; cols <= Math.min(count, 4); cols++) {
    const rows = Math.ceil(count / cols);
    if (rows > 3) continue;
    const tileAspect = (aspect / cols) * rows;
    const wasted = cols * rows - count;
    const score = Math.abs(Math.log(tileAspect / IDEAL_TILE_ASPECT)) + wasted * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = { cols, rows };
    }
  }
  return best;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function valueNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const hash = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const fx = x - xi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, z * f) * amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, height = size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  draw(canvas.getContext('2d')!, size, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function colored(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

function placed(geo: THREE.BufferGeometry, x: number, y: number, z: number, opts?: { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(opts?.rx || 0, opts?.ry || 0, opts?.rz || 0)),
    new THREE.Vector3(opts?.sx ?? 1, opts?.sy ?? 1, opts?.sz ?? 1),
  );
  geo.applyMatrix4(m);
  return geo;
}

function merged(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!g) throw new Error('merge failed');
  return g;
}

type BoundsSlice = ReturnType<typeof getTrackBoundsAt>;

/** Dynamic per-sample ribbon supporting split widenings and elevated decks. */
function dynamicRibbon(
  track: KartTrack,
  getSlice: (s: KartTrack['samples'][number], b: BoundsSlice, i: number) => {
    offA: number;
    offB: number;
    yA: number;
    yB: number;
    uvA?: number;
    uvB?: number;
  },
  opts: { vScale?: number; length?: number; color?: (s: KartTrack['samples'][number], b: BoundsSlice, i: number) => THREE.Color } = {},
) {
  const samples = track.samples;
  const m = samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const vScale = opts.vScale ?? 40;
  for (let i = 0; i <= m; i++) {
    const s = samples[i % m];
    const b = getTrackBoundsAt(track, s.progress);
    const sl = getSlice(s, b, i % m);
    const sinB = Math.sin(s.bank);
    const v = (i / m) * Math.round((opts.length ?? 0) / vScale || 1);
    pos.push(s.x + s.nx * sl.offA, s.y + sinB * sl.offA + sl.yA, s.z + s.nz * sl.offA);
    pos.push(s.x + s.nx * sl.offB, s.y + sinB * sl.offB + sl.yB, s.z + s.nz * sl.offB);
    uv.push(sl.uvA ?? 0, v, sl.uvB ?? 1, v);
    if (opts.color) {
      const c = opts.color(s, b, i % m);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (i < m) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (opts.color) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Dynamic striped barrier supporting split widenings, elevated decks, and shortcut wall openings. */
function dynamicBarrier(
  track: KartTrack,
  getSpan: (b: BoundsSlice) => { inner: number; outer: number; yBottom: number; yTop: number; active: boolean },
  colorA: THREE.Color,
  colorB: THREE.Color,
  stripePeriod: number,
  skipSegment?: (s: KartTrack['samples'][number], b: BoundsSlice) => boolean,
) {
  const samples = track.samples;
  const m = samples.length;
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < m; i++) {
    const s0 = samples[i];
    const s1 = samples[(i + 1) % m];
    const b0 = getTrackBoundsAt(track, s0.progress);
    const b1 = getTrackBoundsAt(track, s1.progress);
    if (skipSegment && skipSegment(s0, b0)) continue;
    const sp0 = getSpan(b0);
    const sp1 = getSpan(b1);
    if (!sp0.active && !sp1.active) continue;
    const c = Math.floor(i / stripePeriod) % 2 === 0 ? colorA : colorB;
    const dark = c.clone().multiplyScalar(0.72);
    const p = (s: KartTrack['samples'][number], off: number, y: number, innerRef: number) => [
      s.x + s.nx * off,
      s.y + Math.sin(s.bank) * Math.min(Math.abs(off), Math.abs(innerRef)) * (Math.sign(off) || 1) + y,
      s.z + s.nz * off,
    ];
    const sign = Math.sign(sp0.inner + sp0.outer) || Math.sign(sp1.inner + sp1.outer) || 1;
    const near0 = sign > 0 ? sp0.inner : sp0.outer;
    const far0 = sign > 0 ? sp0.outer : sp0.inner;
    const near1 = sign > 0 ? sp1.inner : sp1.outer;
    const far1 = sign > 0 ? sp1.outer : sp1.inner;
    if (sign > 0) {
      quad(p(s0, near0, sp0.yTop, sp0.inner), p(s0, far0, sp0.yTop, sp0.inner), p(s1, near1, sp1.yTop, sp1.inner), p(s1, far1, sp1.yTop, sp1.inner), c);
      quad(p(s0, near0, sp0.yBottom, sp0.inner), p(s0, near0, sp0.yTop, sp0.inner), p(s1, near1, sp1.yBottom, sp1.inner), p(s1, near1, sp1.yTop, sp1.inner), dark);
      quad(p(s0, far0, sp0.yTop, sp0.inner), p(s0, far0, sp0.yBottom, sp0.inner), p(s1, far1, sp1.yTop, sp1.inner), p(s1, far1, sp1.yBottom, sp1.inner), dark);
    } else {
      quad(p(s0, far0, sp0.yTop, sp0.inner), p(s0, near0, sp0.yTop, sp0.inner), p(s1, far1, sp1.yTop, sp1.inner), p(s1, near1, sp1.yTop, sp1.inner), c);
      quad(p(s0, near0, sp0.yTop, sp0.inner), p(s0, near0, sp0.yBottom, sp0.inner), p(s1, near1, sp1.yTop, sp1.inner), p(s1, near1, sp1.yBottom, sp1.inner), dark);
      quad(p(s0, far0, sp0.yBottom, sp0.inner), p(s0, far0, sp0.yTop, sp0.inner), p(s1, far1, sp1.yBottom, sp1.inner), p(s1, far1, sp1.yTop, sp1.inner), dark);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// ─── Textures ────────────────────────────────────────────────────────────────

function makeRoadTexture(track: KartTrack) {
  const t = track.theme;
  const rng = mulberry32(hashString(track.id));
  const tex = canvasTexture(512, (ctx, w, h) => {
    if (t.rainbowRoad) {
      const bands = ['#ff3b5c', '#ff8a1f', '#ffe11f', '#3bf06b', '#1fd9ff', '#7a5bff', '#ff4fd8'];
      bands.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect((i / bands.length) * w, 0, w / bands.length + 1, h);
      });
      // Pulsing darker bars rolling down the road give a real sense of speed
      for (let y = 0; y < h; y += 128) {
        const g = ctx.createLinearGradient(0, y, 0, y + 128);
        g.addColorStop(0, 'rgba(10,0,40,0.5)');
        g.addColorStop(0.45, 'rgba(10,0,40,0.05)');
        g.addColorStop(1, 'rgba(10,0,40,0.5)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, w, 128);
      }
    } else {
      ctx.fillStyle = t.roadColor;
      ctx.fillRect(0, 0, w, h);
      // Asphalt grain
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = rng() > 0.5 ? t.roadGrain : 'rgba(0,0,0,0.25)';
        ctx.globalAlpha = 0.18 + rng() * 0.3;
        const s = 1 + rng() * 1.6;
        ctx.fillRect(rng() * w, rng() * h, s, s);
      }
      ctx.globalAlpha = 1;
      // Racing-line rubber and centre shading
      const across = ctx.createLinearGradient(0, 0, w, 0);
      across.addColorStop(0, 'rgba(255,255,255,0.05)');
      across.addColorStop(0.32, 'rgba(0,0,0,0.16)');
      across.addColorStop(0.5, 'rgba(0,0,0,0.02)');
      across.addColorStop(0.68, 'rgba(0,0,0,0.16)');
      across.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = across;
      ctx.fillRect(0, 0, w, h);
    }
    // Edge lines and dashed centre
    ctx.fillStyle = t.rainbowRoad ? 'rgba(255,255,255,0.95)' : t.roadStripeColor;
    ctx.fillRect(w * 0.022, 0, w * 0.018, h);
    ctx.fillRect(w * 0.96, 0, w * 0.018, h);
    ctx.fillRect(w * 0.492, 0, w * 0.016, h * 0.42);
    if (!t.rainbowRoad) {
      ctx.globalAlpha = 0.35;
      ctx.fillRect(w * 0.255, 0, w * 0.01, h * 0.2);
      ctx.fillRect(w * 0.255, h * 0.5, w * 0.01, h * 0.2);
      ctx.fillRect(w * 0.745, 0, w * 0.01, h * 0.2);
      ctx.fillRect(w * 0.745, h * 0.5, w * 0.01, h * 0.2);
      ctx.globalAlpha = 1;
    }
  });
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeNoiseTexture(seed: number, base = 200, spread = 55) {
  const rng = mulberry32(seed);
  const tex = canvasTexture(256, (ctx, w, h) => {
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      const v = Math.round(base + (rng() - 0.5) * spread * 2);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      const s = 1 + rng() * 3;
      ctx.fillRect(rng() * w, rng() * h, s, s);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePlanetTexture() {
  return canvasTexture(512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3b1d7a');
    g.addColorStop(0.2, '#7c3aed');
    g.addColorStop(0.38, '#c084fc');
    g.addColorStop(0.52, '#f472b6');
    g.addColorStop(0.66, '#6d28d9');
    g.addColorStop(0.84, '#22d3ee');
    g.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const rng = mulberry32(4242);
    for (let i = 0; i < 42; i++) {
      const y = rng() * h;
      const bh = 3 + rng() * 14;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(15,10,45,0.22)';
      ctx.fillRect(0, y, w, bh);
    }
    // Great storm eye
    const sg = ctx.createRadialGradient(w * 0.62, h * 0.56, 2, w * 0.62, h * 0.56, 36);
    sg.addColorStop(0, 'rgba(254,240,138,0.85)');
    sg.addColorStop(0.5, 'rgba(244,114,182,0.55)');
    sg.addColorStop(1, 'rgba(244,114,182,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(w * 0.62, h * 0.56, 42, 22, -0.15, 0, Math.PI * 2);
    ctx.fill();
  }, 256);
}

function makePlanetRingTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const bands: [number, number, string][] = [
      [0.29, 0.34, 'rgba(167,139,250,0.45)'],
      [0.345, 0.39, 'rgba(244,114,182,0.75)'],
      [0.405, 0.445, 'rgba(56,189,248,0.68)'],
      [0.455, 0.49, 'rgba(250,204,21,0.5)'],
    ];
    for (const [r0, r1, col] of bands) {
      ctx.strokeStyle = col;
      ctx.lineWidth = (r1 - r0) * w;
      ctx.beginPath();
      ctx.arc(cx, cy, ((r0 + r1) * 0.5) * w, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function makeChevronTexture(colorA: string, colorB: string, bg: string) {
  const tex = canvasTexture(128, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    for (let row = -1; row < 3; row++) {
      ctx.fillStyle = row % 2 === 0 ? colorA : colorB;
      ctx.beginPath();
      const y = (row * h) / 2;
      ctx.moveTo(0, y + h * 0.5);
      ctx.lineTo(w * 0.5, y);
      ctx.lineTo(w, y + h * 0.5);
      ctx.lineTo(w, y + h);
      ctx.lineTo(w * 0.5, y + h * 0.5);
      ctx.lineTo(0, y + h);
      ctx.closePath();
      ctx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeItemBoxTexture() {
  return canvasTexture(128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ff4fd8');
    g.addColorStop(0.33, '#ffe11f');
    g.addColorStop(0.66, '#3bf06b');
    g.addColorStop(1, '#1fd9ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 88px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.fillText('?', w / 2, h / 2 + 4);
  });
}

function makeBlobTexture(inner = 'rgba(0,0,0,0.62)', outer = 'rgba(0,0,0,0)') {
  return canvasTexture(64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.55, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function makeEmojiTexture(emoji: string) {
  return canvasTexture(128, (ctx, w, h) => {
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, w / 2, h / 2 + 6);
  });
}

function makeNameTagTexture(name: string, color: string, isBot: boolean) {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.font = '800 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = name.length > 12 ? `${name.slice(0, 11)}…` : name;
    const textW = Math.min(w - 16, ctx.measureText(label).width + 28);
    ctx.fillStyle = isBot ? 'rgba(8,10,20,0.55)' : 'rgba(8,10,20,0.85)';
    ctx.beginPath();
    ctx.roundRect((w - textW) / 2, 6, textW, h - 12, 20);
    ctx.fill();
    if (!isBot) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.fillStyle = isBot ? '#cbd5e1' : '#ffffff';
    ctx.fillText(label, w / 2, h / 2 + 2);
  }, 64);
}

function makeWindowTexture(seed: number, tint: string) {
  const rng = mulberry32(seed);
  const tex = canvasTexture(128, (ctx, w, h) => {
    ctx.fillStyle = '#0a0d1e';
    ctx.fillRect(0, 0, w, h);
    const cols = 10;
    const rows = 20;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rng() < 0.42) continue;
        ctx.fillStyle = rng() < 0.3 ? tint : rng() < 0.5 ? '#ffd27a' : '#7fd8ff';
        ctx.globalAlpha = 0.45 + rng() * 0.55;
        ctx.fillRect((x + 0.15) * (w / cols), (y + 0.2) * (h / rows), (w / cols) * 0.7, (h / rows) * 0.55);
      }
    }
    ctx.globalAlpha = 1;
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ─── Terrain ─────────────────────────────────────────────────────────────────

interface TerrainInfo {
  mesh: THREE.Mesh | null;
  heightAt: (x: number, z: number) => number;
  nearestDist: (x: number, z: number) => number;
  center: { x: number; z: number };
  volcanoRadius: number;
}

function buildTerrain(track: KartTrack, noiseTex: THREE.Texture): TerrainInfo {
  const samples = track.samples;
  const coarse = samples.filter((_, i) => i % 3 === 0);
  const xs = samples.map((s) => s.x);
  const zs = samples.map((s) => s.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const center = { x: samples.reduce((a, s) => a + s.x, 0) / samples.length, z: samples.reduce((a, s) => a + s.z, 0) / samples.length };

  const nearest = (x: number, z: number) => {
    let best = Infinity;
    let y = 0;
    let wallWidth = track.wallWidth;
    for (const s of coarse) {
      const d = (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z);
      if (d < best) {
        best = d;
        y = s.y;
        wallWidth = getTrackBoundsAt(track, s.progress).wallWidth;
      }
    }
    return { dist: Math.sqrt(best), y, wallWidth };
  };

  const volcanoRadius = track.biome === 'lava' ? Math.max(40, nearest(center.x, center.z).dist - track.wallWidth - 14) : 0;
  const biome = track.biome;

  const heightAt = (x: number, z: number) => {
    const { dist, y, wallWidth: wall } = nearest(x, z);
    const n = fbm(x * 0.006 + 11, z * 0.006 - 7);
    const n2 = fbm(x * 0.02 - 3, z * 0.02 + 5, 3);
    const near = smoothstep(wall + 2, wall + 70, dist);
    const ring = smoothstep(90, 420, dist);
    let h = 0;
    switch (biome) {
      case 'beach': {
        // Dunes near the track fall away to the sea, with hazy headlands beyond
        const coast = (n - 0.5) * 60 + 2 - ring * 26 + smoothstep(330, 620, dist) * 90 * Math.max(0, n2 - 0.35);
        h = coast + n2 * 5;
        break;
      }
      case 'canyon': {
        // Terraced mesas rising straight off the shoulder
        const raw = (n * 1.4 + n2 * 0.25) * 110 * near + ring * 70 * n;
        h = Math.floor(raw / 16) * 16 + (raw % 16) * 0.22;
        break;
      }
      case 'snow': {
        const ridge = 1 - Math.abs(fbm(x * 0.004 + 40, z * 0.004 + 9) * 2 - 1);
        h = near * (n2 * 12 + n * 24) + ring * ridge * ridge * 300;
        break;
      }
      case 'lava': {
        // Low ground dips under the lava so the course runs between glowing rivers
        h = near * (n * 62 - 36) + ring * 110 * n * n + n2 * 3 * near;
        const cd = Math.hypot(x - center.x, z - center.z);
        if (volcanoRadius > 0 && cd < volcanoRadius) {
          const cone = (1 - cd / volcanoRadius) * volcanoRadius * 1.15;
          const craterR = volcanoRadius * 0.2;
          h = Math.max(h, cd < craterR ? (volcanoRadius * 1.15 * (1 - craterR / volcanoRadius)) - (craterR - cd) * 1.4 : cone) + n2 * 3;
        }
        break;
      }
      case 'city': {
        h = -1.5 + n2 * 0.6;
        break;
      }
      default:
        h = -40;
    }
    // Sink the ground below the road, widened splits, and hidden shortcuts
    const sc = projectOntoShortcut(track, x, z);
    if (sc && sc.dist < sc.shortcut.width * 0.85) {
      return Math.min(sc.point.y - 2.2, (y - 6.5));
    }
    const blend = smoothstep(wall + 2, wall + 26, dist);
    return (y - 6.5) * (1 - blend) + (h + y * (1 - ring)) * blend;
  };

  if (biome === 'space') {
    return { mesh: null, heightAt: () => -60, nearestDist: (x, z) => nearest(x, z).dist, center, volcanoRadius: 0 };
  }

  const margin = 560;
  const span = Math.max(maxX - minX, maxZ - minZ) + margin * 2;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const res = 240;
  const geo = new THREE.PlaneGeometry(span, span, res, res);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, cz);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(track.theme.groundLow);
  const high = new THREE.Color(track.theme.groundHigh);
  const tmp = new THREE.Color();
  const rock = new THREE.Color(biome === 'snow' ? '#7f93a8' : biome === 'lava' ? '#17100e' : biome === 'canyon' ? '#6e2f18' : '#5c6b4a');
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    heights[i] = h;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const h = heights[i];
    const slope = 1 - normals.getY(i);
    const n = fbm(pos.getX(i) * 0.05, pos.getZ(i) * 0.05, 2);
    let t: number;
    if (biome === 'beach') t = smoothstep(-1, 9, h + (n - 0.5) * 8);
    else if (biome === 'snow') t = smoothstep(0.05, 0.4, slope) * 0.8;
    else if (biome === 'canyon') t = (Math.sin(h * 0.35) + 1) * 0.5;
    else t = smoothstep(-5, 40, h);
    tmp.copy(low).lerp(high, t);
    tmp.lerp(rock, smoothstep(0.32, 0.7, slope) * (biome === 'beach' ? 0.5 : 0.85));
    tmp.multiplyScalar(0.86 + n * 0.28);
    if (biome === 'snow' && h > 90) tmp.lerp(new THREE.Color('#ffffff'), smoothstep(90, 150, h));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  (geo.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 60, uv.getY(i) * 60);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: noiseTex }));
  return { mesh, heightAt, nearestDist: (x, z) => nearest(x, z).dist, center, volcanoRadius };
}

// ─── Scenery props (instanced) ───────────────────────────────────────────────

function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const trunkSegs = 4;
  for (let i = 0; i < trunkSegs; i++) {
    const t = i / trunkSegs;
    parts.push(colored(placed(new THREE.CylinderGeometry(0.42 - t * 0.14, 0.52 - t * 0.14, 2.8, 6), t * t * 1.6, 1.4 + i * 2.6, 0, { rz: -t * 0.18 }), i % 2 ? '#8a6238' : '#9c7443'));
  }
  const topX = 1.0;
  const topY = 11;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const frond = new THREE.ConeGeometry(0.9, 6.4, 4);
    frond.scale(1, 1, 0.22);
    parts.push(colored(placed(frond, topX + Math.cos(a) * 2.7, topY + 0.1, Math.sin(a) * 2.7, { ry: -a, rz: -1.72 }), i % 2 ? '#2fa84f' : '#3cc463'));
  }
  parts.push(colored(placed(new THREE.SphereGeometry(0.55, 6, 5), topX, topY - 0.3, 0.4), '#7a4a1f'));
  return merged(parts);
}

function rockGeometry(color: string) {
  const g = new THREE.DodecahedronGeometry(2.6, 0);
  g.scale(1.25, 0.8, 1);
  return colored(placed(g, 0, 1.4, 0), color);
}

function cactusGeometry() {
  const c = '#3f8f4a';
  return merged([
    colored(placed(new THREE.CapsuleGeometry(0.62, 6.4, 3, 8), 0, 3.8, 0), c),
    colored(placed(new THREE.CapsuleGeometry(0.42, 1.4, 3, 8), 1.05, 4.2, 0, { rz: Math.PI / 2 }), c),
    colored(placed(new THREE.CapsuleGeometry(0.42, 2.2, 3, 8), 1.9, 5.3, 0), c),
    colored(placed(new THREE.CapsuleGeometry(0.38, 1.2, 3, 8), -1.0, 3.2, 0, { rz: Math.PI / 2 }), c),
    colored(placed(new THREE.CapsuleGeometry(0.38, 1.8, 3, 8), -1.7, 4.2, 0), c),
  ]);
}

function pineGeometry() {
  return merged([
    colored(placed(new THREE.CylinderGeometry(0.4, 0.6, 3, 6), 0, 1.5, 0), '#5a3b22'),
    colored(placed(new THREE.ConeGeometry(4, 6, 8), 0, 5, 0), '#1f6650'),
    colored(placed(new THREE.ConeGeometry(3.3, 5, 8), 0, 8.2, 0), '#2a7a60'),
    colored(placed(new THREE.ConeGeometry(2.4, 4.4, 8), 0, 11, 0), '#e8f4fb'),
    colored(placed(new THREE.ConeGeometry(4.05, 1.2, 8), 0, 3.0, 0), '#f4faff'),
  ]);
}

function snowmanGeometry() {
  return merged([
    colored(placed(new THREE.SphereGeometry(1.7, 10, 8), 0, 1.5, 0), '#ffffff'),
    colored(placed(new THREE.SphereGeometry(1.2, 10, 8), 0, 3.7, 0), '#ffffff'),
    colored(placed(new THREE.SphereGeometry(0.85, 10, 8), 0, 5.3, 0), '#ffffff'),
    colored(placed(new THREE.ConeGeometry(0.2, 1.1, 6), 0, 5.3, 1.1, { rx: Math.PI / 2 }), '#f97316'),
    colored(placed(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 10), 0, 6.0, 0), '#111827'),
    colored(placed(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 10), 0, 6.5, 0), '#111827'),
  ]);
}

function crystalGeometry(color: string) {
  return merged([
    colored(placed(new THREE.OctahedronGeometry(2.4, 0), 0, 6, 0, { sy: 2.4 }), color),
    colored(placed(new THREE.OctahedronGeometry(1.3, 0), 2.2, 3.5, 1, { sy: 2 }), color),
  ]);
}

function lavaSpireGeometry() {
  return merged([
    colored(placed(new THREE.ConeGeometry(3.4, 15, 6), 0, 7.5, 0), '#1d1412'),
    colored(placed(new THREE.ConeGeometry(1.2, 4, 6), 0, 13.6, 0), '#ff6a1f'),
    colored(placed(new THREE.ConeGeometry(2.1, 8, 5), 2.6, 4, 1, { rz: -0.1 }), '#2a1a16'),
  ]);
}

function deadTreeGeometry() {
  const c = '#2a1c16';
  return merged([
    colored(placed(new THREE.CylinderGeometry(0.28, 0.5, 6, 5), 0, 3, 0), c),
    colored(placed(new THREE.CylinderGeometry(0.1, 0.22, 3, 4), 1, 5.6, 0, { rz: -0.8 }), c),
    colored(placed(new THREE.CylinderGeometry(0.1, 0.2, 2.6, 4), -0.9, 6, 0.4, { rz: 0.9 }), c),
  ]);
}

function umbrellaGeometry() {
  return merged([
    colored(placed(new THREE.CylinderGeometry(0.1, 0.1, 4, 5), 0, 2, 0), '#f8fafc'),
    colored(placed(new THREE.ConeGeometry(2.6, 1.1, 8), 0, 4.4, 0), '#f43f5e'),
  ]);
}

function flagGeometry() {
  return merged([
    colored(placed(new THREE.CylinderGeometry(0.1, 0.13, 8, 5), 0, 4, 0), '#e2e8f0'),
    colored(placed(new THREE.ConeGeometry(0.9, 2.8, 3), 1.2, 7, 0, { rz: -Math.PI / 2, sz: 0.1 }), '#ffffff'),
  ]);
}

function lampGeometry() {
  return merged([
    colored(placed(new THREE.CylinderGeometry(0.12, 0.18, 10, 5), 0, 5, 0), '#39405e'),
    colored(placed(new THREE.BoxGeometry(0.22, 0.22, 2.6), 0, 10, -1.2), '#39405e'),
  ]);
}

function signGeometry() {
  return merged([
    colored(placed(new THREE.CylinderGeometry(0.14, 0.18, 3, 5), -1.4, 1.5, 0), '#64748b'),
    colored(placed(new THREE.CylinderGeometry(0.14, 0.18, 3, 5), 1.4, 1.5, 0), '#64748b'),
  ]);
}

function sailboatGeometry() {
  return merged([
    colored(placed(new THREE.BoxGeometry(3.2, 1.1, 8.6), 0, 0.6, 0), '#f8fafc'),
    colored(placed(new THREE.ConeGeometry(1.65, 3.2, 4), 0, 0.6, 5.4, { rx: Math.PI / 2, ry: Math.PI / 4 }), '#0ea5e9'),
    colored(placed(new THREE.CylinderGeometry(0.14, 0.18, 12, 5), 0, 6.8, -0.4), '#cbd5e1'),
    colored(placed(new THREE.ConeGeometry(3.4, 9.6, 3), 0, 7.6, -1.6, { sz: 0.12 }), '#ffffff'),
    colored(placed(new THREE.ConeGeometry(2.1, 7.2, 3), 0, 6.2, 2.0, { sz: 0.1 }), '#38bdf8'),
  ]);
}

function findStraightawaySpots(track: KartTrack, count: number) {
  const m = track.samples.length;
  const wall = track.wallWidth;
  const candidates: number[] = [];
  for (let i = 0; i < m; i++) {
    const s = track.samples[i];
    if (s.progress < 0.08 || s.progress > 0.9) continue;
    if (Math.abs(s.curvature) > 0.0052) continue;
    const clearRamp = track.ramps.every((r) => {
      const d = Math.abs(s.progress - r.progress);
      return Math.min(d, 1 - d) > 0.045;
    });
    if (!clearRamp) continue;
    const clearItem = track.itemBoxes.every((b) => {
      const d = Math.abs(s.progress - b.progress);
      return Math.min(d, 1 - d) > 0.025;
    });
    if (!clearItem) continue;
    const legOff = wall + 4.8;
    const lx = s.x - s.nx * legOff;
    const lz = s.z - s.nz * legOff;
    const rx = s.x + s.nx * legOff;
    const rz = s.z + s.nz * legOff;
    let clear = true;
    for (let j = 0; j < m; j += 2) {
      const o = track.samples[j];
      if (Math.hypot(lx - o.x, lz - o.z) < wall + 2.8 || Math.hypot(rx - o.x, rz - o.z) < wall + 2.8) {
        clear = false;
        break;
      }
    }
    if (clear) candidates.push(i);
  }
  if (candidates.length === 0) return [];
  const picked: KartTrack['samples'][number][] = [];
  const minSampleSep = Math.floor(m / (count + 1));
  for (const idx of candidates) {
    if (picked.every((p) => {
      const d = Math.abs(idx - Math.round(p.progress * m));
      return Math.min(d, m - d) >= minSampleSep * 0.72;
    })) {
      picked.push(track.samples[idx]);
      if (picked.length >= count) break;
    }
  }
  return picked;
}

function buildBiomeArches(
  track: KartTrack,
  group: THREE.Group,
  propMat: THREE.Material,
  glowMat: THREE.Material,
  disposers: (() => void)[],
  pulseMats: THREE.MeshBasicMaterial[],
) {
  const spots = findStraightawaySpots(track, track.biome === 'space' ? 4 : 3);
  if (spots.length === 0) return;
  const span = track.wallWidth + 4.8;

  if (track.biome === 'lava') {
    const parts: THREE.BufferGeometry[] = [];
    const glowParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      parts.push(
        colored(placed(new THREE.CylinderGeometry(2.6, 4.0, 17, 6), side * span, 8.5, 0), '#1d1412'),
        colored(placed(new THREE.DodecahedronGeometry(3.5, 0), side * (span - 2), 16.5, 0, { sx: 1.4, sy: 0.9 }), '#281916'),
      );
      glowParts.push(colored(placed(new THREE.BoxGeometry(0.45, 11, 0.45), side * (span - 2.3), 7, 0), '#ff5a1f'));
    }
    for (let i = -3; i <= 3; i++) {
      const t = i / 3;
      const x = t * (span - 2);
      const y = 18.5 + (1 - t * t) * 5.5;
      parts.push(colored(placed(new THREE.DodecahedronGeometry(4.2 - Math.abs(t) * 0.8, 0), x, y, 0, { sx: 1.5, sy: 0.8, rz: -t * 0.35 }), i % 2 === 0 ? '#241714' : '#18100e'));
    }
    const geo = merged(parts);
    const gGeo = merged(glowParts);
    const tf = spots.map((s) => ({ x: s.x, y: s.y - 1.5, z: s.z, ry: s.angle, s: 1 }));
    instanced(group, geo, propMat, tf, disposers);
    instanced(group, gGeo, glowMat, tf, disposers);
    return;
  }

  if (track.biome === 'canyon') {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      parts.push(
        colored(placed(new THREE.CylinderGeometry(3.4, 5.2, 16, 7), side * span, 7.5, 0), '#9a4323'),
        colored(placed(new THREE.CylinderGeometry(3.8, 4.4, 5, 7), side * (span - 0.8), 15.5, 0, { rz: side * 0.25 }), '#b85a30'),
      );
    }
    for (let i = -4; i <= 4; i++) {
      const t = i / 4;
      const x = t * (span - 1.2);
      const y = 17.5 + (1 - t * t) * 6.5;
      parts.push(colored(placed(new THREE.BoxGeometry(8.5, 3.8, 6.2 - Math.abs(t) * 1.4), x, y, 0, { rz: -t * 0.42 }), i % 2 === 0 ? '#a84b28' : '#c66838'));
    }
    const geo = merged(parts);
    const tf = spots.map((s) => ({ x: s.x, y: s.y - 2, z: s.z, ry: s.angle, s: 1 }));
    instanced(group, geo, propMat, tf, disposers);
    return;
  }

  if (track.biome === 'snow') {
    const iceMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      shininess: 110,
      specular: '#ffffff',
      emissive: '#38bdf8',
      emissiveIntensity: 0.18,
    });
    disposers.push(() => iceMat.dispose());
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      parts.push(
        colored(placed(new THREE.OctahedronGeometry(3.2, 0), side * span, 8, 0, { sy: 3.1 }), '#bae6fd'),
        colored(placed(new THREE.OctahedronGeometry(2.2, 0), side * (span + 2.4), 5, 1.5, { sy: 2.2, rz: -side * 0.2 }), '#7dd3fc'),
      );
    }
    for (let i = -3; i <= 3; i++) {
      const t = i / 3;
      const x = t * (span - 1.5);
      const y = 17 + (1 - t * t) * 6.2;
      parts.push(colored(placed(new THREE.OctahedronGeometry(3.2, 0), x, y, 0, { sx: 2.1, sy: 0.9, rz: -t * 0.45 }), i % 2 === 0 ? '#e0f2fe' : '#93c5fd'));
    }
    const geo = merged(parts);
    const tf = spots.map((s) => ({ x: s.x, y: s.y - 1.5, z: s.z, ry: s.angle, s: 1 }));
    instanced(group, geo, iceMat, tf, disposers);
    return;
  }

  if (track.biome === 'space') {
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.9 });
    disposers.push(() => ringMat.dispose());
    pulseMats.push(ringMat);
    const frameParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      frameParts.push(
        colored(placed(new THREE.BoxGeometry(1.4, 15, 1.4), side * span, 6.5, 0), '#312e81'),
        colored(placed(new THREE.OctahedronGeometry(1.7, 0), side * span, 14.5, 0), '#c084fc'),
      );
    }
    const frameGeo = merged(frameParts);
    const ringGeo = new THREE.TorusGeometry(span * 0.86, 0.65, 8, 32, Math.PI * 1.18);
    ringGeo.rotateZ(-Math.PI * 0.09);
    ringGeo.translate(0, 6.5, 0);
    const tf = spots.map((s, idx) => ({
      x: s.x,
      y: s.y - 1,
      z: s.z,
      ry: s.angle,
      s: 1,
      color: new THREE.Color(idx % 2 === 0 ? '#22d3ee' : '#f472b6'),
    }));
    instanced(group, frameGeo, propMat, tf, disposers);
    instanced(group, ringGeo, ringMat, tf, disposers);
    return;
  }

  if (track.biome === 'city') {
    const trussParts: THREE.BufferGeometry[] = [];
    const neonParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      trussParts.push(colored(placed(new THREE.BoxGeometry(1.8, 17.5, 1.8), side * span, 8.75, 0), '#1e293b'));
      neonParts.push(colored(placed(new THREE.BoxGeometry(0.35, 13, 0.35), side * (span - 0.95), 8.5, 0), side > 0 ? '#00f5ff' : '#ff4fd8'));
    }
    trussParts.push(colored(placed(new THREE.BoxGeometry(span * 2 + 2.4, 2.1, 2.2), 0, 17.2, 0), '#0f172a'));
    neonParts.push(
      colored(placed(new THREE.BoxGeometry(span * 1.85, 0.42, 2.35), 0, 17.6, 0), '#00f5ff'),
      colored(placed(new THREE.BoxGeometry(span * 1.85, 0.42, 2.35), 0, 16.6, 0), '#ff4fd8'),
    );
    const tf = spots.map((s) => ({ x: s.x, y: s.y - 1, z: s.z, ry: s.angle, s: 1 }));
    instanced(group, merged(trussParts), propMat, tf, disposers);
    instanced(group, merged(neonParts), glowMat, tf, disposers);
  }
}

function instanced(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: { x: number; y: number; z: number; ry: number; s: number; sy?: number; color?: THREE.Color }[],
  disposers?: (() => void)[],
) {
  if (transforms.length === 0) {
    geo.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geo, material, transforms.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  transforms.forEach((t, i) => {
    q.setFromAxisAngle(up, t.ry);
    m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.sy ?? t.s, t.s));
    mesh.setMatrixAt(i, m);
    if (t.color) mesh.setColorAt(i, t.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  disposers?.push(() => {
    geo.dispose();
    mesh.dispose();
  });
  return mesh;
}

function buildScenery(
  track: KartTrack,
  terrain: TerrainInfo,
  group: THREE.Group,
  propMat: THREE.Material,
  glowMat: THREE.Material,
  disposers: (() => void)[],
  pulseMats: THREE.MeshBasicMaterial[],
  lowestRoad: number,
): THREE.Object3D | null {
  const rng = mulberry32(hashString(track.id) ^ 0x51ed);
  const wall = track.wallWidth;
  const xs = track.samples.map((s) => s.x);
  const zs = track.samples.map((s) => s.z);
  const minX = Math.min(...xs) - 260;
  const maxX = Math.max(...xs) + 260;
  const minZ = Math.min(...zs) - 260;
  const maxZ = Math.max(...zs) + 260;

  /** Random spots at least `minGap` beyond the barrier, biased to stay visible from the road. */
  const scatter = (baseCount: number, minGap: number, maxGap: number, scale: [number, number]) => {
    const count = Math.round(baseCount * 1.6);
    const out: { x: number; y: number; z: number; ry: number; s: number }[] = [];
    for (let tries = 0; tries < count * 30 && out.length < count; tries++) {
      const x = minX + rng() * (maxX - minX);
      const z = minZ + rng() * (maxZ - minZ);
      const proj = projectOntoTrack(track, x, z);
      const localWall = getTrackBoundsAt(track, proj.progress).wallWidth;
      const d = proj.distanceToCenter;
      if (d < localWall + minGap || d > localWall + maxGap) continue;
      if (projectOntoShortcut(track, x, z)) continue;
      const cd = Math.hypot(x - terrain.center.x, z - terrain.center.z);
      if (terrain.volcanoRadius > 0 && cd < terrain.volcanoRadius * 1.02) continue;
      out.push({ x, y: terrain.heightAt(x, z) - 0.2, z, ry: rng() * Math.PI * 2, s: scale[0] + rng() * (scale[1] - scale[0]) });
    }
    return out;
  };

  let lighthouseBeam: THREE.Object3D | null = null;

  switch (track.biome) {
    case 'beach': {
      instanced(group, palmGeometry(), propMat, scatter(120, 5, 150, [0.9, 1.5]).filter((p) => p.y > -1), disposers);
      instanced(group, umbrellaGeometry(), propMat, scatter(26, 3, 26, [1, 1.3]), disposers);
      instanced(group, rockGeometry('#8d8678'), propMat, scatter(34, 6, 200, [0.6, 2.2]), disposers);
      // Distant sailboats out on the ocean
      const oceanY = lowestRoad - 7;
      const boats: { x: number; y: number; z: number; ry: number; s: number }[] = [];
      for (let tries = 0; tries < 400 && boats.length < 16; tries++) {
        const x = minX - 240 + rng() * (maxX - minX + 480);
        const z = minZ - 240 + rng() * (maxZ - minZ + 480);
        if (terrain.nearestDist(x, z) < wall + 115) continue;
        if (terrain.heightAt(x, z) > oceanY - 1.2) continue;
        boats.push({ x, y: oceanY - 0.2, z, ry: rng() * Math.PI * 2, s: 1.2 + rng() * 1.1 });
      }
      instanced(group, sailboatGeometry(), propMat, boats, disposers);

      // Coastal lighthouse landmark on a clear headland
      let lhPos: { x: number; y: number; z: number } | null = null;
      for (let tries = 0; tries < 300; tries++) {
        const x = minX + rng() * (maxX - minX);
        const z = minZ + rng() * (maxZ - minZ);
        const d = terrain.nearestDist(x, z);
        if (d < wall + 46 || d > wall + 145) continue;
        const h = terrain.heightAt(x, z);
        if (h > lowestRoad - 2 && h < lowestRoad + 18) {
          lhPos = { x, y: h - 0.5, z };
          break;
        }
      }
      if (lhPos) {
        const lhParts: THREE.BufferGeometry[] = [
          colored(placed(new THREE.CylinderGeometry(4.4, 5.4, 3, 12), 0, 1.5, 0), '#64748b'),
          colored(placed(new THREE.CylinderGeometry(3.5, 4.1, 7, 12), 0, 6.5, 0), '#f8fafc'),
          colored(placed(new THREE.CylinderGeometry(2.9, 3.5, 7, 12), 0, 13.5, 0), '#ef4444'),
          colored(placed(new THREE.CylinderGeometry(2.3, 2.9, 7, 12), 0, 20.5, 0), '#f8fafc'),
          colored(placed(new THREE.CylinderGeometry(1.9, 2.3, 6, 12), 0, 27, 0), '#ef4444'),
          colored(placed(new THREE.CylinderGeometry(2.6, 2.2, 1.2, 12), 0, 30.6, 0), '#0f172a'),
          colored(placed(new THREE.ConeGeometry(2.5, 3.2, 12), 0, 36.2, 0), '#ef4444'),
        ];
        const lhGeo = merged(lhParts);
        const lhMesh = new THREE.Mesh(lhGeo, propMat);
        lhMesh.position.set(lhPos.x, lhPos.y, lhPos.z);
        group.add(lhMesh);
        disposers.push(() => lhGeo.dispose());

        const lanternGeo = new THREE.CylinderGeometry(1.7, 1.7, 3.8, 12);
        const lanternMat = new THREE.MeshBasicMaterial({ color: '#fef08a', toneMapped: false });
        const lantern = new THREE.Mesh(lanternGeo, lanternMat);
        lantern.position.set(lhPos.x, lhPos.y + 33, lhPos.z);
        group.add(lantern);
        disposers.push(() => { lanternGeo.dispose(); lanternMat.dispose(); });

        const beamPivot = new THREE.Group();
        beamPivot.position.set(lhPos.x, lhPos.y + 33, lhPos.z);
        const coneGeo = new THREE.ConeGeometry(9, 72, 14, 1, true);
        coneGeo.translate(0, -36, 0);
        coneGeo.rotateX(Math.PI / 2);
        const coneMat = new THREE.MeshBasicMaterial({
          color: '#fef9c3',
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const coneA = new THREE.Mesh(coneGeo, coneMat);
        const coneB = new THREE.Mesh(coneGeo, coneMat);
        coneB.rotation.y = Math.PI;
        beamPivot.add(coneA, coneB);
        group.add(beamPivot);
        lighthouseBeam = beamPivot;
        disposers.push(() => { coneGeo.dispose(); coneMat.dispose(); });
      }
      break;
    }
    case 'canyon':
      instanced(group, cactusGeometry(), propMat, scatter(90, 4, 90, [0.9, 1.6]), disposers);
      instanced(group, rockGeometry('#a35128'), propMat, scatter(70, 11, 120, [0.7, 3]), disposers);
      break;
    case 'snow':
      instanced(group, pineGeometry(), propMat, scatter(190, 4, 220, [0.8, 1.8]), disposers);
      instanced(group, snowmanGeometry(), propMat, scatter(16, 3, 22, [0.9, 1.2]), disposers);
      instanced(group, rockGeometry('#a9bccd'), propMat, scatter(40, 5, 150, [0.6, 2]), disposers);
      break;
    case 'lava':
      instanced(group, lavaSpireGeometry(), propMat, scatter(70, 6, 150, [0.8, 1.9]), disposers);
      instanced(group, deadTreeGeometry(), propMat, scatter(60, 3, 70, [0.9, 1.5]), disposers);
      instanced(group, rockGeometry('#2a1d19'), propMat, scatter(60, 4, 150, [0.7, 2.6]), disposers);
      break;
    case 'space': {
      const place = (count: number, minGap: number, maxGap: number, scale: [number, number]) =>
        scatter(count, minGap, maxGap, scale).map((p) => {
          const near = track.samples[Math.floor(rng() * track.samples.length)];
          return { ...p, y: near.y - 26 + rng() * 80 };
        });
      instanced(group, crystalGeometry('#c084fc'), glowMat, place(40, 6, 180, [0.9, 2.6]), disposers);
      instanced(group, crystalGeometry('#22d3ee'), glowMat, place(40, 6, 180, [0.9, 2.6]), disposers);
      instanced(group, rockGeometry('#3a3360'), propMat, place(70, 30, 260, [1, 6]), disposers);
      break;
    }
    case 'city': {
      // Skyscrapers line the blocks, with a tall skyline further out
      const tints = ['#ff4fd8', '#00f5ff', '#ffd27a'];
      tints.forEach((tint, idx) => {
        const tex = makeWindowTexture(hashString(track.id) + idx, tint);
        tex.repeat.set(2, idx === 2 ? 6 : 3 + idx);
        disposers.push(() => tex.dispose());
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        disposers.push(() => mat.dispose());
        const geo = new THREE.BoxGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0);
        const spots = scatter(idx === 0 ? 70 : 48, idx === 0 ? 28 : 40, idx === 2 ? 240 : 150, [1, 1]).map((p) => {
          const w = 14 + rng() * 22;
          const h = (idx === 2 ? 110 : 45) + rng() * (idx === 2 ? 150 : 60);
          return { ...p, s: w, sy: h, ry: Math.round(rng() * 4) * (Math.PI / 2) };
        });
        instanced(group, geo, mat, spots, disposers);
      });
      break;
    }
  }

  buildBiomeArches(track, group, propMat, glowMat, disposers, pulseMats);

  // Trackside furniture every so often along the barrier (avoiding shortcut openings & adjusting for split widenings/lifts)
  const m = track.samples.length;
  const flags: { x: number; y: number; z: number; ry: number; s: number; color?: THREE.Color }[] = [];
  const lamps: { x: number; y: number; z: number; ry: number; s: number }[] = [];
  const lampHeads: { x: number; y: number; z: number; ry: number; s: number; color?: THREE.Color }[] = [];
  const signs: { x: number; y: number; z: number; ry: number; s: number }[] = [];
  const boards: { x: number; y: number; z: number; ry: number; s: number }[] = [];
  const useLamps = track.biome === 'city' || track.biome === 'lava';
  const accent = new THREE.Color(track.theme.accentColor);
  for (let i = 0; i < m; i++) {
    const s = track.samples[i];
    const b = getTrackBoundsAt(track, s.progress);
    const side = (i % 16 < 8 ? 1 : -1) as -1 | 1;
    if (i % 10 === 0 && Math.abs(s.curvature) < 0.0092 && !isShortcutWallOpening(track, s.progress, side)) {
      const off = side * (b.wallWidth + 2.4);
      const lift = b.upperSide === side ? b.upperLift : 0;
      const x = s.x + s.nx * off;
      const z = s.z + s.nz * off;
      const y = s.y + Math.sin(s.bank) * b.wallWidth * side + lift;
      if (useLamps) {
        // Point the lamp arm inward toward the road centerline
        const ry = Math.atan2(s.nx * side, s.nz * side);
        lamps.push({ x, y, z, ry, s: 1 });
        const headCol = track.biome === 'city'
          ? new THREE.Color(i % 20 === 0 ? '#00f5ff' : '#ff4fd8')
          : new THREE.Color('#ff8a1f');
        lampHeads.push({ x: x - Math.sin(ry) * 2.35, y: y + 9.85, z: z - Math.cos(ry) * 2.35, ry: 0, s: 1, color: headCol });
      } else if (track.biome !== 'space') {
        flags.push({ x, y, z, ry: -s.angle + (side > 0 ? 0 : Math.PI), s: 1, color: accent });
      }
    }
    // Chevrons on the outside of proper corners
    if (i % 7 === 0 && Math.abs(s.curvature) > 0.0088) {
      const outside = (s.curvature > 0 ? 1 : -1) as -1 | 1;
      if (!isShortcutWallOpening(track, s.progress, outside)) {
        const off = outside * (b.wallWidth + 3);
        const lift = b.upperSide === outside ? b.upperLift : 0;
        const y = s.y + Math.sin(s.bank) * b.wallWidth * outside + lift;
        signs.push({ x: s.x + s.nx * off, y, z: s.z + s.nz * off, ry: s.angle, s: 1 });
        boards.push({ x: s.x + s.nx * off, y: y + 3.4, z: s.z + s.nz * off, ry: s.angle, s: outside });
      }
    }
  }
  if (flags.length) instanced(group, flagGeometry(), propMat, flags, disposers);
  if (lamps.length) instanced(group, lampGeometry(), propMat, lamps, disposers);
  instanced(group, signGeometry(), propMat, signs, disposers);

  if (lampHeads.length) {
    const head = new THREE.SphereGeometry(0.55, 8, 6);
    const headMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    disposers.push(() => headMat.dispose());
    instanced(group, head, headMat, lampHeads, disposers);
  }

  const chevronTex = canvasTexture(128, (ctx, w, h) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#facc15';
    for (let i = 0; i < 3; i++) {
      const x = i * (w / 3) + 8;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x + 20, 8);
      ctx.lineTo(x + 40, h / 2);
      ctx.lineTo(x + 20, h - 8);
      ctx.lineTo(x, h - 8);
      ctx.lineTo(x + 20, h / 2);
      ctx.closePath();
      ctx.fill();
    }
  });
  disposers.push(() => chevronTex.dispose());
  const boardMat = new THREE.MeshBasicMaterial({ map: chevronTex, side: THREE.DoubleSide });
  disposers.push(() => boardMat.dispose());
  // Boards face oncoming traffic and point into the corner
  const right = boards.filter((b) => b.s > 0);
  const left = boards.filter((b) => b.s < 0);
  instanced(group, new THREE.PlaneGeometry(4.6, 2.2), boardMat, left.map((b) => ({ ...b, ry: b.ry + Math.PI, s: 1 })), disposers);
  const mirrored = new THREE.PlaneGeometry(4.6, 2.2);
  mirrored.scale(-1, 1, 1);
  instanced(group, mirrored, boardMat, right.map((b) => ({ ...b, ry: b.ry + Math.PI, s: 1 })), disposers);
  return lighthouseBeam;
}

const PERK_LABELS: Record<SplitSectionDef['leftPerk'], string> = {
  boosts: '⚡ BOOSTS',
  coins: '🪙 COINS',
  boxes: '🎁 ITEMS',
  fast: '🚀 HIGH LINE',
};

function buildSplitStructures(
  track: KartTrack,
  group: THREE.Group,
  propMat: THREE.Material,
  glowMat: THREE.Material,
  disposers: (() => void)[],
) {
  const track2 = <T extends { dispose: () => void }>(res: T): T => {
    disposers.push(() => res.dispose());
    return res;
  };
  const samples = track.samples;
  const m = samples.length;
  const vertexMat = track2(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));

  // Elevated deck underside skirts & support pillars
  const pillarSpots: { x: number; y: number; z: number; ry: number; s: number; sy: number }[] = [];
  for (let i = 0; i < m; i++) {
    const s0 = samples[i];
    const b0 = getTrackBoundsAt(track, s0.progress);
    if (b0.upperSide !== 0 && b0.upperLift > 0.8 && i % 5 === 0) {
      const midOff = b0.upperSide * (b0.dividerHalf + (b0.halfRoad - b0.dividerHalf) * 0.5);
      const h = b0.upperLift + 9;
      pillarSpots.push({
        x: s0.x + s0.nx * midOff,
        y: s0.y + Math.sin(s0.bank) * midOff + b0.upperLift - 0.6 - h * 0.5,
        z: s0.z + s0.nz * midOff,
        ry: s0.angle,
        s: 1,
        sy: h,
      });
    }
  }
  if (pillarSpots.length > 0) {
    const pilGeo = colored(new THREE.BoxGeometry(2.6, 1, 2.6), track.biome === 'canyon' ? '#8c3b1f' : track.biome === 'snow' ? '#7dd3fc' : '#1e293b');
    instanced(group, pilGeo, propMat, pillarSpots, disposers);

    const underGeo = track2(dynamicRibbon(track, (_s, b) => {
      if (b.upperSide === 0 || b.upperLift <= 0.1) {
        return { offA: 0, offB: 0, yA: -10, yB: -10 };
      }
      const offA = b.upperSide < 0 ? -b.halfRoad - 0.4 : b.dividerHalf - 0.2;
      const offB = b.upperSide < 0 ? -b.dividerHalf + 0.2 : b.halfRoad + 0.4;
      return { offA, offB, yA: b.upperLift - 0.85, yB: b.upperLift - 0.85 };
    }));
    const underMat = track2(new THREE.MeshLambertMaterial({ color: track.biome === 'canyon' ? '#6e2f18' : track.biome === 'snow' ? '#38bdf8' : '#0f172a', side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(underGeo, underMat));
  }

  // Central Split Island / Divider per SplitSectionDef
  for (const split of track.splitSections) {
    const startIdx = Math.max(0, Math.floor(split.startProgress * m) - 1);
    const endIdx = Math.min(m - 1, Math.ceil(split.endProgress * m) + 1);
    const pos: number[] = [];
    const col: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
      pos.push(...a, ...c, ...b, ...b, ...c, ...d);
      for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
    };

    const topCol = new THREE.Color(
      split.theme === 'island' ? '#3fa34d'
        : split.theme === 'mesa-pillar' ? '#b85a30'
        : split.theme === 'ice-bridge' ? '#bae6fd'
        : split.theme === 'lava-chasm' ? '#ff6a1f'
        : split.theme === 'median' ? '#1e293b'
        : '#1e1b4b',
    );
    const sideCol = new THREE.Color(
      split.theme === 'island' ? '#e9d38f'
        : split.theme === 'mesa-pillar' ? '#7c2d12'
        : split.theme === 'ice-bridge' ? '#38bdf8'
        : split.theme === 'lava-chasm' ? '#2a1a16'
        : split.theme === 'median' ? '#0f172a'
        : '#312e81',
    );

    const islandPalms: { x: number; y: number; z: number; ry: number; s: number }[] = [];
    const neonRailPos: number[] = [];
    const neonRailCol: number[] = [];

    for (let i = startIdx; i < endIdx; i++) {
      const s0 = samples[i % m];
      const s1 = samples[(i + 1) % m];
      const b0 = getTrackBoundsAt(track, s0.progress);
      const b1 = getTrackBoundsAt(track, s1.progress);
      if (b0.dividerHalf <= 0.3 && b1.dividerHalf <= 0.3) continue;

      const d0 = Math.max(0.2, b0.dividerHalf - 0.35);
      const d1 = Math.max(0.2, b1.dividerHalf - 0.35);
      const e0 = d0 / Math.max(0.5, split.dividerHalfWidth);
      const e1 = d1 / Math.max(0.5, split.dividerHalfWidth);

      if (split.theme === 'neon-split') {
        const cLeft = new THREE.Color('#ec4899');
        const cRight = new THREE.Color('#22d3ee');
        const pushStrip = (off0: number, off1: number, c: THREE.Color) => {
          const pA = [s0.x + s0.nx * (off0 - 0.4), s0.y + Math.sin(s0.bank) * off0 + 0.25, s0.z + s0.nz * (off0 - 0.4)];
          const pB = [s0.x + s0.nx * (off0 + 0.4), s0.y + Math.sin(s0.bank) * off0 + 0.25, s0.z + s0.nz * (off0 + 0.4)];
          const pC = [s1.x + s1.nx * (off1 - 0.4), s1.y + Math.sin(s1.bank) * off1 + 0.25, s1.z + s1.nz * (off1 - 0.4)];
          const pD = [s1.x + s1.nx * (off1 + 0.4), s1.y + Math.sin(s1.bank) * off1 + 0.25, s1.z + s1.nz * (off1 + 0.4)];
          neonRailPos.push(...pA, ...pC, ...pB, ...pB, ...pC, ...pD);
          for (let k = 0; k < 6; k++) neonRailCol.push(c.r, c.g, c.b);
        };
        pushStrip(-d0, -d1, cLeft);
        pushStrip(d0, d1, cRight);
        continue;
      }

      if (split.theme === 'lava-chasm') {
        const floorY0 = s0.y - 1.2;
        const floorY1 = s1.y - 1.2;
        const pA = [s0.x - s0.nx * d0, floorY0, s0.z - s0.nz * d0];
        const pB = [s0.x + s0.nx * d0, floorY0, s0.z + s0.nz * d0];
        const pC = [s1.x - s1.nx * d1, floorY1, s1.z - s1.nz * d1];
        const pD = [s1.x + s1.nx * d1, floorY1, s1.z + s1.nz * d1];
        neonRailPos.push(...pA, ...pC, ...pB, ...pB, ...pC, ...pD);
        for (let k = 0; k < 6; k++) neonRailCol.push(topCol.r, topCol.g, topCol.b);
        continue;
      }

      const hPeak =
        split.theme === 'island' ? 2.5
          : split.theme === 'mesa-pillar' ? 7.4
          : split.theme === 'ice-bridge' ? 6.2
          : 2.3;
      const yTop0 = s0.y + hPeak * e0;
      const yTop1 = s1.y + hPeak * e1;
      const yBot0 = s0.y - 2.0;
      const yBot1 = s1.y - 2.0;

      const L0T = [s0.x - s0.nx * d0, yTop0, s0.z - s0.nz * d0];
      const R0T = [s0.x + s0.nx * d0, yTop0, s0.z + s0.nz * d0];
      const L1T = [s1.x - s1.nx * d1, yTop1, s1.z - s1.nz * d1];
      const R1T = [s1.x + s1.nx * d1, yTop1, s1.z + s1.nz * d1];
      const L0B = [s0.x - s0.nx * (d0 + 0.5), yBot0, s0.z - s0.nz * (d0 + 0.5)];
      const R0B = [s0.x + s0.nx * (d0 + 0.5), yBot0, s0.z + s0.nz * (d0 + 0.5)];
      const L1B = [s1.x - s1.nx * (d1 + 0.5), yBot1, s1.z - s1.nz * (d1 + 0.5)];
      const R1B = [s1.x + s1.nx * (d1 + 0.5), yBot1, s1.z + s1.nz * (d1 + 0.5)];

      quad(L0T, R0T, L1T, R1T, topCol);
      quad(L0B, L0T, L1B, L1T, sideCol);
      quad(R0T, R0B, R1T, R1B, sideCol);

      if (split.theme === 'island' && e0 > 0.55 && i % 5 === 0) {
        islandPalms.push({ x: s0.x, y: yTop0 - 0.3, z: s0.z, ry: i * 1.1, s: 0.72 + e0 * 0.35 });
      }
      if (split.theme === 'median') {
        const cNeon = new THREE.Color(i % 4 < 2 ? '#00f5ff' : '#ff4fd8');
        const nA = [s0.x - s0.nx * 0.45, yTop0 + 0.12, s0.z - s0.nz * 0.45];
        const nB = [s0.x + s0.nx * 0.45, yTop0 + 0.12, s0.z + s0.nz * 0.45];
        const nC = [s1.x - s1.nx * 0.45, yTop1 + 0.12, s1.z - s1.nz * 0.45];
        const nD = [s1.x + s1.nx * 0.45, yTop1 + 0.12, s1.z + s1.nz * 0.45];
        neonRailPos.push(...nA, ...nC, ...nB, ...nB, ...nC, ...nD);
        for (let k = 0; k < 6; k++) neonRailCol.push(cNeon.r, cNeon.g, cNeon.b);
      }
    }

    if (pos.length > 0) {
      const divGeo = track2(new THREE.BufferGeometry());
      divGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      divGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      divGeo.computeVertexNormals();
      if (split.theme === 'ice-bridge') {
        const iceDivMat = track2(new THREE.MeshPhongMaterial({
          vertexColors: true,
          shininess: 100,
          specular: '#ffffff',
          emissive: '#0284c7',
          emissiveIntensity: 0.2,
          side: THREE.DoubleSide,
        }));
        group.add(new THREE.Mesh(divGeo, iceDivMat));
      } else {
        group.add(new THREE.Mesh(divGeo, vertexMat));
      }
    }
    if (neonRailPos.length > 0) {
      const nGeo = track2(new THREE.BufferGeometry());
      nGeo.setAttribute('position', new THREE.Float32BufferAttribute(neonRailPos, 3));
      nGeo.setAttribute('color', new THREE.Float32BufferAttribute(neonRailCol, 3));
      group.add(new THREE.Mesh(nGeo, glowMat));
    }
    if (islandPalms.length > 0) {
      instanced(group, palmGeometry(), propMat, islandPalms, disposers);
    }

    // Overhead split signpost just before the fork
    const signP = ((split.startProgress - 0.015) + 1) % 1;
    const signS = sampleTrackAtProgress(track, signP);
    const signB = getTrackBoundsAt(track, signP);
    const gantry = new THREE.Group();
    gantry.position.set(signS.x, signS.y, signS.z);
    gantry.rotation.y = signS.angle;
    const pDist = signB.wallWidth + 1.8;
    const pGeo = track2(new THREE.BoxGeometry(1.1, 13, 1.1));
    const pMat = track2(new THREE.MeshLambertMaterial({ color: '#1e293b' }));
    const lp = new THREE.Mesh(pGeo, pMat);
    lp.position.set(-pDist, 6.5, 0);
    const rp = new THREE.Mesh(pGeo, pMat);
    rp.position.set(pDist, 6.5, 0);
    const signTex = track2(canvasTexture(768, (ctx, w, h) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = track.theme.accentColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 26px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((split.name || 'SPLIT ROUTE').toUpperCase(), w / 2, 34);
      ctx.font = '900 44px Arial, sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.textAlign = 'left';
      ctx.fillText(`◀ ${PERK_LABELS[split.leftPerk]}`, 36, 98);
      ctx.fillStyle = '#facc15';
      ctx.textAlign = 'right';
      ctx.fillText(`${PERK_LABELS[split.rightPerk]} ▶`, w - 36, 98);
    }, 144));
    const signBoard = new THREE.Mesh(
      track2(new THREE.BoxGeometry(pDist * 2 + 1.5, 4.2, 1.0)),
      [
        pMat,
        pMat,
        pMat,
        pMat,
        track2(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })),
        track2(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })),
      ],
    );
    signBoard.position.set(0, 12.2, 0);
    gantry.add(lp, rp, signBoard);
    group.add(gantry);
  }
}

function buildShortcuts(
  track: KartTrack,
  group: THREE.Group,
  glowMat: THREE.Material,
  disposers: (() => void)[],
  pulseMats: THREE.MeshBasicMaterial[],
) {
  const track2 = <T extends { dispose: () => void }>(res: T): T => {
    disposers.push(() => res.dispose());
    return res;
  };
  const biome = track.biome;

  for (const sc of track.shortcuts) {
    const pts = sc.points;
    if (pts.length < 2) continue;
    const hw = sc.width * 0.5;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const railPos: number[] = [];
    const railCol: number[] = [];

    const roadColA = new THREE.Color(
      biome === 'beach' ? '#e9c46a'
        : biome === 'canyon' ? '#c2410c'
        : biome === 'snow' ? '#bae6fd'
        : biome === 'space' ? '#a855f7'
        : biome === 'lava' ? '#1c1917'
        : '#1e293b',
    );
    const roadColB = new THREE.Color(
      biome === 'beach' ? '#f4d58d'
        : biome === 'canyon' ? '#9a3412'
        : biome === 'snow' ? '#e0f2fe'
        : biome === 'space' ? '#22d3ee'
        : biome === 'lava' ? '#292524'
        : '#0f172a',
    );
    const trimCol = new THREE.Color(
      biome === 'beach' ? '#f97316'
        : biome === 'canyon' ? '#fbbf24'
        : biome === 'snow' ? '#38bdf8'
        : biome === 'space' ? '#f472b6'
        : biome === 'lava' ? '#ff5a1f'
        : '#00f5ff',
    );

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const lift = sc.kind === 'hidden-ramp' && i >= 5 && i <= 11 ? ((i - 5) / 6) * 2.2 : 0;
      const y = pt.y + 0.08 + lift;
      pos.push(pt.x - pt.nx * hw, y, pt.z - pt.nz * hw);
      pos.push(pt.x + pt.nx * hw, y, pt.z + pt.nz * hw);
      const t = i / (pts.length - 1);
      uv.push(0, t * 4, 1, t * 4);
      const c = biome === 'space'
        ? new THREE.Color().setHSL((t * 1.4) % 1, 0.9, 0.58)
        : i % 2 === 0 ? roadColA : roadColB;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }

      if (i < pts.length - 1) {
        const pt1 = pts[i + 1];
        const lift1 = sc.kind === 'hidden-ramp' && i + 1 >= 5 && i + 1 <= 11 ? ((i - 4) / 6) * 2.2 : 0;
        const y1 = pt1.y + 0.14 + lift1;
        for (const sgn of [-1, 1]) {
          const p0A = [pt.x + pt.nx * sgn * (hw - 0.5), y + 0.06, pt.z + pt.nz * sgn * (hw - 0.5)];
          const p0B = [pt.x + pt.nx * sgn * (hw + 0.3), y + 0.06, pt.z + pt.nz * sgn * (hw + 0.3)];
          const p1A = [pt1.x + pt1.nx * sgn * (hw - 0.5), y1, pt1.z + pt1.nz * sgn * (hw - 0.5)];
          const p1B = [pt1.x + pt1.nx * sgn * (hw + 0.3), y1, pt1.z + pt1.nz * sgn * (hw + 0.3)];
          railPos.push(...p0A, ...p1A, ...p0B, ...p0B, ...p1A, ...p1B);
          for (let k = 0; k < 6; k++) railCol.push(trimCol.r, trimCol.g, trimCol.b);
        }
      }
    }

    const geo = track2(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = biome === 'space' || biome === 'city' || biome === 'snow'
      ? track2(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
      : track2(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(geo, mat));

    const rGeo = track2(new THREE.BufferGeometry());
    rGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    rGeo.setAttribute('color', new THREE.Float32BufferAttribute(railCol, 3));
    group.add(new THREE.Mesh(rGeo, glowMat));

    // Entrance & exit portal markers
    const archMat = track2(new THREE.MeshBasicMaterial({ color: trimCol, toneMapped: false, transparent: true, opacity: 0.88 }));
    pulseMats.push(archMat);
    for (const endIdx of [1, pts.length - 2]) {
      const pt = pts[endIdx];
      const ry = Math.atan2(pt.tx, pt.tz);
      const portal = new THREE.Group();
      portal.position.set(pt.x, pt.y, pt.z);
      portal.rotation.y = ry;
      const postGeo = track2(new THREE.CylinderGeometry(0.45, 0.55, 7.5, 8));
      const postCol = biome === 'beach' ? '#7a4a1f' : biome === 'canyon' ? '#9a4323' : '#1e293b';
      const postMat = track2(new THREE.MeshLambertMaterial({ color: postCol }));
      const lp = new THREE.Mesh(postGeo, postMat);
      lp.position.set(-hw - 0.4, 3.75, 0);
      const rp = new THREE.Mesh(postGeo, postMat);
      rp.position.set(hw + 0.4, 3.75, 0);
      portal.add(lp, rp);

      if (biome === 'beach' || biome === 'lava') {
        const flameGeo = track2(new THREE.ConeGeometry(0.65, 1.5, 7));
        const lf = new THREE.Mesh(flameGeo, archMat);
        lf.position.set(-hw - 0.4, 8.1, 0);
        const rf = new THREE.Mesh(flameGeo, archMat);
        rf.position.set(hw + 0.4, 8.1, 0);
        portal.add(lf, rf);
      } else {
        const archGeo = track2(new THREE.TorusGeometry(hw + 0.4, 0.42, 8, 22, Math.PI));
        const arch = new THREE.Mesh(archGeo, archMat);
        arch.position.set(0, 7.2, 0);
        portal.add(arch);
      }
      group.add(portal);
    }

    if (sc.kind === 'boost-gate') {
      const gatePt = pts[Math.min(pts.length - 1, 3)];
      const padTex = track2(makeChevronTexture('#fde047', '#00f5ff', '#0f172a'));
      const padGeo = track2(new THREE.PlaneGeometry(sc.width * 0.72, 7.5));
      padGeo.rotateX(-Math.PI / 2);
      const pad = new THREE.Mesh(padGeo, track2(new THREE.MeshBasicMaterial({ map: padTex, toneMapped: false, transparent: true, opacity: 0.92 })));
      pad.position.set(gatePt.x, gatePt.y + 0.16, gatePt.z);
      pad.rotation.y = Math.atan2(gatePt.tx, gatePt.tz);
      group.add(pad);
    }
  }
}

interface MovingHazardVisual {
  def: TrackFeatureDef;
  group: THREE.Group;
  shadow: THREE.Mesh;
  spinTarget: THREE.Object3D;
  pulsePart?: THREE.Object3D;
  prevLat: number;
}

function buildMovingHazardMesh(
  biome: KartTrack['biome'],
  disposers: (() => void)[],
): { group: THREE.Group; spinTarget: THREE.Object3D; pulsePart?: THREE.Object3D } {
  const track2 = <T extends { dispose: () => void }>(res: T): T => {
    disposers.push(() => res.dispose());
    return res;
  };
  const group = new THREE.Group();
  const spinTarget = new THREE.Group();
  group.add(spinTarget);
  const phong = track2(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 75, specular: '#ffffff' }));

  if (biome === 'beach') {
    // Giant scuttling red crab
    const bodyGeo = track2(merged([
      colored(placed(new THREE.SphereGeometry(2.1, 12, 8), 0, 1.4, 0, { sx: 1.35, sy: 0.55, sz: 0.95 }), '#ef4444'),
      colored(placed(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 6), -0.75, 2.3, 1.0), '#dc2626'),
      colored(placed(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 6), 0.75, 2.3, 1.0), '#dc2626'),
      colored(placed(new THREE.SphereGeometry(0.3, 8, 6), -0.75, 2.8, 1.05), '#ffffff'),
      colored(placed(new THREE.SphereGeometry(0.3, 8, 6), 0.75, 2.8, 1.05), '#ffffff'),
      colored(placed(new THREE.SphereGeometry(0.15, 6, 5), -0.75, 2.85, 1.28), '#0f172a'),
      colored(placed(new THREE.SphereGeometry(0.15, 6, 5), 0.75, 2.85, 1.28), '#0f172a'),
      // 6 legs
      ...[-1, 1].flatMap((side) =>
        [-0.8, 0, 0.8].map((zOff) =>
          colored(placed(new THREE.BoxGeometry(1.7, 0.24, 0.28), side * 2.55, 0.8, zOff, { rz: -side * 0.55 }), '#b91c1c'),
        ),
      ),
    ]));
    spinTarget.add(new THREE.Mesh(bodyGeo, phong));
    const claws = new THREE.Mesh(
      track2(merged([
        colored(placed(new THREE.SphereGeometry(0.85, 8, 6), -2.2, 2.5, 1.8, { sx: 1.1, sy: 0.75 }), '#f97316'),
        colored(placed(new THREE.SphereGeometry(0.85, 8, 6), 2.2, 2.5, 1.8, { sx: 1.1, sy: 0.75 }), '#f97316'),
      ])),
      phong,
    );
    spinTarget.add(claws);
    return { group, spinTarget, pulsePart: claws };
  }

  if (biome === 'canyon') {
    const geo = track2(merged([
      colored(placed(new THREE.DodecahedronGeometry(2.7, 1), 0, 2.6, 0), '#9a4323'),
      colored(placed(new THREE.TorusGeometry(2.45, 0.35, 6, 12), 0, 2.6, 0, { rx: 0.6 }), '#d97706'),
      colored(placed(new THREE.TorusGeometry(2.4, 0.3, 6, 12), 0, 2.6, 0, { ry: 0.9 }), '#5c2612'),
    ]));
    spinTarget.add(new THREE.Mesh(geo, phong));
    return { group, spinTarget };
  }

  if (biome === 'snow') {
    const geo = track2(merged([
      colored(placed(new THREE.IcosahedronGeometry(2.75, 1), 0, 2.7, 0), '#f8fafc'),
      colored(placed(new THREE.DodecahedronGeometry(1.3, 0), 1.6, 3.2, 0.8), '#bae6fd'),
      colored(placed(new THREE.DodecahedronGeometry(1.1, 0), -1.5, 2.2, -1.0), '#e0f2fe'),
    ]));
    spinTarget.add(new THREE.Mesh(geo, phong));
    return { group, spinTarget };
  }

  if (biome === 'space') {
    const ufoGeo = track2(merged([
      colored(placed(new THREE.CylinderGeometry(1.2, 3.0, 0.8, 16), 0, 4.4, 0), '#94a3b8'),
      colored(placed(new THREE.CylinderGeometry(3.0, 1.4, 0.65, 16), 0, 3.7, 0), '#475569'),
      colored(placed(new THREE.SphereGeometry(1.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 4.75, 0), '#22d3ee'),
      colored(placed(new THREE.TorusGeometry(2.9, 0.18, 6, 18), 0, 4.05, 0, { rx: Math.PI / 2 }), '#f472b6'),
    ]));
    spinTarget.add(new THREE.Mesh(ufoGeo, phong));
    const beamGeo = track2(new THREE.ConeGeometry(2.5, 3.8, 14, 1, true));
    const beamMat = track2(new THREE.MeshBasicMaterial({
      color: '#22d3ee',
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 1.9;
    group.add(beam);
    return { group, spinTarget, pulsePart: beam };
  }

  if (biome === 'lava') {
    const ventGeo = track2(merged([
      colored(placed(new THREE.CylinderGeometry(2.2, 3.1, 1.0, 12), 0, 0.5, 0), '#1d1412'),
      colored(placed(new THREE.CylinderGeometry(1.5, 1.9, 0.4, 12), 0, 0.9, 0), '#ff5a1f'),
    ]));
    group.add(new THREE.Mesh(ventGeo, phong));
    const plumeGeo = track2(new THREE.ConeGeometry(1.6, 6.2, 10));
    plumeGeo.translate(0, 3.1, 0);
    const plumeMat = track2(new THREE.MeshBasicMaterial({
      color: '#ff8a1f',
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    const plume = new THREE.Mesh(plumeGeo, plumeMat);
    group.add(plume);
    return { group, spinTarget, pulsePart: plume };
  }

  // City: hovering neon-ringed Cyber Drone
  const droneGeo = track2(merged([
    colored(placed(new THREE.OctahedronGeometry(1.5, 0), 0, 2.8, 0, { sy: 0.65 }), '#0f172a'),
    colored(placed(new THREE.SphereGeometry(0.55, 8, 6), 0, 2.8, 1.1), '#ff2255'),
  ]));
  group.add(new THREE.Mesh(droneGeo, phong));
  const ringGeo = track2(merged([
    colored(placed(new THREE.TorusGeometry(2.5, 0.2, 6, 18), 0, 0, 0, { rx: Math.PI / 2 }), '#00f5ff'),
    colored(placed(new THREE.BoxGeometry(0.4, 0.25, 4.9), 0, 0, 0), '#ff4fd8'),
  ]));
  const ringMat = track2(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const holoRing = new THREE.Mesh(ringGeo, ringMat);
  holoRing.position.y = 2.8;
  spinTarget.add(holoRing);
  return { group, spinTarget, pulsePart: holoRing };
}

// ─── Kart models ─────────────────────────────────────────────────────────────

function roundedKartProfile(len: number, height: number, bevel: number) {
  // A side profile extruded across the kart: low nose, cockpit dip, raised tail
  const shape = new THREE.Shape();
  const hl = len / 2;
  shape.moveTo(-hl, 0.1);
  shape.lineTo(hl - bevel, 0.1);
  shape.quadraticCurveTo(hl + 0.1, 0.1, hl, height * 0.34);
  shape.quadraticCurveTo(hl * 0.55, height * 0.72, hl * 0.2, height * 0.62);
  shape.lineTo(-hl * 0.2, height * 0.5);
  shape.quadraticCurveTo(-hl * 0.5, height * 0.6, -hl * 0.72, height);
  shape.lineTo(-hl, height);
  shape.closePath();
  return shape;
}

function extrudeBody(len: number, height: number, width: number) {
  const g = new THREE.ExtrudeGeometry(roundedKartProfile(len, height, 0.55), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.1,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2); // profile x -> world +z (nose forward)
  return g;
}

function kartBodyGeometry(style: string) {
  // Painted with the driver's colour
  if (style === 'rocket') {
    return merged([
      placed(new THREE.CylinderGeometry(0.64, 0.88, 3.5, 14), 0, 0.72, -0.1, { rx: Math.PI / 2 }).toNonIndexed(),
      placed(new THREE.ConeGeometry(0.64, 1.45, 14), 0, 0.72, 2.3, { rx: Math.PI / 2 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(3.0, 0.12, 1.25), 0, 0.5, -0.8, { ry: 0 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.14, 1.15, 1.05), 0, 1.5, -1.4).toNonIndexed(),
    ].map((g) => { g.deleteAttribute('uv'); return g; }));
  }
  if (style === 'cyber') {
    const g = extrudeBody(4.35, 0.94, 1.9);
    return merged([
      g.index ? g.toNonIndexed() : g,
      placed(new THREE.BoxGeometry(0.12, 0.85, 1.35), 1.08, 0.88, -1.1, { rx: -0.3 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.12, 0.85, 1.35), -1.08, 0.88, -1.1, { rx: -0.3 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.42, 0.36, 1.8), 1.02, 0.44, 0.15).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.42, 0.36, 1.8), -1.02, 0.44, 0.15).toNonIndexed(),
    ].map((p) => { if (p.getAttribute('uv')) p.deleteAttribute('uv'); return p; }));
  }
  if (style === 'bruiser') {
    return merged([
      placed(new THREE.BoxGeometry(2.34, 0.82, 3.45), 0, 0.72, 0).toNonIndexed(),
      placed(new THREE.BoxGeometry(2.04, 0.44, 1.05), 0, 1.26, 1.1, { rx: 0.18 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(2.44, 0.72, 0.85), 0, 1.12, -1.5).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.38, 0.42, 2.6), 1.25, 0.62, 0).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.38, 0.42, 2.6), -1.25, 0.62, 0).toNonIndexed(),
    ].map((g) => { g.deleteAttribute('uv'); return g; }));
  }
  const body = extrudeBody(4.15, 1.05, 1.72);
  const nonIdx = body.index ? body.toNonIndexed() : body;
  return merged([
    nonIdx,
    placed(new THREE.BoxGeometry(0.48, 0.46, 1.95), 1.1, 0.52, -0.3).toNonIndexed(),
    placed(new THREE.BoxGeometry(0.48, 0.46, 1.95), -1.1, 0.52, -0.3).toNonIndexed(),
  ].map((p) => { if (p.getAttribute('uv')) p.deleteAttribute('uv'); return p; }));
}

function kartTrimGeometry(style: string, accent: string) {
  // Vertex-coloured detail shared by every style: wings, seat, racing stripe, diffuser, chrome exhausts, roll hoop
  const dark = '#141824';
  const metal = '#d8e1ec';
  const chrome = '#eef4fb';
  const stripe = '#f8fafc';
  const parts: THREE.BufferGeometry[] = [
    colored(placed(new THREE.BoxGeometry(1.12, 0.82, 0.28), 0, 1.08, -0.7, { rx: -0.25 }), dark), // seat back
    colored(placed(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 6), 0, 0.92, 0.36, { rx: -0.65 }), dark), // steering column
    colored(placed(new THREE.BoxGeometry(1.55, 0.22, 0.44), 0, 0.34, -1.92), dark), // rear diffuser
    colored(placed(new THREE.BoxGeometry(0.28, 0.08, 1.9), 0, 0.92, 0.85, { rx: 0.16 }), stripe), // hood racing stripe
    // Chrome twin exhausts + flared tips
    colored(placed(new THREE.CylinderGeometry(0.13, 0.17, 0.9, 10), -0.62, 0.86, -2.0, { rx: Math.PI / 2 - 0.25 }), metal),
    colored(placed(new THREE.CylinderGeometry(0.13, 0.17, 0.9, 10), 0.62, 0.86, -2.0, { rx: Math.PI / 2 - 0.25 }), metal),
    colored(placed(new THREE.CylinderGeometry(0.17, 0.15, 0.22, 10), -0.62, 0.97, -2.38, { rx: Math.PI / 2 - 0.25 }), chrome),
    colored(placed(new THREE.CylinderGeometry(0.17, 0.15, 0.22, 10), 0.62, 0.97, -2.38, { rx: Math.PI / 2 - 0.25 }), chrome),
    // Roll hoop behind cockpit
    colored(placed(new THREE.TorusGeometry(0.62, 0.075, 6, 12, Math.PI), 0, 1.38, -0.82), metal),
  ];
  if (style === 'classic') {
    parts.push(
      colored(placed(new THREE.BoxGeometry(2.55, 0.12, 0.66), 0, 0.34, 2.28), dark),
      colored(placed(new THREE.BoxGeometry(2.45, 0.07, 0.24), 0, 0.4, 2.42), accent),
      colored(placed(new THREE.BoxGeometry(2.45, 0.16, 0.72), 0, 1.68, -1.86), accent),
      colored(placed(new THREE.BoxGeometry(0.12, 0.62, 0.5), 1.0, 1.36, -1.86), dark),
      colored(placed(new THREE.BoxGeometry(0.12, 0.62, 0.5), -1.0, 1.36, -1.86), dark),
      colored(placed(new THREE.BoxGeometry(0.16, 0.34, 0.85), 1.24, 1.68, -1.86), dark),
      colored(placed(new THREE.BoxGeometry(0.16, 0.34, 0.85), -1.24, 1.68, -1.86), dark),
    );
  } else if (style === 'rocket') {
    parts.push(
      colored(placed(new THREE.CylinderGeometry(0.76, 0.54, 0.75, 14), 0, 0.72, -2.0, { rx: Math.PI / 2 }), chrome),
      colored(placed(new THREE.BoxGeometry(3.15, 0.14, 0.34), 0, 0.5, -0.36), accent),
      colored(placed(new THREE.BoxGeometry(0.24, 0.08, 1.5), 0, 1.38, 0.3), stripe),
      colored(placed(new THREE.BoxGeometry(0.18, 0.55, 0.9), 1.48, 0.68, -0.8), accent),
      colored(placed(new THREE.BoxGeometry(0.18, 0.55, 0.9), -1.48, 0.68, -0.8), accent),
    );
  } else if (style === 'cyber') {
    parts.push(
      colored(placed(new THREE.BoxGeometry(2.15, 0.08, 3.6), 0, 0.28, 0), accent),
      colored(placed(new THREE.BoxGeometry(1.24, 0.28, 0.85), 0, 1.0, 0.92, { rx: 0.5 }), '#0b1020'),
      colored(placed(new THREE.BoxGeometry(2.3, 0.14, 0.55), 0, 1.32, -1.62), dark),
      colored(placed(new THREE.BoxGeometry(2.32, 0.08, 0.2), 0, 1.4, -1.72), accent),
    );
  } else {
    parts.push(
      colored(placed(new THREE.TorusGeometry(1.08, 0.13, 6, 14, Math.PI), 0, 0.5, 2.02), chrome),
      colored(placed(new THREE.BoxGeometry(2.2, 0.24, 0.4), 0, 0.42, 1.88), dark),
      colored(placed(new THREE.TorusGeometry(0.88, 0.1, 6, 14, Math.PI), 0, 1.32, -0.8), dark),
      colored(placed(new THREE.CylinderGeometry(0.16, 0.2, 1.45, 8), -1.0, 1.7, -1.5), chrome),
      colored(placed(new THREE.CylinderGeometry(0.16, 0.2, 1.45, 8), 1.0, 1.7, -1.5), chrome),
    );
  }
  return merged(parts);
}

function brakeLightGeometry(style: string) {
  const z = style === 'rocket' ? -1.85 : style === 'cyber' ? -2.05 : -1.96;
  const y = style === 'bruiser' ? 1.12 : 0.92;
  const x = style === 'bruiser' ? 0.82 : 0.68;
  return merged([
    placed(new THREE.BoxGeometry(0.38, 0.16, 0.12), -x, y, z),
    placed(new THREE.BoxGeometry(0.38, 0.16, 0.12), x, y, z),
  ]);
}

function exhaustGlowGeometry() {
  return merged([
    placed(new THREE.CylinderGeometry(0.15, 0.11, 0.34, 8), -0.62, 0.99, -2.42, { rx: Math.PI / 2 - 0.25 }),
    placed(new THREE.CylinderGeometry(0.15, 0.11, 0.34, 8), 0.62, 0.99, -2.42, { rx: Math.PI / 2 - 0.25 }),
  ]);
}

function wheelGeometry(radius: number, width: number) {
  const tire = colored(placed(new THREE.CylinderGeometry(radius, radius, width, 16), 0, 0, 0, { rz: Math.PI / 2 }), '#0f131c');
  const innerRim = colored(placed(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.02, 14), 0, 0, 0, { rz: Math.PI / 2 }), '#1e293b');
  const outerRing = colored(placed(new THREE.TorusGeometry(radius * 0.56, radius * 0.08, 6, 14), width * 0.48, 0, 0, { ry: Math.PI / 2 }), '#e2e8f0');
  const outerRingL = colored(placed(new THREE.TorusGeometry(radius * 0.56, radius * 0.08, 6, 14), -width * 0.48, 0, 0, { ry: Math.PI / 2 }), '#e2e8f0');
  const spoke = colored(placed(new THREE.BoxGeometry(width + 0.07, radius * 1.12, radius * 0.2), 0, 0, 0), '#cbd5e1');
  const spoke2 = colored(placed(new THREE.BoxGeometry(width + 0.07, radius * 0.2, radius * 1.12), 0, 0, 0), '#cbd5e1');
  const hubCap = colored(placed(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, width + 0.1, 8), 0, 0, 0, { rz: Math.PI / 2 }), '#f8fafc');
  return merged([tire, innerRim, outerRing, outerRingL, spoke, spoke2, hubCap]);
}

function coinGeometry() {
  const outer = colored(placed(new THREE.CylinderGeometry(0.85, 0.85, 0.22, 16), 0, 0, 0, { rx: Math.PI / 2 }), '#facc15');
  const inner = colored(placed(new THREE.CylinderGeometry(0.64, 0.64, 0.25, 14), 0, 0, 0, { rx: Math.PI / 2 }), '#eab308');
  const slot = colored(placed(new THREE.BoxGeometry(0.24, 0.78, 0.3), 0, 0, 0), '#fef08a');
  return merged([outer, inner, slot]);
}

const WHEEL_SPECS: Record<string, { front: [number, number, number]; rear: [number, number, number]; r: number; w: number }> = {
  classic: { front: [1.3, 0.54, 1.45], rear: [1.4, 0.62, -1.3], r: 0.54, w: 0.56 },
  rocket: { front: [1.25, 0.48, 1.5], rear: [1.45, 0.58, -1.25], r: 0.5, w: 0.5 },
  cyber: { front: [1.25, 0.46, 1.5], rear: [1.3, 0.5, -1.35], r: 0.48, w: 0.5 },
  bruiser: { front: [1.45, 0.72, 1.3], rear: [1.5, 0.76, -1.3], r: 0.76, w: 0.72 },
};

interface KartVisual {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  bodyMat: THREE.MeshPhongMaterial;
  baseColor: THREE.Color;
  brakeLightMat: THREE.MeshBasicMaterial;
  exhaustGlow: THREE.Mesh;
  exhaustGlowMat: THREE.MeshBasicMaterial;
  steerWheel: THREE.Mesh;
  driverUpper: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  frontL: THREE.Mesh;
  frontR: THREE.Mesh;
  rear: THREE.Mesh;
  head: THREE.Sprite;
  tag: THREE.Sprite;
  tagMat: THREE.SpriteMaterial;
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  flameOuter: THREE.Mesh;
  flameOuterMat: THREE.MeshBasicMaterial;
  flameInner: THREE.Mesh;
  aura: THREE.Sprite;
  auraMat: THREE.SpriteMaterial;
  hornRing: THREE.Mesh;
  hornRingMat: THREE.MeshBasicMaterial;
  heldItemAnchor: THREE.Group;
  heldItemMesh: THREE.Mesh;
  shownItem: KartItemType | null;
  disposables: { dispose: () => void }[];
  x: number;
  y: number;
  z: number;
  angle: number;
  velAngle: number;
  tx: number;
  tz: number;
  tAngle: number;
  tVel: number;
  tSpeed: number;
  tProgress: number;
  tLat: number;
  rx: number;
  spin: number;
  squash: number;
  prevHopT: number;
  launchLift: number;
  wheelRot: number;
  sparkAcc: number;
  dustAcc: number;
  flameAcc: number;
  skidAcc: number;
  revAcc: number;
  slipAcc: number;
  hornPhase: number;
  data: SnapKart;
}

// ─── Particles ───────────────────────────────────────────────────────────────

const PARTICLE_VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(uScale * aSize * 0.42 / max(1.0, -mv.z), 72.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = smoothstep(1.0, 0.25, d) * vAlpha;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private cap: number;
  private material: THREE.ShaderMaterial;
  private tmpColor = new THREE.Color();

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3).fill(-9999);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.baseSize = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.ColorRepresentation, size: number, life: number, gravity = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.cap;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.tmpColor.set(color);
    this.col[i * 3] = this.tmpColor.r;
    this.col[i * 3 + 1] = this.tmpColor.g;
    this.col[i * 3 + 2] = this.tmpColor.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 2] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, t * 1.6);
      this.size[i] = this.baseSize[i] * (0.6 + 0.4 * t);
    }
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aColor').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
    geo.getAttribute('aAlpha').needsUpdate = true;
  }

  setScale(scale: number) {
    this.material.uniforms.uScale.value = scale;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// ─── Scene ───────────────────────────────────────────────────────────────────

interface CameraRig {
  cam: THREE.PerspectiveCamera;
  yaw: number;
  x: number;
  y: number;
  z: number;
  fov: number;
  shake: number;
  driftLook: number;
  ready: boolean;
}

export interface SceneViewport {
  kartId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SKID_CAP = 360;

export class KartScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private track: KartTrack;
  private karts = new Map<string, KartVisual>();
  private hazards = new Map<string, THREE.Object3D>();
  private hazardGeos: Record<string, THREE.BufferGeometry> = {};
  private hazardMats: Record<string, THREE.Material> = {};
  private heldItemAssets = new Map<KartItemType, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
  private rigs = new Map<string, CameraRig>();
  private additive = new ParticlePool(2200, true);
  private smoke = new ParticlePool(1000, false);
  private disposers: (() => void)[] = [];
  private animated: { tex: THREE.Texture; speed: number }[] = [];
  private shaderTimes: THREE.ShaderMaterial[] = [];
  private pulseMats: THREE.MeshBasicMaterial[] = [];
  private gantryLights: THREE.MeshBasicMaterial[] = [];
  private itemBoxMesh!: THREE.InstancedMesh;
  private itemBoxShadowMesh!: THREE.InstancedMesh;
  private itemBoxSlots = new Map<string, { index: number; x: number; y: number; z: number; scale: number; active: boolean }>();
  private coinMesh!: THREE.InstancedMesh;
  private coinSlots = new Map<string, { index: number; x: number; y: number; z: number; scale: number; active: boolean }>();
  private skidMesh!: THREE.InstancedMesh;
  private skidCursor = 0;
  private skidColor = new THREE.Color();
  private shadowTex!: THREE.Texture;
  private shadowGeo!: THREE.PlaneGeometry;
  private craterPos: THREE.Vector3 | null = null;
  private craterAcc = 0;
  private lighthouseBeam: THREE.Object3D | null = null;
  private spaceBodies: THREE.Object3D[] = [];
  private trafficMesh: THREE.InstancedMesh | null = null;
  private trafficLanes: { cx: number; cz: number; r: number; y: number; speed: number; phase: number; dir: number }[] = [];
  private snapshot: KartTelemetrySnapshot | null = null;
  private snapshotAt = 0;
  private lastEventId = 0;
  private sky!: THREE.Mesh;
  private skyGroup = new THREE.Group();
  private weather: THREE.Points | null = null;
  private weatherMat: THREE.ShaderMaterial | null = null;
  private time = 0;
  private lastFrame = 0;
  private frameTimes: number[] = [];
  private pixelRatio: number;
  private size = { w: 0, h: 0 };
  private clearColor: THREE.Color;
  private dummy = new THREE.Object3D();
  private rampSpans: { start: number; end: number; height: number; latMin?: number; latMax?: number }[] = [];
  private movingHazards: MovingHazardVisual[] = [];
  private boostRings: { ring: THREE.Object3D; inner: THREE.Object3D }[] = [];
  private aerialStars: THREE.Object3D[] = [];
  private onEvent?: (e: KartEvent) => void;
  private rng = mulberry32(12345);
  private confettiUntil = 0;

  constructor(canvas: HTMLCanvasElement, track: KartTrack, onEvent?: (e: KartEvent) => void) {
    this.track = track;
    this.onEvent = onEvent;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setScissorTest(true);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.clearColor = new THREE.Color(track.theme.fog);
    this.renderer.setClearColor(this.clearColor);

    this.scene.fog = new THREE.FogExp2(track.theme.fog, track.theme.fogDensity);
    this.buildEnvironment();
    this.buildTrack();
    this.scene.add(this.additive.points, this.smoke.points);
  }

  private track2<T extends { dispose: () => void }>(res: T): T {
    this.disposers.push(() => res.dispose());
    return res;
  }

  private buildEnvironment() {
    const t = this.track.theme;
    const biome = this.track.biome;
    this.scene.add(this.track2(new THREE.HemisphereLight(t.ambient, t.groundLow, 1.15)));
    const sun = this.track2(new THREE.DirectionalLight(t.sun, 2.05));
    sun.position.set(t.sunDir[0] * 500, t.sunDir[1] * 500, t.sunDir[2] * 500);
    this.scene.add(sun);

    // Cool counter-directional rim light opposite sunDir so karts and edges pop
    const rim = this.track2(new THREE.DirectionalLight('#a8ccff', 0.65));
    rim.position.set(-t.sunDir[0] * 400, Math.max(140, Math.abs(t.sunDir[1]) * 260), -t.sunDir[2] * 400);
    this.scene.add(rim);

    const sunDir = new THREE.Vector3(...t.sunDir).normalize();

    // Rich gradient sky dome with atmospheric sun halo & horizon scatter
    const skyMat = this.track2(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(t.skyTop) },
        horizon: { value: new THREE.Color(t.skyHorizon) },
        ground: { value: new THREE.Color(t.fog) },
        uSunDir: { value: sunDir.clone() },
        uSunColor: { value: new THREE.Color(t.sun) },
        uScatter: { value: biome === 'canyon' ? 0.52 : biome === 'beach' ? 0.42 : 0.25 },
      },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 ground;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uScatter;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.62)) : mix(horizon, ground, min(1.0, -h * 8.0));
          float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
          float halo = pow(sunDot, 10.0) * 0.35 + pow(sunDot, 84.0) * 0.7;
          float band = pow(1.0 - min(1.0, abs(h)), 4.0) * 0.22;
          c += uSunColor * (halo * uScatter + band * uScatter * 0.6);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }));
    this.sky = new THREE.Mesh(this.track2(new THREE.SphereGeometry(2400, 24, 16)), skyMat);
    this.sky.renderOrder = -10;
    this.skyGroup.add(this.sky);

    const rng = mulberry32(hashString(this.track.id) + 77);

    // Sun, moon or planet glow
    const sunTex = this.track2(makeBlobTexture(biome === 'city' || biome === 'space' ? 'rgba(255,255,255,0.9)' : 'rgba(255,250,225,1)', 'rgba(255,240,200,0)'));
    const sunSprite = new THREE.Sprite(this.track2(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, toneMapped: false })));
    sunSprite.scale.setScalar(biome === 'beach' ? 560 : 440);
    sunSprite.position.copy(sunDir.clone().multiplyScalar(2000));
    sunSprite.renderOrder = -9;
    this.skyGroup.add(sunSprite);

    if (biome === 'snow') {
      // Animated Aurora Borealis curtain in the alpine sky
      const auroraMat = this.track2(new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float wave1 = sin(vUv.x * 22.0 + uTime * 0.45 + sin(vUv.x * 7.0 - uTime * 0.25) * 1.4);
            float wave2 = sin(vUv.x * 38.0 - uTime * 0.35 + vUv.y * 3.0);
            float curtain = pow(max(0.0, 0.55 + 0.45 * wave1), 2.2) * (0.65 + 0.35 * wave2);
            float vFade = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.22, vUv.y);
            float hFade = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
            vec3 emerald = vec3(0.14, 0.96, 0.62);
            vec3 cyan = vec3(0.22, 0.78, 0.98);
            vec3 violet = vec3(0.68, 0.34, 0.96);
            vec3 col = mix(emerald, cyan, smoothstep(0.15, 0.65, vUv.y));
            col = mix(col, violet, smoothstep(0.55, 0.95, vUv.y));
            float a = curtain * vFade * hFade * 0.62;
            gl_FragColor = vec4(col, a);
            #include <colorspace_fragment>
          }
        `,
      }));
      this.shaderTimes.push(auroraMat);
      const auroraGeo = this.track2(new THREE.CylinderGeometry(1650, 1780, 560, 64, 4, true, 0.2, Math.PI * 1.25));
      const aurora = new THREE.Mesh(auroraGeo, auroraMat);
      aurora.position.y = 520;
      aurora.rotation.y = 0.8;
      aurora.renderOrder = -8;
      this.skyGroup.add(aurora);
    }

    if (biome === 'space' || biome === 'city' || biome === 'lava') {
      const count = biome === 'space' ? 1600 : 500;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = rng() * Math.PI * 2;
        const v = biome === 'space' ? Math.acos(1 - 2 * rng()) : Math.acos(rng() * 0.92 + 0.02);
        pos.set([Math.sin(v) * Math.cos(u) * 2200, Math.cos(v) * 2200, Math.sin(v) * Math.sin(u) * 2200], i * 3);
      }
      const geo = this.track2(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(geo, this.track2(new THREE.PointsMaterial({ color: '#ffffff', size: biome === 'space' ? 2.4 : 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false })));
      stars.renderOrder = -9;
      this.skyGroup.add(stars);
    }

    if (biome === 'beach' || biome === 'snow' || biome === 'canyon') {
      const cloudTex = this.track2(canvasTexture(256, (ctx, w, h) => {
        for (let i = 0; i < 26; i++) {
          const x = w * (0.2 + rng() * 0.6);
          const y = h * (0.42 + rng() * 0.2);
          const r = 18 + rng() * 40;
          const g = ctx.createRadialGradient(x, y, 1, x, y, r);
          g.addColorStop(0, 'rgba(255,255,255,0.75)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      }, 128));
      const cloudMat = this.track2(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, transparent: true, opacity: biome === 'canyon' ? 0.5 : 0.9, color: biome === 'canyon' ? '#ffd1a8' : '#ffffff' }));
      for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2;
        const elev = 0.08 + rng() * 0.28;
        const s = new THREE.Sprite(cloudMat);
        s.position.set(Math.cos(a) * 1800, elev * 1800, Math.sin(a) * 1800);
        s.scale.set(420 + rng() * 480, 160 + rng() * 160, 1);
        s.renderOrder = -8;
        this.skyGroup.add(s);
      }
    }

    if (biome === 'space') {
      // Multi-band ringed gas giant + moon slowly rotating in deep space
      const planetTex = this.track2(makePlanetTexture());
      const planet = new THREE.Mesh(
        this.track2(new THREE.SphereGeometry(200, 36, 24)),
        this.track2(new THREE.MeshBasicMaterial({ map: planetTex, fog: false })),
      );
      planet.position.set(-1100, 460, 900);
      planet.rotation.z = 0.25;
      const ringTex = this.track2(makePlanetRingTexture());
      const ring = new THREE.Mesh(
        this.track2(new THREE.PlaneGeometry(760, 760)),
        this.track2(new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, fog: false, transparent: true, depthWrite: false })),
      );
      ring.position.copy(planet.position);
      ring.rotation.x = 1.24;
      ring.rotation.y = 0.28;
      const moon = new THREE.Mesh(
        this.track2(new THREE.SphereGeometry(62, 24, 16)),
        this.track2(new THREE.MeshBasicMaterial({ color: '#5de0ff', fog: false })),
      );
      moon.position.set(1300, 300, -700);
      planet.renderOrder = ring.renderOrder = moon.renderOrder = -8;
      this.skyGroup.add(planet, ring, moon);
      this.spaceBodies.push(planet, ring);
    }

    this.scene.add(this.skyGroup);

    // Camera-local weather, wrapped in a box so it costs the same everywhere on the track
    const weather = {
      snow: { color: '#ffffff', count: 500, size: 1.5, fall: 7, drift: 3, additive: false },
      lava: { color: '#ff7a2a', count: 300, size: 1.4, fall: -5, drift: 2.2, additive: true },
      space: { color: '#c7d2ff', count: 260, size: 0.9, fall: 0, drift: 1, additive: true },
      city: { color: '#9dc9ff', count: 500, size: 0.7, fall: 70, drift: 0.5, additive: true },
      canyon: { color: '#ffd4a3', count: 180, size: 1.15, fall: 0.3, drift: 4.5, additive: true },
    }[biome as string];
    if (weather) {
      const pos = new Float32Array(weather.count * 3);
      for (let i = 0; i < weather.count; i++) pos.set([rng() * 120, rng() * 60, rng() * 120], i * 3);
      const geo = this.track2(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.weatherMat = this.track2(new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: weather.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uFall: { value: weather.fall },
          uDrift: { value: weather.drift },
          uSize: { value: weather.size * 60 },
          uColor: { value: new THREE.Color(weather.color) },
        },
        vertexShader: `
          uniform float uTime; uniform vec3 uCam; uniform float uFall; uniform float uDrift; uniform float uSize;
          void main() {
            vec3 box = vec3(120.0, 60.0, 120.0);
            vec3 p = position;
            p.y -= uFall * uTime;
            p.x += sin(uTime * 0.7 + position.z) * uDrift;
            p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = min(uSize / max(1.0, -mv.z), 10.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            gl_FragColor = vec4(uColor, (1.0 - d) * 0.85);
            #include <colorspace_fragment>
          }
        `,
      }));
      this.weather = new THREE.Points(geo, this.weatherMat);
      this.weather.frustumCulled = false;
      this.weather.renderOrder = 6;
      this.scene.add(this.weather);
    }
  }

  private buildTrack() {
    const track = this.track;
    const t = track.theme;
    const group = new THREE.Group();
    this.scene.add(group);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const noiseTex = this.track2(makeNoiseTexture(hashString(track.id), 225, 28));
    const terrain = buildTerrain(track, noiseTex);
    if (terrain.mesh) {
      this.disposers.push(() => {
        terrain.mesh!.geometry.dispose();
        (terrain.mesh!.material as THREE.Material).dispose();
      });
      group.add(terrain.mesh);
    }

    const lowestRoad = Math.min(...track.samples.map((sample) => sample.y));

    // Custom GLSL Ocean or Molten Lava shader below the terrain, zero tiling repetition
    if (track.biome === 'beach') {
      const sunDir = new THREE.Vector3(...t.sunDir).normalize();
      const oceanMat = this.track2(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: sunDir },
          uSunColor: { value: new THREE.Color(t.sun) },
          uFogColor: { value: new THREE.Color(t.fog) },
          uFogDensity: { value: t.fogDensity },
        },
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uFogColor;
          uniform float uFogDensity;
          varying vec3 vWorldPos;
          float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
                       mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          float fbm2(vec2 p) {
            float s = 0.0; float a = 0.5;
            for (int i = 0; i < 3; i++) { s += vnoise(p) * a; p *= 2.04; a *= 0.5; }
            return s;
          }
          void main() {
            vec2 xz = vWorldPos.xz;
            float w1 = sin(xz.x * 0.075 + uTime * 1.4 + xz.y * 0.03);
            float w2 = cos(xz.y * 0.09 - uTime * 1.15 + xz.x * 0.025);
            float w3 = sin((xz.x - xz.y) * 0.14 + uTime * 1.9);
            float swell = fbm2(xz * 0.014 + vec2(uTime * 0.03, -uTime * 0.02));
            float waveH = (w1 * 0.4 + w2 * 0.35 + w3 * 0.25);
            vec3 nrm = normalize(vec3(
              (cos(xz.x * 0.075 + uTime * 1.4 + xz.y * 0.03) * 0.14 + cos((xz.x - xz.y) * 0.14 + uTime * 1.9) * 0.08),
              1.0,
              (-sin(xz.y * 0.09 - uTime * 1.15 + xz.x * 0.025) * 0.14 - cos((xz.x - xz.y) * 0.14 + uTime * 1.9) * 0.08)
            ));
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(1.0 - max(0.0, dot(viewDir, nrm)), 3.2);
            vec3 deepCol = vec3(0.04, 0.28, 0.56);
            vec3 turqCol = vec3(0.08, 0.68, 0.78);
            vec3 col = mix(deepCol, turqCol, clamp(swell * 1.15 + waveH * 0.12, 0.0, 1.0));
            col = mix(col, vec3(0.55, 0.86, 0.98), fresnel * 0.45);
            vec3 refl = reflect(-normalize(uSunDir), nrm);
            float spec = pow(max(0.0, dot(viewDir, refl)), 56.0);
            col += uSunColor * spec * 1.15;
            float crest = smoothstep(0.68, 0.96, waveH * 0.5 + 0.5 + (swell - 0.5) * 0.4);
            col = mix(col, vec3(0.85, 0.97, 1.0), crest * 0.24);
            float dist = length(cameraPosition - vWorldPos);
            float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
            col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }));
      this.shaderTimes.push(oceanMat);
      const plane = new THREE.Mesh(this.track2(new THREE.PlaneGeometry(6000, 6000)), oceanMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(terrain.center.x, lowestRoad - 7, terrain.center.z);
      group.add(plane);
    } else if (track.biome === 'lava') {
      const lavaMat = this.track2(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFogColor: { value: new THREE.Color(t.fog) },
          uFogDensity: { value: t.fogDensity },
        },
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uFogColor;
          uniform float uFogDensity;
          varying vec3 vWorldPos;
          float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
                       mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          float fbm2(vec2 p) {
            float s = 0.0; float a = 0.5;
            for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p *= 2.03; a *= 0.5; }
            return s;
          }
          void main() {
            vec2 p = vWorldPos.xz * 0.022;
            vec2 warp = vec2(fbm2(p + uTime * 0.05), fbm2(p + vec2(5.2, 1.3) - uTime * 0.04));
            float n = fbm2(p + warp * 1.6);
            float crack = 1.0 - smoothstep(0.0, 0.16, abs(n - 0.5));
            float pulse = 0.85 + 0.15 * sin(uTime * 2.2 + n * 10.0);
            vec3 crust = vec3(0.11, 0.05, 0.04);
            vec3 magma = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.55, 0.08), crack);
            magma = mix(magma, vec3(1.0, 0.92, 0.45), pow(crack, 3.0)) * pulse;
            vec3 col = mix(crust, magma, clamp(crack * 1.15 + smoothstep(0.62, 0.88, n) * 0.45, 0.0, 1.0));
            float dist = length(cameraPosition - vWorldPos);
            float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
            col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }));
      this.shaderTimes.push(lavaMat);
      const plane = new THREE.Mesh(this.track2(new THREE.PlaneGeometry(6000, 6000)), lavaMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(terrain.center.x, lowestRoad - 7, terrain.center.z);
      group.add(plane);
    } else if (track.biome !== 'space') {
      // Plain ground past the terrain edge so the horizon is never a hard line
      const plane = new THREE.Mesh(
        this.track2(new THREE.PlaneGeometry(7000, 7000)),
        this.track2(new THREE.MeshLambertMaterial({ color: t.groundLow })),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(terrain.center.x, -9, terrain.center.z);
      group.add(plane);
    }

    // Volcano crater glow & erupting ember anchor
    if (terrain.volcanoRadius > 0) {
      const craterY = terrain.heightAt(terrain.center.x, terrain.center.z) + 0.6;
      this.craterPos = new THREE.Vector3(terrain.center.x, craterY, terrain.center.z);
      const crater = new THREE.Mesh(
        this.track2(new THREE.CircleGeometry(terrain.volcanoRadius * 0.2, 24)),
        this.track2(new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false })),
      );
      crater.rotation.x = -Math.PI / 2;
      crater.position.set(terrain.center.x, craterY, terrain.center.z);
      group.add(crater);
      const glowTex = this.track2(makeBlobTexture('rgba(255,120,40,0.75)', 'rgba(255,60,0,0)'));
      const glow = new THREE.Sprite(this.track2(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })));
      glow.position.set(terrain.center.x, craterY + 10, terrain.center.z);
      glow.scale.setScalar(terrain.volcanoRadius * 1.1);
      group.add(glow);
    }

    // Dynamic split-capable road (left branch [-halfRoad, -dividerHalf], right branch [+dividerHalf, +halfRoad])
    const roadTex = this.track2(makeRoadTexture(track));
    roadTex.anisotropy = anisotropy;
    const roadMat = this.track2(t.rainbowRoad
      ? new THREE.MeshBasicMaterial({ map: roadTex, toneMapped: false })
      : track.biome === 'city'
        ? new THREE.MeshPhongMaterial({
            map: roadTex,
            shininess: 120,
            specular: new THREE.Color('#7dd3fc'),
            emissive: new THREE.Color(t.roadStripeColor),
            emissiveIntensity: 0.14,
            emissiveMap: roadTex,
          })
        : new THREE.MeshLambertMaterial({ map: roadTex, emissive: t.glowRoad ? new THREE.Color(t.roadStripeColor) : new THREE.Color('#000000'), emissiveIntensity: t.glowRoad ? 0.1 : 0, emissiveMap: t.glowRoad ? roadTex : null }));
    const leftRoadGeo = this.track2(dynamicRibbon(track, (_s, b) => {
      const lift = b.upperSide === -1 ? b.upperLift : 0;
      return { offA: -b.halfRoad, offB: -b.dividerHalf, yA: 0.06 + lift, yB: 0.06 + lift, uvA: 0, uvB: 0.5 };
    }, { length: track.totalLength, vScale: 26 }));
    const rightRoadGeo = this.track2(dynamicRibbon(track, (_s, b) => {
      const lift = b.upperSide === 1 ? b.upperLift : 0;
      return { offA: b.dividerHalf, offB: b.halfRoad, yA: 0.06 + lift, yB: 0.06 + lift, uvA: 0.5, uvB: 1 };
    }, { length: track.totalLength, vScale: 26 }));
    group.add(new THREE.Mesh(leftRoadGeo, roadMat), new THREE.Mesh(rightRoadGeo, roadMat));

    // Shoulders follow dynamic road/wall bounds and upper-deck elevation
    const shoulderMat = this.track2(new THREE.MeshLambertMaterial({ color: t.shoulder, map: noiseTex }));
    group.add(new THREE.Mesh(this.track2(dynamicRibbon(track, (_s, b) => {
      const lift = b.upperSide === -1 ? b.upperLift : 0;
      return { offA: -b.wallWidth - 2.4, offB: -b.halfRoad, yA: -0.05 + lift, yB: -0.05 + lift };
    }, { length: track.totalLength, vScale: 14 })), shoulderMat));
    group.add(new THREE.Mesh(this.track2(dynamicRibbon(track, (_s, b) => {
      const lift = b.upperSide === 1 ? b.upperLift : 0;
      return { offA: b.halfRoad, offB: b.wallWidth + 2.4, yA: -0.05 + lift, yB: -0.05 + lift };
    }, { length: track.totalLength, vScale: 14 })), shoulderMat));

    if (track.biome === 'space') {
      // Twin glowing undersides split cleanly when the star ribbons diverge
      const underMat = this.track2(new THREE.MeshBasicMaterial({ color: '#5b21b6', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
      group.add(new THREE.Mesh(this.track2(dynamicRibbon(track, (_s, b) => {
        const lift = b.upperSide === -1 ? b.upperLift : 0;
        return { offA: -b.wallWidth - 1.6, offB: -b.dividerHalf, yA: -1.6 + lift, yB: -1.6 + lift };
      }, { length: track.totalLength })), underMat));
      group.add(new THREE.Mesh(this.track2(dynamicRibbon(track, (_s, b) => {
        const lift = b.upperSide === 1 ? b.upperLift : 0;
        return { offA: b.dividerHalf, offB: b.wallWidth + 1.6, yA: -1.6 + lift, yB: -1.6 + lift };
      }, { length: track.totalLength })), underMat));
    }

    // Dynamic curbs & barriers (with real physical openings for hidden shortcuts!)
    const vertexMat = this.track2(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const curbA = new THREE.Color(t.curbColorA);
    const curbB = new THREE.Color(t.curbColorB);
    const curbW = 1.9;
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === -1 ? b.upperLift : 0;
      return { inner: -b.halfRoad - curbW, outer: -b.halfRoad + 0.3, yBottom: -0.2 + lift, yTop: 0.2 + lift, active: true };
    }, curbA, curbB, 2, (s) => isShortcutWallOpening(track, s.progress, -1))), vertexMat));
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === 1 ? b.upperLift : 0;
      return { inner: b.halfRoad - 0.3, outer: b.halfRoad + curbW, yBottom: -0.2 + lift, yTop: 0.2 + lift, active: true };
    }, curbA, curbB, 2, (s) => isShortcutWallOpening(track, s.progress, 1))), vertexMat));

    // Inner split curbs along the central divider
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === -1 ? b.upperLift : 0;
      return { inner: -b.dividerHalf - 0.2, outer: -b.dividerHalf + 1.3, yBottom: -0.2 + lift, yTop: 0.22 + lift, active: b.dividerHalf > 0.4 };
    }, curbA, curbB, 2, (_s, b) => b.dividerHalf <= 0.35)), vertexMat));
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === 1 ? b.upperLift : 0;
      return { inner: b.dividerHalf - 1.3, outer: b.dividerHalf + 0.2, yBottom: -0.2 + lift, yTop: 0.22 + lift, active: b.dividerHalf > 0.4 };
    }, curbA, curbB, 2, (_s, b) => b.dividerHalf <= 0.35)), vertexMat));

    const wallA = new THREE.Color(t.wallColor);
    const wallB = wallA.clone().lerp(new THREE.Color(t.wallTop), 0.28);
    const wallH = t.wallHeight;
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === -1 ? b.upperLift : 0;
      return { inner: -b.wallWidth - 1.3, outer: -b.wallWidth, yBottom: -9, yTop: wallH + lift, active: true };
    }, wallA, wallB, 4, (s) => isShortcutWallOpening(track, s.progress, -1))), vertexMat));
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === 1 ? b.upperLift : 0;
      return { inner: b.wallWidth, outer: b.wallWidth + 1.3, yBottom: -9, yTop: wallH + lift, active: true };
    }, wallA, wallB, 4, (s) => isShortcutWallOpening(track, s.progress, 1))), vertexMat));

    // Bright top rail along barriers (omitted across shortcut openings so the gap is obvious)
    const railMat = this.track2(new THREE.MeshBasicMaterial({ color: t.wallTop, toneMapped: false }));
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === -1 ? b.upperLift : 0;
      return { inner: -b.wallWidth - 0.85, outer: -b.wallWidth - 0.35, yBottom: wallH + lift - 0.04, yTop: wallH + lift + 0.05, active: true };
    }, new THREE.Color(t.wallTop), new THREE.Color(t.wallTop), 1, (s) => isShortcutWallOpening(track, s.progress, -1))), railMat));
    group.add(new THREE.Mesh(this.track2(dynamicBarrier(track, (b) => {
      const lift = b.upperSide === 1 ? b.upperLift : 0;
      return { inner: b.wallWidth + 0.35, outer: b.wallWidth + 0.85, yBottom: wallH + lift - 0.04, yTop: wallH + lift + 0.05, active: true };
    }, new THREE.Color(t.wallTop), new THREE.Color(t.wallTop), 1, (s) => isShortcutWallOpening(track, s.progress, 1))), railMat));

    // Scenery, split dividers/signposts, and hidden shortcuts
    const propMat = this.track2(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const glowMat = this.track2(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.lighthouseBeam = buildScenery(track, terrain, group, propMat, glowMat, this.disposers, this.pulseMats, lowestRoad);
    buildSplitStructures(track, group, propMat, glowMat, this.disposers);
    buildShortcuts(track, group, glowMat, this.disposers, this.pulseMats);

    // Shared contact shadow texture & geometry for item boxes, stationary hazards & moving hazards
    this.shadowTex = this.track2(makeBlobTexture('rgba(0,0,0,0.68)', 'rgba(0,0,0,0)'));
    this.shadowGeo = this.track2(new THREE.PlaneGeometry(1, 1));
    this.shadowGeo.rotateX(-Math.PI / 2);

    // Distant flying traffic light streaks in Cyber Metropolis
    if (track.biome === 'city') {
      const trafficCount = 42;
      const streakGeo = this.track2(new THREE.BoxGeometry(0.8, 0.4, 11));
      const streakMat = this.track2(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      const trafficMesh = this.track2(new THREE.InstancedMesh(streakGeo, streakMat, trafficCount));
      trafficMesh.frustumCulled = false;
      const tRng = mulberry32(hashString(track.id) + 909);
      const colors = ['#00f5ff', '#ff4fd8', '#facc15', '#38bdf8'];
      for (let i = 0; i < trafficCount; i++) {
        this.trafficLanes.push({
          cx: terrain.center.x + (tRng() - 0.5) * 180,
          cz: terrain.center.z + (tRng() - 0.5) * 180,
          r: 220 + tRng() * 380,
          y: 48 + tRng() * 110,
          speed: 0.14 + tRng() * 0.22,
          phase: tRng() * Math.PI * 2,
          dir: i % 2 === 0 ? 1 : -1,
        });
        trafficMesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      }
      if (trafficMesh.instanceColor) trafficMesh.instanceColor.needsUpdate = true;
      group.add(trafficMesh);
      this.trafficMesh = trafficMesh;
    }

    this.buildStartLine(group, anisotropy);

    // Boost pads: scrolling chevrons laid on the road
    const padTex = this.track2(makeChevronTexture('#ffb02e', '#ff5a1f', '#7a1d00'));
    padTex.repeat.set(1, 2);
    padTex.anisotropy = anisotropy;
    this.animated.push({ tex: padTex, speed: 1.1 });
    const padMat = this.track2(new THREE.MeshBasicMaterial({ map: padTex, toneMapped: false, transparent: true, opacity: 0.96 }));
    const padGeo = new THREE.PlaneGeometry(7.4, 10);
    padGeo.rotateX(-Math.PI / 2);
    const padMesh = this.track2(new THREE.InstancedMesh(this.track2(padGeo), padMat, track.boostPads.length));
    track.boostPads.forEach((pad, i) => {
      this.dummy.position.set(pad.x, pad.y + 0.16, pad.z);
      this.dummy.rotation.set(0, pad.angle + Math.PI, 0);
      this.dummy.updateMatrix();
      padMesh.setMatrixAt(i, this.dummy.matrix);
    });
    padMesh.frustumCulled = false;
    group.add(padMesh);

    // Ramps
    const rampTex = this.track2(makeChevronTexture('#ffffff', '#22d3ee', '#0ea5e9'));
    rampTex.repeat.set(track.roadWidth / 8, 1);
    rampTex.anisotropy = anisotropy;
    const rampMat = this.track2(new THREE.MeshLambertMaterial({ map: rampTex, side: THREE.DoubleSide, emissive: '#0ea5e9', emissiveIntensity: 0.25 }));
    const RAMP_LEN = 11;
    const RAMP_H = 2.6;
    for (const ramp of track.ramps) {
      // Built along the road so it sits flush on hills and curves
      const startP = ramp.progress - RAMP_LEN / track.totalLength;
      this.rampSpans.push({ start: startP, end: ramp.progress, height: RAMP_H });
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const p = startP + (ramp.progress - startP) * f;
        const s = sampleTrackAtProgress(track, p);
        const rw = getTrackBoundsAt(track, p).halfRoad;
        const lift = RAMP_H * f + 0.08;
        for (const side of [-1, 1]) {
          const off = side * (rw + 0.5);
          pos.push(s.x + s.nx * off, s.y + Math.sin(s.bank) * off + lift, s.z + s.nz * off);
          uv.push((side + 1) / 2, f * 2);
        }
        if (i < steps) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      // Rear face drops back to the road
      const lastTop = steps * 2;
      const end = sampleTrackAtProgress(track, ramp.progress);
      const endW = getTrackBoundsAt(track, ramp.progress).halfRoad;
      for (const side of [-1, 1]) {
        const off = side * (endW + 0.5);
        pos.push(end.x + end.nx * off, end.y + Math.sin(end.bank) * off - 0.2, end.z + end.nz * off);
        uv.push((side + 1) / 2, 0);
      }
      idx.push(lastTop, lastTop + 2, lastTop + 1, lastTop + 1, lastTop + 2, lastTop + 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      group.add(new THREE.Mesh(this.track2(geo), rampMat));
    }

    // Interactive Track Features: boost_ring, mega_ramp, moving_hazard
    const megaTex = this.track2(makeChevronTexture('#fde047', '#00f5ff', '#0c4a6e'));
    megaTex.repeat.set(2, 2);
    megaTex.anisotropy = anisotropy;
    this.animated.push({ tex: megaTex, speed: 1.5 });
    const megaMat = this.track2(new THREE.MeshBasicMaterial({ map: megaTex, side: THREE.DoubleSide, toneMapped: false }));
    const ringOuterMat = this.track2(new THREE.MeshBasicMaterial({ color: '#00f5ff', transparent: true, opacity: 0.9, toneMapped: false }));
    const ringInnerMat = this.track2(new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.pulseMats.push(ringOuterMat);
    const starGeo = this.track2(new THREE.OctahedronGeometry(0.95, 0));
    const starMat = this.track2(new THREE.MeshBasicMaterial({ color: '#fde047', toneMapped: false }));

    for (const feat of track.features) {
      if (feat.kind === 'boost_ring') {
        const portal = new THREE.Group();
        portal.position.set(feat.x, feat.y, feat.z);
        portal.rotation.y = feat.angle;
        const outer = new THREE.Mesh(this.track2(new THREE.TorusGeometry(5.2, 0.36, 10, 28)), ringOuterMat);
        outer.position.y = 3.5;
        const inner = new THREE.Mesh(this.track2(new THREE.TorusGeometry(4.1, 0.22, 8, 20)), ringInnerMat);
        inner.position.y = 3.5;
        const pylonGeo = this.track2(new THREE.BoxGeometry(0.9, 3.8, 0.9));
        const pylonMat = this.track2(new THREE.MeshLambertMaterial({ color: '#0f172a' }));
        const lp = new THREE.Mesh(pylonGeo, pylonMat);
        lp.position.set(-5.2, 1.8, 0);
        const rp = new THREE.Mesh(pylonGeo, pylonMat);
        rp.position.set(5.2, 1.8, 0);
        portal.add(outer, inner, lp, rp);
        group.add(portal);
        this.boostRings.push({ ring: outer, inner });
      } else if (feat.kind === 'mega_ramp') {
        const MEGA_LEN = 14;
        const MEGA_H = 4.2;
        const startP = feat.progress - MEGA_LEN / track.totalLength;
        const bFeat = getTrackBoundsAt(track, feat.progress);
        const rampHalf = Math.min(bFeat.halfRoad * 0.8, Math.max(10, bFeat.halfRoad * 0.72));
        const centerOff = feat.lateral * bFeat.halfRoad;
        const latMin = Math.max(-bFeat.halfRoad, centerOff - rampHalf);
        const latMax = Math.min(bFeat.halfRoad, centerOff + rampHalf);
        this.rampSpans.push({ start: startP, end: feat.progress, height: MEGA_H, latMin, latMax });

        const pos: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const p = startP + (feat.progress - startP) * f;
          const s = sampleTrackAtProgress(track, p);
          const b = getTrackBoundsAt(track, p);
          const lift = MEGA_H * f * f * 0.4 + MEGA_H * f * 0.6 + 0.1;
          for (const side of [-1, 1]) {
            const off = side < 0 ? latMin : latMax;
            const upper = b.upperSide !== 0 && Math.sign(off) === b.upperSide ? b.upperLift : 0;
            pos.push(s.x + s.nx * off, s.y + Math.sin(s.bank) * off + upper + lift, s.z + s.nz * off);
            uv.push((side + 1) / 2, f * 2.5);
          }
          if (i < steps) {
            const a = i * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
        const lastTop = steps * 2;
        const end = sampleTrackAtProgress(track, feat.progress);
        const endB = getTrackBoundsAt(track, feat.progress);
        for (const side of [-1, 1]) {
          const off = side < 0 ? latMin : latMax;
          const upper = endB.upperSide !== 0 && Math.sign(off) === endB.upperSide ? endB.upperLift : 0;
          pos.push(end.x + end.nx * off, end.y + Math.sin(end.bank) * off + upper - 0.2, end.z + end.nz * off);
          uv.push((side + 1) / 2, 0);
        }
        idx.push(lastTop, lastTop + 2, lastTop + 1, lastTop + 1, lastTop + 2, lastTop + 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(this.track2(geo), megaMat));

        // Floating parabolic aerial star/coin arc above the mega jump trajectory
        for (let k = 1; k <= 6; k++) {
          const arcT = k / 7;
          const pArc = feat.progress + (arcT * 52) / track.totalLength;
          const sArc = sampleTrackAtProgress(track, pArc);
          const bArc = getTrackBoundsAt(track, pArc);
          const upperArc = bArc.upperSide !== 0 && Math.sign(centerOff) === bArc.upperSide ? bArc.upperLift : 0;
          const arcY = sArc.y + Math.sin(sArc.bank) * centerOff + upperArc + MEGA_H + Math.sin(arcT * Math.PI) * 9.5;
          const star = new THREE.Mesh(starGeo, starMat);
          star.position.set(sArc.x + sArc.nx * centerOff, arcY, sArc.z + sArc.nz * centerOff);
          group.add(star);
          this.aerialStars.push(star);
        }
      } else if (feat.kind === 'moving_hazard') {
        const haz = buildMovingHazardMesh(track.biome, this.disposers);
        const initPos = getMovingHazardPosition(track, feat, 0);
        haz.group.position.set(initPos.x, initPos.y, initPos.z);
        haz.group.rotation.y = initPos.angle;
        group.add(haz.group);

        const shMat = this.track2(new THREE.MeshBasicMaterial({
          map: this.shadowTex,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        }));
        const shadow = new THREE.Mesh(this.shadowGeo, shMat);
        shadow.scale.set(5.4, 1, 5.4);
        shadow.position.set(initPos.x, initPos.y + 0.12, initPos.z);
        shadow.renderOrder = 2;
        group.add(shadow);

        this.movingHazards.push({
          def: feat,
          group: haz.group,
          shadow,
          spinTarget: haz.spinTarget,
          pulsePart: haz.pulsePart,
          prevLat: initPos.lateralOffset,
        });
      }
    }

    // Item boxes share one instanced mesh; the slots are animated each frame
    const boxTex = this.track2(makeItemBoxTexture());
    const boxMat = this.track2(new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, opacity: 0.92, toneMapped: false }));
    const boxGeo = this.track2(new THREE.BoxGeometry(3.1, 3.1, 3.1));
    const maxBoxes = track.itemBoxes.length + 16;
    this.itemBoxMesh = this.track2(new THREE.InstancedMesh(boxGeo, boxMat, maxBoxes));
    this.itemBoxMesh.frustumCulled = false;
    this.itemBoxMesh.count = maxBoxes;

    const boxShadowMat = this.track2(new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    }));
    this.itemBoxShadowMesh = this.track2(new THREE.InstancedMesh(this.shadowGeo, boxShadowMat, maxBoxes));
    this.itemBoxShadowMesh.frustumCulled = false;
    this.itemBoxShadowMesh.renderOrder = 2;
    this.itemBoxShadowMesh.count = maxBoxes;

    this.dummy.position.set(0, -500, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < maxBoxes; i++) {
      this.itemBoxMesh.setMatrixAt(i, this.dummy.matrix);
      this.itemBoxShadowMesh.setMatrixAt(i, this.dummy.matrix);
    }
    track.itemBoxes.forEach((b, index) => {
      this.itemBoxSlots.set(b.id, { index, x: b.x, y: b.y, z: b.z, scale: 1, active: true });
    });
    group.add(this.itemBoxMesh, this.itemBoxShadowMesh);

    // Spinning 3D gold coins
    const coinCount = Math.max(1, track.coins.length);
    const cGeo = this.track2(coinGeometry());
    const cMat = this.track2(new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 110,
      specular: new THREE.Color('#ffffff'),
      emissive: new THREE.Color('#ca8a04'),
      emissiveIntensity: 0.25,
    }));
    this.coinMesh = this.track2(new THREE.InstancedMesh(cGeo, cMat, coinCount));
    this.coinMesh.frustumCulled = false;
    for (let i = 0; i < coinCount; i++) this.coinMesh.setMatrixAt(i, this.dummy.matrix);
    track.coins.forEach((c, index) => {
      this.coinSlots.set(c.id, { index, x: c.x, y: c.y, z: c.z, scale: 1, active: true });
    });
    group.add(this.coinMesh);

    // Tire skidmark ring buffer
    const skidGeo = this.track2(new THREE.PlaneGeometry(0.46, 2.1));
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = this.track2(new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }));
    this.skidMesh = this.track2(new THREE.InstancedMesh(skidGeo, skidMat, SKID_CAP));
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 1;
    const initSkidCol = new THREE.Color('#141820');
    for (let i = 0; i < SKID_CAP; i++) {
      this.skidMesh.setMatrixAt(i, this.dummy.matrix);
      this.skidMesh.setColorAt(i, initSkidCol);
    }
    if (this.skidMesh.instanceColor) this.skidMesh.instanceColor.needsUpdate = true;
    group.add(this.skidMesh);
  }

  private buildStartLine(group: THREE.Group, anisotropy: number) {
    const track = this.track;
    const start = track.samples[0];
    const wall = track.wallWidth;

    // Checker strip across the road
    const checker = this.track2(canvasTexture(128, (ctx, w, h) => {
      const n = 8;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#f8fafc' : '#0b0f1a';
          ctx.fillRect((x * w) / n, (y * h) / n, w / n + 1, h / n + 1);
        }
      }
    }));
    checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
    checker.repeat.set(track.roadWidth / 8, 1);
    checker.anisotropy = anisotropy;
    const stripGeo = new THREE.PlaneGeometry(track.roadWidth, 4);
    stripGeo.rotateX(-Math.PI / 2);
    const strip = new THREE.Mesh(this.track2(stripGeo), this.track2(new THREE.MeshLambertMaterial({ map: checker })));
    strip.position.set(start.x, start.y + 0.14, start.z);
    strip.rotation.y = start.angle;
    group.add(strip);

    // Grid boxes painted behind the line
    const box = new THREE.PlaneGeometry(track.roadWidth * 0.3, 7);
    box.rotateX(-Math.PI / 2);
    const boxMat = this.track2(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16 }));
    const boxes = this.track2(new THREE.InstancedMesh(this.track2(box), boxMat, 16));
    for (let i = 0; i < 16; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2 === 0 ? -1 : 1;
      const s = sampleTrackAtProgress(track, 1 - (12 + row * 12 + (i % 2) * 4 + 1) / track.totalLength);
      const lat = col * track.roadWidth * 0.24;
      this.dummy.position.set(s.x + s.nx * lat, s.y + Math.sin(s.bank) * lat + 0.13, s.z + s.nz * lat);
      this.dummy.rotation.set(0, s.angle, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      boxes.setMatrixAt(i, this.dummy.matrix);
    }
    boxes.frustumCulled = false;
    group.add(boxes);

    // Gantry
    const gantry = new THREE.Group();
    gantry.position.set(start.x, start.y, start.z);
    gantry.rotation.y = start.angle;
    const pillarDist = wall + 2.6;
    const accent = this.track.theme.accentColor;
    const pillarGeo = this.track2(new THREE.BoxGeometry(1.8, 16, 1.8));
    const pillarMat = this.track2(new THREE.MeshLambertMaterial({ color: '#1f2937' }));
    const lp = new THREE.Mesh(pillarGeo, pillarMat);
    lp.position.set(-pillarDist, 8, 0);
    const rp = new THREE.Mesh(pillarGeo, pillarMat);
    rp.position.set(pillarDist, 8, 0);
    const beamTex = this.track2(canvasTexture(1024, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, accent);
      g.addColorStop(0.5, '#111827');
      g.addColorStop(1, accent);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.font = '900 76px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`🏁  ${track.name.toUpperCase()}  🏁`, w / 2, h / 2 + 4);
    }, 128));
    const beam = new THREE.Mesh(
      this.track2(new THREE.BoxGeometry(pillarDist * 2 + 2, 4, 1.6)),
      [
        pillarMat,
        pillarMat,
        pillarMat,
        pillarMat,
        this.track2(new THREE.MeshBasicMaterial({ map: beamTex, toneMapped: false })),
        // The back face is what you see when approaching the line from behind
        this.track2(new THREE.MeshBasicMaterial({ map: beamTex, toneMapped: false })),
      ],
    );
    beam.position.set(0, 15, 0);
    gantry.add(lp, rp, beam);

    // Countdown lights, on the side of the beam facing the grid
    const lightGeo = this.track2(new THREE.SphereGeometry(1, 16, 12));
    for (let i = 0; i < 3; i++) {
      const mat = this.track2(new THREE.MeshBasicMaterial({ color: '#2b3244', toneMapped: false }));
      const bulb = new THREE.Mesh(lightGeo, mat);
      bulb.position.set((i - 1) * 3.2, 11.6, -0.2);
      gantry.add(bulb);
      this.gantryLights.push(mat);
    }
    group.add(gantry);

    // Grandstands with a crowd, wherever there's room beside the straight
    const crowd = this.track2(canvasTexture(256, (ctx, w, h) => {
      const rng = mulberry32(7);
      ctx.fillStyle = '#20263a';
      ctx.fillRect(0, 0, w, h);
      const colors = ['#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#a855f7', '#f472b6', '#f8fafc'];
      for (let y = 4; y < h; y += 14) {
        for (let x = (y / 14) % 2 === 0 ? 3 : 9; x < w; x += 12) {
          ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
          ctx.fillRect(x, y + 6, 8, 7);
          ctx.fillStyle = '#f4c7a1';
          ctx.fillRect(x + 2, y, 4, 5);
        }
      }
    }));
    crowd.wrapS = THREE.RepeatWrapping;
    crowd.repeat.set(4, 1);
    const crowdMat = this.track2(new THREE.MeshLambertMaterial({ map: crowd }));
    const roofMat = this.track2(new THREE.MeshLambertMaterial({ color: accent }));
    for (const side of [-1, 1]) {
      const s = sampleTrackAtProgress(track, 1 - 26 / track.totalLength);
      const standDist = wall + 13;
      const cx = s.x + s.nx * side * standDist;
      const cz = s.z + s.nz * side * standDist;
      let clear = true;
      for (let i = 0; i < track.samples.length; i += 3) {
        const o = track.samples[i];
        if (Math.hypot(cx - o.x, cz - o.z) < wall + 8) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const stand = new THREE.Group();
      stand.position.set(cx, s.y - 1, cz);
      stand.rotation.y = s.angle;
      const seats = new THREE.Mesh(this.track2(new THREE.PlaneGeometry(52, 18)), crowdMat);
      // Local +X is the road's left, so a stand on the right (+n) faces +X
      seats.rotation.set(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      seats.rotateX(-0.62);
      seats.position.set(-side * 3, 7, 0);
      const roof = new THREE.Mesh(this.track2(new THREE.BoxGeometry(18, 0.8, 54)), roofMat);
      roof.position.set(-side * 4, 15.5, 0);
      roof.rotation.z = -side * 0.08;
      stand.add(seats, roof);
      group.add(stand);
    }
  }

  // ─── Karts ─────────────────────────────────────────────────────────────────

  private createKart(k: SnapKart): KartVisual {
    const root = new THREE.Group();
    const chassisGroup = new THREE.Group();
    root.add(chassisGroup);
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(r: T) => {
      disposables.push(r);
      return r;
    };
    const baseColor = new THREE.Color(k.color);
    const bodyMat = keep(new THREE.MeshPhongMaterial({ color: baseColor.clone(), shininess: 95, specular: new THREE.Color('#ffffff'), side: THREE.DoubleSide }));
    const trimMat = keep(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 85, specular: new THREE.Color('#e2e8f0') }));

    const body = new THREE.Mesh(keep(kartBodyGeometry(k.kartStyle)), bodyMat);
    const trim = new THREE.Mesh(keep(kartTrimGeometry(k.kartStyle, k.sparksColor)), trimMat);
    chassisGroup.add(body, trim);

    // LED Brake / Tail lights
    const brakeLightMat = keep(new THREE.MeshBasicMaterial({ color: '#551111', toneMapped: false }));
    const brakeLights = new THREE.Mesh(keep(brakeLightGeometry(k.kartStyle)), brakeLightMat);
    chassisGroup.add(brakeLights);

    // Exhaust tip rev glow
    const exhaustGlowMat = keep(new THREE.MeshBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const exhaustGlow = new THREE.Mesh(keep(exhaustGlowGeometry()), exhaustGlowMat);
    exhaustGlow.visible = false;
    chassisGroup.add(exhaustGlow);

    // Animated steering wheel
    const steerWheelGeo = keep(merged([
      colored(placed(new THREE.TorusGeometry(0.32, 0.055, 6, 12), 0, 0, 0), '#141824'),
      colored(placed(new THREE.BoxGeometry(0.56, 0.08, 0.06), 0, 0, 0), k.sparksColor),
    ]));
    const steerWheel = new THREE.Mesh(steerWheelGeo, trimMat);
    steerWheel.position.set(0, 1.15, 0.54);
    steerWheel.rotation.x = -0.68;
    chassisGroup.add(steerWheel);

    // Driver: upper body with shoulders, collar, animated arms, and crisp avatar emoji head
    const driverUpper = new THREE.Group();
    driverUpper.position.set(0, 1.05, -0.22);
    chassisGroup.add(driverUpper);

    const torso = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.38, 0.42, 3, 8)), bodyMat);
    torso.position.set(0, 0.25, 0);
    const shoulderGeo = keep(merged([
      colored(placed(new THREE.BoxGeometry(1.06, 0.26, 0.42), 0, 0.46, 0), k.color),
      colored(placed(new THREE.CylinderGeometry(0.3, 0.34, 0.16, 10), 0, 0.62, 0), '#f8fafc'),
      colored(placed(new THREE.SphereGeometry(0.54, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.08, 0.02, { rx: -0.25 }), '#1e293b'),
    ]));
    const shoulders = new THREE.Mesh(shoulderGeo, trimMat);
    driverUpper.add(torso, shoulders);

    const armGeo = keep(merged([
      colored(placed(new THREE.CapsuleGeometry(0.11, 0.48, 3, 6), 0, 0, 0.28, { rx: Math.PI / 2 - 0.18 }), k.color),
      colored(placed(new THREE.SphereGeometry(0.13, 6, 6), 0, -0.06, 0.6), '#1e293b'),
    ]));
    const leftArm = new THREE.Group();
    leftArm.position.set(0.46, 0.44, 0.06);
    leftArm.add(new THREE.Mesh(armGeo, trimMat));
    const rightArm = new THREE.Group();
    rightArm.position.set(-0.46, 0.44, 0.06);
    rightArm.add(new THREE.Mesh(armGeo, trimMat));
    driverUpper.add(leftArm, rightArm);

    const headTex = keep(makeEmojiTexture(k.avatar || '🏎️'));
    const head = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: headTex, transparent: true, toneMapped: false, depthWrite: false })));
    head.position.set(0, 1.15, 0.06);
    head.scale.setScalar(1.88);
    driverUpper.add(head);

    const tagTex = keep(makeNameTagTexture(k.name, k.color, k.isBot));
    const tagMat = keep(new THREE.SpriteMaterial({ map: tagTex, transparent: true, toneMapped: false, depthWrite: false, fog: false }));
    const tag = new THREE.Sprite(tagMat);
    tag.position.set(0, 4.15, 0);
    tag.scale.set(k.isBot ? 4.3 : 5.6, k.isBot ? 1.08 : 1.4, 1);
    root.add(tag);

    // Wheels
    const spec = WHEEL_SPECS[k.kartStyle] || WHEEL_SPECS.classic;
    const wheelMat = keep(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 55, specular: new THREE.Color('#ffffff') }));
    const wheelGeo = keep(wheelGeometry(spec.r, spec.w));
    const frontL = new THREE.Mesh(wheelGeo, wheelMat);
    frontL.position.set(spec.front[0], spec.front[1], spec.front[2]);
    const frontR = new THREE.Mesh(wheelGeo, wheelMat);
    frontR.position.set(-spec.front[0], spec.front[1], spec.front[2]);
    frontL.rotation.order = 'YXZ';
    frontR.rotation.order = 'YXZ';
    const rearGeo = keep(merged([
      placed(wheelGeometry(spec.r * 1.08, spec.w * 1.15), spec.rear[0], 0, 0),
      placed(wheelGeometry(spec.r * 1.08, spec.w * 1.15), -spec.rear[0], 0, 0),
    ]));
    const rear = new THREE.Mesh(rearGeo, wheelMat);
    rear.position.set(0, spec.rear[1], spec.rear[2]);
    chassisGroup.add(frontL, frontR, rear);

    // Contact shadow placed directly in scene at road height (immune to trick flips, crisp polygonOffset)
    const shadowTex = keep(makeBlobTexture());
    const shadowGeo = keep(new THREE.PlaneGeometry(5.5, 6.3));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = keep(new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    }));
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 2;
    this.scene.add(shadow);

    // Dual-core exhaust boost flames (outer tier-colored + inner white-hot core)
    const makeFlameGeo = (radius: number, length: number, zOff: number) => {
      const parts = [-0.62, 0.62].map((x) => {
        const g = new THREE.ConeGeometry(radius, length, 8);
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0.96, zOff);
        return g.toNonIndexed();
      });
      parts.forEach((g) => g.deleteAttribute('uv'));
      return keep(merged(parts));
    };
    const flameOuterMat = keep(new THREE.MeshBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const flameOuter = new THREE.Mesh(makeFlameGeo(0.42, 2.7, -3.45), flameOuterMat);
    flameOuter.visible = false;
    const flameInnerMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const flameInner = new THREE.Mesh(makeFlameGeo(0.21, 1.85, -3.1), flameInnerMat);
    flameInner.visible = false;
    chassisGroup.add(flameOuter, flameInner);

    // Star / shell-warning aura
    const auraTex = keep(makeBlobTexture('rgba(255,255,255,0.7)', 'rgba(255,255,255,0)'));
    const auraMat = keep(new THREE.SpriteMaterial({ map: auraTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const aura = new THREE.Sprite(auraMat);
    aura.position.y = 1.2;
    aura.scale.setScalar(8.5);
    aura.visible = false;
    root.add(aura);

    // Expanding sonic ring for Super Horn / honk
    const hornGeo = keep(new THREE.TorusGeometry(1, 0.09, 6, 32));
    hornGeo.rotateX(Math.PI / 2);
    const hornRingMat = keep(new THREE.MeshBasicMaterial({ color: '#d946ef', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const hornRing = new THREE.Mesh(hornGeo, hornRingMat);
    hornRing.position.set(0, 1.4, 0);
    hornRing.visible = false;
    root.add(hornRing);

    // Real 3D trailing held item behind the rear bumper
    const heldItemAnchor = new THREE.Group();
    heldItemAnchor.position.set(0, 1.15, -2.9);
    heldItemAnchor.visible = false;
    const heldItemMesh = new THREE.Mesh(new THREE.BufferGeometry(), keep(new THREE.MeshBasicMaterial()));
    heldItemAnchor.add(heldItemMesh);
    root.add(heldItemAnchor);

    if (k.kartStyle === 'cyber') {
      const glowTex = keep(makeBlobTexture('rgba(255,255,255,0.8)', 'rgba(255,255,255,0)'));
      const g = keep(new THREE.PlaneGeometry(5, 6));
      g.rotateX(-Math.PI / 2);
      const under = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ map: glowTex, color: k.sparksColor, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
      under.position.y = 0.09;
      under.renderOrder = 3;
      chassisGroup.add(under);
    }

    this.scene.add(root);
    return {
      root,
      chassisGroup,
      bodyMat,
      baseColor,
      brakeLightMat,
      exhaustGlow,
      exhaustGlowMat,
      steerWheel,
      driverUpper,
      leftArm,
      rightArm,
      frontL,
      frontR,
      rear,
      head,
      tag,
      tagMat,
      shadow,
      shadowMat,
      flameOuter,
      flameOuterMat,
      flameInner,
      aura,
      auraMat,
      hornRing,
      hornRingMat,
      heldItemAnchor,
      heldItemMesh,
      shownItem: null,
      disposables,
      x: k.x,
      y: 0,
      z: k.z,
      angle: k.angle,
      velAngle: k.velAngle,
      tx: k.x,
      tz: k.z,
      tAngle: k.angle,
      tVel: k.velAngle,
      tSpeed: k.speed,
      tProgress: k.progress,
      tLat: k.lateralOffset,
      rx: 0,
      spin: 0,
      squash: 0,
      prevHopT: 0,
      launchLift: 2.6,
      wheelRot: 0,
      sparkAcc: 0,
      dustAcc: 0,
      flameAcc: 0,
      skidAcc: 0,
      revAcc: 0,
      slipAcc: 0,
      hornPhase: 0,
      data: k,
    };
  }

  private heldItemAsset(item: KartItemType): { geo: THREE.BufferGeometry; mat: THREE.Material } {
    const cached = this.heldItemAssets.get(item);
    if (cached) return cached;

    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    const phong = (emissive = '#000000', emissiveIntensity = 0) =>
      new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: '#ffffff', emissive, emissiveIntensity });

    switch (item) {
      case 'green_shell':
      case 'red_shell':
      case 'spiny_shell':
      case 'banana':
      case 'fake_box': {
        const haz = this.hazardAsset(item);
        geo = haz.geo.clone();
        const s = item === 'fake_box' ? 0.44 : item === 'spiny_shell' ? 0.48 : item === 'banana' ? 0.72 : 0.62;
        geo.scale(s, s, s);
        if (item === 'banana') geo.translate(0, -0.5, 0);
        mat = haz.mat;
        this.disposers.push(() => geo.dispose());
        const entry = { geo, mat };
        this.heldItemAssets.set(item, entry);
        return entry;
      }
      case 'mushroom':
      case 'golden_mushroom': {
        const isGold = item === 'golden_mushroom';
        const capCol = isGold ? '#facc15' : '#ef4444';
        const spotCol = isGold ? '#fef9c3' : '#ffffff';
        const parts: THREE.BufferGeometry[] = [
          colored(placed(new THREE.CylinderGeometry(0.32, 0.4, 0.55, 10), 0, -0.25, 0), '#fef3c7'),
          colored(placed(new THREE.SphereGeometry(0.68, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), 0, 0.02, 0), capCol),
        ];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          parts.push(colored(placed(new THREE.SphereGeometry(0.18, 6, 5), Math.cos(a) * 0.46, 0.34, Math.sin(a) * 0.46), spotCol));
        }
        parts.push(colored(placed(new THREE.SphereGeometry(0.2, 6, 5), 0, 0.62, 0), spotCol));
        if (isGold) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            parts.push(colored(placed(new THREE.ConeGeometry(0.12, 0.3, 5), Math.cos(a) * 0.28, 0.72, Math.sin(a) * 0.28), '#fde047'));
          }
        }
        geo = merged(parts);
        mat = phong(isGold ? '#eab308' : '#000000', isGold ? 0.28 : 0);
        break;
      }
      case 'star': {
        const shape = new THREE.Shape();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 0.78 : 0.36;
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        }
        shape.closePath();
        const raw = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1 });
        raw.translate(0, 0, -0.12);
        geo = colored(raw, '#fde047');
        mat = phong('#facc15', 0.45);
        break;
      }
      case 'super_horn': {
        geo = merged([
          colored(placed(new THREE.CylinderGeometry(0.55, 0.2, 0.9, 12), 0, 0.1, 0.08, { rx: Math.PI / 2 - 0.15 }), '#9333ea'),
          colored(placed(new THREE.TorusGeometry(0.55, 0.08, 6, 14), 0, 0.17, 0.52), '#facc15'),
          colored(placed(new THREE.CylinderGeometry(0.1, 0.12, 0.42, 8), 0, -0.22, -0.05), '#e2e8f0'),
        ]);
        mat = phong('#a855f7', 0.25);
        break;
      }
      case 'lightning': {
        const shape = new THREE.Shape();
        shape.moveTo(0.15, 0.85);
        shape.lineTo(-0.35, 0.08);
        shape.lineTo(0.04, 0.08);
        shape.lineTo(-0.22, -0.85);
        shape.lineTo(0.38, -0.04);
        shape.lineTo(-0.02, -0.04);
        shape.closePath();
        const raw = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 1 });
        raw.translate(0, 0, -0.09);
        geo = colored(raw, '#fde047');
        mat = phong('#38bdf8', 0.35);
        break;
      }
    }
    this.disposers.push(() => geo.dispose());
    this.disposers.push(() => mat.dispose());
    const entry = { geo, mat };
    this.heldItemAssets.set(item, entry);
    return entry;
  }

  /** Called for every telemetry tick. */
  setSnapshot(snap: KartTelemetrySnapshot) {
    this.snapshot = snap;
    this.snapshotAt = performance.now();
    for (const k of snap.karts) {
      let v = this.karts.get(k.id);
      if (!v) {
        v = this.createKart(k);
        this.karts.set(k.id, v);
      }
      v.tx = k.x;
      v.tz = k.z;
      v.tAngle = k.angle;
      v.tVel = k.velAngle;
      v.tSpeed = k.speed;
      v.tProgress = k.progress;
      v.tLat = k.lateralOffset;
      v.data = k;
    }
    for (const e of snap.events || []) {
      if (e.id <= this.lastEventId) continue;
      this.lastEventId = e.id;
      this.handleEvent(e);
      this.onEvent?.(e);
    }
    this.syncHazards(snap.hazards);
    this.syncItemBoxes(snap.itemBoxes);
    this.syncCoins(snap.coins || []);
  }

  private burst(pool: ParticlePool, x: number, y: number, z: number, count: number, speed: number, color: THREE.ColorRepresentation | (() => THREE.ColorRepresentation), size: number, life: number, gravity = 18, upBias = 0.6) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const up = this.rng();
      const sp = speed * (0.4 + this.rng() * 0.6);
      pool.emit(x, y, z, Math.cos(a) * sp, (up + upBias) * sp * 0.7, Math.sin(a) * sp, typeof color === 'function' ? color() : color, size * (0.6 + this.rng() * 0.7), life * (0.6 + this.rng() * 0.6), gravity, 0.6);
    }
  }

  private roadY(x: number, z: number, hint?: number) {
    const sc = projectOntoShortcut(this.track, x, z);
    if (sc && sc.dist < sc.shortcut.width * 0.65) return sc.point.y;
    const p = projectOntoTrack(this.track, x, z, hint);
    const b = getTrackBoundsAt(this.track, p.progress);
    const lift = b.upperSide !== 0 && Math.sign(p.lateralOffset) === b.upperSide ? b.upperLift : 0;
    return p.sample.y + Math.sin(p.sample.bank) * p.lateralOffset + lift;
  }

  private handleEvent(e: KartEvent) {
    const v = e.kartId ? this.karts.get(e.kartId) : null;
    const x = e.x ?? v?.x ?? 0;
    const z = e.z ?? v?.z ?? 0;
    const y = (v ? v.y : this.roadY(x, z)) + 1.4;
    const rainbow = () => ['#ff4fd8', '#ffe11f', '#3bf06b', '#1fd9ff', '#ff8a1f'][Math.floor(this.rng() * 5)];
    switch (e.type) {
      case 'box':
        this.burst(this.additive, x, y + 1, z, 26, 18, rainbow, 1.5, 0.7);
        break;
      case 'hit':
        if (v) {
          v.spin = Math.PI * 4;
          this.burst(this.additive, v.x, y, v.z, 16, 15, () => (this.rng() > 0.5 ? '#ffe11f' : '#ffffff'), 1.6, 0.8);
          this.shakeFor(e.kartId!, 1);
        }
        break;
      case 'explosion': {
        const big = (e.value || 0) >= 2;
        this.burst(this.additive, x, y, z, big ? 110 : 34, big ? 34 : 18, () => (this.rng() > 0.5 ? '#ff8a1f' : '#ffd24a'), big ? 3.4 : 2, big ? 1.1 : 0.7, 12);
        this.burst(this.smoke, x, y, z, big ? 40 : 12, big ? 14 : 8, '#3b3b46', big ? 6 : 3.4, big ? 1.6 : 0.9, -4, 0.3);
        break;
      }
      case 'miniturbo':
        if (v) {
          const col = DRIFT_TIER_COLORS[e.value || 1];
          this.burst(this.additive, v.x, y - 0.6, v.z, 20 + (e.value || 1) * 14, 16, col, 1.5, 0.6);
        }
        break;
      case 'rocket':
        if (v) this.burst(this.additive, v.x, y - 0.6, v.z, 40, 18, () => (this.rng() > 0.5 ? '#ffb02e' : '#ffffff'), 1.8, 0.8);
        break;
      case 'stall':
        if (v) this.burst(this.smoke, v.x, y, v.z, 26, 7, '#20222a', 4, 1.4, -5, 0.4);
        break;
      case 'wall':
        this.burst(this.additive, x, y - 0.4, z, 16, 14, () => (this.rng() > 0.4 ? '#ffd24a' : '#ffffff'), 0.9, 0.45, 26);
        if (e.kartId) this.shakeFor(e.kartId, 0.5);
        break;
      case 'bump':
        this.burst(this.additive, x, y - 0.2, z, 10, 11, '#ffffff', 0.9, 0.35);
        break;
      case 'land':
        if (v) {
          v.squash = 1;
          this.burst(this.smoke, v.x, v.y + 0.3, v.z, 16, 8, this.dustColor(), 2.6, 0.7, -2, 0.1);
        }
        break;
      case 'trick':
        if (v) {
          this.burst(this.additive, v.x, y + 2, v.z, 24, 12, rainbow, 1.3, 0.6);
          v.rx = 0;
        }
        break;
      case 'finish':
        if (v && !v.data.isBot) {
          this.confettiUntil = this.time + 4;
          this.burst(this.additive, v.x, y + 4, v.z, 90, 26, rainbow, 1.7, 1.4, 16);
        }
        break;
      case 'lightning':
        for (const other of this.karts.values()) {
          if (other.data.id !== e.kartId && !other.data.finished && other.data.starTimer <= 0) {
            this.burst(this.additive, other.x, other.y + 2, other.z, 12, 8, '#9fe8ff', 1.5, 0.5);
          }
        }
        break;
      case 'horn':
        if (e.value && v) this.burst(this.additive, v.x, y, v.z, 40, 26, '#d8b4fe', 1.2, 0.5, 0);
        if (v) v.hornPhase = 0.01;
        break;
      case 'coin':
        this.burst(this.additive, x, y + 0.3, z, 20, 14, () => (this.rng() > 0.35 ? '#fde047' : '#ffffff'), 1.35, 0.55);
        break;
      case 'hop':
        if (v) this.burst(this.smoke, v.x, v.y + 0.25, v.z, 6, 5, this.dustColor(), 1.4, 0.35, -1, 0.05);
        break;
      case 'drift_tier':
        if (v) {
          const col = DRIFT_TIER_COLORS[e.value || 1];
          this.burst(this.additive, v.x, v.y + 0.4, v.z, 10 + (e.value || 1) * 5, 13, col, 1.1, 0.42);
        }
        break;
      case 'slipstream':
        if (v) this.burst(this.additive, v.x, v.y + 1.0, v.z, 16, 15, () => (this.rng() > 0.4 ? '#38bdf8' : '#ffffff'), 1.2, 0.45, 0);
        break;
      case 'shortcut':
        if (v) this.burst(this.additive, v.x, y + 1.2, v.z, 34, 20, rainbow, 1.6, 0.75);
        break;
      default:
        break;
    }
  }

  private dustColor() {
    switch (this.track.biome) {
      case 'snow': return '#f4faff';
      case 'canyon': return '#d9a273';
      case 'beach': return '#efe2b6';
      case 'lava': return '#3a2c28';
      case 'space': return '#8b7bff';
      default: return '#9aa3b8';
    }
  }

  private shakeFor(kartId: string, amount: number) {
    const rig = this.rigs.get(kartId);
    if (rig) rig.shake = Math.max(rig.shake, amount);
  }

  // ─── Hazards & boxes ───────────────────────────────────────────────────────

  private hazardAsset(kind: SnapHazard['kind']): { geo: THREE.BufferGeometry; mat: THREE.Material } {
    const key = kind;
    if (!this.hazardGeos[key]) {
      const shell = (dome: string, rim: string) => merged([
        colored(placed(new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.2, 0), dome),
        colored(placed(new THREE.CylinderGeometry(1.3, 1.2, 0.4, 14), 0, 0.15, 0), rim),
        colored(placed(new THREE.SphereGeometry(0.34, 6, 5), 0, 1.2, 0), rim),
      ]);
      let geo: THREE.BufferGeometry;
      let mat: THREE.Material;
      const phong = () => new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80 });
      switch (kind) {
        case 'banana':
          geo = merged([
            colored(placed(new THREE.TorusGeometry(0.8, 0.32, 8, 14, Math.PI * 1.1), 0, 0.85, 0, { rz: Math.PI * 0.95 }), '#ffe23a'),
            colored(placed(new THREE.ConeGeometry(0.22, 0.4, 6), 0.76, 1.2, 0), '#6b4f16'),
          ]);
          mat = phong();
          break;
        case 'red_shell':
          geo = shell('#ef2b2b', '#fff4e0');
          mat = phong();
          break;
        case 'spiny_shell': {
          const parts = [
            colored(placed(new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0), '#1d6fe0'),
            colored(placed(new THREE.CylinderGeometry(1.65, 1.5, 0.4, 16), 0, 0, 0), '#ffffff'),
            colored(placed(new THREE.BoxGeometry(2.8, 0.1, 0.9), 2.2, 0.3, 0, { rz: 0.3 }), '#f0f6ff'),
            colored(placed(new THREE.BoxGeometry(2.8, 0.1, 0.9), -2.2, 0.3, 0, { rz: -0.3 }), '#f0f6ff'),
          ];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            parts.push(colored(placed(new THREE.ConeGeometry(0.28, 0.9, 6), Math.cos(a) * 0.9, 1.1, Math.sin(a) * 0.9, { rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 }), '#ffffff'));
          }
          parts.push(colored(placed(new THREE.ConeGeometry(0.3, 1, 6), 0, 1.8, 0), '#ffffff'));
          geo = merged(parts);
          mat = phong();
          break;
        }
        case 'fake_box': {
          geo = new THREE.BoxGeometry(3.0, 3.0, 3.0);
          // Nearly passes for a real box, but it's upside-down and a shade too red
          const tex = canvasTexture(128, (ctx, w, h) => {
            const g = ctx.createLinearGradient(0, 0, w, h);
            g.addColorStop(0, '#ff5a7a');
            g.addColorStop(0.5, '#ffb02e');
            g.addColorStop(1, '#ff4fd8');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 8;
            ctx.strokeRect(4, 4, w - 8, h - 8);
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.rotate(Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.font = '900 88px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', 0, 4);
            ctx.restore();
          });
          this.disposers.push(() => tex.dispose());
          mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.94, toneMapped: false });
          break;
        }
        case 'shockwave':
          geo = new THREE.RingGeometry(0.72, 1, 40);
          geo.rotateX(-Math.PI / 2);
          mat = new THREE.MeshBasicMaterial({ color: '#d946ef', side: THREE.DoubleSide, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
          break;
        default:
          geo = shell('#22c55e', '#fff4e0');
          mat = phong();
      }
      this.hazardGeos[key] = geo;
      this.hazardMats[key] = mat;
      this.disposers.push(() => geo.dispose());
      this.disposers.push(() => mat.dispose());
    }
    return { geo: this.hazardGeos[key], mat: this.hazardMats[key] };
  }

  private syncHazards(list: SnapHazard[]) {
    const live = new Set(list.map((h) => h.id));
    for (const [id, obj] of this.hazards) {
      if (!live.has(id)) {
        this.scene.remove(obj);
        if (obj.userData.shadow) {
          const sh = obj.userData.shadow as THREE.Mesh;
          this.scene.remove(sh);
          (sh.material as THREE.Material).dispose();
        }
        // Shockwaves own a material clone because each fades on its own
        if (obj.userData.ownMat) ((obj as THREE.Mesh).material as THREE.Material).dispose();
        this.hazards.delete(id);
      }
    }
    for (const h of list) {
      let obj = this.hazards.get(h.id);
      if (!obj) {
        const asset = this.hazardAsset(h.kind);
        const mat = h.kind === 'shockwave' ? asset.mat.clone() : asset.mat;
        obj = new THREE.Mesh(asset.geo, mat);
        const baseY = h.kind === 'banana' || h.kind === 'fake_box' || h.kind === 'shockwave' ? this.roadY(h.x, h.z) : 0;
        let shadow: THREE.Mesh | undefined;
        if (h.kind === 'banana' || h.kind === 'fake_box') {
          const shMat = new THREE.MeshBasicMaterial({
            map: this.shadowTex,
            transparent: true,
            opacity: h.kind === 'fake_box' ? 0.55 : 0.62,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            toneMapped: false,
          });
          shadow = new THREE.Mesh(this.shadowGeo, shMat);
          const shScale = h.kind === 'fake_box' ? 3.8 : 2.6;
          shadow.scale.set(shScale, 1, shScale);
          shadow.position.set(h.x, baseY + 0.12, h.z);
          shadow.renderOrder = 2;
          this.scene.add(shadow);
        }
        obj.userData = {
          ownMat: h.kind === 'shockwave',
          kind: h.kind,
          hint: undefined as number | undefined,
          baseY,
          shadow,
          tx: h.x,
          tz: h.z,
          born: performance.now(),
        };
        obj.position.set(h.x, baseY, h.z);
        this.scene.add(obj);
        this.hazards.set(h.id, obj);
      }
      obj.userData.tx = h.x;
      obj.userData.tz = h.z;
      obj.userData.age = h.age;
      obj.userData.ttl = h.ttl;
      obj.userData.angle = h.angle;
    }
  }

  private syncCoins(list: KartTelemetrySnapshot['coins']) {
    for (const c of list) {
      const slot = this.coinSlots.get(c.id);
      if (slot) slot.active = c.active;
    }
  }

  private syncItemBoxes(list: KartTelemetrySnapshot['itemBoxes']) {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      let slot = this.itemBoxSlots.get(b.id);
      if (!slot) {
        // Bonus boxes dropped by the pit crew take the spare slots
        const used = new Set([...this.itemBoxSlots.values()].map((s) => s.index));
        let index = -1;
        for (let i = this.track.itemBoxes.length; i < this.itemBoxMesh.count; i++) {
          if (!used.has(i)) {
            index = i;
            break;
          }
        }
        if (index < 0) continue;
        slot = { index, x: b.x, y: this.roadY(b.x, b.z), z: b.z, scale: 0, active: true };
        this.itemBoxSlots.set(b.id, slot);
      }
      slot.active = b.active;
    }
    for (const [id, slot] of this.itemBoxSlots) {
      if (!seen.has(id) && slot.index >= this.track.itemBoxes.length) {
        this.dummy.position.set(0, -500, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.itemBoxMesh.setMatrixAt(slot.index, this.dummy.matrix);
        this.itemBoxSlots.delete(id);
      }
    }
  }

  // ─── Frame update ──────────────────────────────────────────────────────────

  private rampLift(progress: number, lateral: number) {
    for (const r of this.rampSpans) {
      if (typeof r.latMin === 'number' && typeof r.latMax === 'number') {
        if (lateral < r.latMin || lateral > r.latMax) continue;
      }
      const p = progress < r.start && r.start > 0.9 ? progress + 1 : progress;
      if (p >= r.start && p <= r.end) return ((p - r.start) / (r.end - r.start)) * r.height;
    }
    return 0;
  }

  private updateKarts(dt: number, now: number) {
    const sinceSnap = Math.min(0.1, (now - this.snapshotAt) / 1000);
    const posBlend = 1 - Math.exp(-dt * 22);
    const angBlend = 1 - Math.exp(-dt * 20);
    const track = this.track;

    for (const v of this.karts.values()) {
      const k = v.data;
      // Dead-reckon from the last tick so 30Hz telemetry renders smoothly without adding lag
      const moving = this.snapshot && !this.snapshot.waitingForOrientation && this.snapshot.countdownMs <= 0;
      const predX = v.tx + (moving ? Math.sin(v.tVel) * v.tSpeed * sinceSnap : 0);
      const predZ = v.tz + (moving ? Math.cos(v.tVel) * v.tSpeed * sinceSnap : 0);
      if (Math.hypot(predX - v.x, predZ - v.z) > 30) {
        v.x = predX;
        v.z = predZ;
      } else {
        v.x += (predX - v.x) * posBlend;
        v.z += (predZ - v.z) * posBlend;
      }
      const lerpAng = (a: number, b: number, t: number) => {
        let d = (b - a) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
      };
      v.angle = lerpAng(v.angle, v.tAngle, angBlend);
      v.velAngle = lerpAng(v.velAngle, v.tVel, angBlend);

      const progress = v.tProgress + (moving ? (v.tSpeed * sinceSnap) / track.totalLength : 0);
      const s = sampleTrackAtProgress(track, progress);
      const sAhead = sampleTrackAtProgress(track, progress + 3 / track.totalLength);
      const sBehind = sampleTrackAtProgress(track, progress - 3 / track.totalLength);
      const bounds = getTrackBoundsAt(track, progress);
      const upperLift = bounds.upperSide !== 0 && Math.sign(v.tLat) === bounds.upperSide ? bounds.upperLift : 0;
      let groundY = s.y + Math.sin(s.bank) * v.tLat + upperLift;
      let roadSlope = (sAhead.y - sBehind.y) / 6;
      let roadBank = s.bank;
      let refAngle = s.angle;
      if (k.onShortcut) {
        const sc = projectOntoShortcut(track, v.x, v.z);
        if (sc) {
          groundY = sc.point.y;
          roadSlope = 0;
          roadBank = 0;
          refAngle = Math.atan2(sc.point.tx, sc.point.tz);
        }
      }

      // Jump arc & drift hop (with extra height for mega ramps)
      let lift = k.onShortcut ? 0 : this.rampLift(progress, v.tLat);
      if (lift > 0.2) v.launchLift = Math.max(v.launchLift, lift);
      let airborne = false;
      if (k.airT > 0) {
        airborne = true;
        const isMega = v.launchLift > 3.1;
        const H = (isMega ? 7.8 : 3.2) + k.speed * (isMega ? 0.085 : 0.05);
        lift = v.launchLift * (1 - k.airT) + 4 * H * k.airT * (1 - k.airT);
      } else if (lift <= 0.05) {
        v.launchLift = 2.6;
      }
      const hopLift = k.hopT > 0 ? Math.sin(k.hopT * Math.PI) * 1.15 : 0;
      if (v.prevHopT > 0 && k.hopT === 0) {
        v.squash = Math.max(v.squash, 0.45);
      }
      v.prevHopT = k.hopT;

      const targetY = groundY + lift + hopLift + 0.05;
      v.y = v.y === 0 ? targetY : v.y + (targetY - v.y) * (1 - Math.exp(-dt * 30));
      v.root.position.set(v.x, v.y, v.z);

      const rel = v.angle - refAngle;
      const slope = roadSlope;
      const pitch = -Math.atan(slope) * Math.cos(rel) - (airborne ? (0.5 - k.airT) * 0.5 : 0);
      const roll = -roadBank * Math.cos(rel) * 0.9 + (k.steer || 0) * 0.08 + (k.drifting ? k.driftDir * 0.12 : 0);

      // Spin-outs and tricks are presentation only: the heading stays as simulated
      if (v.spin > 0) {
        v.spin = Math.max(0, v.spin - dt * 13);
      }
      if (k.trick) v.rx = Math.min(Math.PI * 2, v.rx + dt * 11);
      else if (!airborne) v.rx = 0;

      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(pitch - v.rx, v.angle + v.spin, roll);

      if (v.squash > 0) v.squash = Math.max(0, v.squash - dt * 4);
      const shrink = k.shrinkTimer > 0 ? 0.55 : 1;
      const sq = v.squash * 0.22;
      v.root.scale.set(shrink * (1 + sq), shrink * (1 - sq), shrink * (1 + sq));

      // Countdown rev chassis vibration & exhaust cone glow
      if (k.launchRev > 0) {
        const vib = 0.045 * Math.min(1.6, k.launchRev);
        v.chassisGroup.position.set((this.rng() - 0.5) * vib * 2, Math.sin(this.time * 68) * vib, 0);
        v.exhaustGlow.visible = true;
        const overheat = k.launchRev > 1.2;
        if (overheat) {
          const pulseRed = Math.sin(this.time * 28) > 0 ? '#ff2222' : '#ff6b00';
          v.exhaustGlowMat.color.set(pulseRed);
          v.exhaustGlowMat.opacity = 0.95;
        } else {
          v.exhaustGlowMat.color.set('#ff8a1f');
          v.exhaustGlowMat.opacity = 0.5 + Math.min(0.45, k.launchRev * 0.35);
        }
      } else {
        v.chassisGroup.position.set(0, 0, 0);
        v.exhaustGlow.visible = false;
      }

      // LED Brake lights
      v.brakeLightMat.color.set(k.braking ? '#ff2222' : '#551111');

      // Wheels & animated driver steering
      v.wheelRot += dt * (k.speed || 0) * 1.9;
      const steerAngle = k.drifting ? -k.driftDir * 0.35 + (k.steer || 0) * -0.3 : -(k.steer || 0) * 0.5;
      v.frontL.rotation.set(v.wheelRot, steerAngle, 0);
      v.frontR.rotation.set(v.wheelRot, steerAngle, 0);
      v.rear.rotation.x = v.wheelRot;
      v.steerWheel.rotation.z = -steerAngle * 1.15;
      v.driverUpper.rotation.z = steerAngle * 0.28;
      v.driverUpper.rotation.y = steerAngle * 0.35;
      v.leftArm.rotation.y = steerAngle * 0.38;
      v.rightArm.rotation.y = steerAngle * 0.38;

      // Paint & auras
      if (k.starTimer > 0) {
        v.bodyMat.color.setHSL((this.time * 1.8) % 1, 1, 0.55);
        v.aura.visible = true;
        v.auraMat.color.setHSL((this.time * 1.8) % 1, 1, 0.6);
        v.auraMat.opacity = 0.6 + Math.sin(this.time * 16) * 0.2;
      } else {
        v.bodyMat.color.copy(v.baseColor);
        if (k.goldenShroomTimer > 0) v.bodyMat.color.lerp(new THREE.Color('#ffd700'), 0.5);
        const flashing = k.spinOutTimer <= 0 && k.hasIncomingShell && Math.sin(this.time * 18) > 0;
        v.aura.visible = flashing;
        if (flashing) {
          v.auraMat.color.set('#ff2a2a');
          v.auraMat.opacity = 0.65;
        }
      }

      // Real 3D trailing held item
      if (k.heldItem !== v.shownItem) {
        v.shownItem = k.heldItem;
        v.heldItemAnchor.visible = Boolean(k.heldItem);
        if (k.heldItem) {
          const asset = this.heldItemAsset(k.heldItem);
          v.heldItemMesh.geometry = asset.geo;
          v.heldItemMesh.material = asset.mat;
        }
      }
      if (v.heldItemAnchor.visible) {
        v.heldItemAnchor.position.y = 1.15 + Math.sin(this.time * 4.5 + v.tx) * 0.14;
        v.heldItemMesh.rotation.y = this.time * 2.6;
      }

      // Horn expanding sonic ring
      if (k.horn || v.hornPhase > 0) {
        v.hornRing.visible = true;
        v.hornPhase += dt * 2.8;
        if (v.hornPhase >= 1) {
          v.hornPhase = k.horn ? 0.01 : 0;
          v.hornRing.visible = Boolean(k.horn);
        }
        const rs = 1.5 + v.hornPhase * 7.5;
        v.hornRing.scale.set(rs, rs, 1);
        v.hornRingMat.opacity = Math.max(0, (1 - v.hornPhase) * 0.85);
      } else {
        v.hornRing.visible = false;
      }

      // Layered dual-core boost flames
      const boosting = k.boostTimer > 0 || k.starTimer > 0;
      v.flameOuter.visible = boosting;
      v.flameInner.visible = boosting;
      if (boosting) {
        const pulse = 0.88 + Math.sin(this.time * 48 + v.tx) * 0.22;
        const lenPulse = 1 + Math.sin(this.time * 31) * 0.28;
        v.flameOuter.scale.set(pulse, pulse, lenPulse);
        v.flameInner.scale.set(pulse * 0.9, pulse * 0.9, lenPulse * 1.05);
        v.flameOuterMat.color.set(
          k.goldenShroomTimer > 0
            ? '#ffd700'
            : k.starTimer > 0
              ? '#22d3ee'
              : k.driftLevel > 0
                ? DRIFT_TIER_COLORS[k.driftLevel]
                : '#ff8a1f',
        );
      }

      // Crisp contact shadow on the road (polygonOffset + slope/bank aligned)
      const airGap = Math.max(0, v.y - groundY);
      v.shadow.position.set(v.x, groundY + 0.12, v.z);
      v.shadow.rotation.order = 'YXZ';
      v.shadow.rotation.set(-Math.atan(slope) * Math.cos(rel), v.angle + v.spin, -roadBank * Math.cos(rel));
      const shadowScale = shrink * Math.max(0.55, 1 - airGap * 0.05);
      v.shadow.scale.set(shadowScale, 1, shadowScale);
      v.shadowMat.opacity = Math.max(0.14, 0.9 - airGap * 0.085);

      this.emitKartParticles(v, dt, airborne, groundY, Math.atan(slope) * Math.cos(rel), roadBank * Math.cos(rel));
    }
  }

  private emitKartParticles(v: KartVisual, dt: number, airborne: boolean, groundY: number, roadPitch: number, roadBank: number) {
    const k = v.data;
    const heading = v.angle + v.spin;
    const sinA = Math.sin(heading);
    const cosA = Math.cos(heading);
    const rearX = (lat: number, back: number) => v.x - sinA * back + cosA * lat;
    const rearZ = (lat: number, back: number) => v.z - cosA * back - sinA * lat;

    // Tire skidmarks while drifting on the road
    if (k.drifting && !airborne && Math.abs(k.speed) > 10 && (k.hopT <= 0 || k.hopT > 0.7)) {
      v.skidAcc += dt * Math.abs(k.speed);
      const biome = this.track.biome;
      if (biome === 'snow') this.skidColor.set('#e0f2fe');
      else if (biome === 'space' || biome === 'city') this.skidColor.set(k.driftDir > 0 ? '#22d3ee' : '#ec4899');
      else this.skidColor.set('#141820');
      while (v.skidAcc >= 1.45) {
        v.skidAcc -= 1.45;
        for (const side of [-1.25, 1.25]) {
          const idx = this.skidCursor;
          this.skidCursor = (this.skidCursor + 1) % SKID_CAP;
          this.dummy.position.set(rearX(side, 1.35), groundY + 0.09, rearZ(side, 1.35));
          this.dummy.rotation.order = 'YXZ';
          this.dummy.rotation.set(-roadPitch, v.velAngle, -roadBank);
          this.dummy.scale.setScalar(1);
          this.dummy.updateMatrix();
          this.skidMesh.setMatrixAt(idx, this.dummy.matrix);
          this.skidMesh.setColorAt(idx, this.skidColor);
        }
        this.skidMesh.instanceMatrix.needsUpdate = true;
        if (this.skidMesh.instanceColor) this.skidMesh.instanceColor.needsUpdate = true;
      }
    }

    // Countdown revving sparks & overheat smoke
    if (k.launchRev > 0) {
      const overheat = k.launchRev > 1.2;
      v.revAcc += dt * (overheat ? 34 : 18);
      while (v.revAcc >= 1) {
        v.revAcc -= 1;
        const side = this.rng() > 0.5 ? 0.62 : -0.62;
        if (overheat) {
          this.smoke.emit(rearX(side, 2.5), v.y + 0.95, rearZ(side, 2.5), -sinA * 6 + (this.rng() - 0.5) * 4, 2 + this.rng() * 4, -cosA * 6 + (this.rng() - 0.5) * 4, '#27272a', 2.4, 0.55, -3, 0.8);
          this.additive.emit(rearX(side, 2.5), v.y + 0.95, rearZ(side, 2.5), -sinA * 10 + (this.rng() - 0.5) * 6, 1 + this.rng() * 4, -cosA * 10 + (this.rng() - 0.5) * 6, '#ff2a2a', 1.2, 0.35, 10, 0.6);
        } else {
          this.additive.emit(rearX(side, 2.5), v.y + 0.95, rearZ(side, 2.5), -sinA * 11 + (this.rng() - 0.5) * 5, 1 + this.rng() * 3, -cosA * 11 + (this.rng() - 0.5) * 5, this.rng() > 0.4 ? '#ff9f1c' : '#fde047', 1.1, 0.32, 8, 0.8);
        }
      }
    }

    // Slipstream wind-tunnel streaks curving past the kart
    if (k.slipstreaming) {
      v.slipAcc += dt * 36;
      while (v.slipAcc >= 1) {
        v.slipAcc -= 1;
        const side = this.rng() > 0.5 ? 1.55 : -1.55;
        const hOff = 0.7 + this.rng() * 1.1;
        this.additive.emit(
          rearX(side, -1.6), v.y + hOff, rearZ(side, -1.6),
          -sinA * 26 + cosA * side * -2.2, (this.rng() - 0.5) * 1.5, -cosA * 26 - sinA * side * -2.2,
          this.rng() > 0.45 ? '#e0f7ff' : '#38bdf8',
          0.95,
          0.26,
          0,
          1.2,
        );
      }
    }

    if (k.drifting && !airborne) {
      v.sparkAcc += dt * (k.driftLevel > 0 ? 70 : 22);
      const color = k.driftLevel === 0 ? '#c8d2e0' : k.driftLevel === 1 ? (k.sparksColor || DRIFT_TIER_COLORS[1]) : DRIFT_TIER_COLORS[k.driftLevel];
      while (v.sparkAcc >= 1) {
        v.sparkAcc -= 1;
        const side = this.rng() > 0.5 ? 1.35 : -1.35;
        const pool = k.driftLevel > 0 ? this.additive : this.smoke;
        const spread = 9;
        pool.emit(
          rearX(side, 1.8), v.y + 0.3, rearZ(side, 1.8),
          -sinA * (6 + this.rng() * 10) + (this.rng() - 0.5) * spread,
          2 + this.rng() * 9,
          -cosA * (6 + this.rng() * 10) + (this.rng() - 0.5) * spread,
          color,
          k.driftLevel > 0 ? 0.9 + k.driftLevel * 0.28 : 2.2,
          k.driftLevel > 0 ? 0.42 : 0.5,
          k.driftLevel > 0 ? 26 : -2,
          0.4,
        );
      }
    }
    if ((k.boostTimer > 0 || k.starTimer > 0) && !airborne) {
      v.flameAcc += dt * 46;
      while (v.flameAcc >= 1) {
        v.flameAcc -= 1;
        const side = this.rng() > 0.5 ? 0.62 : -0.62;
        const col = k.starTimer > 0 ? ['#ff4fd8', '#ffe11f', '#3bf06b', '#1fd9ff'][Math.floor(this.rng() * 4)] : this.rng() > 0.5 ? '#ffb02e' : '#ff5a1f';
        this.additive.emit(rearX(side, 3.1), v.y + 0.85, rearZ(side, 3.1), -sinA * 22 + (this.rng() - 0.5) * 5, this.rng() * 3, -cosA * 22 + (this.rng() - 0.5) * 5, col, 1.5, 0.3, 0, 1.5);
      }
    }
    if (k.offRoad && !airborne && Math.abs(k.speed) > 12) {
      v.dustAcc += dt * 26;
      while (v.dustAcc >= 1) {
        v.dustAcc -= 1;
        const side = this.rng() > 0.5 ? 1.3 : -1.3;
        this.smoke.emit(rearX(side, 1.5), v.y + 0.4, rearZ(side, 1.5), (this.rng() - 0.5) * 8, 3 + this.rng() * 5, (this.rng() - 0.5) * 8, this.dustColor(), 2.2, 0.6, -2, 0.5);
      }
    }
    if (k.spinOutTimer > 0 && this.rng() < dt * 30) {
      this.additive.emit(v.x + (this.rng() - 0.5) * 2, v.y + 3.2, v.z + (this.rng() - 0.5) * 2, Math.cos(this.time * 9) * 5, 2, Math.sin(this.time * 9) * 5, '#ffe11f', 1.2, 0.5, 0);
    }
  }

  private updateHazards(dt: number) {
    const blend = 1 - Math.exp(-dt * 24);
    for (const obj of this.hazards.values()) {
      const u = obj.userData;
      obj.position.x += (u.tx - obj.position.x) * blend;
      obj.position.z += (u.tz - obj.position.z) * blend;
      switch (u.kind) {
        case 'shockwave': {
          const life = (u.age || 0) + (u.ttl || 0);
          const f = life > 0 ? (u.age || 0) / life : 0;
          const scale = 3 + f * 24;
          obj.scale.set(scale, 1, scale);
          obj.position.y = u.baseY + 0.5;
          ((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.9;
          break;
        }
        case 'banana':
          obj.position.y = u.baseY + 0.1;
          break;
        case 'fake_box':
          obj.position.y = u.baseY + 2.4 + Math.sin(this.time * 3.2) * 0.25;
          obj.rotation.y = this.time * 1.6;
          obj.rotation.x = this.time * 0.9;
          break;
        case 'spiny_shell': {
          const y = this.roadY(obj.position.x, obj.position.z, u.hint);
          obj.position.y = y + 7 + Math.sin(this.time * 6) * 0.6;
          obj.rotation.y = this.time * 9;
          this.additive.emit(obj.position.x, obj.position.y, obj.position.z, 0, 0, 0, '#38bdf8', 1.5, 0.4);
          break;
        }
        default: {
          const p = projectOntoTrack(this.track, obj.position.x, obj.position.z, u.hint);
          u.hint = p.sampleIdx;
          const b = getTrackBoundsAt(this.track, p.progress);
          const lift = b.upperSide !== 0 && Math.sign(p.lateralOffset) === b.upperSide ? b.upperLift : 0;
          obj.position.y = p.sample.y + Math.sin(p.sample.bank) * p.lateralOffset + lift + 0.25;
          obj.rotation.y = this.time * 14;
          this.smoke.emit(obj.position.x, obj.position.y + 0.3, obj.position.z, 0, 1, 0, '#ffffff', 1.1, 0.25);
        }
      }
    }
  }

  private updateItemBoxes(dt: number) {
    for (const slot of this.itemBoxSlots.values()) {
      const target = slot.active ? 1 : 0;
      slot.scale += (target - slot.scale) * Math.min(1, dt * (slot.active ? 5 : 16));
      const bob = Math.sin(this.time * 2.6 + slot.x) * 0.35;
      this.dummy.position.set(slot.x, slot.y + 3 + bob, slot.z);
      this.dummy.rotation.set(this.time * 0.9 + slot.x, this.time * 1.5, 0.3);
      this.dummy.scale.setScalar(Math.max(0.0001, slot.scale));
      this.dummy.updateMatrix();
      this.itemBoxMesh.setMatrixAt(slot.index, this.dummy.matrix);

      this.dummy.position.set(slot.x, slot.y + 0.12, slot.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(Math.max(0.0001, slot.scale * (3.7 - bob * 0.5)));
      this.dummy.updateMatrix();
      this.itemBoxShadowMesh.setMatrixAt(slot.index, this.dummy.matrix);
    }
    this.itemBoxMesh.instanceMatrix.needsUpdate = true;
    this.itemBoxShadowMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCoins(dt: number) {
    for (const slot of this.coinSlots.values()) {
      const target = slot.active ? 1 : 0;
      slot.scale += (target - slot.scale) * Math.min(1, dt * (slot.active ? 7 : 20));
      this.dummy.position.set(slot.x, slot.y + 1.45 + Math.sin(this.time * 3.5 + slot.x) * 0.25, slot.z);
      this.dummy.rotation.set(0, this.time * 3.2 + slot.x * 0.2, 0);
      this.dummy.scale.setScalar(Math.max(0.0001, slot.scale));
      this.dummy.updateMatrix();
      this.coinMesh.setMatrixAt(slot.index, this.dummy.matrix);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  private updateGantry(snap: KartTelemetrySnapshot) {
    const lights = this.gantryLights;
    if (lights.length < 3) return;
    const off = '#2b3244';
    const red = '#ff2a2a';
    const green = '#22ff66';
    const cd = snap.countdownMs;
    let colors: string[];
    if (snap.waitingForOrientation) colors = [off, off, off];
    else if (cd > 2000) colors = [red, off, off];
    else if (cd > 1000) colors = [red, red, off];
    else if (cd > 0) colors = [red, red, red];
    else if (snap.raceTimeMs < 3000) colors = [green, green, green];
    else colors = [off, off, off];
    colors.forEach((c, i) => lights[i].color.set(c));
  }

  // ─── Cameras ───────────────────────────────────────────────────────────────

  private rig(key: string): CameraRig {
    let rig = this.rigs.get(key);
    if (!rig) {
      rig = { cam: new THREE.PerspectiveCamera(68, 1.6, 0.6, 5200), yaw: 0, x: 0, y: 0, z: 0, fov: 68, shake: 0, driftLook: 0, ready: false };
      this.rigs.set(key, rig);
    }
    return rig;
  }

  private aimChase(rig: CameraRig, v: KartVisual, dt: number, snap: KartTelemetrySnapshot) {
    const k = v.data;
    const speedRatio = Math.min(1.5, Math.abs(k.speed) / 64);
    const preRace = Boolean(snap.waitingForOrientation) || snap.countdownMs > 1200;
    const blendYaw = k.drifting ? v.velAngle * 0.5 + (v.velAngle + (((v.angle - v.velAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) * 0.5 : v.angle;
    if (!rig.ready) {
      rig.yaw = blendYaw;
      rig.x = v.x - Math.sin(blendYaw) * 12;
      rig.y = v.y + 5;
      rig.z = v.z - Math.cos(blendYaw) * 12;
      rig.ready = true;
    }
    let dYaw = (blendYaw - rig.yaw) % (Math.PI * 2);
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    rig.yaw += dYaw * (1 - Math.exp(-dt * (k.drifting ? 4.2 : 6.5)));

    const targetDriftLook = !preRace && !k.finished && k.drifting ? k.driftDir * 3.4 : 0;
    rig.driftLook += (targetDriftLook - rig.driftLook) * (1 - Math.exp(-dt * 4.5));

    if (k.finished) {
      // Victory orbit in front of the kart
      const a = this.time * 0.5;
      const tx = v.x + Math.sin(v.angle + a) * 10;
      const tz = v.z + Math.cos(v.angle + a) * 10;
      const f = 1 - Math.exp(-dt * 2.4);
      rig.x += (tx - rig.x) * f;
      rig.y += (v.y + 3.2 - rig.y) * f;
      rig.z += (tz - rig.z) * f;
      rig.cam.position.set(rig.x, rig.y, rig.z);
      rig.cam.lookAt(v.x, v.y + 1.8, v.z);
    } else if (preRace) {
      // A slow orbit around your kart while the grid waits
      const orbit = this.time * 0.34;
      const tx = v.x + Math.sin(rig.yaw + Math.PI * 0.8 + orbit) * 14;
      const tz = v.z + Math.cos(rig.yaw + Math.PI * 0.8 + orbit) * 14;
      const f = 1 - Math.exp(-dt * 2.4);
      rig.x += (tx - rig.x) * f;
      rig.y += (v.y + 4.6 - rig.y) * f;
      rig.z += (tz - rig.z) * f;
      rig.cam.position.set(rig.x, rig.y, rig.z);
      rig.cam.lookAt(v.x, v.y + 1.5, v.z);
    } else {
      const boost = k.boostTimer > 0 || k.starTimer > 0;
      const dist = 9.4 + speedRatio * 1.2 + (boost ? 1.8 : 0);
      const height = 4.3 + speedRatio * 0.3;
      const tx = v.x - Math.sin(rig.yaw) * dist;
      const tz = v.z - Math.cos(rig.yaw) * dist;
      const f = 1 - Math.exp(-dt * 14);
      rig.x += (tx - rig.x) * f;
      rig.z += (tz - rig.z) * f;
      rig.y += (v.y + height - rig.y) * (1 - Math.exp(-dt * 7));
      const shakeX = rig.shake > 0 ? (this.rng() - 0.5) * rig.shake * 0.9 : 0;
      const shakeY = rig.shake > 0 ? (this.rng() - 0.5) * rig.shake * 0.9 : 0;
      rig.cam.position.set(rig.x + shakeX, rig.y + shakeY, rig.z);
      // Subtle apex look-ahead offset into the corner when drifting
      const lookX = v.x + Math.sin(rig.yaw) * 14 - Math.cos(rig.yaw) * rig.driftLook;
      const lookZ = v.z + Math.cos(rig.yaw) * 14 + Math.sin(rig.yaw) * rig.driftLook;
      rig.cam.lookAt(lookX, v.y + 2, lookZ);
    }
    if (rig.shake > 0) rig.shake = Math.max(0, rig.shake - dt * 2.4);

    const boost = k.boostTimer > 0 || k.starTimer > 0;
    const targetFov = preRace || k.finished ? 58 : 64 + speedRatio * 9 + (boost ? 9 : 0);
    rig.fov += (targetFov - rig.fov) * (1 - Math.exp(-dt * 5));
  }

  private aimTv(rig: CameraRig, target: KartVisual | null, dt: number, mode: 'tv' | 'helicopter' | 'leader' | 'action', second: KartVisual | null) {
    const fallback = this.track.samples[0];
    const fx = target ? target.x : fallback.x;
    const fy = target ? target.y : fallback.y;
    const fz = target ? target.z : fallback.z;
    if (mode === 'leader' && target) {
      this.aimChase(rig, target, dt, this.snapshot!);
      return;
    }
    if (mode === 'action' && target && second) {
      const a = second.angle;
      const f = 1 - Math.exp(-dt * 10);
      rig.x += (second.x - Math.sin(a) * 9 - rig.x) * f;
      rig.y += (second.y + 4.2 - rig.y) * f;
      rig.z += (second.z - Math.cos(a) * 9 - rig.z) * f;
      rig.cam.position.set(rig.x, rig.y, rig.z);
      rig.cam.lookAt(target.x, target.y + 1.5, target.z);
      rig.fov += (72 - rig.fov) * f;
      return;
    }
    // Helicopter / TV cam: a high orbit that follows the leader
    const orbit = this.time * 0.16;
    const radius = mode === 'tv' ? 62 : 78;
    const height = mode === 'tv' ? 40 : 58;
    const tx = fx + Math.cos(orbit) * radius;
    const tz = fz + Math.sin(orbit) * radius;
    if (!rig.ready) {
      rig.x = tx;
      rig.y = fy + height;
      rig.z = tz;
      rig.ready = true;
    }
    const f = 1 - Math.exp(-dt * 2.2);
    rig.x += (tx - rig.x) * f;
    rig.y += (fy + height - rig.y) * f;
    rig.z += (tz - rig.z) * f;
    rig.cam.position.set(rig.x, rig.y, rig.z);
    rig.cam.lookAt(fx, fy + 1.5, fz);
    rig.fov += (54 - rig.fov) * f;
  }

  private renderRig(rig: CameraRig, vp: SceneViewport, ownKartId: string | null) {
    const { w, h } = vp;
    if (w <= 0 || h <= 0) return;
    rig.cam.aspect = w / Math.max(1, h);
    rig.cam.fov = rig.fov;
    rig.cam.updateProjectionMatrix();

    this.skyGroup.position.copy(rig.cam.position);
    if (this.weatherMat) this.weatherMat.uniforms.uCam.value.copy(rig.cam.position);

    const scale = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((rig.fov * Math.PI) / 360));
    this.additive.setScale(scale);
    this.smoke.setScale(scale);

    for (const v of this.karts.values()) {
      // Hide own nameplate; distance-scale & fade bot tags beyond 38..65m so pack battles stay clean
      if (v.data.id === ownKartId) {
        v.tag.visible = false;
        continue;
      }
      const d = Math.hypot(v.x - rig.cam.position.x, v.z - rig.cam.position.z);
      const maxD = v.data.isBot ? 65 : 220;
      if (d >= maxD) {
        v.tag.visible = false;
        continue;
      }
      v.tag.visible = true;
      const fadeStart = v.data.isBot ? 38 : 160;
      v.tagMat.opacity = d > fadeStart ? Math.max(0, 1 - smoothstep(fadeStart, maxD, d)) : 1;
      const distScale = v.data.isBot
        ? Math.max(0.72, 1 - smoothstep(20, 65, d) * 0.28)
        : Math.min(1.35, 1 + smoothstep(40, 180, d) * 0.35);
      v.tag.scale.set((v.data.isBot ? 4.3 : 5.6) * distScale, (v.data.isBot ? 1.08 : 1.4) * distScale, 1);
    }

    this.renderer.setViewport(vp.x, vp.y, w, h);
    this.renderer.setScissor(vp.x, vp.y, w, h);
    this.renderer.render(this.scene, rig.cam);
  }

  /** Lays out split-screen tiles and renders one frame. Returns the grid for the HUD overlay. */
  render(now: number, mode: CameraMode, width: number, height: number) {
    const dtRaw = this.lastFrame ? (now - this.lastFrame) / 1000 : 0.016;
    const dt = Math.min(dtRaw, 0.1);
    this.lastFrame = now;
    this.time += dt;
    const snap = this.snapshot;
    if (!snap) return;

    this.adaptQuality(dtRaw);
    if (width !== this.size.w || height !== this.size.h) {
      this.size = { w: width, h: height };
      this.renderer.setSize(width, height, false);
    }

    for (const { tex, speed } of this.animated) tex.offset.y = (tex.offset.y - dt * speed) % 1;
    for (const mat of this.shaderTimes) mat.uniforms.uTime.value = this.time;
    if (this.weatherMat) this.weatherMat.uniforms.uTime.value = this.time;
    if (this.pulseMats.length > 0) {
      const p = 0.65 + 0.35 * Math.sin(this.time * 3.4);
      for (const m of this.pulseMats) m.opacity = p;
    }
    if (this.lighthouseBeam) this.lighthouseBeam.rotation.y += dt * 0.85;
    for (const b of this.spaceBodies) b.rotation.y += dt * 0.025;

    // Distant flying traffic streaks in Cyber Metropolis
    if (this.trafficMesh && this.trafficLanes.length > 0) {
      for (let i = 0; i < this.trafficLanes.length; i++) {
        const lane = this.trafficLanes[i];
        const a = lane.phase + this.time * lane.speed * lane.dir;
        this.dummy.position.set(lane.cx + Math.cos(a) * lane.r, lane.y, lane.cz + Math.sin(a) * lane.r);
        this.dummy.rotation.set(0, -a + (lane.dir > 0 ? 0 : Math.PI), 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.trafficMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.trafficMesh.instanceMatrix.needsUpdate = true;
    }

    // Volcano crater erupting ember fountain
    if (this.craterPos) {
      this.craterAcc += dt * 28;
      while (this.craterAcc >= 1) {
        this.craterAcc -= 1;
        const a = this.rng() * Math.PI * 2;
        const sp = 6 + this.rng() * 14;
        this.additive.emit(
          this.craterPos.x + (this.rng() - 0.5) * 6,
          this.craterPos.y + 1,
          this.craterPos.z + (this.rng() - 0.5) * 6,
          Math.cos(a) * sp,
          28 + this.rng() * 24,
          Math.sin(a) * sp,
          this.rng() > 0.35 ? '#ff7a1f' : '#fde047',
          1.6 + this.rng() * 1.4,
          1.4 + this.rng() * 0.8,
          22,
          0.2,
        );
        if (this.rng() < 0.25) {
          this.smoke.emit(this.craterPos.x + (this.rng() - 0.5) * 8, this.craterPos.y + 4, this.craterPos.z + (this.rng() - 0.5) * 8, (this.rng() - 0.5) * 5, 12 + this.rng() * 8, (this.rng() - 0.5) * 5, '#2b1d19', 4.5, 2.2, -3, 0.3);
        }
      }
    }

    this.updateKarts(dt, now);
    this.updateHazards(dt);
    this.updateItemBoxes(dt);
    this.updateCoins(dt);
    this.updateGantry(snap);

    // Animate moving hazards, boost rings & aerial mega-ramp stars
    const raceSec = (snap.raceTimeMs || 0) / 1000;
    for (const mh of this.movingHazards) {
      const pos = getMovingHazardPosition(this.track, mh.def, raceSec);
      mh.group.position.set(pos.x, pos.y, pos.z);
      mh.shadow.position.set(pos.x, pos.y + 0.12, pos.z);
      const dLat = pos.lateralOffset - mh.prevLat;
      mh.prevLat = pos.lateralOffset;
      if (this.track.biome === 'canyon' || this.track.biome === 'snow') {
        mh.group.rotation.y = pos.angle;
        mh.spinTarget.rotation.z -= dLat * 0.42;
      } else if (this.track.biome === 'beach') {
        mh.group.rotation.y = pos.angle + (dLat >= 0 ? -Math.PI / 2 : Math.PI / 2);
        if (mh.pulsePart) mh.pulsePart.position.y = Math.abs(Math.sin(this.time * 10)) * 0.35;
      } else if (this.track.biome === 'lava') {
        mh.group.rotation.y = pos.angle;
        if (mh.pulsePart) {
          const s = 0.65 + 0.45 * Math.sin(this.time * 8 + mh.def.progress * 12);
          mh.pulsePart.scale.set(0.9 + s * 0.2, s, 0.9 + s * 0.2);
        }
        if (this.rng() < dt * 16) {
          this.additive.emit(pos.x + (this.rng() - 0.5) * 2, pos.y + 3.5, pos.z + (this.rng() - 0.5) * 2, (this.rng() - 0.5) * 4, 8 + this.rng() * 7, (this.rng() - 0.5) * 4, '#ff8a1f', 1.2, 0.5, 14);
        }
      } else {
        mh.group.rotation.y = pos.angle;
        mh.spinTarget.rotation.y += dt * 3.2;
        mh.spinTarget.position.y = Math.sin(this.time * 4 + mh.def.progress * 10) * 0.35;
        if (mh.pulsePart && this.track.biome === 'space') {
          mh.pulsePart.scale.setScalar(0.9 + 0.14 * Math.sin(this.time * 7));
        }
      }
    }
    for (const br of this.boostRings) {
      br.inner.rotation.z += dt * 2.8;
      const p = 1 + Math.sin(this.time * 5) * 0.05;
      br.ring.scale.setScalar(p);
    }
    for (let i = 0; i < this.aerialStars.length; i++) {
      this.aerialStars[i].rotation.y = this.time * 3 + i * 0.5;
      this.aerialStars[i].rotation.x = this.time * 1.4;
    }

    // Finish-line confetti for whoever just won
    if (this.time < this.confettiUntil) {
      const colors = ['#ff4fd8', '#ffe11f', '#3bf06b', '#1fd9ff', '#ff8a1f', '#ffffff'];
      for (const v of this.karts.values()) {
        if (!v.data.finished || v.data.isBot) continue;
        if (this.rng() < dt * 40) {
          this.smoke.emit(v.x + (this.rng() - 0.5) * 22, v.y + 14 + this.rng() * 6, v.z + (this.rng() - 0.5) * 22, (this.rng() - 0.5) * 6, -6, (this.rng() - 0.5) * 6, colors[Math.floor(this.rng() * colors.length)], 1.2, 2.4, 2);
        }
      }
    }

    this.additive.update(dt);
    this.smoke.update(dt);

    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissor(0, 0, width, height);
    this.renderer.clear();

    const sorted = [...snap.karts].sort((a, b) => a.rank - b.rank);
    const leader = sorted.find((k) => !k.finished) || sorted[0];
    const second = sorted.find((k) => !k.finished && k.id !== leader?.id) || sorted[1];
    const leaderV = leader ? this.karts.get(leader.id) || null : null;
    const secondV = second ? this.karts.get(second.id) || null : null;

    if (mode !== 'split') {
      const rig = this.rig(`full-${mode}`);
      this.aimTv(rig, leaderV, dt, mode, secondV);
      this.renderRig(rig, { kartId: null, x: 0, y: 0, w: width, h: height }, mode === 'leader' ? leader?.id || null : null);
      return;
    }

    const humans = snap.karts.filter((k) => !k.isBot);
    const views = humans.length > 0 ? humans : snap.karts.slice(0, 1);
    const { cols, rows } = computeSplitGrid(views.length, width / Math.max(1, height));
    const tileW = Math.floor(width / cols);
    const tileH = Math.floor(height / rows);
    const total = cols * rows;
    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const vp: SceneViewport = { kartId: null, x: col * tileW, y: height - (row + 1) * tileH, w: tileW, h: tileH };
      const k = views[i];
      if (k) {
        const v = this.karts.get(k.id);
        if (!v) continue;
        const rig = this.rig(k.id);
        this.aimChase(rig, v, dt, snap);
        this.renderRig(rig, { ...vp, kartId: k.id }, k.id);
      } else {
        // Spare tile: a broadcast camera on the leader
        const rig = this.rig(`tv-${i}`);
        this.aimTv(rig, leaderV, dt, i % 2 === 0 ? 'tv' : 'helicopter', secondV);
        this.renderRig(rig, vp, null);
      }
    }
  }

  /** Drop resolution on machines that can't hold frame rate rather than letting the race stutter. */
  private adaptQuality(dtRaw: number) {
    this.frameTimes.push(Math.min(dtRaw, 0.1));
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.03 && this.pixelRatio > 0.7) {
      this.pixelRatio = Math.max(0.7, this.pixelRatio - 0.2);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.size = { w: 0, h: 0 };
    }
  }

  dispose() {
    for (const v of this.karts.values()) {
      this.scene.remove(v.root);
      this.scene.remove(v.shadow);
      v.disposables.forEach((d) => d.dispose());
    }
    this.karts.clear();
    for (const obj of this.hazards.values()) {
      this.scene.remove(obj);
      if (obj.userData.shadow) {
        const sh = obj.userData.shadow as THREE.Mesh;
        this.scene.remove(sh);
        (sh.material as THREE.Material).dispose();
      }
      if (obj.userData.ownMat) ((obj as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.hazards.clear();
    this.heldItemAssets.clear();
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.rigs.clear();
    this.itemBoxSlots.clear();
    this.coinSlots.clear();
    this.gantryLights = [];
    this.animated = [];
    this.shaderTimes = [];
    this.pulseMats = [];
    this.spaceBodies = [];
    this.trafficLanes = [];
    this.rampSpans = [];
    this.movingHazards = [];
    this.boostRings = [];
    this.aerialStars = [];
    this.additive.dispose();
    this.smoke.dispose();
    this.scene.clear();
    this.renderer.renderLists?.dispose?.();
    this.renderer.dispose();
  }
}
