import { getStroke, getStrokeOutlinePoints, getStrokePoints, type StrokeOptions, type StrokePoint } from 'perfect-freehand';

// The sums that turn a pencil's points into a line with a shape, with no browser in sight, so
// they can be tested. perfect-freehand does the work; this is how it's asked.
//
// Its thresholds are distances, tuned for a line worked out in what the screen shows. Ours are
// worked out on the page, which is the same thing until you zoom in: then the same hand, moving
// the same way over the glass, is making a line a fraction of the size on the page, and
// thresholds that were a pixel or two become a good part of a letter. Curves turn into corners
// and the ends of strokes into straight stubs. So a line knows how far zoomed in it was written
// (its `detail`: 1 at the zoom a page fits an iPad at, 3 at three times that), and its
// thresholds are that much finer, which makes them the same on the glass at any zoom.

/** The zoom, in screen pixels to a point of the page, the pen's smoothing was tuned at: a page fitting an iPad's width. */
const TUNED_ZOOM = 1.3;
const MAX_DETAIL = 8;

/** How finely to work out a line written at this zoom. Close to the tuned zoom, and anywhere further out, it's 1. */
export function detailAt(zoom: number) {
  const detail = zoom / TUNED_ZOOM;
  return detail < 1.15 ? 1 : Math.min(MAX_DETAIL, Math.round(detail * 100) / 100);
}

/** A detail from storage or another device, made safe. */
export const cleanDetail = (value: unknown) =>
  (typeof value === 'number' && Number.isFinite(value) && value > 1 ? Math.min(MAX_DETAIL, Math.round(value * 100) / 100) : 1);

export type Ends = { start: boolean; end: boolean };
const PLAIN_END = { cap: true, taper: 0 };

function triples(pts: ArrayLike<number>) {
  const out: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2]]);
  return out;
}

/**
 * The outline of a line from its smoothed points. Finer detail is had by working it out on a
 * page blown up that many times, which shrinks every distance the library goes by, and asking
 * for outline points that much closer together. A line's taper is a distance too, so a brush
 * stroke written zoomed in tapers over as much of the glass as one written at the page's fit.
 */
export function outlineFromPoints(points: StrokePoint[], options: StrokeOptions, width: number, finished: boolean, detail = 1, ends: Ends = { start: true, end: true }) {
  const asked = { ...options, last: finished, ...(ends.start ? {} : { start: PLAIN_END }), ...(ends.end ? {} : { end: PLAIN_END }) };
  if (detail <= 1) return getStrokeOutlinePoints(points, { ...asked, size: width }) as number[][];
  const k = detail;
  const blownUp = points.map((p) => ({ point: [p.point[0] * k, p.point[1] * k], pressure: p.pressure, vector: p.vector, distance: p.distance * k, runningLength: p.runningLength * k }) as StrokePoint);
  const outline = getStrokeOutlinePoints(blownUp, { ...asked, size: width * k, smoothing: (options.smoothing ?? 0.5) / k });
  return outline.map(([x, y]) => [x / k, y / k]);
}

/** A whole line's outline, from its points as stored (x, y, pressure, ...). */
export function outlineOfLine(pts: ArrayLike<number>, options: StrokeOptions, width: number, finished: boolean, detail = 1, ends: Ends = { start: true, end: true }) {
  // Lines from before detail was kept, and ones written at the page's fit, go the way they always have.
  if (detail <= 1) {
    return getStroke(triples(pts), { ...options, size: width, last: finished, ...(ends.start ? {} : { start: PLAIN_END }), ...(ends.end ? {} : { end: PLAIN_END }) }) as number[][];
  }
  // The start of a line is skipped until it's as long as the pen is wide: that's a distance too.
  const points = getStrokePoints(triples(pts), { streamline: options.streamline, size: width / detail, last: finished });
  return outlineFromPoints(points, options, width, finished, detail, ends);
}

// ── The line being written ───────────────────────────────────────────────────────
//
// perfect-freehand's smoothing of a line (getStrokePoints), kept up as the line grows. Each
// point is smoothed from the one before, so what's done stays done: a frame only smooths the
// points that came in since the last. It has to match the library exactly, since the saved line
// is drawn by the library, so it follows its code step for step (notes.test.ts checks the two
// agree).

export type Smoothing = {
  streamline: number;
  /** How long the line gets before its first points count. */
  skip: number;
  /** Points done for good: every raw point before the newest. */
  points: StrokePoint[];
  /** Raw points smoothed into `points`. */
  used: number;
  runningLength: number;
  reached: boolean;
};

const pressureOf = (value: number | undefined) => (value != null && value >= 0 ? value : 0.5);

export function startSmoothing(streamline: number, width: number, detail = 1): Smoothing {
  return { streamline, skip: width / Math.max(1, detail), points: [], used: 0, runningLength: 0, reached: false };
}

/** One raw point into the smoothing, as the library would take it when it isn't the last. */
function take(state: Smoothing, x: number, y: number, pressure: number, isLast: boolean, into: StrokePoint[], t: number) {
  const prev = into[into.length - 1];
  const px = prev.point[0];
  const py = prev.point[1];
  const nx = px + (x - px) * t;
  const ny = py + (y - py) * t;
  if (px === nx && py === ny) return state.runningLength;
  const distance = Math.hypot(nx - px, ny - py);
  const runningLength = state.runningLength + distance;
  if (!isLast && !state.reached) {
    if (runningLength < state.skip) return runningLength;
    state.reached = true;
  }
  const dx = px - nx;
  const dy = py - ny;
  const length = Math.hypot(dx, dy);
  into.push({ point: [nx, ny], pressure: pressureOf(pressure), vector: [dx / length, dy / length], distance, runningLength });
  return runningLength;
}

/** The smoothed line for these raw points (x, y, pressure, ...), carrying on from what's done. */
export function smoothLine(state: Smoothing, pts: ArrayLike<number>): StrokePoint[] {
  const count = pts.length / 3;
  // Short lines are a special case in the library, and a line that's been cut short starts over.
  if (count < 3 || count - 1 < state.used) {
    if (count >= 3) Object.assign(state, { points: [], used: 0, runningLength: 0, reached: false });
    else return count ? getStrokePoints(triples(pts), { streamline: state.streamline, size: state.skip, last: false }) : [];
  }
  const t = 0.15 + (1 - state.streamline) * 0.85;
  if (!state.points.length) {
    state.points.push({ point: [pts[0], pts[1]], pressure: pts[2] != null && pts[2] >= 0 ? pts[2] : 0.25, vector: [1, 1], distance: 0, runningLength: 0 });
    state.used = 1;
  }
  // Everything but the newest point is done for good.
  for (let i = state.used; i < count - 1; i++) {
    state.runningLength = take(state, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], false, state.points, t);
  }
  state.used = Math.max(state.used, count - 1);
  // The newest point is taken on a copy: with the next point it'll be taken again, as not the last.
  const out = state.points.slice();
  const held = { ...state };
  take(held, pts[(count - 1) * 3], pts[(count - 1) * 3 + 1], pts[(count - 1) * 3 + 2], true, out, t);
  if (out.length > 1) out[0] = { ...out[0], vector: out[1].vector };
  else out[0] = { ...out[0], vector: [0, 0] };
  return out;
}
