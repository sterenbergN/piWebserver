// The sums behind the pen, with no browser in sight, so they can be tested: packing strokes
// for storage, finding what a touch hit, erasing part of a stroke, and turning a wobbly
// hand-drawn box into a straight one.

/** Twentieths of a point: finer than a screen shows even zoomed right in. */
const POSITION = 20;
const PRESSURE = 100;

/**
 * Absolute x, y, pressure triples into the stored form: whole numbers, each one the difference
 * from the last. A line written zoomed in (`detail` above 1) keeps halves, quarters or eighths
 * of those twentieths, so its points are as close to where the pencil was, on the glass, as a
 * line's written at the page's fit. They read back the same way either way.
 */
export function packPoints(pts: ArrayLike<number>, detail = 1) {
  const fine = detail > 4 ? 8 : detail > 2 ? 4 : detail > 1 ? 2 : 1;
  const out = new Array<number>(pts.length);
  let lastX = 0;
  let lastY = 0;
  let lastP = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const x = Math.round(pts[i] * POSITION * fine) / fine;
    const y = Math.round(pts[i + 1] * POSITION * fine) / fine;
    const p = Math.round(pts[i + 2] * PRESSURE);
    out[i] = x - lastX;
    out[i + 1] = y - lastY;
    out[i + 2] = p - lastP;
    lastX = x;
    lastY = y;
    lastP = p;
  }
  return out;
}

export function unpackPoints(packed: ArrayLike<number>) {
  const out = new Array<number>(packed.length);
  let x = 0;
  let y = 0;
  let p = 0;
  for (let i = 0; i < packed.length; i += 3) {
    x += packed[i];
    y += packed[i + 1];
    p += packed[i + 2];
    out[i] = x / POSITION;
    out[i + 1] = y / POSITION;
    out[i + 2] = p / PRESSURE;
  }
  return out;
}

export type Box = { x: number; y: number; w: number; h: number };

export function boundsOf(pts: ArrayLike<number>, pad = 0): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export const boxesTouch = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export function unionBoxes(boxes: Box[]): Box {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  return { x: minX, y: minY, w: Math.max(...boxes.map((b) => b.x + b.w)) - minX, h: Math.max(...boxes.map((b) => b.y + b.h)) - minY };
}

/** The squared distance from a point to a line segment. */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

/** Whether a point touches a stroke, within `radius`. */
export function strokeTouches(pts: ArrayLike<number>, x: number, y: number, radius: number) {
  const limit = radius * radius;
  if (pts.length === 3) return segmentDistance2(x, y, pts[0], pts[1], pts[0], pts[1]) <= limit;
  for (let i = 3; i < pts.length; i += 3) {
    if (segmentDistance2(x, y, pts[i - 3], pts[i - 2], pts[i], pts[i + 1]) <= limit) return true;
  }
  return false;
}

/**
 * What's left of a stroke after an eraser passes along `from`→`to`: the runs of points it
 * didn't touch, each a stroke of its own, or null if it wasn't touched at all. Fast strokes
 * have points far apart, so the gaps are filled in first or the eraser would pass between them.
 */
export function eraseFromStroke(pts: ArrayLike<number>, from: [number, number], to: [number, number], radius: number): number[][] | null {
  const limit = radius * radius;
  const step = Math.max(radius / 2, 0.25);
  const runs: number[][] = [];
  let run: number[] = [];
  let touched = false;
  const consider = (x: number, y: number, p: number) => {
    if (segmentDistance2(x, y, from[0], from[1], to[0], to[1]) <= limit) {
      touched = true;
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(x, y, p);
    }
  };
  consider(pts[0], pts[1], pts[2]);
  for (let i = 3; i < pts.length; i += 3) {
    const ax = pts[i - 3];
    const ay = pts[i - 2];
    const bx = pts[i];
    const by = pts[i + 1];
    const parts = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let part = 1; part < parts; part++) {
      const t = part / parts;
      // Only worth keeping the extra points where they're next to the eraser.
      const mx = ax + (bx - ax) * t;
      const my = ay + (by - ay) * t;
      if (segmentDistance2(mx, my, from[0], from[1], to[0], to[1]) <= limit * 4) consider(mx, my, pts[i - 1] + (pts[i + 2] - pts[i - 1]) * t);
    }
    consider(bx, by, pts[i + 2]);
  }
  if (run.length) runs.push(run);
  return touched ? runs : null;
}

