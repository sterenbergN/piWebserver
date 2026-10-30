// The TV's 3D renderer. One scene is rendered once per viewport, so everything static is merged
// or instanced to keep draw calls low enough for eight split screens on a modest machine.
// All art is generated in code: no asset files to host.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRIFT_TIER_COLORS } from '@/lib/party/kart-shared';
import { KartTrack, projectOntoTrack, sampleTrackAtProgress } from '@/lib/party/kart-tracks';
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

/** A strip following the road at two lateral offsets. */
function ribbon(
  samples: KartTrack['samples'],
  offA: number,
  offB: number,
  yOffset: number,
  opts: { vScale?: number; length?: number; color?: (i: number) => THREE.Color; flipUvAcross?: boolean } = {},
) {
  const m = samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const vScale = opts.vScale ?? 40;
  for (let i = 0; i <= m; i++) {
    const s = samples[i % m];
    const sinB = Math.sin(s.bank);
    const v = (i / m) * Math.round((opts.length ?? 0) / vScale || 1);
    pos.push(s.x + s.nx * offA, s.y + sinB * offA + yOffset, s.z + s.nz * offA);
    pos.push(s.x + s.nx * offB, s.y + sinB * offB + yOffset, s.z + s.nz * offB);
    uv.push(0, v, 1, v);
    if (opts.color) {
      const c = opts.color(i % m);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (i < m) {
      const a = i * 2;
      // Winding keeps the top face pointing up since +n is the right-hand side
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

/** A raised box section following the road with alternating colour stripes (curbs and walls). */
function stripedBarrier(
  samples: KartTrack['samples'],
  inner: number,
  outer: number,
  yBottom: number,
  yTop: number,
  colorA: THREE.Color,
  colorB: THREE.Color,
  stripePeriod: number,
) {
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
    const c = Math.floor(i / stripePeriod) % 2 === 0 ? colorA : colorB;
    const dark = c.clone().multiplyScalar(0.72);
    const p = (s: KartTrack['samples'][number], off: number, y: number) => [
      s.x + s.nx * off,
      s.y + Math.sin(s.bank) * Math.min(Math.abs(off), Math.abs(inner)) * Math.sign(off) + y,
      s.z + s.nz * off,
    ];
    const sign = Math.sign(inner + outer) || 1;
    const near = sign > 0 ? inner : outer;
    const far = sign > 0 ? outer : inner;
    // Top, road-facing side, far side. Winding depends on which side of the road we're on.
    if (sign > 0) {
      quad(p(s0, near, yTop), p(s0, far, yTop), p(s1, near, yTop), p(s1, far, yTop), c);
      quad(p(s0, near, yBottom), p(s0, near, yTop), p(s1, near, yBottom), p(s1, near, yTop), dark);
      quad(p(s0, far, yTop), p(s0, far, yBottom), p(s1, far, yTop), p(s1, far, yBottom), dark);
    } else {
      quad(p(s0, far, yTop), p(s0, near, yTop), p(s1, far, yTop), p(s1, near, yTop), c);
      quad(p(s0, near, yTop), p(s0, near, yBottom), p(s1, near, yTop), p(s1, near, yBottom), dark);
      quad(p(s0, far, yBottom), p(s0, far, yTop), p(s1, far, yBottom), p(s1, far, yTop), dark);
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
  const coarse = samples.filter((_, i) => i % 4 === 0);
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
    for (const s of coarse) {
      const d = (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z);
      if (d < best) {
        best = d;
        y = s.y;
      }
    }
    return { dist: Math.sqrt(best), y };
  };

  const volcanoRadius = track.biome === 'lava' ? Math.max(40, nearest(center.x, center.z).dist - track.wallWidth - 14) : 0;
  const biome = track.biome;
  const wall = track.wallWidth;

  const heightAt = (x: number, z: number) => {
    const { dist, y } = nearest(x, z);
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
    // Sink the ground below the road and its barriers, then blend out to the landscape
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

function instanced(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: { x: number; y: number; z: number; ry: number; s: number; sy?: number; color?: THREE.Color }[],
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
  return mesh;
}

function buildScenery(track: KartTrack, terrain: TerrainInfo, group: THREE.Group, propMat: THREE.Material, glowMat: THREE.Material, disposers: (() => void)[]) {
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
      const d = terrain.nearestDist(x, z);
      if (d < wall + minGap || d > wall + maxGap) continue;
      const cd = Math.hypot(x - terrain.center.x, z - terrain.center.z);
      if (terrain.volcanoRadius > 0 && cd < terrain.volcanoRadius * 1.02) continue;
      out.push({ x, y: terrain.heightAt(x, z) - 0.2, z, ry: rng() * Math.PI * 2, s: scale[0] + rng() * (scale[1] - scale[0]) });
    }
    return out;
  };

  switch (track.biome) {
    case 'beach':
      instanced(group, palmGeometry(), propMat, scatter(120, 5, 150, [0.9, 1.5]).filter((p) => p.y > -1));
      instanced(group, umbrellaGeometry(), propMat, scatter(26, 3, 26, [1, 1.3]));
      instanced(group, rockGeometry('#8d8678'), propMat, scatter(34, 6, 200, [0.6, 2.2]));
      break;
    case 'canyon':
      instanced(group, cactusGeometry(), propMat, scatter(90, 4, 90, [0.9, 1.6]));
      instanced(group, rockGeometry('#a35128'), propMat, scatter(70, 11, 120, [0.7, 3]));
      break;
    case 'snow':
      instanced(group, pineGeometry(), propMat, scatter(190, 4, 220, [0.8, 1.8]));
      instanced(group, snowmanGeometry(), propMat, scatter(16, 3, 22, [0.9, 1.2]));
      instanced(group, rockGeometry('#a9bccd'), propMat, scatter(40, 5, 150, [0.6, 2]));
      break;
    case 'lava':
      instanced(group, lavaSpireGeometry(), propMat, scatter(70, 6, 150, [0.8, 1.9]));
      instanced(group, deadTreeGeometry(), propMat, scatter(60, 3, 70, [0.9, 1.5]));
      instanced(group, rockGeometry('#2a1d19'), propMat, scatter(60, 4, 150, [0.7, 2.6]));
      break;
    case 'space': {
      const place = (count: number, minGap: number, maxGap: number, scale: [number, number]) =>
        scatter(count, minGap, maxGap, scale).map((p) => {
          const near = track.samples[Math.floor(rng() * track.samples.length)];
          return { ...p, y: near.y - 26 + rng() * 80 };
        });
      instanced(group, crystalGeometry('#c084fc'), glowMat, place(40, 6, 180, [0.9, 2.6]));
      instanced(group, crystalGeometry('#22d3ee'), glowMat, place(40, 6, 180, [0.9, 2.6]));
      instanced(group, rockGeometry('#3a3360'), propMat, place(70, 30, 260, [1, 6]));
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
        instanced(group, geo, mat, spots);
      });
      break;
    }
  }

  // Trackside furniture every so often along the barrier
  const m = track.samples.length;
  const flags: { x: number; y: number; z: number; ry: number; s: number; color?: THREE.Color }[] = [];
  const signs: { x: number; y: number; z: number; ry: number; s: number }[] = [];
  const boards: { x: number; y: number; z: number; ry: number; s: number }[] = [];
  const isNight = track.biome === 'city' || track.biome === 'lava' || track.biome === 'space';
  const lampHeads: { x: number; y: number; z: number; ry: number; s: number; color?: THREE.Color }[] = [];
  const accent = new THREE.Color(track.theme.accentColor);
  for (let i = 0; i < m; i++) {
    const s = track.samples[i];
    const side = i % 16 < 8 ? 1 : -1;
    if (i % 8 === 0 && Math.abs(s.curvature) < 0.0092) {
      const off = side * (wall + 2.4);
      const x = s.x + s.nx * off;
      const z = s.z + s.nz * off;
      const y = s.y + Math.sin(s.bank) * wall * side;
      flags.push({ x, y, z, ry: -s.angle + (side > 0 ? 0 : Math.PI), s: 1, color: accent });
      if (isNight) lampHeads.push({ x: x, y: y + 9.9, z: z, ry: 0, s: 1, color: accent });
    }
    // Chevrons on the outside of proper corners
    if (i % 6 === 0 && Math.abs(s.curvature) > 0.0088) {
      const outside = s.curvature > 0 ? 1 : -1;
      const off = outside * (wall + 3);
      const y = s.y + Math.sin(s.bank) * wall * outside;
      signs.push({ x: s.x + s.nx * off, y, z: s.z + s.nz * off, ry: s.angle, s: 1 });
      boards.push({ x: s.x + s.nx * off, y: y + 3.4, z: s.z + s.nz * off, ry: s.angle, s: outside });
    }
  }
  if (track.biome !== 'space') instanced(group, flagGeometry(), propMat, flags);
  instanced(group, signGeometry(), propMat, signs);

  if (lampHeads.length) {
    const head = new THREE.SphereGeometry(0.5, 6, 5);
    instanced(group, head, new THREE.MeshBasicMaterial({ color: '#ffffff' }), lampHeads);
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
  instanced(group, new THREE.PlaneGeometry(4.6, 2.2), boardMat, left.map((b) => ({ ...b, ry: b.ry + Math.PI, s: 1 })));
  const mirrored = new THREE.PlaneGeometry(4.6, 2.2);
  mirrored.scale(-1, 1, 1);
  instanced(group, mirrored, boardMat, right.map((b) => ({ ...b, ry: b.ry + Math.PI, s: 1 })));
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
      placed(new THREE.CylinderGeometry(0.62, 0.86, 3.4, 12), 0, 0.72, -0.1, { rx: Math.PI / 2 }).toNonIndexed(),
      placed(new THREE.ConeGeometry(0.62, 1.4, 12), 0, 0.72, 2.25, { rx: Math.PI / 2 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(2.9, 0.1, 1.2), 0, 0.5, -0.8, { ry: 0 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.12, 1.1, 1), 0, 1.5, -1.4).toNonIndexed(),
    ].map((g) => { g.deleteAttribute('uv'); return g; }));
  }
  if (style === 'cyber') {
    const g = extrudeBody(4.3, 0.92, 1.9);
    return merged([
      g.index ? g.toNonIndexed() : g,
      placed(new THREE.BoxGeometry(0.1, 0.8, 1.3), 1.08, 0.86, -1.1, { rx: -0.3 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(0.1, 0.8, 1.3), -1.08, 0.86, -1.1, { rx: -0.3 }).toNonIndexed(),
    ].map((p) => { if (p.getAttribute('uv')) p.deleteAttribute('uv'); return p; }));
  }
  if (style === 'bruiser') {
    return merged([
      placed(new THREE.BoxGeometry(2.3, 0.82, 3.4), 0, 0.72, 0).toNonIndexed(),
      placed(new THREE.BoxGeometry(2.0, 0.42, 1.0), 0, 1.25, 1.1, { rx: 0.18 }).toNonIndexed(),
      placed(new THREE.BoxGeometry(2.4, 0.7, 0.8), 0, 1.1, -1.5).toNonIndexed(),
    ].map((g) => { g.deleteAttribute('uv'); return g; }));
  }
  const body = extrudeBody(4.1, 1.05, 1.7);
  const nonIdx = body.index ? body.toNonIndexed() : body;
  return merged([
    nonIdx,
    placed(new THREE.BoxGeometry(0.46, 0.46, 1.9), 1.1, 0.52, -0.3).toNonIndexed(),
    placed(new THREE.BoxGeometry(0.46, 0.46, 1.9), -1.1, 0.52, -0.3).toNonIndexed(),
  ].map((p) => { if (p.getAttribute('uv')) p.deleteAttribute('uv'); return p; }));
}

function kartTrimGeometry(style: string, accent: string) {
  // Vertex-coloured detail shared by every style: wings, seat, exhausts, steering wheel
  const dark = '#141824';
  const metal = '#c5ced9';
  const parts: THREE.BufferGeometry[] = [
    colored(placed(new THREE.BoxGeometry(1.1, 0.8, 0.28), 0, 1.08, -0.7, { rx: -0.25 }), dark), // seat back
    colored(placed(new THREE.TorusGeometry(0.34, 0.06, 6, 12), 0, 1.15, 0.55, { rx: -0.7 }), dark), // wheel
    colored(placed(new THREE.CylinderGeometry(0.13, 0.17, 0.9, 8), -0.62, 0.86, -2.0, { rx: Math.PI / 2 - 0.25 }), metal),
    colored(placed(new THREE.CylinderGeometry(0.13, 0.17, 0.9, 8), 0.62, 0.86, -2.0, { rx: Math.PI / 2 - 0.25 }), metal),
  ];
  if (style === 'classic') {
    parts.push(
      colored(placed(new THREE.BoxGeometry(2.5, 0.12, 0.62), 0, 0.34, 2.28), dark),
      colored(placed(new THREE.BoxGeometry(2.4, 0.16, 0.7), 0, 1.68, -1.86), accent),
      colored(placed(new THREE.BoxGeometry(0.12, 0.62, 0.5), 1.0, 1.36, -1.86), dark),
      colored(placed(new THREE.BoxGeometry(0.12, 0.62, 0.5), -1.0, 1.36, -1.86), dark),
    );
  } else if (style === 'rocket') {
    parts.push(
      colored(placed(new THREE.CylinderGeometry(0.72, 0.5, 0.7, 12), 0, 0.72, -2.0, { rx: Math.PI / 2 }), metal),
      colored(placed(new THREE.BoxGeometry(3.05, 0.14, 0.34), 0, 0.5, -0.36), accent),
    );
  } else if (style === 'cyber') {
    parts.push(
      colored(placed(new THREE.BoxGeometry(2.05, 0.08, 3.5), 0, 0.28, 0), accent),
      colored(placed(new THREE.BoxGeometry(1.2, 0.3, 0.8), 0, 1.0, 0.9, { rx: 0.5 }), '#0b1020'),
    );
  } else {
    parts.push(
      colored(placed(new THREE.TorusGeometry(1.05, 0.12, 6, 14, Math.PI), 0, 0.5, 2.0), metal),
      colored(placed(new THREE.TorusGeometry(0.85, 0.09, 6, 14, Math.PI), 0, 1.3, -0.8), dark),
      colored(placed(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 8), -1.0, 1.7, -1.5), metal),
      colored(placed(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 8), 1.0, 1.7, -1.5), metal),
    );
  }
  return merged(parts);
}

