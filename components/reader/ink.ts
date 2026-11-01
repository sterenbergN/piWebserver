import type { InkColor, Stroke } from '@/lib/reader/items';
import type { InkOrigin, ReaderTheme } from './source';

// Drawing pen marks: the same few lines for the page, the live stroke and the notes.

export const PEN_COLORS: InkColor[] = ['ink', 'red', 'blue', 'green'];
export const MARKER_COLORS: InkColor[] = ['yellow', 'mint', 'pink', 'blue'];

const COLOR_VALUES: Record<InkColor, string> = {
  ink: '#1d1f27', red: '#d13a32', blue: '#2a6bd1', green: '#2c8a57', yellow: '#f6d23c', pink: '#f08bb4', mint: '#6fd6a8',
};

export function inkColor(color: InkColor, theme: ReaderTheme) {
  if (color === 'ink' && theme === 'night') return '#ecebe6';
  if (theme === 'night' && color === 'red') return '#ff7b72';
  if (theme === 'night' && color === 'blue') return '#79aefc';
  return COLOR_VALUES[color];
}

/** Pen width on screen, before pressure. */
export const PEN_PIXELS = 2.2;
export const MARKER_PIXELS = 18;

function pressureWidth(base: number, pressure: number) {
  return base * (0.45 + pressure * 1.1);
}

/**
 * Draw `points` (x, y, pressure, repeated) that are already in pixels. A pen varies with
 * pressure, so it's drawn piece by piece; a marker is one see-through path, so it
 * doesn't darken where it crosses itself.
 */
export function drawPixels(ctx: CanvasRenderingContext2D, tool: Stroke['tool'], color: string, width: number, points: number[]) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const count = points.length / 3;
  if (count < 2) {
    ctx.beginPath();
    ctx.globalAlpha = tool === 'marker' ? 0.35 : 1;
    ctx.arc(points[0], points[1], (tool === 'marker' ? width : pressureWidth(width, points[2])) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  if (tool === 'marker') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 3; i < points.length; i += 3) ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  // Smooth through the middles of each pair of points.
  let fromX = points[0];
  let fromY = points[1];
  for (let i = 3; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const isLast = i + 3 >= points.length;
    const toX = isLast ? x : (x + points[i + 3]) / 2;
    const toY = isLast ? y : (y + points[i + 4]) / 2;
    ctx.lineWidth = pressureWidth(width, (points[i - 1] + points[i + 2]) / 2);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.quadraticCurveTo(x, y, toX, toY);
    ctx.stroke();
    fromX = toX;
    fromY = toY;
  }
}

/** A saved stroke, at its place on screen. */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, origin: InkOrigin, theme: ReaderTheme) {
  const pixels = new Array<number>(stroke.pts.length);
  for (let i = 0; i < stroke.pts.length; i += 3) {
    pixels[i] = origin.ox + stroke.pts[i] * origin.scale;
    pixels[i + 1] = origin.oy + stroke.pts[i + 1] * origin.scale;
    pixels[i + 2] = stroke.pts[i + 2];
  }
  drawPixels(ctx, stroke.tool, inkColor(stroke.color, theme), stroke.width * origin.scale, pixels);
}

/** Make a canvas's pixels match the screen's, and draw in CSS pixels from then on. */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** A stroke as an SVG path, for handwritten notes in the list. */
export function strokePath(stroke: Stroke) {
  const { pts } = stroke;
  let path = `M${pts[0]} ${pts[1]}`;
  if (pts.length === 3) return `${path}h0.0001`;
  for (let i = 3; i < pts.length; i += 3) path += `L${pts[i]} ${pts[i + 1]}`;
  return path;
}
