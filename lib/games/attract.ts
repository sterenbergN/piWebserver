// Attract mode: a little looping scene of each game for the arcade lobby, the way
// cabinets show themselves off between players. Pure drawing, seeded by time, so
// any frame can be drawn on its own. Coordinates are in CSS pixels.

export type AttractId = 'snake' | '2048' | 'breakout' | 'blocks' | 'flap' | 'setpoint' | 'chain' | 'merge' | 'party';

const INK = '#0b0f1c';
const CYAN = '#4cf2ff';
const PINK = '#ff4fd8';
const YELLOW = '#ffe14d';
const GREEN = '#5dff9b';
const ORANGE = '#ff9f43';
const PURPLE = '#a98bff';
const RED = '#ff5c6c';
const NEONS = [CYAN, PINK, YELLOW, GREEN, ORANGE, PURPLE];

type Ctx = CanvasRenderingContext2D;

/** 0→1→0 over each `period`. */
const pingPong = (t: number, period: number) => {
  const p = (t / period) % 2;
  return p < 1 ? p : 2 - p;
};
/** A repeatable pseudo-random number in [0, 1) for a whole number. */
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function glow(ctx: Ctx, color: string, blur: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
}
const noGlow = (ctx: Ctx) => { ctx.shadowBlur = 0; };

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** A closed path around the screen's cells, for things that wander on a grid. */
function loopCell(i: number, cols: number, rows: number) {
  const per = 2 * (cols + rows) - 4;
  const n = ((i % per) + per) % per;
  if (n < cols) return [n, 0];
  if (n < cols + rows - 1) return [cols - 1, n - cols + 1];
  if (n < 2 * cols + rows - 2) return [2 * cols + rows - 3 - n, rows - 1];
  return [0, per - n];
}