function wheelGeometry(radius: number, width: number) {
  const tire = colored(placed(new THREE.CylinderGeometry(radius, radius, width, 14), 0, 0, 0, { rz: Math.PI / 2 }), '#0d1017');
  const hub = colored(placed(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.04, 10), 0, 0, 0, { rz: Math.PI / 2 }), '#d6dde6');
  const spoke = colored(placed(new THREE.BoxGeometry(width + 0.06, radius * 1.1, radius * 0.2), 0, 0, 0), '#475569');
  const spoke2 = colored(placed(new THREE.BoxGeometry(width + 0.06, radius * 0.2, radius * 1.1), 0, 0, 0), '#475569');
  return merged([tire, hub, spoke, spoke2]);
}

const WHEEL_SPECS: Record<string, { front: [number, number, number]; rear: [number, number, number]; r: number; w: number }> = {
  classic: { front: [1.3, 0.54, 1.45], rear: [1.4, 0.62, -1.3], r: 0.54, w: 0.56 },
  rocket: { front: [1.25, 0.48, 1.5], rear: [1.45, 0.58, -1.25], r: 0.5, w: 0.5 },
  cyber: { front: [1.25, 0.46, 1.5], rear: [1.3, 0.5, -1.35], r: 0.48, w: 0.5 },
  bruiser: { front: [1.45, 0.72, 1.3], rear: [1.5, 0.76, -1.3], r: 0.76, w: 0.72 },
};