export function pointInPolygon(x: number, y: number, polygon: number[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const xi = polygon[i];
    const yi = polygon[i + 1];
    const xj = polygon[j];
    const yj = polygon[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a lasso has caught a stroke: most of it, so grazing one doesn't count. */
export function lassoCatchesStroke(pts: ArrayLike<number>, polygon: number[]) {
  const count = pts.length / 3;
  const stride = Math.max(1, Math.floor(count / 24));
  let tried = 0;
  let caught = 0;
  for (let i = 0; i < count; i += stride) {
    tried += 1;
    if (pointInPolygon(pts[i * 3], pts[i * 3 + 1], polygon)) caught += 1;
  }
  return caught / tried >= 0.6;
}

export function lassoCatchesBox(box: Box, polygon: number[]) {
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h], [box.x + box.w / 2, box.y + box.h / 2]];
  return corners.filter(([x, y]) => pointInPolygon(x, y, polygon)).length >= 3;
}

/** Moved, scaled about and turned about a centre. Enough for everything the selection handles do. */
export type Move = { dx: number; dy: number; scale: number; rot: number; cx: number; cy: number };
export const NO_MOVE: Move = { dx: 0, dy: 0, scale: 1, rot: 0, cx: 0, cy: 0 };

export function movePoint(x: number, y: number, move: Move): [number, number] {
  const cos = Math.cos(move.rot);
  const sin = Math.sin(move.rot);
  const rx = (x - move.cx) * move.scale;
  const ry = (y - move.cy) * move.scale;
  return [move.cx + rx * cos - ry * sin + move.dx, move.cy + rx * sin + ry * cos + move.dy];
}

export function movePoints(pts: ArrayLike<number>, move: Move) {
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    const [x, y] = movePoint(pts[i], pts[i + 1], move);
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = pts[i + 2];
  }
  return out;
}

/** A box (with its own turn) after a move: its centre goes where the move says, and it keeps its shape. */
export function moveBox(box: { x: number; y: number; w: number; h: number; rot: number }, move: Move) {
  const [cx, cy] = movePoint(box.x + box.w / 2, box.y + box.h / 2, move);
  const w = box.w * move.scale;
  const h = box.h * move.scale;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: box.rot + move.rot };
}

/** The screen-space box around a turned rectangle. */
export function turnedBounds(box: { x: number; y: number; w: number; h: number; rot: number }): Box {
  if (!box.rot) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = Math.abs(box.w * Math.cos(box.rot)) + Math.abs(box.h * Math.sin(box.rot));
  const h = Math.abs(box.w * Math.sin(box.rot)) + Math.abs(box.h * Math.cos(box.rot));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Whether a point is inside a turned rectangle. */
export function pointInBox(x: number, y: number, box: { x: number; y: number; w: number; h: number; rot: number }, pad = 0) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const cos = Math.cos(-box.rot);
  const sin = Math.sin(-box.rot);
  const lx = (x - cx) * cos - (y - cy) * sin;
  const ly = (x - cx) * sin + (y - cy) * cos;
  return Math.abs(lx) <= box.w / 2 + pad && Math.abs(ly) <= box.h / 2 + pad;
}

// ── Shapes ───────────────────────────────────────────────────────────────────────

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle';

const MIDDLE_PRESSURE = 0.5;

