'use client';

import { getStroke } from 'perfect-freehand';
import { boundsOf, turnedBounds, unpackPoints, type Box } from '@/lib/notes/geometry';
import type { ImageElement, MarkElement, MarkRole, PageElement, StrokeElement, StrokeStyle, TextElement, TextFont } from '@/lib/notes/items';

// Turning strokes into shapes on a canvas. A stroke's outline comes from perfect-freehand, as
// a filled shape, so it's the same at any zoom, and the wet line under the pencil is drawn by
// the same sums as the finished one, so nothing shifts when you lift. Outlines cost something
// to work out, so each one is kept beside its stroke until the stroke goes away.

export const STROKE_OPTIONS: Record<Exclude<StrokeStyle, 'shape'>, Parameters<typeof getStroke>[1]> = {
  ball: { thinning: 0.22, smoothing: 0.6, streamline: 0.32, simulatePressure: false },
  fountain: { thinning: 0.68, smoothing: 0.62, streamline: 0.38, simulatePressure: false },
  brush: { thinning: 0.92, smoothing: 0.7, streamline: 0.42, simulatePressure: false, start: { taper: 16 }, end: { taper: 22 } },
  marker: { thinning: 0, smoothing: 0.7, streamline: 0.55, simulatePressure: false },
  tape: { thinning: 0, smoothing: 0.7, streamline: 0.6, simulatePressure: false },
};

type Cached = { pts: number[]; box?: Box; path?: Path2D };
const cache = new WeakMap<StrokeElement, Cached>();

function cached(stroke: StrokeElement) {
  let held = cache.get(stroke);
  if (!held) {
    held = { pts: unpackPoints(stroke.p) };
    cache.set(stroke, held);
  }
  return held;
}

export const strokePoints = (stroke: StrokeElement) => cached(stroke).pts;

/** The space a stroke takes up, including its thickness. */
export function strokeBox(stroke: StrokeElement) {
  const held = cached(stroke);
  if (!held.box) held.box = boundsOf(held.pts, stroke.width);
  return held.box;
}

export function elementBox(element: PageElement): Box {
  return element.kind === 'stroke' ? strokeBox(element) : turnedBounds(element);
}

/** A flat list of x, y, pressure as the triples perfect-freehand takes. */
function triples(pts: ArrayLike<number>) {
  const out: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2]]);
  return out;
}

/** An outline as a path, with its corners smoothed through their midpoints. */
export function outlineCommands(outline: number[][]) {
  const commands: (['M' | 'L', number, number] | ['Q', number, number, number, number] | ['Z'])[] = [];
  if (!outline.length) return commands;
  commands.push(['M', outline[0][0], outline[0][1]]);
  for (let i = 1; i < outline.length; i++) {
    const [x, y] = outline[i];
    const [nx, ny] = outline[(i + 1) % outline.length];
    commands.push(['Q', x, y, (x + nx) / 2, (y + ny) / 2]);
  }
  commands.push(['Z']);
  return commands;
}

export function outlineOf(pts: ArrayLike<number>, style: StrokeStyle, width: number, finished: boolean) {
  const options = STROKE_OPTIONS[style === 'shape' ? 'ball' : style];
  return getStroke(triples(pts), { ...options, size: width, last: finished }) as number[][];
}

function filledPath(pts: ArrayLike<number>, style: StrokeStyle, width: number, finished: boolean) {
  const path = new Path2D();
  for (const command of outlineCommands(outlineOf(pts, style, width, finished))) {
    if (command[0] === 'M') path.moveTo(command[1], command[2]);
    else if (command[0] === 'L') path.lineTo(command[1], command[2]);
    else if (command[0] === 'Q') path.quadraticCurveTo(command[1], command[2], command[3], command[4]);
    else path.closePath();
  }
  return path;
}

function linePath(pts: ArrayLike<number>) {
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  if (pts.length === 3) path.lineTo(pts[0] + 0.01, pts[1]);
  for (let i = 3; i < pts.length; i += 3) path.lineTo(pts[i], pts[i + 1]);
  return path;
}

export const MARKER_ALPHA = 0.42;

/** Paint a path made by either of the above, in the way its style wants. */
function paintPath(ctx: CanvasRenderingContext2D, path: Path2D, style: StrokeStyle, color: string, width: number, darkPaper: boolean, revealed = false) {
  ctx.fillStyle = color;
  if (style === 'shape') {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    return;
  }
  if (style === 'marker') {
    // Multiplying lets the writing underneath show through at full strength, as real
    // highlighter does. Nothing multiplies against dark paper, so there it's see-through instead.
    ctx.save();
    if (darkPaper) ctx.globalAlpha = MARKER_ALPHA;
    else ctx.globalCompositeOperation = 'multiply';
    ctx.fill(path);
    ctx.restore();
    return;
  }
  if (style === 'tape') {
    ctx.save();
    if (revealed) ctx.globalAlpha = 0.14;
    ctx.fill(path);
    ctx.restore();
    return;
  }
  ctx.fill(path);
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeElement, darkPaper: boolean, revealed = false) {
  const held = cached(stroke);
  if (!held.path) held.path = stroke.style === 'shape' ? linePath(held.pts) : filledPath(held.pts, stroke.style, stroke.width, true);
  paintPath(ctx, held.path, stroke.style, stroke.color, stroke.width, darkPaper, revealed);
}