interface KartVisual {
  root: THREE.Group;
  bodyMat: THREE.MeshPhongMaterial;
  baseColor: THREE.Color;
  frontL: THREE.Mesh;
  frontR: THREE.Mesh;
  rear: THREE.Mesh;
  head: THREE.Sprite;
  tag: THREE.Sprite;
  shadow: THREE.Mesh;
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  aura: THREE.Sprite;
  auraMat: THREE.SpriteMaterial;
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
  wheelRot: number;
  sparkAcc: number;
  dustAcc: number;
  flameAcc: number;
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
  ready: boolean;
}

export interface SceneViewport {
  kartId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class KartScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private track: KartTrack;
  private karts = new Map<string, KartVisual>();
  private hazards = new Map<string, THREE.Object3D>();
  private hazardGeos: Record<string, THREE.BufferGeometry> = {};
  private hazardMats: Record<string, THREE.Material> = {};
  private rigs = new Map<string, CameraRig>();
  private additive = new ParticlePool(1800, true);
  private smoke = new ParticlePool(900, false);
  private disposers: (() => void)[] = [];
  private animated: { tex: THREE.Texture; speed: number }[] = [];
  private gantryLights: THREE.MeshBasicMaterial[] = [];
  private itemBoxMesh!: THREE.InstancedMesh;
  private itemBoxSlots = new Map<string, { index: number; x: number; y: number; z: number; scale: number; active: boolean }>();
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
  private rampSpans: { start: number; end: number; height: number }[] = [];
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
    this.scene.add(new THREE.HemisphereLight(t.ambient, t.groundLow, 1.15));
    const sun = new THREE.DirectionalLight(t.sun, 2.1);
    sun.position.set(t.sunDir[0] * 500, t.sunDir[1] * 500, t.sunDir[2] * 500);
    this.scene.add(sun);