const toPoints = (flat: number[]) => {
  const out: number[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(flat[i], flat[i + 1], MIDDLE_PRESSURE);
  return out;
};

function ellipsePoints(cx: number, cy: number, rx: number, ry: number) {
  const steps = 72;
  const flat: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    flat.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return toPoints(flat);
}

/** A shape stretched between where a drag started and where it is now. */
export function shapeFromDrag(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, width = 1.5) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  if (kind === 'line') return toPoints([x0, y0, x1, y1]);
  if (kind === 'rect') return toPoints([left, top, right, top, right, bottom, left, bottom, left, top]);
  if (kind === 'ellipse') return ellipsePoints((left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2);
  if (kind === 'triangle') return toPoints([(left + right) / 2, top, right, bottom, left, bottom, (left + right) / 2, top]);
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  const head = Math.min(length * 0.4, Math.max(9, width * 5));
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const wing = (turn: number) => [x1 - head * Math.cos(angle + turn), y1 - head * Math.sin(angle + turn)];
  return toPoints([x0, y0, x1, y1, ...wing(0.45), x1, y1, ...wing(-0.45)]);
}

/** Ramer–Douglas–Peucker: the few corners a wobbly line is really made of. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let farthest = -1;
    let distance = tolerance * tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance2(points[i][0], points[i][1], points[from][0], points[from][1], points[to][0], points[to][1]);
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = true;
      stack.push([from, farthest], [farthest, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const ANGLE_SNAP = (5 * Math.PI) / 180;

/** A line that was nearly level or upright is meant to be. */
function straighten(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  for (let quarter = -4; quarter <= 4; quarter++) {
    const target = (quarter * Math.PI) / 4;
    if (Math.abs(angle - target) < ANGLE_SNAP) return [x0 + length * Math.cos(target), y0 + length * Math.sin(target)];
  }
  return [x1, y1];
}

/**
 * What shape a hand-drawn stroke was going for, as the points of a clean one, or null if it
 * doesn't look like anything. Tried in order of how sure each answer can be.
 */
export function recognizeShape(pts: ArrayLike<number>): { kind: ShapeKind; pts: number[] } | null {
  const points: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 3) points.push([pts[i], pts[i + 1]]);
  if (points.length < 2) return null;
  const box = boundsOf(pts);
  const size = Math.max(box.w, box.h);
  if (size < 6) return null;

  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const [first, last] = [points[0], points[points.length - 1]];
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);

  if (chord / length > 0.93) {
    const [x1, y1] = straighten(first[0], first[1], last[0], last[1]);
    return { kind: 'line', pts: shapeFromDrag('line', first[0], first[1], x1, y1) };
  }
  // An open scribble isn't a closed shape, however it wiggles.
  if (chord > Math.max(size * 0.28, length * 0.15)) return null;

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2;
  const ry = box.h / 2;
  if (rx < 2 || ry < 2) return null;
  const ellipseError = points.reduce((sum, [x, y]) => sum + Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1), 0) / points.length;

  const corners = simplify(points, size * 0.09);
  const closedCorners = Math.hypot(corners[0][0] - corners[corners.length - 1][0], corners[0][1] - corners[corners.length - 1][1]) < size * 0.28 ? corners.slice(0, -1) : corners;

  if (closedCorners.length === 3 && ellipseError > 0.08) {
    return { kind: 'triangle', pts: toPoints([...closedCorners.flat(), ...closedCorners[0]]) };
  }
  if (closedCorners.length === 4 && ellipseError > 0.08) {
    const rectError = points.reduce((sum, [x, y]) => {
      const fromSide = Math.min(Math.abs(x - box.x), Math.abs(x - box.x - box.w), Math.abs(y - box.y), Math.abs(y - box.y - box.h));
      return sum + fromSide;
    }, 0) / points.length / size;
    if (rectError < 0.06) return { kind: 'rect', pts: shapeFromDrag('rect', box.x, box.y, box.x + box.w, box.y + box.h) };
    return { kind: 'rect', pts: toPoints([...closedCorners.flat(), ...closedCorners[0]]) };
  }
  if (ellipseError < 0.14) {
    // Close to round is meant to be round.
    const round = Math.abs(rx - ry) / Math.max(rx, ry) < 0.12;
    const r = (rx + ry) / 2;
    return { kind: 'ellipse', pts: ellipsePoints(cx, cy, round ? r : rx, round ? r : ry) };
  }
  return null;
}