/** The line still being drawn. `flat` is for one that's been snapped to a clean shape. */
export function drawWet(ctx: CanvasRenderingContext2D, pts: ArrayLike<number>, style: StrokeStyle, color: string, width: number, flat: boolean) {
  // On the live layer, which is blended by CSS, so a marker needs no blending of its own.
  if (flat || style === 'shape') {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(linePath(pts));
    return;
  }
  ctx.fillStyle = color;
  ctx.fill(filledPath(pts, style, width, false));
}

// ── Text ─────────────────────────────────────────────────────────────────────────

export const FONT_STACKS: Record<TextFont, string> = {
  sans: "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif",
  serif: "'Newsreader Variable', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  hand: "'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive",
};

export const TEXT_LINE_HEIGHT = 1.3;

export const textFont = (element: Pick<TextElement, 'size' | 'font' | 'bold' | 'italic'>, scale = 1) =>
  `${element.italic ? 'italic ' : ''}${element.bold ? '700 ' : ''}${element.size * scale}px ${FONT_STACKS[element.font]}`;

let measure: CanvasRenderingContext2D | null = null;
function measuring() {
  if (!measure) measure = document.createElement('canvas').getContext('2d');
  return measure!;
}

/** The lines a text box breaks into, the same way for the screen and for an exported PDF. */
export function layoutText(element: Pick<TextElement, 'text' | 'w' | 'size' | 'font' | 'bold' | 'italic'>) {
  const ctx = measuring();
  ctx.font = textFont(element);
  const lines: string[] = [];
  for (const paragraph of element.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(?<=\s)/)) {
      const attempt = line + word;
      if (line && ctx.measureText(attempt.trimEnd()).width > element.w) {
        lines.push(line.trimEnd());
        line = word;
      } else {
        line = attempt;
      }
      // One word wider than the box breaks wherever it has to.
      while (ctx.measureText(line.trimEnd()).width > element.w && line.length > 1) {
        let fit = line.length - 1;
        while (fit > 1 && ctx.measureText(line.slice(0, fit)).width > element.w) fit -= 1;
        lines.push(line.slice(0, fit));
        line = line.slice(fit);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export const textHeight = (element: Pick<TextElement, 'text' | 'w' | 'size' | 'font' | 'bold' | 'italic'>) => layoutText(element).length * element.size * TEXT_LINE_HEIGHT;

/** Turned about their middle, so a box's x and y stay where they'd be without the turn. */
function withTurn(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number; rot: number }, draw: () => void) {
  if (!box.rot) { draw(); return; }
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(box.rot);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

export function drawText(ctx: CanvasRenderingContext2D, element: TextElement) {
  withTurn(ctx, element, () => {
    ctx.font = textFont(element);
    ctx.fillStyle = element.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = element.align ?? 'left';
    const x = element.align === 'center' ? element.x + element.w / 2 : element.align === 'right' ? element.x + element.w : element.x;
    const lineHeight = element.size * TEXT_LINE_HEIGHT;
    // The same place a textarea puts its first line: the spare height of the line goes half above.
    const firstBaseline = element.y + (lineHeight - element.size) / 2 + element.size * 0.82;
    layoutText(element).forEach((line, i) => ctx.fillText(line, x, firstBaseline + i * lineHeight));
    ctx.textAlign = 'left';
  });
}

export const MARK_COLORS: Record<MarkRole, string> = { link: '#2f6fed', heading: '#e07b1a', keyword: '#2c8a57' };
const MARK_PAD = 2.5;

/** A link, heading or keyword over its ink: a faint box in its colour, so the writing stays readable. */
export function drawMark(ctx: CanvasRenderingContext2D, mark: MarkElement) {
  const color = MARK_COLORS[mark.role];
  const x = mark.x - MARK_PAD;
  const y = mark.y - MARK_PAD;
  const w = mark.w + MARK_PAD * 2;
  const h = mark.h + MARK_PAD * 2;
  const box = () => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3);
    else ctx.rect(x, y, w, h);
  };
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.09;
  box();
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 0.9;
  if (mark.role === 'heading') {
    // A bar down the left, heavier for a bigger heading.
    ctx.fillRect(x - 4, y, mark.level === 1 || !mark.level ? 3 : mark.level === 2 ? 2 : 1.2, h);
  } else if (mark.role === 'link') {
    ctx.beginPath();
    ctx.moveTo(x + 1, y + h);
    ctx.lineTo(x + w - 1, y + h);
    ctx.stroke();
    ctx.font = `600 ${Math.min(9, Math.max(6, h * 0.35))}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('↗', x + w + 8, y + 6);
    ctx.textAlign = 'left';
  } else {
    ctx.setLineDash([2.5, 2]);
    box();
    ctx.stroke();
  }
  ctx.restore();
}

export const markBox = (mark: MarkElement) => ({ x: mark.x - MARK_PAD, y: mark.y - MARK_PAD, w: mark.w + MARK_PAD * 2, h: mark.h + MARK_PAD * 2, rot: mark.rot });

export function drawImageElement(ctx: CanvasRenderingContext2D, element: ImageElement, bitmap: CanvasImageSource | null) {
  withTurn(ctx, element, () => {
    if (bitmap) {
      ctx.drawImage(bitmap, element.x, element.y, element.w, element.h);
    } else {
      ctx.fillStyle = 'rgba(120,130,150,0.18)';
      ctx.fillRect(element.x, element.y, element.w, element.h);
    }
  });
}