function snake(ctx: Ctx, t: number, w: number, h: number) {
  const cell = Math.max(8, Math.round(Math.min(w, h) / 9));
  const cols = Math.floor(w / cell) - 2;
  const rows = Math.floor(h / cell) - 2;
  const ox = (w - cols * cell) / 2;
  const oy = (h - rows * cell) / 2;
  const head = Math.floor(t * 7);
  const length = 7 + (Math.floor(t / 4) % 6);
  for (let s = length; s >= 0; s--) {
    const [cx, cy] = loopCell(head - s, cols, rows);
    glow(ctx, s === 0 ? '#c9ffe0' : GREEN, s === 0 ? 12 : 6);
    ctx.globalAlpha = 1 - (s / length) * 0.55;
    roundRect(ctx, ox + cx * cell + 1, oy + cy * cell + 1, cell - 2, cell - 2, 3);
  }
  ctx.globalAlpha = 1;
  const seed = Math.floor(t / 3);
  glow(ctx, RED, 12 + 5 * Math.sin(t * 6));
  ctx.beginPath();
  ctx.arc(ox + (2 + Math.floor(rand(seed) * (cols - 4)) + 0.5) * cell, oy + (2 + Math.floor(rand(seed + 9) * (rows - 4)) + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
  ctx.fill();
}

const TILE_COLORS: Record<number, string> = { 2: '#2c3b57', 4: '#35507a', 8: ORANGE, 16: '#ff7e4f', 32: RED, 64: PINK, 128: PURPLE, 256: CYAN, 512: GREEN, 1024: YELLOW };

function g2048(ctx: Ctx, t: number, w: number, h: number) {
  const size = Math.min(w, h) * 0.86;
  const gap = size * 0.03;
  const cell = (size - gap * 5) / 4;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const beat = Math.floor(t / 1.1);
  const phase = (t / 1.1) % 1;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = ox + gap + x * (cell + gap);
      const py = oy + gap + y * (cell + gap);
      noGlow(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, px, py, cell, cell, cell * 0.14);
      const r = rand(x * 7 + y * 13 + (beat >> 1) * 3);
      if (r < 0.38) continue;
      const value = 2 ** (1 + Math.floor(rand(x * 3 + y * 5 + beat) * 10));
      const pop = 1 + 0.12 * Math.max(0, 1 - phase * 5) * (rand(x + y + beat) > 0.6 ? 1 : 0);
      const c = cell * pop;
      glow(ctx, TILE_COLORS[value] ?? CYAN, value >= 8 ? 10 : 0);
      roundRect(ctx, px - (c - cell) / 2, py - (c - cell) / 2, c, c, c * 0.14);
      noGlow(ctx);
      ctx.fillStyle = value >= 256 ? INK : '#fff';
      ctx.font = `800 ${cell * (value >= 1000 ? 0.28 : value >= 100 ? 0.34 : 0.44)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(value), px + cell / 2, py + cell / 2 + 1);
    }
  }
}

function breakout(ctx: Ctx, t: number, w: number, h: number) {
  const cols = 8;
  const rows = 4;
  const bw = (w * 0.9) / cols;
  const bh = h * 0.07;
  const left = w * 0.05;
  const top = h * 0.1;
  const round = Math.floor(t / 14);
  const ballX = left + pingPong(t, 1.3) * (w * 0.9);
  const ballY = h * 0.42 + pingPong(t, 0.97) * (h * 0.42);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const gone = rand(x * 3 + y * 11 + round) * 14 < t % 14;
      if (gone) continue;
      glow(ctx, NEONS[y % NEONS.length], 5);
      roundRect(ctx, left + x * bw + 1.5, top + y * (bh + 3), bw - 3, bh, 2);
    }
  }
  glow(ctx, CYAN, 10);
  const pw = w * 0.24;
  roundRect(ctx, Math.max(2, Math.min(w - pw - 2, ballX - pw / 2)), h * 0.9, pw, h * 0.035, 4);
  glow(ctx, '#ffffff', 12);
  ctx.beginPath();
  ctx.arc(ballX, ballY, Math.max(3, h * 0.028), 0, Math.PI * 2);
  ctx.fill();
}

const PIECES = [[[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]], [[1, 0], [2, 0], [0, 1], [1, 1]]];

function blocks(ctx: Ctx, t: number, w: number, h: number) {
  const rows = 12;
  const cell = h / rows;
  const cols = Math.floor(w / cell);
  const ox = (w - cols * cell) / 2;
  const square = (x: number, y: number, color: string) => {
    glow(ctx, color, 6);
    roundRect(ctx, ox + x * cell + 1, y * cell + 1, cell - 2, cell - 2, 2);
  };
  for (let x = 0; x < cols; x++) {
    const height = 1 + Math.floor(rand(x * 5 + 2) * 4);
    for (let y = 0; y < height; y++) if (rand(x * 9 + y * 17) > 0.15) square(x, rows - 1 - y, NEONS[(x + y) % NEONS.length]);
  }
  const drop = Math.floor(t / 4.5);
  const piece = PIECES[drop % PIECES.length];
  const row = Math.floor(((t / 4.5) % 1) * (rows - 5));
  const column = 1 + Math.floor(rand(drop) * Math.max(1, cols - 5));
  for (const [dx, dy] of piece) square(column + dx, row + dy, '#ffffff');
}

function flap(ctx: Ctx, t: number, w: number, h: number) {
  const ground = h * 0.88;
  const spacing = w * 0.5;
  const pipeW = Math.max(14, w * 0.11);
  const scroll = t * w * 0.28;
  const first = Math.floor(scroll / spacing);
  for (let i = first; i < first + 4; i++) {
    const x = i * spacing - scroll + w * 0.6;
    const gapY = ground * (0.3 + rand(i) * 0.4);
    const gap = h * 0.36;
    glow(ctx, GREEN, 7);
    ctx.fillRect(x, 0, pipeW, gapY - gap / 2);
    ctx.fillRect(x, gapY + gap / 2, pipeW, ground - gapY - gap / 2);
    ctx.fillRect(x - 3, gapY - gap / 2 - 7, pipeW + 6, 7);
    ctx.fillRect(x - 3, gapY + gap / 2, pipeW + 6, 7);
  }
  // Follow the next gap, so the bird never crashes in the demo.
  const birdX = w * 0.3;
  const next = Math.ceil((scroll + birdX - w * 0.6 - pipeW) / spacing);
  const target = ground * (0.3 + rand(next) * 0.4);
  const previous = ground * (0.3 + rand(next - 1) * 0.4);
  const travel = ((scroll + birdX - w * 0.6 - pipeW) / spacing) - (next - 1);
  const ease = Math.min(1, Math.max(0, (travel - 0.1) / 0.75));
  const birdY = previous + (target - previous) * (ease * ease * (3 - 2 * ease)) + Math.sin(t * 7) * h * 0.012;
  const r = Math.max(6, h * 0.055);
  glow(ctx, YELLOW, 10);
  ctx.beginPath();
  ctx.arc(birdX, birdY, r, 0, Math.PI * 2);
  ctx.fill();
  noGlow(ctx);
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.ellipse(birdX - r * 0.35, birdY + r * 0.2, r * 0.6, r * (0.28 + 0.14 * Math.sin(t * 16)), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(birdX + r * 0.9, birdY - r * 0.2);
  ctx.lineTo(birdX + r * 1.5, birdY + r * 0.1);
  ctx.lineTo(birdX + r * 0.9, birdY + r * 0.4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(birdX + r * 0.35, birdY - r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  glow(ctx, 'rgba(93,255,155,0.5)', 0);
  ctx.fillRect(0, ground, w, 2);
  ctx.fillStyle = 'rgba(93,255,155,0.16)';
  for (let x = -(scroll % 22); x < w; x += 22) ctx.fillRect(x, ground + 4, 11, 4);
}

function setpoint(ctx: Ctx, t: number, w: number, h: number) {
  const band = h * (0.14 + 0.04 * Math.sin(t * 0.4));
  const sp = h * (0.5 + 0.12 * Math.sin(t * 0.35));
  noGlow(ctx);
  ctx.fillStyle = 'rgba(76,242,255,0.12)';
  ctx.fillRect(0, sp - band, w, band * 2);
  ctx.strokeStyle = 'rgba(76,242,255,0.7)';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, sp);
  ctx.lineTo(w, sp);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let x = -(t * 40) % 34; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  // The process value: a settling loop that keeps getting bumped.
  const value = (x: number) => {
    const at = t - (w - x) / 90;
    const bump = at % 5;
    const spAt = h * (0.5 + 0.12 * Math.sin(at * 0.35));
    return spAt + h * 0.2 * Math.exp(-bump * 1.1) * Math.cos(bump * 4.2) + Math.sin(at * 9) * h * 0.008;
  };
  glow(ctx, PINK, 8);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let x = 0; x <= w; x += 3) { if (x === 0) ctx.moveTo(x, value(x)); else ctx.lineTo(x, value(x)); }
  ctx.stroke();
  glow(ctx, '#ffffff', 10);
  ctx.beginPath();
  ctx.arc(w - 2, value(w), 4, 0, Math.PI * 2);
  ctx.fill();
}

function chain(ctx: Ctx, t: number, w: number, h: number) {
  const round = Math.floor(t / 6);
  const time = t % 6;
  for (let i = 0; i < 26; i++) {
    const seed = round * 40 + i;
    const x = rand(seed) * w;
    const y = rand(seed + 200) * h;
    const color = NEONS[i % NEONS.length];
    const start = 0.5 + rand(seed + 400) * 3.2;
    const age = time - start;
    if (age < 0) {
      glow(ctx, color, 5);
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 2 + i) * 5, y + Math.cos(t * 1.7 + i) * 5, Math.max(2.5, h * 0.018), 0, Math.PI * 2);
      ctx.fill();
    } else if (age < 1.7) {
      const grow = Math.min(1, age / 0.45);
      const fade = age < 1.1 ? 1 : 1 - (age - 1.1) / 0.6;
      ctx.globalAlpha = 0.55 * fade;
      glow(ctx, color, 14);
      ctx.beginPath();
      ctx.arc(x, y, h * 0.17 * grow, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function merge(ctx: Ctx, t: number, w: number, h: number) {
  const cell = Math.max(14, Math.round(Math.min(w, h) / 6.5));
  const cols = Math.floor(w / cell) - 1;
  const rows = Math.floor(h / cell) - 1;
  const ox = (w - cols * cell) / 2;
  const oy = (h - rows * cell) / 2;
  const head = Math.floor(t * 3.5);
  const values = [64, 32, 16, 8, 4, 2];
  values.forEach((value, s) => {
    const [cx, cy] = loopCell(head - s, cols, rows);
    glow(ctx, TILE_COLORS[value] ?? CYAN, 7);
    roundRect(ctx, ox + cx * cell + 1, oy + cy * cell + 1, cell - 2, cell - 2, 4);
    noGlow(ctx);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${cell * 0.42}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), ox + (cx + 0.5) * cell, oy + (cy + 0.5) * cell + 1);
  });
  const px = ox + (cols / 2 - 0.5) * cell;
  const py = oy + (rows / 2 - 0.5) * cell + Math.sin(t * 3) * 3;
  glow(ctx, CYAN, 10 + 5 * Math.sin(t * 5));
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(px, py, cell, cell, 5);
  ctx.stroke();
  ctx.fillStyle = CYAN;
  ctx.font = `800 ${cell * 0.42}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('2', px + cell / 2, py + cell / 2 + 1);
}

function party(ctx: Ctx, t: number, w: number, h: number) {
  for (let i = 0; i < 34; i++) {
    const x = rand(i) * w + Math.sin(t + i) * 10;
    const y = ((rand(i + 50) * h + t * (22 + rand(i + 90) * 34)) % (h + 12)) - 6;
    glow(ctx, NEONS[i % NEONS.length], 5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 2 + i);
    ctx.fillRect(-3, -2, 6, 4);
    ctx.restore();
  }
  const phones = 3;
  const pw = Math.min(w * 0.17, h * 0.34);
  const ph = pw * 1.85;
  for (let i = 0; i < phones; i++) {
    const x = w / 2 + (i - 1) * pw * 1.35 - pw / 2;
    const y = h * 0.54 - ph / 2 + Math.sin(t * 2.4 + i * 1.3) * h * 0.035;
    const color = [CYAN, PINK, YELLOW][i];
    noGlow(ctx);
    ctx.fillStyle = INK;
    roundRect(ctx, x, y, pw, ph, pw * 0.16);
    glow(ctx, color, 10);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, pw, ph, pw * 0.16);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    roundRect(ctx, x + pw * 0.16, y + ph * 0.18, pw * 0.68, ph * 0.2, 2);
    ctx.globalAlpha = 0.45 + 0.3 * Math.sin(t * 3 + i);
    roundRect(ctx, x + pw * 0.16, y + ph * 0.48, pw * 0.68, ph * 0.28, 2);
    ctx.globalAlpha = 1;
  }
}

const SCENES: Record<AttractId, (ctx: Ctx, t: number, w: number, h: number) => void> = {
  snake, '2048': g2048, breakout, blocks, flap, setpoint, chain, merge, party,
};

/** Draw one frame of a game's scene; `t` is seconds. */
export function drawAttract(id: AttractId, ctx: Ctx, t: number, w: number, h: number) {
  noGlow(ctx);
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  SCENES[id](ctx, t, w, h);
  noGlow(ctx);
  ctx.globalAlpha = 1;
}
