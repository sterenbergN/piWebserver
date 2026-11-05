import { getStrokePoints, type StrokePoint } from 'perfect-freehand';

// perfect-freehand's smoothing of a line (getStrokePoints), kept up as the line grows, for the
// line being written. Each point is smoothed from the one before, so what's done stays done:
// a frame only smooths the points that came in since the last. It has to match the library
// exactly, since the saved line is drawn by the library, so it follows its code step for step
// (lib/notes/notes.test.ts checks the two agree).

export type Smoothing = {
  streamline: number;
  size: number;
  /** Points done for good: every raw point before the newest. */
  points: StrokePoint[];
  /** Raw points smoothed into `points`. */
  used: number;
  runningLength: number;
  reached: boolean;
};

const pressureOf = (value: number | undefined) => (value != null && value >= 0 ? value : 0.5);

export function startSmoothing(streamline: number, size: number): Smoothing {
  return { streamline, size, points: [], used: 0, runningLength: 0, reached: false };
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
  // Near the start, points are left out until the line is as long as the pen is wide.
  if (!isLast && !state.reached) {
    if (runningLength < state.size) return runningLength;
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
    if (count >= 3) Object.assign(state, startSmoothing(state.streamline, state.size));
    else return count ? getStrokePoints(triplesOf(pts), { streamline: state.streamline, size: state.size, last: false }) : [];
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

function triplesOf(pts: ArrayLike<number>) {
  const out: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2]]);
  return out;
}