    // Gradient sky dome that follows the camera
    const skyMat = this.track2(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(t.skyTop) },
        horizon: { value: new THREE.Color(t.skyHorizon) },
        ground: { value: new THREE.Color(t.fog) },
      },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
        void main() {
          float h = normalize(vDir).y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.62)) : mix(horizon, ground, min(1.0, -h * 8.0));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }));
    this.sky = new THREE.Mesh(this.track2(new THREE.SphereGeometry(2400, 24, 16)), skyMat);
    this.sky.renderOrder = -10;
    this.skyGroup.add(this.sky);

    const biome = this.track.biome;
    const rng = mulberry32(hashString(this.track.id) + 77);

    // Sun, moon or planet glow
    const sunDir = new THREE.Vector3(...t.sunDir).normalize();
    const sunTex = this.track2(makeBlobTexture(biome === 'city' || biome === 'space' ? 'rgba(255,255,255,0.9)' : 'rgba(255,250,225,1)', 'rgba(255,240,200,0)'));
    const sunSprite = new THREE.Sprite(this.track2(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, toneMapped: false })));
    sunSprite.scale.setScalar(biome === 'beach' ? 520 : 420);
    sunSprite.position.copy(sunDir.clone().multiplyScalar(2000));
    sunSprite.renderOrder = -9;
    this.skyGroup.add(sunSprite);

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
      const cloudMat = this.track2(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, transparent: true, opacity: biome === 'canyon' ? 0.45 : 0.9, color: biome === 'canyon' ? '#ffd1a8' : '#ffffff' }));
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
      // A ringed planet hanging over the course
      const planet = new THREE.Mesh(
        this.track2(new THREE.SphereGeometry(190, 32, 20)),
        this.track2(new THREE.MeshBasicMaterial({ color: '#b34fd8', fog: false })),
      );
      planet.position.set(-1100, 460, 900);
      const ring = new THREE.Mesh(
        this.track2(new THREE.RingGeometry(250, 360, 64)),
        this.track2(new THREE.MeshBasicMaterial({ color: '#f5c6ff', side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.5 })),
      );
      ring.position.copy(planet.position);
      ring.rotation.x = 1.25;
      ring.rotation.y = 0.3;
      const moon = new THREE.Mesh(
        this.track2(new THREE.SphereGeometry(60, 20, 14)),
        this.track2(new THREE.MeshBasicMaterial({ color: '#5de0ff', fog: false })),
      );
      moon.position.set(1300, 300, -700);
      planet.renderOrder = ring.renderOrder = moon.renderOrder = -8;
      this.skyGroup.add(planet, ring, moon);
    }

    this.scene.add(this.skyGroup);

    // Camera-local weather, wrapped in a box so it costs the same everywhere on the track
    const weather = {
      snow: { color: '#ffffff', count: 500, size: 1.5, fall: 7, drift: 3, additive: false },
      lava: { color: '#ff7a2a', count: 300, size: 1.4, fall: -5, drift: 2.2, additive: true },
      space: { color: '#c7d2ff', count: 240, size: 0.9, fall: 0, drift: 1, additive: true },
      city: { color: '#9dc9ff', count: 500, size: 0.7, fall: 70, drift: 0.5, additive: true },
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
    const samples = track.samples;
    const group = new THREE.Group();
    this.scene.add(group);
    const halfW = track.roadWidth / 2;
    const wall = track.wallWidth;
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

    // Sea or lava lake below the terrain, far out to the horizon
    if (track.biome === 'beach' || track.biome === 'lava') {
      const isLava = track.biome === 'lava';
      const liquidTex = this.track2(canvasTexture(256, (ctx, w, h) => {
        const rng = mulberry32(99);
        ctx.fillStyle = isLava ? '#c2330c' : '#1f8fd6';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 420; i++) {
          ctx.fillStyle = isLava
            ? (rng() > 0.5 ? 'rgba(255,190,70,0.55)' : 'rgba(90,10,0,0.5)')
            : (rng() > 0.5 ? 'rgba(160,230,255,0.28)' : 'rgba(10,70,140,0.3)');
          ctx.beginPath();
          ctx.ellipse(rng() * w, rng() * h, 6 + rng() * 22, 2 + rng() * 7, rng() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }));
      liquidTex.wrapS = liquidTex.wrapT = THREE.RepeatWrapping;
      liquidTex.repeat.set(70, 70);
      liquidTex.anisotropy = anisotropy;
      this.animated.push({ tex: liquidTex, speed: isLava ? 0.05 : 0.025 });
      const plane = new THREE.Mesh(
        this.track2(new THREE.PlaneGeometry(6000, 6000)),
        this.track2(new THREE.MeshBasicMaterial({ map: liquidTex })),
      );
      plane.rotation.x = -Math.PI / 2;
      // Always below the lowest stretch of road, or it floods the shoulders
      const lowestRoad = Math.min(...track.samples.map((sample) => sample.y));
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

    // Volcano crater glow
    if (terrain.volcanoRadius > 0) {
      const craterY = terrain.heightAt(terrain.center.x, terrain.center.z) + 0.6;
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

    // Road
    const roadTex = this.track2(makeRoadTexture(track));
    roadTex.anisotropy = anisotropy;
    const roadGeo = this.track2(ribbon(samples, -halfW, halfW, 0.06, { length: track.totalLength, vScale: 26 }));
    const roadMat = this.track2(t.rainbowRoad
      ? new THREE.MeshBasicMaterial({ map: roadTex, toneMapped: false })
      : new THREE.MeshLambertMaterial({ map: roadTex, emissive: t.glowRoad ? new THREE.Color(t.roadStripeColor) : new THREE.Color('#000000'), emissiveIntensity: t.glowRoad ? 0.1 : 0, emissiveMap: t.glowRoad ? roadTex : null }));
    group.add(new THREE.Mesh(roadGeo, roadMat));

    // Shoulders run from the road edge out under the barrier
    const shoulderMat = this.track2(new THREE.MeshLambertMaterial({ color: t.shoulder, map: noiseTex }));
    group.add(new THREE.Mesh(this.track2(ribbon(samples, -wall - 2.4, -halfW, -0.05, { length: track.totalLength, vScale: 14 })), shoulderMat));
    group.add(new THREE.Mesh(this.track2(ribbon(samples, halfW, wall + 2.4, -0.05, { length: track.totalLength, vScale: 14 })), shoulderMat));

    if (track.biome === 'space') {
      // The road is a floating ribbon, so give it a glowing underside
      const under = new THREE.Mesh(
        this.track2(ribbon(samples, -wall - 1.6, wall + 1.6, -1.6, { length: track.totalLength })),
        this.track2(new THREE.MeshBasicMaterial({ color: '#5b21b6', side: THREE.DoubleSide, transparent: true, opacity: 0.55 })),
      );
      group.add(under);
    }

    // Curbs and barriers
    const vertexMat = this.track2(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const curbA = new THREE.Color(t.curbColorA);
    const curbB = new THREE.Color(t.curbColorB);
    const curbW = 1.9;
    group.add(new THREE.Mesh(this.track2(stripedBarrier(samples, -halfW - curbW, -halfW + 0.3, -0.2, 0.2, curbA, curbB, 2)), vertexMat));
    group.add(new THREE.Mesh(this.track2(stripedBarrier(samples, halfW - 0.3, halfW + curbW, -0.2, 0.2, curbA, curbB, 2)), vertexMat));

    const wallA = new THREE.Color(t.wallColor);
    const wallB = wallA.clone().lerp(new THREE.Color(t.wallTop), 0.28);
    const wallH = t.wallHeight;
    group.add(new THREE.Mesh(this.track2(stripedBarrier(samples, -wall - 1.3, -wall, -9, wallH, wallA, wallB, 4)), vertexMat));
    group.add(new THREE.Mesh(this.track2(stripedBarrier(samples, wall, wall + 1.3, -9, wallH, wallA, wallB, 4)), vertexMat));
    // A bright rail along the top so the road edge reads at speed
    const railMat = this.track2(new THREE.MeshBasicMaterial({ color: t.wallTop, toneMapped: false }));
    group.add(new THREE.Mesh(this.track2(ribbon(samples, -wall - 0.85, -wall - 0.35, wallH + 0.04, {})), railMat));
    group.add(new THREE.Mesh(this.track2(ribbon(samples, wall + 0.35, wall + 0.85, wallH + 0.04, {})), railMat));

    // Scenery
    const propMat = this.track2(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const glowMat = this.track2(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    buildScenery(track, terrain, group, propMat, glowMat, this.disposers);

    this.buildStartLine(group, anisotropy);

    // Boost pads: scrolling chevrons laid on the road
    const padTex = this.track2(makeChevronTexture('#ffb02e', '#ff5a1f', '#7a1d00'));
    padTex.repeat.set(1, 2);
    padTex.anisotropy = anisotropy;
    this.animated.push({ tex: padTex, speed: 1.1 });
    const padMat = this.track2(new THREE.MeshBasicMaterial({ map: padTex, toneMapped: false, transparent: true, opacity: 0.96 }));
    const padGeo = new THREE.PlaneGeometry(7.4, 10);
    padGeo.rotateX(-Math.PI / 2);
    const padMesh = new THREE.InstancedMesh(this.track2(padGeo), padMat, track.boostPads.length);
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
        const s = sampleTrackAtProgress(track, startP + (ramp.progress - startP) * f);
        const lift = RAMP_H * f + 0.08;
        for (const side of [-1, 1]) {
          const off = side * (halfW + 0.5);
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
      for (const side of [-1, 1]) {
        const off = side * (halfW + 0.5);
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

    // Item boxes share one instanced mesh; the slots are animated each frame
    const boxTex = this.track2(makeItemBoxTexture());
    const boxMat = this.track2(new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, opacity: 0.92, toneMapped: false }));
    const boxGeo = this.track2(new THREE.BoxGeometry(3.1, 3.1, 3.1));
    this.itemBoxMesh = new THREE.InstancedMesh(boxGeo, boxMat, track.itemBoxes.length + 16);
    this.itemBoxMesh.frustumCulled = false;
    this.itemBoxMesh.count = track.itemBoxes.length + 16;
    this.dummy.position.set(0, -500, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.itemBoxMesh.count; i++) this.itemBoxMesh.setMatrixAt(i, this.dummy.matrix);
    track.itemBoxes.forEach((b, index) => {
      this.itemBoxSlots.set(b.id, { index, x: b.x, y: b.y, z: b.z, scale: 1, active: true });
    });
    group.add(this.itemBoxMesh);
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
    const boxes = new THREE.InstancedMesh(this.track2(box), boxMat, 16);
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
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(r: T) => {
      disposables.push(r);
      return r;
    };
    const baseColor = new THREE.Color(k.color);
    const bodyMat = keep(new THREE.MeshPhongMaterial({ color: baseColor.clone(), shininess: 90, specular: new THREE.Color('#ffffff'), side: THREE.DoubleSide }));
    const trimMat = keep(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40 }));

    const body = new THREE.Mesh(keep(kartBodyGeometry(k.kartStyle)), bodyMat);
    const trim = new THREE.Mesh(keep(kartTrimGeometry(k.kartStyle, k.sparksColor)), trimMat);
    root.add(body, trim);

    // Driver: suit in the player's colour with their avatar as the head
    const torso = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.42, 0.5, 3, 8)), bodyMat);
    torso.position.set(0, 1.28, -0.2);
    root.add(torso);
    const headTex = keep(makeEmojiTexture(k.avatar || '🏎️'));
    const head = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: headTex, transparent: true, toneMapped: false, depthWrite: false })));
    head.position.set(0, 2.2, -0.15);
    head.scale.setScalar(1.95);
    root.add(head);

    const tagTex = keep(makeNameTagTexture(k.name, k.color, k.isBot));
    const tag = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tagTex, transparent: true, toneMapped: false, depthWrite: false, fog: false })));
    tag.position.set(0, 4.1, 0);
    tag.scale.set(k.isBot ? 4.4 : 5.6, k.isBot ? 1.1 : 1.4, 1);
    root.add(tag);

    // Wheels
    const spec = WHEEL_SPECS[k.kartStyle] || WHEEL_SPECS.classic;
    const wheelMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
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
    root.add(frontL, frontR, rear);

    // Contact shadow
    const shadowTex = keep(makeBlobTexture());
    const shadowGeo = keep(new THREE.PlaneGeometry(5.4, 6.2));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(shadowGeo, keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false })));
    shadow.position.y = 0.05;
    shadow.renderOrder = 2;
    root.add(shadow);

    // Exhaust flame
    const flameParts = [-0.62, 0.62].map((x) => {
      const g = new THREE.ConeGeometry(0.38, 2.4, 8);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.9, -3.3);
      return g.toNonIndexed();
    });
    flameParts.forEach((g) => g.deleteAttribute('uv'));
    const flameMat = keep(new THREE.MeshBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const flame = new THREE.Mesh(keep(merged(flameParts)), flameMat);
    flame.visible = false;
    root.add(flame);

    // Star / shell-warning aura
    const auraTex = keep(makeBlobTexture('rgba(255,255,255,0.7)', 'rgba(255,255,255,0)'));
    const auraMat = keep(new THREE.SpriteMaterial({ map: auraTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const aura = new THREE.Sprite(auraMat);
    aura.position.y = 1.2;
    aura.scale.setScalar(8.5);
    aura.visible = false;
    root.add(aura);

    if (k.kartStyle === 'cyber') {
      const glowTex = keep(makeBlobTexture('rgba(255,255,255,0.8)', 'rgba(255,255,255,0)'));
      const g = keep(new THREE.PlaneGeometry(5, 6));
      g.rotateX(-Math.PI / 2);
      const under = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ map: glowTex, color: k.sparksColor, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
      under.position.y = 0.09;
      under.renderOrder = 3;
      root.add(under);
    }

    this.scene.add(root);
    return {
      root,
      bodyMat,
      baseColor,
      frontL,
      frontR,
      rear,
      head,
      tag,
      shadow,
      flame,
      flameMat,
      aura,
      auraMat,
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
      wheelRot: 0,
      sparkAcc: 0,
      dustAcc: 0,
      flameAcc: 0,
      data: k,
    };
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
    const p = projectOntoTrack(this.track, x, z, hint);
    return p.sample.y + Math.sin(p.sample.bank) * p.lateralOffset;
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
        obj.userData = {
          ownMat: h.kind === 'shockwave',
          kind: h.kind,
          hint: undefined as number | undefined,
          baseY: h.kind === 'banana' || h.kind === 'fake_box' || h.kind === 'shockwave' ? this.roadY(h.x, h.z) : 0,
          tx: h.x,
          tz: h.z,
          born: performance.now(),
        };
        obj.position.set(h.x, obj.userData.baseY, h.z);
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

  private rampLift(progress: number) {
    for (const r of this.rampSpans) {
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
      const groundY = s.y + Math.sin(s.bank) * v.tLat;

      // Jump arc: leaves from the ramp lip and lands back on the road
      let lift = this.rampLift(progress);
      let airborne = false;
      if (k.airT > 0) {
        airborne = true;
        const H = 3.2 + k.speed * 0.05;
        lift = 2.6 * (1 - k.airT) + 4 * H * k.airT * (1 - k.airT);
      }
      const targetY = groundY + lift + 0.05;
      v.y = v.y === 0 ? targetY : v.y + (targetY - v.y) * (1 - Math.exp(-dt * 30));
      v.root.position.set(v.x, v.y, v.z);

      const rel = v.angle - s.angle;
      const slope = (sAhead.y - sBehind.y) / 6;
      const pitch = -Math.atan(slope) * Math.cos(rel) - (airborne ? (0.5 - k.airT) * 0.5 : 0);
      const roll = -s.bank * Math.cos(rel) * 0.9 + (k.steer || 0) * 0.08 + (k.drifting ? k.driftDir * 0.12 : 0);

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

      // Wheels
      v.wheelRot += dt * (k.speed || 0) * 1.9;
      const steerAngle = k.drifting ? -k.driftDir * 0.35 + (k.steer || 0) * -0.3 : -(k.steer || 0) * 0.5;
      v.frontL.rotation.set(v.wheelRot, steerAngle, 0);
      v.frontR.rotation.set(v.wheelRot, steerAngle, 0);
      v.rear.rotation.x = v.wheelRot;

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

      // Flames
      const boosting = k.boostTimer > 0 || k.starTimer > 0;
      v.flame.visible = boosting;
      if (boosting) {
        const pulse = 0.85 + Math.sin(this.time * 48 + v.tx) * 0.25;
        v.flame.scale.set(pulse, pulse, 1 + Math.sin(this.time * 31) * 0.3);
        v.flameMat.color.set(k.goldenShroomTimer > 0 ? '#ffd700' : k.starTimer > 0 ? '#ffffff' : '#ff8a1f');
      }

      // Shadow lays on the road even when the kart is in the air
      const airGap = Math.max(0, v.y - groundY);
      v.shadow.position.y = -airGap / shrink + 0.05;
      (v.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.2, 1 - airGap * 0.1);

      this.emitKartParticles(v, dt, airborne);
    }
  }

  private emitKartParticles(v: KartVisual, dt: number, airborne: boolean) {
    const k = v.data;
    const heading = v.angle + v.spin;
    const sinA = Math.sin(heading);
    const cosA = Math.cos(heading);
    const rearX = (lat: number, back: number) => v.x - sinA * back + cosA * lat;
    const rearZ = (lat: number, back: number) => v.z - cosA * back - sinA * lat;

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
          obj.position.y = p.sample.y + Math.sin(p.sample.bank) * p.lateralOffset + 0.25;
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
      this.dummy.position.set(slot.x, slot.y + 3 + Math.sin(this.time * 2.6 + slot.x) * 0.35, slot.z);
      this.dummy.rotation.set(this.time * 0.9 + slot.x, this.time * 1.5, 0.3);
      this.dummy.scale.setScalar(Math.max(0.0001, slot.scale));
      this.dummy.updateMatrix();
      this.itemBoxMesh.setMatrixAt(slot.index, this.dummy.matrix);
    }
    this.itemBoxMesh.instanceMatrix.needsUpdate = true;
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
      rig = { cam: new THREE.PerspectiveCamera(68, 1.6, 0.6, 5200), yaw: 0, x: 0, y: 0, z: 0, fov: 68, shake: 0, ready: false };
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
      rig.cam.lookAt(v.x + Math.sin(rig.yaw) * 14, v.y + 2, v.z + Math.cos(rig.yaw) * 14);
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
      // Your own name tag just gets in your way
      const d = Math.hypot(v.x - rig.cam.position.x, v.z - rig.cam.position.z);
      v.tag.visible = v.data.id !== ownKartId && d < (v.data.isBot ? 90 : 240);
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
    if (this.weatherMat) this.weatherMat.uniforms.uTime.value = this.time;

    this.updateKarts(dt, now);
    this.updateHazards(dt);
    this.updateItemBoxes(dt);
    this.updateGantry(snap);

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
    this.frameTimes.push(dtRaw);
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
      v.disposables.forEach((d) => d.dispose());
    }
    this.karts.clear();
    for (const obj of this.hazards.values()) {
      if (obj.userData.ownMat) ((obj as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.hazards.clear();
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.additive.dispose();
    this.smoke.dispose();
    this.renderer.dispose();
  }
}
